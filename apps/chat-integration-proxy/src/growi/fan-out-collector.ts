// Sending one command to every GROWI a channel is linked to, waiting for them
// together, and reporting what came back (design.md's `FanOutCollector`,
// Requirements 3.1, 3.4, 3.5, 11.3, 14.3, 14.5).
//
// Search and help share this module. They differ only in what is sent and what
// is taken out of the answer, which is why both of those arrive as functions
// (`build` / `extract`) and this file names neither command.
//
// Three things below are the contract, not implementation taste:
//
//  - **Nothing that happens to one destination reaches another.** One GROWI
//    that never answers, refuses the call, or answers in a shape the caller
//    cannot use costs exactly that GROWI's entry. `fanOut` never rejects --
//    not with no targets, and not when not one target answered (Requirement
//    3.5). `GrowiClient` was built to make this possible: it returns
//    per-destination failures as values (task 6.1's note), so the only
//    exceptions left to guard against are ones the caller's own `build` /
//    `extract` throw.
//  - **`excluded` is carried through, never recomputed.** It arrives as an
//    argument because the fan-out cannot see it otherwise: by the time a
//    caller has the target list, the GROWIs `GrowiSelector` filtered out are
//    already gone from it, and a `FanOutOutcome` built from targets alone
//    would report an empty `excluded` forever -- meaning a user in a channel
//    where one of three GROWIs is barred would read the other two's results as
//    if the whole federation had been searched (design.md: 「検索が黙って不完全
//    になる」). It is the caller's `ExcludedGrowi[]` exactly, with
//    `not-permitted-in-channel` and `no-settings` still apart, because the two
//    ask a user to do different things.
//  - **`requestId` is `build`'s to assign, not this module's.** design.md says
//    「宛先ごとに `requestId` と `relationId` を作り替えて配る」, which
//    describes what the fan-out as a whole does; `build(relation)` is called
//    once per target and whatever it returns is sent unchanged, so a caller
//    that mints a fresh id per call satisfies it. Stamping one here would
//    overwrite a value the caller may have to know (a `requestId` is what
//    GROWI keys duplicate-execution detection on, Requirement 10.4), and
//    `GrowiClient` deliberately passes `relationId` through for the same
//    reason.
//
// **Posting to chat is NOT done here.** design.md describes the staging around
// a search -- post 「検索しています」 first, then `replace()` the message once
// the answers are in, because a `MessageRef` does not exist before the first
// post and the chat services allow 3 seconds. That staging is orchestration's:
// it posts before calling this, builds an `OutboundMessage` from the
// `FanOutOutcome`, and replaces afterwards. Nothing in this module's declared
// arguments can reach the platform layer, and adding a route to it would put
// the same posting decision in two layers.

import type { CommandRequest, CommandResponse } from '@growi/chat';

import type { ExcludedGrowi } from '../relation/index.js';
import type { Relation } from '../types/index.js';
import type { GrowiClient } from './growi-client.js';

/** Requirement 3.4 / 14.5: named, so the user can be told which GROWI is missing. */
interface GrowiName {
  readonly relationId: string;
  readonly growiLabel: string;
}

export interface FanOutOutcome<T> {
  readonly responded: ReadonlyArray<GrowiName & { readonly value: T }>;
  /**
   * Asked, and nothing usable came back. `timeout` is only ever the wait cap
   * running out; every other way a call can fail -- refused URI, no signing
   * key, unreachable, non-2xx, an answer that does not parse, an answer
   * `extract` cannot use -- is `error`. The two are kept apart because only
   * one of them says anything about trying again.
   */
  readonly notResponded: ReadonlyArray<
    GrowiName & { readonly reason: 'timeout' | 'error' }
  >;
  /**
   * Not asked at all, because channel permission ruled it out (Requirement
   * 11.3). `ExcludedGrowi` is `GrowiSelector`'s own type, reused rather than
   * re-declared: `select()` hands back `{ targets, excluded }` and both go
   * straight into `fanOut`, so the permission verdict's reason reaches the
   * user without being converted anywhere in between.
   */
  readonly excluded: ReadonlyArray<ExcludedGrowi>;
}

export interface FanOutRequest<T> {
  readonly targets: ReadonlyArray<Relation>;
  readonly excluded: ReadonlyArray<ExcludedGrowi>;
  readonly build: (relation: Relation) => CommandRequest;
  /** Throwing is how a caller says "this answer is not one I can use". */
  readonly extract: (response: CommandResponse, relation: Relation) => T;
  readonly deadlineMs?: number;
  readonly concurrency?: number;
}

export interface FanOutCollector {
  fanOut<T>(request: FanOutRequest<T>): Promise<FanOutOutcome<T>>;
}

