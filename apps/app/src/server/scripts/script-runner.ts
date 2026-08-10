import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

import type { Logger } from '~/utils/logger';
import loggerFactory from '~/utils/logger';

import { getMongoUri, mongoOptions } from '../util/mongoose-utils';

/**
 * Shared helpers for the standalone admin scripts (password-hash-cleanup,
 * password-hash-downgrade-prep, ...). These scripts run outside the normal server
 * boot, so each needs the same two things: a guard that only fires the CLI body
 * when the file is executed directly, and a connect/disconnect lifecycle around
 * the work.
 */

const logger = loggerFactory('growi:scripts:script-runner');

/**
 * True when this module's importer is the process entry point (invoked as
 * `node <script>` / `tsrun <script>`), not merely imported (e.g. by a test).
 *
 * Callers pass their own `import.meta.url`; comparing the caller's file against
 * `process.argv[1]` is what tells a direct run apart from an import.
 */
export const isEntryPoint = (importMetaUrl: string): boolean => {
  const entry = process.argv[1];
  return (
    entry != null && resolve(entry) === resolve(fileURLToPath(importMetaUrl))
  );
};

/**
 * Reduce a MongoDB connection string to `scheme://host[,host…][/db]`, dropping
 * BOTH the userinfo (`user:pass@`) and the whole query string (options such as
 * `authMechanismProperties` / `tlsCertificateKeyFilePassword` can carry secrets).
 *
 * WHY this exists: `getMongoUri()` silently falls back to `mongodb://mongo/growi`
 * when no MONGO*_URI env var is set. A standalone admin script started without
 * the env preload would then destructively rewrite a COMPLETELY DIFFERENT
 * database than the admin expects, with nothing on screen to reveal it. Logging
 * the resolved target makes that mistake visible before any write happens.
 *
 * Assumes credentials are percent-encoded as the connection-string spec requires;
 * if an un-encoded `/` or `?` in the credentials makes the authority
 * unparseable, the whole URI is withheld rather than risk leaking part of a
 * password.
 */
export const redactMongoUri = (uri: string): string => {
  const schemeEnd = uri.indexOf('://');
  if (schemeEnd < 0) {
    return '(unparsable mongodb uri)';
  }

  const scheme = uri.slice(0, schemeEnd + 3);
  // Work on the RAW post-scheme string: the userinfo boundary must be located
  // BEFORE anything is stripped off. Stripping the option string first would
  // hide an un-encoded '?' inside a password and leave the password prefix in
  // what we then treat as the host.
  const afterScheme = uri.slice(schemeEnd + 3);

  // The authority ends at whichever of '/' (db name) or '?' (options) comes
  // first; both delimiters end it, so both must be considered here.
  const slashIndex = afterScheme.indexOf('/');
  const questionIndex = afterScheme.indexOf('?');
  const delimiters = [slashIndex, questionIndex].filter((i) => i >= 0);
  const authorityEnd =
    delimiters.length === 0 ? afterScheme.length : Math.min(...delimiters);

  const authority = afterScheme.slice(0, authorityEnd);

  // A '@' beyond that boundary means the credentials themselves contain an
  // un-encoded '/' or '?': the boundary was computed inside the password, so
  // `authority` holds part of a secret. Withhold everything.
  const firstAtIndex = afterScheme.indexOf('@');
  if (firstAtIndex >= 0 && firstAtIndex > authorityEnd) {
    return '(unparsable mongodb uri)';
  }

  // Within a well-formed authority the userinfo ends at its LAST '@', so an
  // encoded-as-written '@' inside the password still resolves to the right host.
  const atIndex = authority.lastIndexOf('@');
  const hosts = atIndex < 0 ? authority : authority.slice(atIndex + 1);

  const rawDbName =
    slashIndex >= 0 && slashIndex === authorityEnd
      ? afterScheme.slice(slashIndex + 1)
      : '';
  const optionsIndex = rawDbName.indexOf('?');
  const dbName =
    optionsIndex < 0 ? rawDbName : rawDbName.slice(0, optionsIndex);

  return dbName === '' ? `${scheme}${hosts}` : `${scheme}${hosts}/${dbName}`;
};

/**
 * Open a mongoose connection, run `fn`, and always disconnect afterwards (even
 * when `fn` throws). Keeps the connect/disconnect lifecycle identical across the
 * standalone scripts.
 *
 * Logs the resolved (credential-redacted) target once before connecting — see
 * `redactMongoUri` for why that matters for these destructive scripts.
 */
export const withMongoConnection = async (
  fn: () => Promise<void>,
): Promise<void> => {
  const uri = getMongoUri();
  logger.info(
    `Target MongoDB: ${redactMongoUri(uri)} — abort now if this is not the database you intend to modify.`,
  );

  await mongoose.connect(uri, mongoOptions);
  try {
    await fn();
  } finally {
    await mongoose.disconnect();
  }
};

/**
 * Grace period given to pino's transport worker thread before `process.exit()`
 * kills it. The app logger writes through `pino.transport()` (a worker), so an
 * immediate exit truncates the final lines — exactly the lines an admin needs.
 */
const LOG_FLUSH_GRACE_MS = 300;

/**
 * Terminate the process with `code`, giving the logger a chance to drain first.
 *
 * Two distinct problems, one helper:
 *  - a script that bootstraps Crowi (`crowi.init()`) starts cron jobs, socket.io
 *    and S2S messaging, so the event loop never drains and the process HANGS
 *    after the work is done — an explicit exit is the only termination path;
 *  - even a script that does exit naturally races the transport worker, and the
 *    lines it loses are the last ones written: the run's own result. Flushing
 *    plus a short grace period is what makes the outcome actually reach stdout.
 *
 * Call this ONLY from a script's entry-point branch — never from an exported or
 * otherwise reusable function, so tests and library callers are unaffected.
 */
export const exitAfterLogFlush = (
  scriptLogger: Logger,
  code: number,
  graceMs: number = LOG_FLUSH_GRACE_MS,
): void => {
  scriptLogger.flush();
  setTimeout(() => {
    process.exit(code);
  }, graceMs);
};
