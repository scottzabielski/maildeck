import Anthropic from 'npm:@anthropic-ai/sdk@0.133.0';

/**
 * Claude API access for edge functions: the client, the models a sweep
 * check may use with their prices, cost accounting, and how a failed call
 * is classified.
 *
 * ANTHROPIC_API_KEY is a function secret. ANTHROPIC_WORKSPACE_ID is only
 * needed for a key that isn't tied to one workspace, which must name the
 * workspace on every request.
 */

export { Anthropic };

export interface ModelPrice {
  label: string;
  /** USD per million tokens, for prompts under 100k tokens (every check is). */
  input: number;
  output: number;
}

/**
 * Models a sweep check may use. Each one accepts a forced tool call, which
 * is how a check gets its structured verdict (Claude Opus 5.5 and Fable 5.1
 * don't, so they aren't offered).
 */
export const CHECK_MODELS: Record<string, ModelPrice> = {
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5', input: 0.1, output: 0.5 },
  'claude-haiku-4-5': { label: 'Claude Haiku 4.5', input: 1, output: 5 },
  'claude-sonnet-5': { label: 'Claude Sonnet 5', input: 2, output: 10 },
  'claude-opus-5': { label: 'Claude Opus 5', input: 5, output: 25 },
};

export const DEFAULT_CHECK_MODEL = 'claude-haiku-5-5';

/** Turns a plain-English description into a rule; used rarely, so the most capable default. */
export const DRAFT_MODEL = 'claude-opus-5';

// Prices for models a draft can be served by (a refusal falls back server-side).
const OTHER_PRICES: Record<string, ModelPrice> = {
  'claude-opus-4-8': { label: 'Claude Opus 4.8', input: 5, output: 25 },
};

/** What a call cost, from its usage. Unknown models are priced as Opus, the most a call here can cost. */
export function costUsd(
  model: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  },
): number {
  const p = CHECK_MODELS[model] ?? OTHER_PRICES[model] ?? CHECK_MODELS['claude-opus-5'];
  const input = usage.input_tokens +
    1.25 * (usage.cache_creation_input_tokens ?? 0) +
    0.1 * (usage.cache_read_input_tokens ?? 0);
  return (input * p.input + usage.output_tokens * p.output) / 1_000_000;
}

/** Input tokens a call reported, cached or not. */
export function inputTokens(usage: {
  input_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): number {
  return usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

/** The client, or null when no API key is configured (callers then skip their checks). */
export function createClaudeClient(opts: { timeoutMs?: number; fetch?: typeof fetch } = {}): Anthropic | null {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  const workspace = Deno.env.get('ANTHROPIC_WORKSPACE_ID');
  return new Anthropic({
    apiKey,
    // Retries are the caller's job: a failed check waits for a later run.
    maxRetries: 0,
    timeout: opts.timeoutMs ?? 30_000,
    ...(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}

/**
 * A call that didn't produce a usable answer. "systemic" means the next call
 * would most likely fail the same way (rate limit, outage, key, credits,
 * request shape), so a batch stops instead of failing every message in it.
 * Usage is set when the API answered and billed the call anyway.
 */
export class ClaudeCallError extends Error {
  constructor(
    message: string,
    public systemic: boolean,
    public usage?: { inputTokens: number; outputTokens: number; costUsd: number },
  ) {
    super(message);
  }
}

/** Maps an SDK exception to a ClaudeCallError with a short reason worth showing the user. */
export function toCallError(err: unknown): ClaudeCallError {
  if (err instanceof ClaudeCallError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ClaudeCallError('Claude timed out', true);
  if (err instanceof Anthropic.APIConnectionError) return new ClaudeCallError("Couldn't reach Claude", true);
  if (err instanceof Anthropic.RateLimitError) return new ClaudeCallError('Claude rate limit reached', true);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ClaudeCallError('Claude rejected the API key', true);
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    if (status === 402 || /credit balance/i.test(err.message)) return new ClaudeCallError('Claude API credits are used up', true);
    if (status === 529) return new ClaudeCallError('Claude is overloaded', true);
    if (status >= 500) return new ClaudeCallError(`Claude had a server error (${status})`, true);
    return new ClaudeCallError(`Claude rejected the request (${status}): ${err.message.slice(0, 160)}`, true);
  }
  return new ClaudeCallError(`Claude call failed: ${(err as Error)?.message?.slice(0, 160) ?? 'unknown error'}`, true);
}
