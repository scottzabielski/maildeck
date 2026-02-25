export type ColumnEntry = {
  columnId: string;
  accountId: string | null;
  emailIds: string[];
  order: number;
};

const registry = new Map<string, ColumnEntry>();

export function registerColumn(entry: ColumnEntry) {
  registry.set(entry.columnId, entry);
}

export function unregisterColumn(columnId: string) {
  registry.delete(columnId);
}

export function getColumnEntries(): ColumnEntry[] {
  return [...registry.values()].sort((a, b) => a.order - b.order);
}

export function getColumnEntry(columnId: string): ColumnEntry | undefined {
  return registry.get(columnId);
}
