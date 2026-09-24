// `Invocation` is `CommandInvocation.normalize`'s output (added in a later
// task, `command/invocation.ts`): the single internal representation that a
// `mention` and a `slash-command` `PlatformEvent` both become (design.md
// Components and Interfaces table, decision 4 in the umbrella research.md).
// It lives in `types/` for the same reason as `Relation` (see relation.ts):
// `ArgumentCollector.start(invocation, ...)` and `ResumeOutcome.invocation`
// (both in `command/`) need this shape, and it is also carried as JSON in
// the `pending_collection` table read/written from `db/` -- a layer to the
// left of `command/` in the declared dependency order.
//
// Fields are the parts `mention` and `slash-command` share on `PlatformEvent`
// (platform-event.ts), plus the command name resolved out of the free-text
// `text`/`command` field so downstream layers (`command/command-set.ts`)
// never re-parse it:
// - `platform` / `channel` / `actor` / `interaction`: carried through as-is
//   from the originating `PlatformEvent`.
// - `commandName`: the word identifying which `CommandSet` entry this is
//   (design.md's "打つ言葉" column, e.g. `search`, `create-page`, `keep`).
// - `argsText`: whatever free text followed the command name, still
//   unparsed -- `ArgumentCollector` is what turns it into per-`FieldSpec`
//   values.
import type { ChannelRef, ChatAccountRef, PlatformName } from '@growi/chat';

import type { InteractionRef } from './index.js';

export interface Invocation {
  readonly platform: PlatformName;
  readonly channel: ChannelRef;
  readonly actor: ChatAccountRef;
  readonly commandName: string;
  readonly argsText: string;
  readonly interaction: InteractionRef | null;
}
