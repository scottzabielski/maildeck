/** Module-level cache of column scroll positions (columnId → scrollTop). */
export const scrollPositions = new Map<string, number>();

/** Module-level cache of column filter modes (columnId → filterMode). */
export const filterModes = new Map<string, string>();
