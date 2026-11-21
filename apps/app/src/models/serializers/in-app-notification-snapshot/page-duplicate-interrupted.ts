export interface PageDuplicateInterruptedSnapshot {
  readonly path: string; // the copy's top page path; PagePathLabel shows it
  readonly fromPath: string;
  readonly toPath: string;
  readonly copiedPageCount: number;
  readonly sourcePageCount: number;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isSnapshot = (
  value: unknown,
): value is PageDuplicateInterruptedSnapshot => {
  if (value == null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.path === 'string' &&
    typeof v.fromPath === 'string' &&
    typeof v.toPath === 'string' &&
    isCount(v.copiedPageCount) &&
    isCount(v.sourcePageCount)
  );
};

export const pageDuplicateInterruptedSnapshot = {
  stringify(snapshot: PageDuplicateInterruptedSnapshot): string {
    return JSON.stringify({
      path: snapshot.path,
      fromPath: snapshot.fromPath,
      toPath: snapshot.toPath,
      copiedPageCount: snapshot.copiedPageCount,
      sourcePageCount: snapshot.sourcePageCount,
    });
  },

  parse(snapshot: string): PageDuplicateInterruptedSnapshot | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(snapshot);
    } catch {
      return undefined;
    }
    if (!isSnapshot(parsed)) return undefined;
    return {
      path: parsed.path,
      fromPath: parsed.fromPath,
      toPath: parsed.toPath,
      copiedPageCount: parsed.copiedPageCount,
      sourcePageCount: parsed.sourcePageCount,
    };
  },
};
