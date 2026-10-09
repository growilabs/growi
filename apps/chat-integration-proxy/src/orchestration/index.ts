// This layer's public entry point, opened by task 7.1 and complete as of task
// 7.3: the three modules design.md lists under `orchestration/` are all built
// (`event-sink.ts`, `command-flow.ts`, `inbound-flow.ts`), plus `admin-flow.ts`
// which carries out the operator half of `command-flow.ts`'s routing.
//
// `createAdminFlow` is exported even though no layer to the right calls it:
// `CommandFlowDeps.adminFlow` is required, so the composition point cannot
// build a `CommandFlow` without being able to build an `AdminFlow` first.
//
// `CommandFlow` and `LinkPostedEvent` are here because implementing the flow
// means naming both. `KNOWN_COMMAND_WORDS` and `EventSinkDeps` are NOT: the
// first is how the routing decision is made (this layer's own business, read
// only by `event-sink.spec.ts`), and the second is only ever written inline at
// the composition point.
//
// The numbers these modules apply -- the search weight's bounds, how long a
// per-destination notification record is kept -- stay module-private, the same
// way `growi/index.ts` holds its own defaults down: no caller passes one, and a
// second name for one number is how two of them start to disagree.
//
// `parseTimeRange` / `TIME_RANGE_USAGE` stay internal for the same reason:
// they exist because `command-flow.ts` is the side that calls `fetchHistory`,
// and no layer to the right of this one interprets a range.
export type {
  AdminFlow,
  AdminFlowDeps,
  AdminFlowPlatform,
  ObserveActorRoles,
} from './admin-flow.js';
export { createAdminFlow } from './admin-flow.js';
export type { CommandFlowDeps, CommandFlowPlatform } from './command-flow.js';
export { createCommandFlow } from './command-flow.js';
export type { CommandFlow, LinkPostedEvent } from './event-sink.js';
export { createEventSink } from './event-sink.js';
export type {
  InboundFlow,
  InboundFlowDeps,
  InboundFlowPlatform,
} from './inbound-flow.js';
export { createInboundFlow } from './inbound-flow.js';