export interface FanOutCollectorDeps {
  /**
   * Only the command half is taken. `GrowiClient` also registers keys, revokes
   * them, pulls settings and starts account links; naming the one method used
   * keeps those from becoming reachable through this module, the same
   * narrowing `GrowiClient` itself applies to `RelationKeyService`.
   */
  readonly growiClient: Pick<GrowiClient, 'sendCommand'>;
}

/** design.md: 既定 10000 / 既定 20. Module-private -- callers pass overrides, not names. */
const DEFAULT_DEADLINE_MS = 10_000;
const DEFAULT_CONCURRENCY = 20;

/**
 * The value the wait cap resolves to. A sentinel rather than a rejection
 * because running out of time is not an error: a slow GROWI is an ordinary
 * outcome, and the only `catch` in this module is there for genuine
 * exceptions -- the caller's `build` / `extract` throwing. Rejecting on the
 * deadline would send "ran out of time" through that same `catch` and put the
 * two on one path. (A rejecting loser in a `Promise.race` would *not* go
 * unhandled -- `race` attaches a handler to every input -- so that is not the
 * reason.)
 */
const TIMED_OUT = Symbol('fan-out deadline reached');

const withDeadline = async <T>(
  work: Promise<T>,
  deadlineMs: number,
): Promise<T | typeof TIMED_OUT> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), deadlineMs);
      }),
    ]);
  } finally {
    // On every path, including the one where the request won: a per-target
    // timer left running holds the process awake for as long as the cap, which
    // in a test suite is the difference between finishing and hanging.
    clearTimeout(timer);
  }
};

/**
 * Runs `work` for each index with at most `limit` running at once, answering
 * in index order however the work interleaved.
 *
 * A cursor-driven pool rather than fixed batches: batches also respect the cap
 * but make every destination wait for the slowest one in its batch, so one
 * GROWI sitting on the wait cap would delay a whole group of others that
 * answer immediately.
 *
 * A target that reaches the wait cap gives its slot up there and then. The
 * request itself is abandoned rather than cancelled -- `GrowiClient` exposes
 * no way to call it off, and it has a wait cap of its own -- so briefly more
 * sockets than `limit` can be open. Holding the slot instead would be worse:
 * one unresponsive GROWI would take a slot out of circulation for the whole
 * fan-out.
 */
const runBounded = async <I, O>(
  items: ReadonlyArray<I>,
  limit: number,
  work: (item: I) => Promise<O>,
): Promise<ReadonlyArray<O>> => {
  // One iterator shared by every worker, so "take the next item" is a single
  // step no two workers can land on together. Each worker writes its answer
  // back at the item's own index, which is what keeps the result in the order
  // the targets were given however the destinations interleaved.
  const queue = items.entries();
  const results: O[] = new Array<O>(items.length);

  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) {
      // biome-ignore lint/performance/noAwaitInLoops: waiting here before taking the next item is the cap itself -- one worker holds exactly one slot, and the `Promise.all` this rule suggests is the unbounded shape the pool exists to avoid.
      results[index] = await work(item);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker),
  );
  return results;
};

type TargetOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'timeout' | 'error' };

export const createFanOutCollector = (
  deps: FanOutCollectorDeps,
): FanOutCollector => {
  const { growiClient } = deps;

  const ask = async <T>(
    relation: Relation,
    request: FanOutRequest<T>,
    deadlineMs: number,
  ): Promise<TargetOutcome<T>> => {
    try {
      const sent = await withDeadline(
        growiClient.sendCommand(relation.growiUri, request.build(relation)),
        deadlineMs,
      );
      if (sent === TIMED_OUT) {
        return { ok: false, reason: 'timeout' };
      }
      if (!sent.ok) {
        return { ok: false, reason: 'error' };
      }
      return { ok: true, value: request.extract(sent.response, relation) };
    } catch {
      // `build` and `extract` are the caller's code and may throw; so, in
      // principle, may anything `sendCommand` failed to fold into a value.
      // Whatever it was, it is one destination's problem and stops here.
      return { ok: false, reason: 'error' };
    }
  };

  return {
    fanOut: async <T>(request: FanOutRequest<T>): Promise<FanOutOutcome<T>> => {
      const deadlineMs = request.deadlineMs ?? DEFAULT_DEADLINE_MS;
      const asked = await runBounded(
        request.targets,
        request.concurrency ?? DEFAULT_CONCURRENCY,
        async (relation) => ({
          relation,
          outcome: await ask(relation, request, deadlineMs),
        }),
      );

      return {
        responded: asked.flatMap(({ relation, outcome }) =>
          outcome.ok
            ? [
                {
                  relationId: relation.relationId,
                  growiLabel: relation.growiLabel,
                  value: outcome.value,
                },
              ]
            : [],
        ),
        notResponded: asked.flatMap(({ relation, outcome }) =>
          outcome.ok
            ? []
            : [
                {
                  relationId: relation.relationId,
                  growiLabel: relation.growiLabel,
                  reason: outcome.reason,
                },
              ],
        ),
        excluded: request.excluded,
      };
    },
  };
};
