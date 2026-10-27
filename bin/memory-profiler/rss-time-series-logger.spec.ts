/**
 * Unit tests for RssTimeSeriesLogger
 *
 * Uses vi.useFakeTimers() and a mock sendCdpCommand function to exercise
 * the logger without a real CDP connection or filesystem writes.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------
const { createRssTimeSeriesLogger } = await import('./rss-time-series-logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake CDP command sender that returns process.memoryUsage() values. */
function makeMockSender(values?: {
  rss?: number;
  heapUsed?: number;
  heapTotal?: number;
  external?: number;
}) {
  const mem = {
    rss: values?.rss ?? 100_000_000,
    heapUsed: values?.heapUsed ?? 50_000_000,
    heapTotal: values?.heapTotal ?? 70_000_000,
    external: values?.external ?? 5_000_000,
  };
  return vi.fn().mockResolvedValue({
    result: { value: JSON.stringify(mem) },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RssTimeSeriesLogger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join('/tmp', 'rss-logger-test-'));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // -------------------------------------------------------------------------
  // start() — creates CSV with header
  // -------------------------------------------------------------------------
  describe('start()', () => {
    it('creates a CSV file with the header row', async () => {
      const sendCommand = makeMockSender();
      const logger = createRssTimeSeriesLogger(tmpDir, sendCommand);

      await logger.start('baseline');

      const outputPath = path.join(tmpDir, 'rss-timeseries.csv');
      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, 'utf8');
      expect(content).toBe(
        'timestamp,phase,rss,heap_used,heap_total,external\n',
      );
    });

    it('writes a data row after the first interval tick', async () => {
      const sendCommand = makeMockSender({
        rss: 120_000_000,
        heapUsed: 60_000_000,
        heapTotal: 80_000_000,
        external: 3_000_000,
      });
      const logger = createRssTimeSeriesLogger(tmpDir, sendCommand);

      await logger.start('baseline');

      // Advance 1 second to trigger the interval
      await vi.advanceTimersByTimeAsync(1000);

      const outputPath = path.join(tmpDir, 'rss-timeseries.csv');
      const content = fs.readFileSync(outputPath, 'utf8');
      const lines = content.split('\n').filter(Boolean);

      // header + 1 data row
      expect(lines).toHaveLength(2);

      const header = lines[0];
      expect(header).toBe('timestamp,phase,rss,heap_used,heap_total,external');

      const dataRow = lines[1];
      // timestamp,phase,rss,heap_used,heap_total,external
      const parts = dataRow.split(',');
      expect(parts).toHaveLength(6);
      expect(parts[1]).toBe('baseline');
      expect(parts[2]).toBe('120000000');
      expect(parts[3]).toBe('60000000');
      expect(parts[4]).toBe('80000000');
      expect(parts[5]).toBe('3000000');

      // Timestamp should be a valid ISO8601 string
      expect(() => new Date(parts[0])).not.toThrow();
      expect(new Date(parts[0]).getTime()).toBeGreaterThan(0);
    });

    it('writes multiple rows over multiple interval ticks', async () => {
      const sendCommand = makeMockSender();
      const logger = createRssTimeSeriesLogger(tmpDir, sendCommand);

      await logger.start('baseline');

      // Advance 3 seconds
      await vi.advanceTimersByTimeAsync(3000);

      const outputPath = path.join(tmpDir, 'rss-timeseries.csv');
      const content = fs.readFileSync(outputPath, 'utf8');
      const lines = content.split('\n').filter(Boolean);

      // header + 3 data rows
      expect(lines).toHaveLength(4);
    });
  });

  // -------------------------------------------------------------------------
  // mark() — changes phase label
  // -------------------------------------------------------------------------
  describe('mark()', () => {
    it('changes the phase label for subsequent rows after mark()', async () => {
      const sendCommand = makeMockSender();
      const logger = createRssTimeSeriesLogger(tmpDir, sendCommand);

      await logger.start('baseline');

      // 1 tick in baseline
      await vi.advanceTimersByTimeAsync(1000);

      // Switch to load phase
      logger.mark('load');

      // 1 tick in load
      await vi.advanceTimersByTimeAsync(1000);

      // Switch to drain phase
      logger.mark('drain');

      // 1 tick in drain
      await vi.advanceTimersByTimeAsync(1000);

      const outputPath = path.join(tmpDir, 'rss-timeseries.csv');
      const content = fs.readFileSync(outputPath, 'utf8');
      const lines = content.split('\n').filter(Boolean);

      // header + 3 data rows
      expect(lines).toHaveLength(4);

      const phases = lines.slice(1).map((line) => line.split(',')[1]);
      expect(phases).toEqual(['baseline', 'load', 'drain']);
    });
  });

  // -------------------------------------------------------------------------
  // stop() — stops the interval
  // -------------------------------------------------------------------------
  describe('stop()', () => {
    it('stops writing rows after stop() is called', async () => {
      const sendCommand = makeMockSender();
      const logger = createRssTimeSeriesLogger(tmpDir, sendCommand);

      await logger.start('baseline');
      await vi.advanceTimersByTimeAsync(2000);
      await logger.stop();

      const outputPath = path.join(tmpDir, 'rss-timeseries.csv');
      const linesBefore = fs
        .readFileSync(outputPath, 'utf8')
        .split('\n')
        .filter(Boolean).length;

      // Advance time further — no new rows should be written
      await vi.advanceTimersByTimeAsync(5000);

      const linesAfter = fs
        .readFileSync(outputPath, 'utf8')
        .split('\n')
        .filter(Boolean).length;

      expect(linesAfter).toBe(linesBefore);
    });

    it('stop() is safe to call when not started', async () => {
      const sendCommand = makeMockSender();
      const logger = createRssTimeSeriesLogger(tmpDir, sendCommand);
      await expect(logger.stop()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Archive existing CSV
  // -------------------------------------------------------------------------
  describe('archive behavior', () => {
    it('archives an existing rss-timeseries.csv before creating a new one', async () => {
      const outputPath = path.join(tmpDir, 'rss-timeseries.csv');

      // Pre-create a CSV with some content
      fs.writeFileSync(outputPath, 'old-content\n');

      const sendCommand = makeMockSender();
      const logger = createRssTimeSeriesLogger(tmpDir, sendCommand);

      await logger.start('baseline');

      // The original file should no longer contain old-content
      const newContent = fs.readFileSync(outputPath, 'utf8');
      expect(newContent).not.toContain('old-content');
      expect(newContent).toBe(
        'timestamp,phase,rss,heap_used,heap_total,external\n',
      );

      // An archive file should exist with old-content
      const files = fs.readdirSync(tmpDir);
      const archiveFiles = files.filter(
        (f) =>
          f.startsWith('rss-timeseries.') &&
          f.endsWith('.csv') &&
          f !== 'rss-timeseries.csv',
      );
      expect(archiveFiles).toHaveLength(1);

      const archiveContent = fs.readFileSync(
        path.join(tmpDir, archiveFiles[0]),
        'utf8',
      );
      expect(archiveContent).toBe('old-content\n');
    });

    it('does not create an archive when no existing CSV is present', async () => {
      const sendCommand = makeMockSender();
      const logger = createRssTimeSeriesLogger(tmpDir, sendCommand);

      await logger.start('baseline');

      const files = fs.readdirSync(tmpDir);
      const archiveFiles = files.filter(
        (f) =>
          f.startsWith('rss-timeseries.') &&
          f.endsWith('.csv') &&
          f !== 'rss-timeseries.csv',
      );
      expect(archiveFiles).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // CSV format correctness
  // -------------------------------------------------------------------------
  describe('CSV format', () => {
    it('timestamp field is a valid ISO8601 datetime string', async () => {
      const sendCommand = makeMockSender();
      const logger = createRssTimeSeriesLogger(tmpDir, sendCommand);

      await logger.start('baseline');
      await vi.advanceTimersByTimeAsync(1000);

      const outputPath = path.join(tmpDir, 'rss-timeseries.csv');
      const lines = fs
        .readFileSync(outputPath, 'utf8')
        .split('\n')
        .filter(Boolean);
      const dataRow = lines[1];
      const timestamp = dataRow.split(',')[0];

      // ISO8601 with "T" separator
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      const parsed = new Date(timestamp);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
    });

    it('sendCommand is called with Runtime.evaluate and correct expression', async () => {
      const sendCommand = makeMockSender();
      const logger = createRssTimeSeriesLogger(tmpDir, sendCommand);

      await logger.start('baseline');
      await vi.advanceTimersByTimeAsync(1000);

      expect(sendCommand).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: 'JSON.stringify(process.memoryUsage())',
        returnByValue: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Output directory creation
  // -------------------------------------------------------------------------
  describe('output directory', () => {
    it('creates the output directory if it does not exist', async () => {
      const nestedDir = path.join(tmpDir, 'nested', 'deep', 'dir');
      const sendCommand = makeMockSender();
      const logger = createRssTimeSeriesLogger(nestedDir, sendCommand);

      await logger.start('baseline');

      expect(fs.existsSync(nestedDir)).toBe(true);
      const outputPath = path.join(nestedDir, 'rss-timeseries.csv');
      expect(fs.existsSync(outputPath)).toBe(true);
    });
  });
});
