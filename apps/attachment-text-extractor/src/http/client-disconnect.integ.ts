import {
  childPids,
  hasEnded,
  killStrayChildren,
  openFdCount,
  STAND_IN_CHILD,
  standInInput,
  waitForOnlyChild,
  waitUntil,
} from '../runner/spec-support';
import { extractedOf, postFile } from './spec-support/extract-client';
import { fakeRunner } from './spec-support/fake-runner';
import {
  realRunner,
  type TestService,
  useTestService,
} from './spec-support/test-service';

// Req 3.5 end to end: a caller that goes away mid-conversion has its child
// stopped and reaped, and the slot comes back. The real HTTP layer and runner
// with a stand-in child that converts forever ('hang'). Python
// test_live_disconnect.py.

vi.setConfig({ testTimeout: 120_000 });

const service = useTestService(() => ({ runner: fakeRunner() }));

const standInFile = (mode: string, argument = '-'): Buffer =>
  Buffer.concat(standInInput(mode, { argument }).chunks);

const startStandIn = (
  env: Readonly<Record<string, string>>,
): Promise<TestService> =>
  service.restart(realRunner(env, { childEntry: STAND_IN_CHILD }), env);

/** Starts a conversion that never ends, waits for its child, then hangs up. Returns the child's pid. */
const hangUpMidConversion = async (target: TestService): Promise<number> => {
  const caller = new AbortController();
  const request = postFile(target.url, 'a.txt', standInFile('hang'), {
    token: target.token,
    signal: caller.signal,
  }).catch(() => null);
  const pid = await waitForOnlyChild(10_000);
  caller.abort();
  await request;
  return pid;
};

/** Waits until a conversion with the only slot succeeds again. */
const slotComesBack = async (target: TestService): Promise<void> => {
  await expect
    .poll(
      async () =>
        (
          await postFile(target.url, 'a.txt', standInFile('echo'), {
            token: target.token,
          })
        ).status,
      { timeout: 5_000 },
    )
    .toBe(200);
};

describe.skipIf(process.platform !== 'linux')(
  'a caller that gives up mid-conversion',
  () => {
    afterEach(killStrayChildren);

    it('has its child stopped and reaped, and the only slot comes back', async () => {
      const target = await startStandIn({ MAX_CONCURRENCY: '1' });

      const pid = await hangUpMidConversion(target);

      expect(await waitUntil(() => hasEnded(pid), 3_000)).toBe(true);
      await slotComesBack(target);
      expect(await waitUntil(() => childPids().length === 0, 3_000)).toBe(true);
    });

    it('thirty times leaks no fd, child or zombie', async () => {
      const target = await startStandIn({ MAX_CONCURRENCY: '1' });
      await slotComesBack(target);
      const fdsBefore = openFdCount();

      for (let i = 0; i < 30; i++) {
        const pid = await hangUpMidConversion(target);
        expect(await waitUntil(() => hasEnded(pid), 3_000)).toBe(true);
        await slotComesBack(target);
      }

      expect(await waitUntil(() => childPids().length === 0, 3_000)).toBe(true);
      expect(openFdCount() - fdsBefore).toBeLessThan(10);
    });
  },
);

describe.skipIf(process.platform !== 'linux')('a caller that waits', () => {
  afterEach(killStrayChildren);

  it('gets the result of a slow conversion', async () => {
    const target = await startStandIn({ MAX_CONCURRENCY: '1' });

    const answer = await postFile(
      target.url,
      'a.txt',
      standInFile('slow-echo', '500'),
      { token: target.token },
    );

    expect(extractedOf(answer).pages[0]?.content).toMatch(
      /^received \d+ bytes$/,
    );
  });

  it('leaving right as the conversion finishes is harmless', async () => {
    const target = await startStandIn({ MAX_CONCURRENCY: '1' });
    const caller = new AbortController();
    const request = postFile(
      target.url,
      'a.txt',
      standInFile('slow-echo', '300'),
      { token: target.token, signal: caller.signal },
    ).catch(() => null);
    await waitForOnlyChild(10_000);
    await waitUntil(() => childPids().length === 0, 5_000);

    caller.abort();
    await request;

    await slotComesBack(target);
  });
});
