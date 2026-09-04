import type { Prisma } from '~/generated/prisma/client';

/**
 * MongoDB reports per-statement write failures *inside a successful reply*: the command
 * resolves with `ok: 1` and a `writeErrors` array (duplicate keys, bad update operators),
 * and a write-concern failure resolves with `writeConcernError`. Only a command-level
 * failure — an unknown command, a lost connection — rejects, as Prisma's P2010.
 *
 * So a `$runCommandRaw` write whose reply is discarded loses those failures silently.
 * Every raw write in this feature passes its reply through here instead.
 */
export const throwOnWriteErrors = (
  result: Prisma.JsonObject,
  context: string,
): void => {
  const messages = [
    ...describeAll(result.writeErrors),
    ...describeAll(result.writeConcernError),
  ];

  if (messages.length === 0) {
    return;
  }

  throw new Error(`${context} failed: ${messages.join('; ')}`);
};

// `writeErrors` is an array, `writeConcernError` a single object; both are absent when
// the command wrote cleanly.
const describeAll = (value: Prisma.JsonValue | undefined): string[] => {
  if (value == null) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).map(describeError);
};

const describeError = (entry: Prisma.JsonValue): string => {
  if (typeof entry !== 'object' || entry == null || Array.isArray(entry)) {
    return String(entry);
  }

  const errmsg = 'errmsg' in entry ? entry.errmsg : undefined;
  if (typeof errmsg !== 'string') {
    return JSON.stringify(entry);
  }

  const code = 'code' in entry ? entry.code : undefined;
  return code != null ? `[${String(code)}] ${errmsg}` : errmsg;
};
