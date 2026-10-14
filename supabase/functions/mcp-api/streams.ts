import { normalizeCriteria, ruleCriteria } from '../_shared/sweepMatching.ts';
import {
  ApiError,
  type Args,
  type Ctx,
  LOGICS,
  type RuleRow,
  STREAM_COLUMNS,
  STREAM_FIELDS,
  type StreamRow,
  badRequest,
  byId,
  criteriaArg,
  criteriaView,
  describeCriteria,
  loadRules,
  loadStreams,
  oneOf,
  optBool,
  optInt,
  optString,
  refersToStream,
  reqString,
  reqUuid,
} from './common.ts';

// The stream editor's palette; new streams get a random one, as in the UI.
const ACCENT_COLORS = [
  '#7c3aed', '#2563eb', '#16a34a', '#d97706', '#dc2626',
  '#06b6d4', '#ec4899', '#8b5cf6', '#f59e0b', '#10b981',
];

function optColor(args: Args): string | undefined {
  const v = optString(args, 'color', 7);
  if (v === undefined) return undefined;
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw badRequest('color must be a hex color like #2563eb');
  return v.toLowerCase();
}

function streamView(s: StreamRow, streams: Map<string, StreamRow>, position: number) {
  const criteria = normalizeCriteria(s.criteria);
  const logic = s.criteria_logic === 'or' ? 'or' : 'and';
  return {
    id: s.id,
    name: s.name,
    ...(s.icon ? { icon: s.icon } : {}),
    color: s.accent,
    enabled: s.is_enabled,
    position,
    logic,
    criteria: criteriaView(criteria, streams),
    summary: describeCriteria(criteria, logic, streams),
  };
}

/** Sweep rules and other streams that use this stream as a condition. */
function usersOf(stream: StreamRow, rules: RuleRow[], streams: StreamRow[]) {
  return {
    rules: rules.filter((r) => refersToStream(ruleCriteria(r), stream)).map((r) => ({ id: r.id, name: r.name })),
    streams: streams
      .filter((s) => s.id !== stream.id && refersToStream(normalizeCriteria(s.criteria), stream))
      .map((s) => ({ id: s.id, name: s.name })),
  };
}

/** Rules and streams that point at this stream by name (older data) rather than by id. */
function nameReferences(stream: StreamRow, rules: RuleRow[], streams: StreamRow[]): string[] {
  const byName = (criteria: { field: string; value: string }[]) =>
    criteria.some((c) => c.field === 'stream' && c.value.toLowerCase() === stream.name.toLowerCase());
  return [
    ...rules.filter((r) => byName(ruleCriteria(r))).map((r) => `rule "${r.name}"`),
    ...streams.filter((s) => s.id !== stream.id && byName(normalizeCriteria(s.criteria))).map((s) => `stream "${s.name}"`),
  ];
}

function checkNameFree(streams: StreamRow[], name: string, exceptId?: string): void {
  const clash = streams.find((s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new ApiError(409, `There's already a stream named "${clash.name}" (${clash.id}).`);
}

const listNames = (xs: { name: string }[]) => xs.map((x) => `"${x.name}"`).join(', ');

/** Moves one stream to `position` and renumbers sort_order 0..n-1. Returns the new order. */
async function placeStream(ctx: Ctx, streams: StreamRow[], id: string, position: number): Promise<StreamRow[]> {
  const order = [...streams].sort((a, b) => a.sort_order - b.sort_order);
  const [moving] = order.splice(order.findIndex((s) => s.id === id), 1);
  order.splice(Math.min(position, order.length), 0, moving);
  const results = await Promise.all(
    order
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => s.sort_order !== i)
      .map(({ s, i }) => ctx.admin.from('columns').update({ sort_order: i }).eq('id', s.id).eq('user_id', ctx.userId)),
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
  return order.map((s, i) => ({ ...s, sort_order: i }));
}

// ---- Ops ---------------------------------------------------------------------

export async function listStreams(ctx: Ctx) {
  const [streams, rules] = await Promise.all([loadStreams(ctx), loadRules(ctx)]);
  const map = byId(streams);
  return {
    streams: streams.map((s, i) => {
      const used = usersOf(s, rules, streams);
      return {
        ...streamView(s, map, i),
        ...(used.rules.length ? { used_by_rules: used.rules } : {}),
        ...(used.streams.length ? { used_by_streams: used.streams } : {}),
      };
    }),
  };
}

export async function createStream(ctx: Ctx, args: Args) {
  const streams = await loadStreams(ctx);
  const name = reqString(args, 'name', 60);
  checkNameFree(streams, name);
  const criteria = criteriaArg(args.criteria, STREAM_FIELDS, streams);
  const logic = oneOf(args, 'logic', LOGICS) ?? 'and';
  const icon = optString(args, 'icon', 16) ?? '';
  const color = optColor(args) ?? ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)];
  const enabled = optBool(args, 'enabled') ?? true;
  const position = optInt(args, 'position', 0, 10_000);

  const { data, error } = await ctx.admin
    .from('columns')
    .insert({
      user_id: ctx.userId,
      name,
      icon,
      accent: color,
      criteria,
      criteria_logic: logic,
      sort_order: streams.reduce((max, s) => Math.max(max, s.sort_order + 1), 0),
      is_enabled: enabled,
    })
    .select(STREAM_COLUMNS)
    .single();
  if (error) throw error;
  const row = data as StreamRow;

  let order = [...streams, row];
  if (position !== undefined) order = await placeStream(ctx, order, row.id, position);
  return { stream: streamView(row, byId(order), order.findIndex((s) => s.id === row.id)) };
}

