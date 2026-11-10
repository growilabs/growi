// `EventSink` -- design.md's 「イベントの振り分け」 table, and nothing else.
// Every `PlatformEvent` the platform layer produces enters the app here and is
// handed to whichever component owns it; this file decides WHERE an event
// goes, never what is done with it once it gets there.
//
// It therefore posts nothing, reads no relation, and calls no GROWI. Those
// belong to `command-flow.ts` / `inbound-flow.ts` (tasks 7.2 / 7.3), reached
// through the `CommandFlow` interface below, which is declared here rather
// than imported so that this file stays complete on its own: routing is
// testable against the interface before either flow exists.
import { COMMAND_NAMES } from '@growi/chat';

import {
  ADMIN_COMMAND_WORDS,
  type ArgumentCollector,
  CommandInvocation,
  LINK_COMMAND_WORD,
} from '../command/index.js';
import type {
  Invocation,
  PlatformEvent,
  PlatformEventSink,
} from '../types/index.js';

/** The one `PlatformEvent` kind that never goes near command parsing. */
export type LinkPostedEvent = Extract<
  PlatformEvent,
  { readonly kind: 'link-posted' }
>;

/**
 * Every word this app answers to, as one set built from the three places that
 * declare words -- the shared command vocabulary (`COMMAND_NAMES`, whose
 * proxy-side traits are `COMMAND_TRAITS`), `link` (deliberately outside that
 * vocabulary, see `command-set.ts`), and the operator words. Nothing here is
 * written by hand: a command added to any of the three becomes typeable
 * without this file being edited.
 *
 * Two consequences for whoever implements `CommandFlow`:
 *
 * - a `commandName` reaching `startCommand` may be an OPERATOR word, which has
 *   no `COMMAND_TRAITS` entry (`COMMAND_TRAITS[name]` would be `undefined`).
 *   Splitting user commands from operator commands -- and deciding where the
 *   actor's roles are observed, which task 4.3 left to orchestration -- is the
 *   flow's job, not this file's.
 * - `link-preview` is in the set because it is in `COMMAND_NAMES`, not because
 *   typing it is useful (its real entrance is a posted URL below). Excluding
 *   it would mean a literal exception here for a distinction that belongs in
 *   the declaration itself.
 */
export const KNOWN_COMMAND_WORDS: ReadonlySet<string> = new Set<string>([
  ...Object.values(COMMAND_NAMES),
  LINK_COMMAND_WORD,
  ...ADMIN_COMMAND_WORDS,
]);

/**
 * What this file routes TO. Implemented by `command-flow.ts` (task 7.2).
 *
 * Preconditions:
 * - `startCommand` is called with any word in `KNOWN_COMMAND_WORDS` AND with
 *   whatever a slash command carried, recognized or not: the platform's own UI
 *   already told the user they were invoking this bot, so an unknown slash
 *   command owes them an answer rather than silence. Answering it is the
 *   flow's -- it is the side that can post.
 * - `previewLinks` receives the event whole (`messageRef` and every URL). A
 *   posted URL matching no linked GROWI must produce no message at all
 *   (Requirement 6.4); that is `GrowiSelector`'s `silent` outcome, decided
 *   inside the flow, so nothing is filtered out here.
 */
export interface CommandFlow {
  startCommand(invocation: Invocation): Promise<void>;
  runCollected(
    invocation: Invocation,
    values: Readonly<Record<string, string>>,
  ): Promise<void>;
  /**
   * The user has said which GROWI the command runs against (Requirement 8.2).
   * The values collected before the question was asked come back with the
   * answer, so nothing is asked twice.
   */
  runChosenGrowi(
    invocation: Invocation,
    values: Readonly<Record<string, string>>,
    relationId: string,
  ): Promise<void>;
  previewLinks(event: LinkPostedEvent): Promise<void>;
  /** Says that a half-finished input is gone; this layer cannot post. */
  reportExpired(event: PlatformEvent): Promise<void>;
}

export interface EventSinkDeps {
  /**
   * Narrowed to `resume`: starting a collection happens inside the flow, as
   * part of running a command, never from the routing decision.
   */
  readonly collector: Pick<ArgumentCollector, 'resume'>;
  readonly flow: CommandFlow;
}

export const createEventSink = (deps: EventSinkDeps): PlatformEventSink => {
  const { collector, flow } = deps;

  /**
   * The single destination for everything that continues an exchange already
   * under way: a modal submission, a button press, and an answer typed as a
   * mention all resume the same stored collection.
   */
  const resumeCollection = async (event: PlatformEvent): Promise<void> => {
    const outcome = await collector.resume(event);
    switch (outcome.status) {
      case 'collected':
        // Every value is in. The invocation comes back from the STORED row,
        // not from this event -- the event that completed it carries no
        // command name of its own.
        await flow.runCollected(outcome.invocation, outcome.values);
        return;
      case 'growi-chosen':
        // Requirement 8.2's button (or, where a service renders no buttons,
        // the numbered answer): which GROWI to act on is now settled, and
        // the values collected before the question came back with it.
        await flow.runChosenGrowi(
          outcome.invocation,
          outcome.values,
          outcome.relationId,
        );
        return;
      case 'pending':
        // The collector has just asked the next question; the next event
        // continues from there.
        return;
      case 'cancelled':
        // The collector gave up because it could no longer reach the user
        // (task 4.4), so there is no channel left to say anything through.
        return;
      case 'expired':
        // The user IS present and reachable here, so their half-finished
        // input quietly vanishing is worth saying. Only the flow can post.
        await flow.reportExpired(event);
        return;
      case 'not-mine':
        // On a mention: an ordinary message, so nothing happens (design.md's
        // step 3). On an `action`: a button that belongs to no collection of
        // ours -- a stale press from a superseded command, or an id that was
        // never among the ones offered.
        return;
    }
  };

  return {
    handle: (event) => {
      switch (event.kind) {
        case 'link-posted':
          // Requirement 6.1. Structurally separate: a posted URL is not a
          // command and is never parsed as one.
          return flow.previewLinks(event);
        case 'slash-command':
          // The platform already fixed the command name, so there is no
          // "did this name a command?" step to take -- and `resume` answers
          // `not-mine` to a slash command by construction, so falling through
          // to it could only ever be dead code.
          return flow.startCommand(CommandInvocation.normalize(event));
        case 'mention': {
          const invocation = CommandInvocation.normalize(event);
          // Step 1 → 2. Recognizing the word FIRST is what makes design.md's
          // 「新しいコマンドが優先される」 hold: `ArgumentCollector.start`
          // discards the half-finished collection when the new command begins,
          // but only if the new command gets that far. Handing a command word
          // to `resume` instead would have it read as the answer to the
          // question still outstanding.
          return KNOWN_COMMAND_WORDS.has(invocation.commandName)
            ? flow.startCommand(invocation)
            : resumeCollection(event);
        }
        case 'modal-submit':
        case 'action':
          return resumeCollection(event);
      }
    },
  };
};
