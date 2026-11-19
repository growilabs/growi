// Which service the black-box tests talk to, and the marks for the tests the
// Python service must skip (research.md 22.4 / 22.5).
//
// BLACKBOX_TARGET=python skips every test wrapped below; nothing else changes.
// `target` is deliberately not exported: a test must not switch its
// expectation on the target, or running it against Python checks nothing.

export type BlackboxTarget = 'node' | 'python';

/** One id per row of research.md 22.5. */
export type NodeOnlyReason = 'D2' | 'D3' | '7.5-2' | '7.5-3' | '16.1' | '16.9';

export const readTarget = (
  env: Readonly<Record<string, string | undefined>>,
): BlackboxTarget => {
  const raw = env.BLACKBOX_TARGET ?? 'node';
  if (raw !== 'node' && raw !== 'python') {
    throw new Error(`BLACKBOX_TARGET must be node or python, got: ${raw}`);
  }
  if (raw === 'python' && (env.BLACKBOX_URL ?? '') === '') {
    throw new Error('BLACKBOX_TARGET=python needs BLACKBOX_URL');
  }
  return raw;
};

const target: BlackboxTarget = readTarget(process.env);

export const describeNodeOnly = (
  reason: NodeOnlyReason,
  name: string,
  body: () => void,
): void => {
  describe.skipIf(target === 'python')(`[node-only:${reason}] ${name}`, body);
};

export const itNodeOnly = (
  reason: NodeOnlyReason,
  name: string,
  body: () => void | Promise<void>,
): void => {
  it.skipIf(target === 'python')(`[node-only:${reason}] ${name}`, body);
};
