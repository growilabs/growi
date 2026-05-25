/**
 * Stable contract surface tests
 *
 * Mechanical safety net that fails whenever a stable-contract surface name,
 * value, exit code, file naming convention, CSV header, or barrel re-export
 * shape is changed by accident.  These are NOT behavior tests — implementation
 * correctness is covered by the per-module specs.  This file only verifies
 * that the names / values / signatures declared as "do not change" stay
 * intact.
 *
 * Covered surfaces (see design.md "Stable Contract Surface Tests"):
 *   (a) Env var names referenced from scenarios/load.ts and run-scenario.ts
 *   (b) ScenarioRunnerError exitCode value AND type (1 | 2)
 *   (c) Snapshot file naming convention (snapshot-a/b/c.heapsnapshot)
 *   (d) RssTimeSeriesLogger CSV header string
 *   (e) Top-level barrel re-export shape (./index)
 *
 * Requirements: 1.4, 5.3, 6.2, 6.3, 6.4, 8.1, 8.2, 9.2, 9.3
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest';

// ---------------------------------------------------------------------------
// Type-level helper for compile-time assertions
// ---------------------------------------------------------------------------

type Expect<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

// ---------------------------------------------------------------------------
// (a) Env var name presence in source
// ---------------------------------------------------------------------------

describe('stable contract surface', () => {
  describe('(a) Env var names exist in source', () => {
    const loadSource = fs.readFileSync(
      path.join(__dirname, 'scenarios', 'load.ts'),
      'utf8',
    );
    const baselineSource = fs.readFileSync(
      path.join(__dirname, 'scenarios', 'baseline.ts'),
      'utf8',
    );
    const drainSource = fs.readFileSync(
      path.join(__dirname, 'scenarios', 'drain.ts'),
      'utf8',
    );
    const runScenarioSource = fs.readFileSync(
      path.join(__dirname, 'run-scenario.ts'),
      'utf8',
    );

    // Source bundle that env var names may live in.  The names must appear
    // verbatim in at least one of these files (scenarios/* declares them;
    // run-scenario.ts re-uses LOAD_* through process.env parsing).
    const combinedSource = [
      loadSource,
      baselineSource,
      drainSource,
      runScenarioSource,
    ].join('\n');

    const stableEnvVarNames = [
      'LOAD_PAGE_CREATE',
      'LOAD_PAGE_EDIT',
      'LOAD_PAGE_GET',
      'LOAD_PAGE_LIST',
      'LOAD_PAGE_SEARCH',
      'LOAD_YJS_CLEAN_CLOSE',
      'LOAD_YJS_ABORT',
      'BASELINE_IDLE_SECONDS',
      'DRAIN_IDLE_SECONDS',
    ] as const;

    it.each(
      stableEnvVarNames,
    )('%s appears verbatim in scenarios/* or run-scenario.ts', (envVarName) => {
      expect(combinedSource).toContain(envVarName);
    });

    it('declares exactly 9 stable env var names (guard against silent additions)', () => {
      expect(stableEnvVarNames).toHaveLength(9);
    });
  });

  // -------------------------------------------------------------------------
  // (b) ScenarioRunnerError exitCode — runtime value AND TypeScript type
  // -------------------------------------------------------------------------
  describe('(b) ScenarioRunnerError exitCode contract', () => {
    it('can be constructed with exitCode 1 and exposes it on the instance', async () => {
      const { ScenarioRunnerError } = await import('./run-scenario');
      const err = new ScenarioRunnerError('msg', 1);
      expect(err.exitCode).toBe(1);
    });

    it('can be constructed with exitCode 2 and exposes it on the instance', async () => {
      const { ScenarioRunnerError } = await import('./run-scenario');
      const err = new ScenarioRunnerError('msg', 2);
      expect(err.exitCode).toBe(2);
    });

    it('exitCode type is exactly the literal union 1 | 2', async () => {
      const { ScenarioRunnerError } = await import('./run-scenario');

      // expectTypeOf assertion — type error if exitCode is widened to `number`
      // or narrowed to a single literal.
      expectTypeOf<
        InstanceType<typeof ScenarioRunnerError>['exitCode']
      >().toEqualTypeOf<1 | 2>();

      // Mirror as a pure type-level assertion for explicit Expect<Equal<...>>
      // documentation (also a type error if the shape ever changes).
      type _CheckExitCodeType = Expect<
        Equal<InstanceType<typeof ScenarioRunnerError>['exitCode'], 1 | 2>
      >;
      // Reference the alias to keep the compiler happy that it's not unused
      // when emitDecoratorMetadata is off.
      const _checkSentinel: _CheckExitCodeType = true;
      expect(_checkSentinel).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // (c) Snapshot file naming convention
  // -------------------------------------------------------------------------
  describe('(c) Snapshot file naming convention', () => {
    // Use isolated module + mocks for this group so we record takeSnapshot
    // paths without colliding with other describe blocks' mock state.
    const snapshotPaths: string[] = [];

    beforeEach(async () => {
      snapshotPaths.length = 0;
      vi.resetModules();

      vi.doMock('./cdp-snapshot-client', () => ({
        createCdpSnapshotClient: () => ({
          connect: vi.fn().mockResolvedValue(undefined),
          takeSnapshot: vi.fn((outputPath: string) => {
            snapshotPaths.push(outputPath);
            return Promise.resolve();
          }),
          sendCommand: vi.fn().mockResolvedValue({ result: { value: '{}' } }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      }));

      vi.doMock('./rss-time-series-logger', () => ({
        createRssTimeSeriesLogger: () => ({
          start: vi.fn().mockResolvedValue(undefined),
          mark: vi.fn(),
          stop: vi.fn().mockResolvedValue(undefined),
        }),
      }));

      vi.doMock('./load-driver', () => ({
        createLoadDriver: () => ({
          initInstaller: vi.fn().mockResolvedValue({
            adminEmail: 'admin@example.com',
            adminPassword: 'password',
            cookie: 'session=abc',
          }),
          pageCreate: vi.fn().mockResolvedValue(undefined),
          pageEdit: vi.fn().mockResolvedValue(undefined),
          pageGet: vi.fn().mockResolvedValue(undefined),
          pageList: vi.fn().mockResolvedValue(undefined),
          pageSearch: vi.fn().mockResolvedValue(undefined),
          yjsSessionCleanClose: vi.fn().mockResolvedValue(undefined),
          yjsSessionAbort: vi.fn().mockResolvedValue(undefined),
        }),
      }));

      vi.doMock('./scenarios', () => ({
        runBaseline: vi.fn().mockResolvedValue(undefined),
        runLoad: vi.fn().mockResolvedValue(undefined),
        runDrain: vi.fn().mockResolvedValue(undefined),
      }));
    });

    afterEach(() => {
      vi.doUnmock('./cdp-snapshot-client');
      vi.doUnmock('./rss-time-series-logger');
      vi.doUnmock('./load-driver');
      vi.doUnmock('./scenarios');
      vi.resetModules();
    });

    it('takeSnapshot is invoked with paths ending in snapshot-a/b/c.heapsnapshot in order', async () => {
      const { runScenario } = await import('./run-scenario');

      await runScenario({
        inspectorUrl: 'http://127.0.0.1:9229',
        outputDir: '/tmp/stable-contract-snapshot-naming',
        baseUrl: 'http://localhost:3000',
        idleSeconds: 5,
        loadOpCounts: {
          pageCreate: 1,
          pageEdit: 1,
          pageGet: 1,
          pageList: 1,
          pageSearch: 1,
          yjsSessionsCleanClose: 1,
          yjsSessionsAbort: 1,
        },
      });

      expect(snapshotPaths).toHaveLength(3);
      expect(snapshotPaths[0].endsWith('/snapshot-a.heapsnapshot')).toBe(true);
      expect(snapshotPaths[1].endsWith('/snapshot-b.heapsnapshot')).toBe(true);
      expect(snapshotPaths[2].endsWith('/snapshot-c.heapsnapshot')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // (d) CSV header string
  // -------------------------------------------------------------------------
  describe('(d) RssTimeSeriesLogger CSV header', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join('/tmp', 'stable-contract-csv-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('CSV file starts with the exact header "timestamp,phase,rss,heap_used,heap_total,external\\n"', async () => {
      const { createRssTimeSeriesLogger } = await import(
        './rss-time-series-logger'
      );

      const sendCommand = vi.fn().mockResolvedValue({
        result: {
          value: JSON.stringify({
            rss: 0,
            heapUsed: 0,
            heapTotal: 0,
            external: 0,
          }),
        },
      });

      const logger = createRssTimeSeriesLogger(tmpDir, sendCommand);
      await logger.start('baseline');
      await logger.stop();

      const csvPath = path.join(tmpDir, 'rss-timeseries.csv');
      const content = fs.readFileSync(csvPath, 'utf8');

      const expectedHeader =
        'timestamp,phase,rss,heap_used,heap_total,external\n';
      expect(content.startsWith(expectedHeader)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // (e) Top-level barrel re-export shape
  // -------------------------------------------------------------------------
  describe('(e) Top-level barrel re-export shape (./index)', () => {
    it('exposes runScenario as a function at runtime', async () => {
      const Public = await import('./index');
      expect(typeof Public.runScenario).toBe('function');
    });

    it('exposes ScenarioRunnerError as a constructor at runtime', async () => {
      const Public = await import('./index');
      expect(typeof Public.ScenarioRunnerError).toBe('function');
      const err = new Public.ScenarioRunnerError('msg', 1);
      expect(err).toBeInstanceOf(Public.ScenarioRunnerError);
      expect(err).toBeInstanceOf(Error);
    });

    it.each([
      'createLoadDriver',
      'createCdpSnapshotClient',
      'createRssTimeSeriesLogger',
      'runBaseline',
      'runLoad',
      'runDrain',
      'LOAD_PAGE_CREATE',
      'LOAD_PAGE_EDIT',
      'LOAD_PAGE_GET',
      'LOAD_PAGE_LIST',
      'LOAD_PAGE_SEARCH',
      'LOAD_YJS_CLEAN_CLOSE',
      'LOAD_YJS_ABORT',
    ])('does NOT re-export internal symbol %s', async (symbolName) => {
      const Public = (await import('./index')) as Record<string, unknown>;
      expect(symbolName in Public).toBe(false);
    });

    it('type assertions: the 5 stable symbols are typed on the barrel', async () => {
      const Public = await import('./index');

      // (1) runScenario — runtime value with the expected signature
      const runScenarioRef: typeof Public.runScenario = Public.runScenario;
      expect(typeof runScenarioRef).toBe('function');

      // (2) ScenarioRunnerError — runtime constructor
      const ErrorCtor: typeof Public.ScenarioRunnerError =
        Public.ScenarioRunnerError;
      expect(typeof ErrorCtor).toBe('function');

      // (3-5) ScenarioRunnerOptions / LoadOpCounts / LoadDriver are types.
      // Reference each in a type-only position so the compiler verifies the
      // barrel re-exports them.  Object-typed sentinels guarantee the shape
      // exists at typecheck time.
      const _opts: import('./index').ScenarioRunnerOptions | undefined =
        undefined;
      const _counts: import('./index').LoadOpCounts | undefined = undefined;
      const _driver: import('./index').LoadDriver | undefined = undefined;
      expect(_opts).toBeUndefined();
      expect(_counts).toBeUndefined();
      expect(_driver).toBeUndefined();
    });

    it('type assertion: createLoadDriver / LOAD_PAGE_CREATE etc. are NOT on the barrel type', async () => {
      const Public = await import('./index');

      // Type-level: these properties must not exist on the barrel module type.
      // `keyof typeof Public` should NOT include the internal names below;
      // we encode this via a conditional type that must evaluate to `never`.
      type BarrelKeys = keyof typeof Public;
      type ForbiddenInBarrel =
        | 'createLoadDriver'
        | 'createCdpSnapshotClient'
        | 'createRssTimeSeriesLogger'
        | 'runBaseline'
        | 'runLoad'
        | 'runDrain'
        | 'LOAD_PAGE_CREATE';
      type _NoForbiddenKeys = Expect<
        Equal<Extract<BarrelKeys, ForbiddenInBarrel>, never>
      >;
      const _checkSentinel: _NoForbiddenKeys = true;
      expect(_checkSentinel).toBe(true);
    });
  });
});
