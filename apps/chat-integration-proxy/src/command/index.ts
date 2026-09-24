// This layer's public entry point -- 「この層の入口もここでまとめる」
// (tasks.md 4.4), the same shape `db/index.ts` and `platform/index.ts` already
// take for their own layers. Everything `relation/`, `growi/`,
// `orchestration/` and `routes/` may see of `command/` is exported from here;
// nothing else in this directory is part of its contract.
//
// The whole public surface of all four modules is re-exported, and that is
// deliberate rather than lazy: orchestration is the only external caller, and
// it needs each of them -- `normalize` to turn an event into an `Invocation`,
// `COMMAND_TRAITS` to look up what that command collects and how its target is
// chosen, the admin words to route an operator's command, and
// `ArgumentCollector` to collect and resume. What is NOT here is what stayed
// unexported in each module (its internal helpers, e.g. the argument-line
// parser and the `pending_collection` state shape), which is where this
// layer's implementation detail actually lives.

export type {
  AdminActorRoles,
  AdminCommandIntent,
  AdminCommandOutcome,
  AdminCommandWord,
  AdminDelivery,
} from './admin-command-set.js';
export {
  ADMIN_COMMAND_WORDS,
  isWorkspaceAdmin,
  parseAdminCommand,
} from './admin-command-set.js';
export type {
  ArgumentCollector,
  ArgumentCollectorDeps,
  ArgumentCollectorPlatform,
  GrowiChoiceOption,
  ResumeOutcome,
  StartOutcome,
} from './argument-collector.js';
export {
  createArgumentCollector,
  PENDING_COLLECTION_TTL_MS,
} from './argument-collector.js';
export type {
  CommandRequestKind,
  CommandTargeting,
  CommandTrait,
} from './command-set.js';
export {
  COMMAND_TRAITS,
  LINK_COMMAND_WORD,
  LINK_TRAIT,
  SEARCH_DEFAULT_LIMIT,
} from './command-set.js';
export type { CommandStartEvent } from './invocation.js';
export { CommandInvocation, stripAddressToken } from './invocation.js';
