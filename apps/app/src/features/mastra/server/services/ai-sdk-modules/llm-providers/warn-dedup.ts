import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:features:mastra:llm-providers:warn-dedup');

// A generic dedup registry for observability logs that would otherwise repeat on
// every chat request / config read (malformed-config warns, provider-availability
// reasons, env-shadowing infos). Each message is emitted at most once per dedup
// key until the registry is reset, so misconfiguration is logged once instead of
// flooding the log, and re-notified after a config change.
//
// This module owns only the mechanism (dedup + emit). It holds no knowledge of
// providers or config keys — callers supply an opaque, stable dedup key that
// encodes their own (subject, reason) tuple. Both the config accessors and
// provider-availability depend on this module (one-directional: config accessor
// -> availability, both -> warn-dedup, so there is no import cycle).

// The dedup key is namespaced by log level so that a warn and an info sharing the
// same caller key string are tracked independently and never cross-suppress.
const emittedKeys = new Set<string>();

const emitOnce = (dedupKey: string, emit: () => void): void => {
  if (emittedKeys.has(dedupKey)) {
    return;
  }
  emittedKeys.add(dedupKey);
  emit();
};

/** Emit `message` via logger.warn at most once per `key` until the next reset. */
export const warnOnce = (key: string, message: string): void => {
  emitOnce(`warn:${key}`, () => logger.warn(message));
};

/** Emit `message` via logger.info at most once per `key` until the next reset. */
export const infoOnce = (key: string, message: string): void => {
  emitOnce(`info:${key}`, () => logger.info(message));
};

/**
 * Reset the dedup registry so every key may log again. Called alongside
 * `clearResolvedMastraModelCache()` on config save and on the s2s `configUpdated`
 * message, so a configuration change re-notifies the operator of any remaining
 * misconfiguration.
 */
export const clearAvailabilityLogDedup = (): void => {
  emittedKeys.clear();
};
