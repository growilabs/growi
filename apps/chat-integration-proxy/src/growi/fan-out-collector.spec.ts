import type { CommandRequest, CommandResponse } from '@growi/chat';
import { describe, expect, it, vi } from 'vitest';

import type { ExcludedGrowi } from '../relation/index.js';
import type { Relation } from '../types/index.js';
import { createFanOutCollector } from './fan-out-collector.js';
import type { GrowiCallResult, GrowiClient } from './growi-client.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const relation = (id: string, label: string): Relation => ({
  relationId: id,
  installationId: 'inst-1',
  growiUri: `https://${id}.example.com/`,
  growiLabel: label,
  searchWeight: 1,
  settingsVersion: 1,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
});

const searchRequestFor = (target: Relation): CommandRequest => ({
  op: 'command',
  relationId: target.relationId,
  // Distinct per target: `build` is the caller's closure, and assigning a
  // fresh id per call is its job, not the fan-out's.
  requestId: `req-${target.relationId}`,
  actor: { platform: 'slack', accountId: 'U1', displayName: 'User One' },
  channel: {
    platform: 'slack',
    channelId: 'C1',
    channelName: 'general',
    isPrivate: false,
  },
  kind: 'search',
  keyword: 'onboarding',
  limit: 10,
});

const searchResponse = (path: string): CommandResponse => ({
  kind: 'search',
  items: [
    {
      rank: 1,
      path,
      title: path,
      url: `https://growi.example.com${path}`,
      updatedAt: '2026-09-01T00:00:00.000Z',
      commentCount: 0,
    },
  ],
  appliedAs: 'linked-user',
});