export async function updateStream(ctx: Ctx, args: Args) {
  const streamId = reqUuid(args, 'stream_id');
  const [streams, rules] = await Promise.all([loadStreams(ctx), loadRules(ctx)]);
  const existing = streams.find((s) => s.id === streamId);
  if (!existing) throw new ApiError(404, `No stream ${streamId}. maildeck_list_streams lists them.`);
  const before = streamView(existing, byId(streams), streams.indexOf(existing));
  const updates: Record<string, unknown> = {};

  const name = optString(args, 'name', 60);
  if (name !== undefined && !name) throw badRequest("name can't be empty");
  if (name !== undefined && name !== existing.name) {
    checkNameFree(streams, name, streamId);
    const refs = nameReferences(existing, rules, streams);
    if (refs.length) {
      throw new ApiError(409, `${refs.join(', ')} refer to this stream by name, so renaming it would break them.`);
    }
    updates.name = name;
  }
  if (args.criteria !== undefined || args.logic !== undefined) {
    // Sweep rules flatten the stream's conditions into their own, so a change
    // here would silently change what they archive or delete.
    const sweepers = usersOf(existing, rules, streams).rules;
    if (sweepers.length) {
      throw new ApiError(
        409,
        `Sweep rule${sweepers.length > 1 ? 's' : ''} ${listNames(sweepers)} sweep this stream, so changing its conditions would change what they sweep. Change the rule with maildeck_update_sweep_rule instead, or take the stream out of it first.`,
      );
    }
    if (args.criteria !== undefined) updates.criteria = criteriaArg(args.criteria, STREAM_FIELDS, streams, streamId);
    if (args.logic !== undefined) updates.criteria_logic = oneOf(args, 'logic', LOGICS);
  }
  const icon = optString(args, 'icon', 16);
  if (icon !== undefined) updates.icon = icon;
  const color = optColor(args);
  if (color !== undefined) updates.accent = color;
  const enabled = optBool(args, 'enabled');
  if (enabled !== undefined) updates.is_enabled = enabled;
  const position = optInt(args, 'position', 0, 10_000);

  if (Object.keys(updates).length === 0 && position === undefined) return { stream: before, changed: false };

  let row = existing;
  if (Object.keys(updates).length) {
    const { data, error } = await ctx.admin
      .from('columns')
      .update(updates)
      .eq('id', streamId)
      .eq('user_id', ctx.userId)
      .select(STREAM_COLUMNS)
      .single();
    if (error) throw error;
    row = data as StreamRow;
  }
  let order = streams.map((s) => (s.id === streamId ? row : s));
  if (position !== undefined) order = await placeStream(ctx, order, streamId, position);
  return {
    before,
    stream: streamView(row, byId(order), order.findIndex((s) => s.id === streamId)),
    changed: true,
  };
}

export async function deleteStream(ctx: Ctx, args: Args) {
  const streamId = reqUuid(args, 'stream_id');
  const [streams, rules] = await Promise.all([loadStreams(ctx), loadRules(ctx)]);
  const existing = streams.find((s) => s.id === streamId);
  if (!existing) throw new ApiError(404, `No stream ${streamId}. maildeck_list_streams lists them.`);

  // A sweep rule whose stream disappears stops matching; a stream that
  // includes it silently loses a condition. Make the caller untangle them.
  const used = usersOf(existing, rules, streams);
  if (used.rules.length) {
    throw new ApiError(
      409,
      `Sweep rule${used.rules.length > 1 ? 's' : ''} ${listNames(used.rules)} use this stream. Delete or change ${used.rules.length > 1 ? 'them' : 'it'} first.`,
    );
  }
  if (used.streams.length) {
    throw new ApiError(409, `Stream${used.streams.length > 1 ? 's' : ''} ${listNames(used.streams)} include this stream. Change ${used.streams.length > 1 ? 'them' : 'it'} first.`);
  }

  const { error } = await ctx.admin.from('columns').delete().eq('id', streamId).eq('user_id', ctx.userId);
  if (error) throw error;
  return { deleted: streamView(existing, byId(streams), streams.indexOf(existing)) };
}
