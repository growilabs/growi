// Task 3.8: 「この層の入口もここでまとめる」.
//
// `createPlatformFacade` itself is not exercised here: it connects a real
// PostgreSQL state adapter before it returns anything (that is why it is
// asynchronous), so it belongs to the integration tests rather than to a unit
// test. Its parts are covered where they live -- `connection-manager.spec.ts`,
// `event-handlers.spec.ts`, `webhook-options.spec.ts`, and tasks 3.1-3.7's own
// specs.
//
// What IS asserted here is the thing only this file can get wrong, and which
// nothing else would catch: **what the barrel publishes**.
// `src/architecture.spec.ts`'s Chat SDK guard only inspects files OUTSIDE
// `platform/**`, so it cannot see a barrel that re-exports an SDK-typed symbol
// -- the violation would only surface later, as a consumer in `command/` or
// `routes/` that suddenly needs `chat` in its own imports and gets rejected
// for it, far from the cause.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BARREL = join(dirname(fileURLToPath(import.meta.url)), 'index.ts');

/**
 * Every name `platform/index.ts` exports: the re-export lists
 * (`export { a, b } from '...'`) and its own declarations
 * (`export const` / `interface` / `type` / `function` / `class`).
 *
 * Aliases are read as the name they are published under, since that is what a
 * consumer sees.
 */
const exportedNames = (source: string): ReadonlyArray<string> => {
  const fromLists = [
    ...source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from/g),
  ].flatMap(([, list]) =>
    (list ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .map((entry) => {
        const parts = entry.replace(/^type\s+/, '').split(/\s+as\s+/);
        return (parts[parts.length - 1] ?? '').trim();
      }),
  );

  const declarations = [
    ...source.matchAll(
      /^export\s+(?:const|interface|type|function|class)\s+(\w+)/gm,
    ),
  ].map(([, name]) => name ?? '');

  return [...new Set([...fromLists, ...declarations])].sort();
};

describe('the surface this layer publishes', () => {
  const source = readFileSync(BARREL, 'utf8');

  it('publishes exactly the agreed names', () => {
    // A deliberate allowlist, not a snapshot: adding a name here is a decision
    // to widen the layer's public API (`.claude/rules/coding-style.md`,
    // "re-export only what callers need"), and the reviewer of that decision
    // is whoever changes this line.
    expect(exportedNames(source)).toEqual([
      'ChannelRefreshDeps',
      'ChannelRefreshFailure',
      'ConnectionManager',
      'ConnectionState',
      'ConnectionStatusRow',
      'InstallationProvider',
      'InstallationStore',
      'InstallationStoreDeps',
      'LOCK_TTL_MS',
      'OAUTH_EXCHANGES',
      'OAuthCallbackFailureReason',
      'OAuthExchangeTable',
      'PlatformFacade',
      'RECONCILE_INTERVAL_MS',
      'completeOAuthCallback',
      'createInstallationProvider',
      'createInstallationStore',
      'createPlatformFacade',
      'refreshChannelInventory',
      'toConnectionStatusViews',
    ]);
  });

  it('publishes nothing whose type names a Chat SDK value', () => {
    // Each of these is a real symbol in this directory that a previous task
    // flagged as unpublishable, naming `ChatInstance`, `PostgresStateAdapter`,
    // `ModalElement`, `Adapter`, `StateAdapter` or `AdapterPostableMessage` in
    // its own signature. Listing them by name is what makes the rule checkable
    // instead of a comment.
    const sdkTyped = [
      'AppBot',
      'createAppBot',
      'createInstallationBot',
      'createDistributedLock',
      'ModalOpener',
      'ModalTriggerRegistry',
      'createModalTriggerRegistry',
      'OutboundContext',
      'toPostable',
      'channelThreadId',
      'HistoryContext',
      'HandlerHost',
      'registerEventHandlers',
      'ChannelLister',
      'ChannelListerContext',
      'CHANNEL_LISTERS',
      'ADAPTER_FACTORIES',
      'AdapterFactory',
      'createAppAdapters',
      'createInstallationAdapter',
      'createChatState',
      'webhookOptionsFor',
      'OPENS_MODAL_IN_WEBHOOK_RESPONSE',
      'fromMessage',
      'fromSlashCommand',
      'fromAction',
      'fromModalSubmit',
      'encodeActionId',
      'decodeActionId',
    ];

    expect(
      exportedNames(source).filter((name) => sdkTyped.includes(name)),
    ).toEqual([]);
  });

  it('reads a re-export list, an alias and a declaration', () => {
    // Without this the two assertions above would pass vacuously the moment
    // the parser stopped matching anything.
    expect(
      exportedNames(
        [
          "export type { A, B as C } from './x.js';",
          "export { d } from './y.js';",
          'export const e = 1;',
          'export interface F {}',
        ].join('\n'),
      ),
    ).toEqual(['A', 'C', 'F', 'd', 'e']);
  });
});