const helpResponse = (usage: string): CommandResponse => ({
  kind: 'help',
  commands: [{ name: 'search', usage, description: 'find pages' }],
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A `sendCommand` driven by a per-destination script. Real (very short) waits
 * rather than fake timers: this repo's own `growi-uri-resolver.spec.ts` waits
 * on a real socket for the same reason -- a faked clock does not drive the
 * timers the code under test actually schedules, and pretending otherwise is
 * how a green test stops meaning anything.
 */
const clientAnswering = (
  script: Readonly<
    Record<
      string,
      | {
          readonly after?: number;
          readonly result: GrowiCallResult<CommandResponse>;
        }
      | 'never'
    >
  >,
) => {
  const sendCommand = vi.fn(
    async (
      growiUri: string,
      _request: CommandRequest,
    ): Promise<GrowiCallResult<CommandResponse>> => {
      const entry = script[growiUri];
      if (entry == null || entry === 'never') {
        // Longer than any deadline the tests set: the fan-out's own wait cap
        // is what has to end this, not the fake.
        await sleep(10_000);
        return { ok: false, reason: 'unreachable' };
      }
      if (entry.after != null) {
        await sleep(entry.after);
      }
      return entry.result;
    },
  );
  return { sendCommand } satisfies Pick<GrowiClient, 'sendCommand'>;
};

const extractSearch = (response: CommandResponse): ReadonlyArray<string> => {
  if (response.kind !== 'search') {
    throw new Error(`not a search answer: ${response.kind}`);
  }
  return response.items.map((entry) => entry.path);
};

// ---------------------------------------------------------------------------

describe('createFanOutCollector: the acceptance case', () => {
  const answered = relation('rel-a', 'Team A');
  const silent = relation('rel-b', 'Team B');
  // Two reasons, not one: design.md says 「`not-permitted-in-channel` と
  // `no-settings` は利用者への案内が違うので、1 つに丸めない」, and a single
  // fixture reason cannot tell a faithful pass-through from one that rewrites
  // every entry to the same reason.
  const leftOut: ReadonlyArray<ExcludedGrowi> = [
    {
      relationId: 'rel-c',
      growiLabel: 'Team C',
      reason: 'not-permitted-in-channel',
    },
    { relationId: 'rel-d', growiLabel: 'Team D', reason: 'no-settings' },
  ];

  it('reports the one answer, the one that ran out of time, and the one that was never asked', async () => {
    const growiClient = clientAnswering({
      [answered.growiUri]: {
        result: { ok: true, response: searchResponse('/a') },
      },
      [silent.growiUri]: 'never',
    });
    const collector = createFanOutCollector({ growiClient });

    const outcome = await collector.fanOut({
      targets: [answered, silent],
      excluded: leftOut,
      build: searchRequestFor,
      extract: extractSearch,
      deadlineMs: 30,
    });

    expect(outcome.responded).toEqual([
      { relationId: 'rel-a', growiLabel: 'Team A', value: ['/a'] },
    ]);
    // Requirement 3.4: 名前付きで示す -- the label has to survive, not just the id.
    expect(outcome.notResponded).toEqual([
      { relationId: 'rel-b', growiLabel: 'Team B', reason: 'timeout' },
    ]);
    // Requirement 11.3: carried through with its own reason, never folded into
    // `notResponded` -- "barred from this channel" and "asked but silent" are
    // different things to tell a user.
    expect(outcome.excluded).toEqual(leftOut);
  });

  it('never even asks a GROWI that was handed over as excluded', async () => {
    const growiClient = clientAnswering({
      [answered.growiUri]: {
        result: { ok: true, response: searchResponse('/a') },
      },
    });
    const collector = createFanOutCollector({ growiClient });

    await collector.fanOut({
      targets: [answered],
      excluded: leftOut,
      build: searchRequestFor,
      extract: extractSearch,
    });

    expect(growiClient.sendCommand).toHaveBeenCalledTimes(1);
    expect(growiClient.sendCommand).not.toHaveBeenCalledWith(
      'https://rel-c.example.com/',
      expect.anything(),
    );
  });
});

describe('createFanOutCollector: what it asks each destination', () => {
  it('sends exactly what `build` returned, to that relation own URI', async () => {
    const first = relation('rel-a', 'Team A');
    const second = relation('rel-b', 'Team B');
    const built = new Map<string, CommandRequest>();
    const build = (target: Relation): CommandRequest => {
      const request = searchRequestFor(target);
      built.set(target.relationId, request);
      return request;
    };
    const growiClient = clientAnswering({
      [first.growiUri]: {
        result: { ok: true, response: searchResponse('/a') },
      },
      [second.growiUri]: {
        result: { ok: true, response: searchResponse('/b') },
      },
    });
    const collector = createFanOutCollector({ growiClient });

    await collector.fanOut({
      targets: [first, second],
      excluded: [],
      build,
      extract: extractSearch,
    });

    // The identity check is the point: the fan-out does not invent, stamp or
    // rewrite `requestId` / `relationId`. Each target got its own request
    // object because `build` made one per call, and it arrived untouched.
    expect(growiClient.sendCommand.mock.calls).toEqual([
      [first.growiUri, built.get('rel-a')],
      [second.growiUri, built.get('rel-b')],
    ]);
    expect(growiClient.sendCommand.mock.calls[0]?.[1]).toBe(built.get('rel-a'));
    expect(built.get('rel-a')?.requestId).not.toBe(
      built.get('rel-b')?.requestId,
    );
  });
});

describe('createFanOutCollector: one destination failing never reaches another', () => {
  it('treats a refused call as no answer at all', async () => {
    const target = relation('rel-a', 'Team A');
    const growiClient = clientAnswering({
      [target.growiUri]: { result: { ok: false, reason: 'no-signing-key' } },
    });

    const outcome = await createFanOutCollector({ growiClient }).fanOut({
      targets: [target],
      excluded: [],
      build: searchRequestFor,
      extract: extractSearch,
    });

    expect(outcome.responded).toEqual([]);
    expect(outcome.notResponded).toEqual([
      { relationId: 'rel-a', growiLabel: 'Team A', reason: 'error' },
    ]);
  });

  it('treats an answer `extract` cannot use as no answer either', async () => {
    const target = relation('rel-a', 'Team A');
    const growiClient = clientAnswering({
      [target.growiUri]: {
        result: {
          ok: true,
          response: { kind: 'error', code: 'forbidden', message: 'no' },
        },
      },
    });

    const outcome = await createFanOutCollector({ growiClient }).fanOut({
      targets: [target],
      excluded: [],
      build: searchRequestFor,
      extract: extractSearch,
    });

    expect(outcome.responded).toEqual([]);
    expect(outcome.notResponded).toEqual([
      { relationId: 'rel-a', growiLabel: 'Team A', reason: 'error' },
    ]);
  });

  it('answers without throwing when not one GROWI came back (Requirement 3.5)', async () => {
    const targets = [relation('rel-a', 'Team A'), relation('rel-b', 'Team B')];
    const growiClient = clientAnswering({});

    const outcome = await createFanOutCollector({ growiClient }).fanOut({
      targets,
      excluded: [],
      build: searchRequestFor,
      extract: extractSearch,
      deadlineMs: 20,
    });

    expect(outcome.responded).toEqual([]);
    expect(outcome.notResponded.map((entry) => entry.reason)).toEqual([
      'timeout',
      'timeout',
    ]);
  });

  it('answers without throwing when there is nowhere to send at all', async () => {
    const growiClient = clientAnswering({});

    const outcome = await createFanOutCollector({ growiClient }).fanOut({
      targets: [],
      excluded: [],
      build: searchRequestFor,
      extract: extractSearch,
    });

    expect(outcome).toEqual({ responded: [], notResponded: [], excluded: [] });
    expect(growiClient.sendCommand).not.toHaveBeenCalled();
  });
});

describe('createFanOutCollector: how many requests are out at once', () => {
  it('keeps exactly `concurrency` requests in flight, no more and no fewer', async () => {
    const targets = Array.from({ length: 10 }, (_, index) =>
      relation(`rel-${index}`, `Team ${index}`),
    );
    let inFlight = 0;
    let peak = 0;
    const sendCommand = vi.fn(
      async (): Promise<GrowiCallResult<CommandResponse>> => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await sleep(5);
        inFlight -= 1;
        return { ok: true, response: searchResponse('/p') };
      },
    );

    const outcome = await createFanOutCollector({
      growiClient: { sendCommand },
    }).fanOut({
      targets,
      excluded: [],
      build: searchRequestFor,
      extract: extractSearch,
      concurrency: 3,
    });

    // Both bounds: `toBeLessThanOrEqual` alone is also satisfied by an
    // implementation that sends one at a time.
    expect(peak).toBe(3);
    expect(outcome.responded).toHaveLength(10);
    // Every destination here waits the same 5ms, so this only says the ten
    // answers all arrived under their own names -- not that target order
    // survives a destination replying out of turn. That is the next block.
    expect(outcome.responded.map((entry) => entry.relationId)).toEqual(
      targets.map((target) => target.relationId),
    );
  });
});

describe('createFanOutCollector: the order of the answers', () => {
  it('lists both answers and failures in the order the targets were given, not the order they finished', async () => {
    // The fixture is built so completion order and target order disagree in
    // *both* output arrays: within `responded` and within `notResponded`
    // alike, the target listed first is the slower one. A fan-out that wrote
    // each answer down as it arrived would put the fast pair first in both.
    const slowOk = relation('slow-ok', 'Slow OK');
    const slowErr = relation('slow-err', 'Slow Err');
    const fastOk = relation('fast-ok', 'Fast OK');
    const fastErr = relation('fast-err', 'Fast Err');
    const growiClient = clientAnswering({
      [slowOk.growiUri]: {
        after: 40,
        result: { ok: true, response: searchResponse('/slow') },
      },
      [slowErr.growiUri]: {
        after: 35,
        // A refused call, not a wait cap running out: a timed-out target
        // finishes at `deadlineMs`, which would flatten the stagger this test
        // depends on.
        result: { ok: false, reason: 'unreachable' },
      },
      [fastOk.growiUri]: {
        after: 1,
        result: { ok: true, response: searchResponse('/fast') },
      },
      [fastErr.growiUri]: {
        after: 2,
        result: { ok: false, reason: 'unreachable' },
      },
    });

    const outcome = await createFanOutCollector({ growiClient }).fanOut({
      targets: [slowOk, slowErr, fastOk, fastErr],
      excluded: [],
      build: searchRequestFor,
      extract: extractSearch,
      // Enough slots for all four to start together -- with fewer, the slow
      // ones would simply be sent first and the orders would agree again.
      concurrency: 4,
      // Far above the slowest destination: nothing here is meant to time out.
      deadlineMs: 300,
    });

    expect(outcome.responded.map((entry) => entry.relationId)).toEqual([
      'slow-ok',
      'fast-ok',
    ]);
    expect(outcome.notResponded.map((entry) => entry.relationId)).toEqual([
      'slow-err',
      'fast-err',
    ]);
  });
});

describe('createFanOutCollector: help uses the same waiting (Requirements 14.3, 14.5)', () => {
  it('keeps each GROWI help apart by label, and names the one that returned none', async () => {
    const first = relation('rel-a', 'Team A');
    const second = relation('rel-b', 'Team B');
    const third = relation('rel-c', 'Team C');
    const growiClient = clientAnswering({
      [first.growiUri]: {
        result: { ok: true, response: helpResponse('/search word') },
      },
      [second.growiUri]: {
        result: { ok: true, response: helpResponse('/find word') },
      },
      [third.growiUri]: 'never',
    });

    const outcome = await createFanOutCollector({ growiClient }).fanOut({
      targets: [first, second, third],
      excluded: [],
      build: (target) => ({ ...searchRequestFor(target), kind: 'help' }),
      extract: (response) => {
        if (response.kind !== 'help') {
          throw new Error(`not a help answer: ${response.kind}`);
        }
        return response.commands.map((entry) => entry.usage);
      },
      deadlineMs: 30,
    });

    expect(outcome.responded).toEqual([
      { relationId: 'rel-a', growiLabel: 'Team A', value: ['/search word'] },
      { relationId: 'rel-b', growiLabel: 'Team B', value: ['/find word'] },
    ]);
    // 14.5: 「その GROWI についてヘルプを表示できなかったことを示す」 needs the
    // label, which is why `notResponded` carries one.
    expect(outcome.notResponded).toEqual([
      { relationId: 'rel-c', growiLabel: 'Team C', reason: 'timeout' },
    ]);
  });
});
