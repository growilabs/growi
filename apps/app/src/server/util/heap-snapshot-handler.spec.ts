import * as fs from 'node:fs';
import * as v8 from 'node:v8';

// Mock node:v8 module to avoid actual heap snapshot writes
vi.mock('node:v8', () => ({
  writeHeapSnapshot: vi.fn().mockReturnValue('/tmp/snapshot.heapsnapshot'),
}));

// Mock node:fs to avoid actual directory/file operations
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
}));

// Mock logger to capture log calls
vi.mock('~/utils/logger', () => ({
  default: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('heap-snapshot-handler', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original env and clean up before each test
    originalEnv = { ...process.env };
    delete process.env.MEMORY_PROFILING_ENABLED;
    delete process.env.MEMORY_PROFILING_OUTPUT_DIR;
    // Remove all SIGUSR2 listeners to ensure test isolation
    process.removeAllListeners('SIGUSR2');
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    // Clean up listeners
    process.removeAllListeners('SIGUSR2');
  });

  describe('registerHeapSnapshotSignalHandler', () => {
    describe('when MEMORY_PROFILING_ENABLED is NOT set', () => {
      it('should NOT register a SIGUSR2 listener', async () => {
        const { registerHeapSnapshotSignalHandler } = await import(
          './heap-snapshot-handler'
        );

        const listenerCountBefore = process.listenerCount('SIGUSR2');
        registerHeapSnapshotSignalHandler();
        const listenerCountAfter = process.listenerCount('SIGUSR2');

        expect(listenerCountAfter).toBe(listenerCountBefore);
      });

      it('should NOT call v8.writeHeapSnapshot when SIGUSR2 is emitted', async () => {
        const { registerHeapSnapshotSignalHandler } = await import(
          './heap-snapshot-handler'
        );

        registerHeapSnapshotSignalHandler();
        process.emit('SIGUSR2');

        expect(vi.mocked(v8.writeHeapSnapshot)).not.toHaveBeenCalled();
      });
    });

    describe('when MEMORY_PROFILING_ENABLED is set to "true"', () => {
      beforeEach(() => {
        process.env.MEMORY_PROFILING_ENABLED = 'true';
      });

      it('should register a SIGUSR2 listener', async () => {
        const { registerHeapSnapshotSignalHandler } = await import(
          './heap-snapshot-handler'
        );

        const listenerCountBefore = process.listenerCount('SIGUSR2');
        registerHeapSnapshotSignalHandler();
        const listenerCountAfter = process.listenerCount('SIGUSR2');

        expect(listenerCountAfter).toBe(listenerCountBefore + 1);
      });

      it('should call v8.writeHeapSnapshot with a path matching the default output dir on SIGUSR2', async () => {
        const { registerHeapSnapshotSignalHandler } = await import(
          './heap-snapshot-handler'
        );

        registerHeapSnapshotSignalHandler();
        process.emit('SIGUSR2');

        expect(vi.mocked(v8.writeHeapSnapshot)).toHaveBeenCalledOnce();
        const calledPath = vi.mocked(v8.writeHeapSnapshot).mock
          .calls[0][0] as string;
        expect(calledPath).toMatch(
          /tmp\/memory-leak-investigation\/snapshots\/signal-.*\.heapsnapshot$/,
        );
      });

      it('should create the output directory recursively when SIGUSR2 is emitted', async () => {
        const { registerHeapSnapshotSignalHandler } = await import(
          './heap-snapshot-handler'
        );

        registerHeapSnapshotSignalHandler();
        process.emit('SIGUSR2');

        expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledOnce();
        const [dirArg, optionsArg] = vi.mocked(fs.mkdirSync).mock.calls[0];
        expect(dirArg).toContain('tmp/memory-leak-investigation/snapshots');
        expect(optionsArg).toEqual({ recursive: true });
      });

      it('should use MEMORY_PROFILING_OUTPUT_DIR env var as output dir when set', async () => {
        process.env.MEMORY_PROFILING_OUTPUT_DIR = '/custom/output/dir';
        const { registerHeapSnapshotSignalHandler } = await import(
          './heap-snapshot-handler'
        );

        registerHeapSnapshotSignalHandler();
        process.emit('SIGUSR2');

        const calledPath = vi.mocked(v8.writeHeapSnapshot).mock
          .calls[0][0] as string;
        expect(calledPath).toMatch(
          /^\/custom\/output\/dir\/signal-.*\.heapsnapshot$/,
        );
      });

      it('should use a timestamp-based filename with ISO8601 format on SIGUSR2', async () => {
        const { registerHeapSnapshotSignalHandler } = await import(
          './heap-snapshot-handler'
        );

        registerHeapSnapshotSignalHandler();
        process.emit('SIGUSR2');

        const calledPath = vi.mocked(v8.writeHeapSnapshot).mock
          .calls[0][0] as string;
        // File name should be signal-{ISO8601 timestamp}.heapsnapshot
        // ISO8601 timestamps contain digits, dashes, T, colons (or their encoded form), and Z
        expect(calledPath).toMatch(/signal-\d{4}-\d{2}-\d{2}.*\.heapsnapshot$/);
      });
    });

    describe('when MEMORY_PROFILING_ENABLED is set to "1"', () => {
      beforeEach(() => {
        process.env.MEMORY_PROFILING_ENABLED = '1';
      });

      it('should register a SIGUSR2 listener', async () => {
        const { registerHeapSnapshotSignalHandler } = await import(
          './heap-snapshot-handler'
        );

        const listenerCountBefore = process.listenerCount('SIGUSR2');
        registerHeapSnapshotSignalHandler();
        const listenerCountAfter = process.listenerCount('SIGUSR2');

        expect(listenerCountAfter).toBe(listenerCountBefore + 1);
      });
    });

    describe('exception handling when v8.writeHeapSnapshot throws', () => {
      beforeEach(() => {
        process.env.MEMORY_PROFILING_ENABLED = 'true';
        vi.mocked(v8.writeHeapSnapshot).mockImplementation(() => {
          throw new Error('Snapshot write failed');
        });
      });

      it('should catch the error and NOT propagate it (process should not terminate)', async () => {
        const { registerHeapSnapshotSignalHandler } = await import(
          './heap-snapshot-handler'
        );

        registerHeapSnapshotSignalHandler();

        // This should not throw - exception must be swallowed
        expect(() => process.emit('SIGUSR2')).not.toThrow();
      });

      it('should call logger.error when v8.writeHeapSnapshot throws', async () => {
        const loggerFactory = (await import('~/utils/logger')).default;
        const _mockLogger =
          vi.mocked(loggerFactory).mock.results[0]?.value ??
          vi.mocked(loggerFactory)('heap-snapshot-handler');

        const { registerHeapSnapshotSignalHandler } = await import(
          './heap-snapshot-handler'
        );

        registerHeapSnapshotSignalHandler();
        process.emit('SIGUSR2');

        // logger.error should have been called
        const loggerInstance = vi
          .mocked(loggerFactory)
          .mock.results.at(-1)?.value;
        expect(loggerInstance?.error).toHaveBeenCalled();
      });
    });
  });
});
