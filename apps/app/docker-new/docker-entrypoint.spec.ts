import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildNodeFlags,
  chownRecursive,
  detectHeapSize,
  readCgroupLimit,
  setupDirectories,
} from './docker-entrypoint';

describe('chownRecursive', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entrypoint-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should chown a flat directory', () => {
    const chownSyncSpy = vi.spyOn(fs, 'chownSync').mockImplementation(() => {});
    chownRecursive(tmpDir, 1000, 1000);
    // Should chown the directory itself
    expect(chownSyncSpy).toHaveBeenCalledWith(tmpDir, 1000, 1000);
    chownSyncSpy.mockRestore();
  });

  it('should chown nested directories and files recursively', () => {
    // Create nested structure
    const subDir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'hello');
    fs.writeFileSync(path.join(subDir, 'file2.txt'), 'world');

    const chownedPaths: string[] = [];
    const chownSyncSpy = vi.spyOn(fs, 'chownSync').mockImplementation((p) => {
      chownedPaths.push(p as string);
    });

    chownRecursive(tmpDir, 1000, 1000);

    expect(chownedPaths).toContain(tmpDir);
    expect(chownedPaths).toContain(subDir);
    expect(chownedPaths).toContain(path.join(tmpDir, 'file1.txt'));
    expect(chownedPaths).toContain(path.join(subDir, 'file2.txt'));
    expect(chownedPaths).toHaveLength(4);

    chownSyncSpy.mockRestore();
  });

  it('should handle empty directory', () => {
    const chownSyncSpy = vi.spyOn(fs, 'chownSync').mockImplementation(() => {});
    chownRecursive(tmpDir, 1000, 1000);
    // Should only chown the directory itself
    expect(chownSyncSpy).toHaveBeenCalledTimes(1);
    expect(chownSyncSpy).toHaveBeenCalledWith(tmpDir, 1000, 1000);
    chownSyncSpy.mockRestore();
  });
});

describe('readCgroupLimit', () => {
  it('should read cgroup v2 numeric limit', () => {
    const readSpy = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValue('1073741824\n');
    const result = readCgroupLimit('/sys/fs/cgroup/memory.max');
    expect(result).toBe(1073741824);
    readSpy.mockRestore();
  });

  it('should return undefined for cgroup v2 "max" (unlimited)', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue('max\n');
    const result = readCgroupLimit('/sys/fs/cgroup/memory.max');
    expect(result).toBeUndefined();
    readSpy.mockRestore();
  });

  it('should return undefined when file does not exist', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = readCgroupLimit('/sys/fs/cgroup/memory.max');
    expect(result).toBeUndefined();
    readSpy.mockRestore();
  });

  it('should return undefined for NaN content', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue('invalid\n');
    const result = readCgroupLimit('/sys/fs/cgroup/memory.max');
    expect(result).toBeUndefined();
    readSpy.mockRestore();
  });
});

describe('detectHeapSize', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use GROWI_HEAP_SIZE when set', () => {
    process.env.GROWI_HEAP_SIZE = '512';
    const readSpy = vi.spyOn(fs, 'readFileSync');
    const result = detectHeapSize();
    expect(result).toBe(512);
    // Should not attempt to read cgroup files
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });

  it('should return undefined for invalid GROWI_HEAP_SIZE', () => {
    process.env.GROWI_HEAP_SIZE = 'abc';
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = detectHeapSize();
    expect(result).toBeUndefined();
    readSpy.mockRestore();
  });

  it('should return undefined for empty GROWI_HEAP_SIZE', () => {
    process.env.GROWI_HEAP_SIZE = '';
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = detectHeapSize();
    expect(result).toBeUndefined();
    readSpy.mockRestore();
  });

  it('should auto-calculate from cgroup v2 at 60%', () => {
    delete process.env.GROWI_HEAP_SIZE;
    // 1GB = 1073741824 bytes → 60% ≈ 614 MB
    const readSpy = vi
      .spyOn(fs, 'readFileSync')
      .mockImplementation((filePath) => {
        if (filePath === '/sys/fs/cgroup/memory.max') return '1073741824\n';
        throw new Error('ENOENT');
      });
    const result = detectHeapSize();
    expect(result).toBe(Math.floor((1073741824 / 1024 / 1024) * 0.6));
    readSpy.mockRestore();
  });

  it('should fallback to cgroup v1 when v2 is unlimited', () => {
    delete process.env.GROWI_HEAP_SIZE;
    // v2 = max (unlimited), v1 = 2GB
    const readSpy = vi
      .spyOn(fs, 'readFileSync')
      .mockImplementation((filePath) => {
        if (filePath === '/sys/fs/cgroup/memory.max') return 'max\n';
        if (filePath === '/sys/fs/cgroup/memory/memory.limit_in_bytes')
          return '2147483648\n';
        throw new Error('ENOENT');
      });
    const result = detectHeapSize();
    expect(result).toBe(Math.floor((2147483648 / 1024 / 1024) * 0.6));
    readSpy.mockRestore();
  });

  it('should treat cgroup v1 > 64GB as unlimited', () => {
    delete process.env.GROWI_HEAP_SIZE;
    const hugeValue = 128 * 1024 * 1024 * 1024; // 128GB
    const readSpy = vi
      .spyOn(fs, 'readFileSync')
      .mockImplementation((filePath) => {
        if (filePath === '/sys/fs/cgroup/memory.max') return 'max\n';
        if (filePath === '/sys/fs/cgroup/memory/memory.limit_in_bytes')
          return `${hugeValue}\n`;
        throw new Error('ENOENT');
      });
    const result = detectHeapSize();
    expect(result).toBeUndefined();
    readSpy.mockRestore();
  });

  it('should return undefined when no cgroup limits detected', () => {
    delete process.env.GROWI_HEAP_SIZE;
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = detectHeapSize();
    expect(result).toBeUndefined();
    readSpy.mockRestore();
  });

  it('should prioritize GROWI_HEAP_SIZE over cgroup', () => {
    process.env.GROWI_HEAP_SIZE = '256';
    const readSpy = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValue('1073741824\n');
    const result = detectHeapSize();
    expect(result).toBe(256);
    // Should not have read cgroup files
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });
});

describe('buildNodeFlags', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should always include --expose_gc', () => {
    const flags = buildNodeFlags(undefined);
    expect(flags).toContain('--expose_gc');
  });

  it('should include --max-heap-size when heapSize is provided', () => {
    const flags = buildNodeFlags(512);
    expect(flags).toContain('--max-heap-size=512');
  });

  it('should not include --max-heap-size when heapSize is undefined', () => {
    const flags = buildNodeFlags(undefined);
    expect(flags.some((f) => f.startsWith('--max-heap-size'))).toBe(false);
  });

  it('should include --optimize-for-size when GROWI_OPTIMIZE_MEMORY=true', () => {
    process.env.GROWI_OPTIMIZE_MEMORY = 'true';
    const flags = buildNodeFlags(undefined);
    expect(flags).toContain('--optimize-for-size');
  });

  it('should not include --optimize-for-size when GROWI_OPTIMIZE_MEMORY is not true', () => {
    process.env.GROWI_OPTIMIZE_MEMORY = 'false';
    const flags = buildNodeFlags(undefined);
    expect(flags).not.toContain('--optimize-for-size');
  });

  it('should include --lite-mode when GROWI_LITE_MODE=true', () => {
    process.env.GROWI_LITE_MODE = 'true';
    const flags = buildNodeFlags(undefined);
    expect(flags).toContain('--lite-mode');
  });

  it('should not include --lite-mode when GROWI_LITE_MODE is not true', () => {
    delete process.env.GROWI_LITE_MODE;
    const flags = buildNodeFlags(undefined);
    expect(flags).not.toContain('--lite-mode');
  });

  it('should combine all flags when all options enabled', () => {
    process.env.GROWI_OPTIMIZE_MEMORY = 'true';
    process.env.GROWI_LITE_MODE = 'true';
    const flags = buildNodeFlags(256);
    expect(flags).toContain('--expose_gc');
    expect(flags).toContain('--max-heap-size=256');
    expect(flags).toContain('--optimize-for-size');
    expect(flags).toContain('--lite-mode');
  });

  it('should not use --max_old_space_size', () => {
    const flags = buildNodeFlags(512);
    expect(flags.some((f) => f.includes('max_old_space_size'))).toBe(false);
  });
});

describe('setupDirectories', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entrypoint-setup-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create uploads directory and symlink', () => {
    const uploadsDir = path.join(tmpDir, 'data', 'uploads');
    const publicUploads = path.join(tmpDir, 'public', 'uploads');
    fs.mkdirSync(path.join(tmpDir, 'public'), { recursive: true });

    const chownSyncSpy = vi.spyOn(fs, 'chownSync').mockImplementation(() => {});
    const lchownSyncSpy = vi
      .spyOn(fs, 'lchownSync')
      .mockImplementation(() => {});

    setupDirectories(
      uploadsDir,
      publicUploads,
      path.join(tmpDir, 'bulk-export'),
    );

    expect(fs.existsSync(uploadsDir)).toBe(true);
    expect(fs.lstatSync(publicUploads).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(publicUploads)).toBe(uploadsDir);

    chownSyncSpy.mockRestore();
    lchownSyncSpy.mockRestore();
  });

  it('should not recreate symlink if it already exists', () => {
    const uploadsDir = path.join(tmpDir, 'data', 'uploads');
    const publicUploads = path.join(tmpDir, 'public', 'uploads');
    fs.mkdirSync(path.join(tmpDir, 'public'), { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.symlinkSync(uploadsDir, publicUploads);

    const symlinkSpy = vi.spyOn(fs, 'symlinkSync');
    const chownSyncSpy = vi.spyOn(fs, 'chownSync').mockImplementation(() => {});
    const lchownSyncSpy = vi
      .spyOn(fs, 'lchownSync')
      .mockImplementation(() => {});

    setupDirectories(
      uploadsDir,
      publicUploads,
      path.join(tmpDir, 'bulk-export'),
    );

    expect(symlinkSpy).not.toHaveBeenCalled();

    symlinkSpy.mockRestore();
    chownSyncSpy.mockRestore();
    lchownSyncSpy.mockRestore();
  });

  it('should create bulk export directory with permissions', () => {
    const bulkExportDir = path.join(tmpDir, 'bulk-export');
    fs.mkdirSync(path.join(tmpDir, 'public'), { recursive: true });
    const chownSyncSpy = vi.spyOn(fs, 'chownSync').mockImplementation(() => {});
    const lchownSyncSpy = vi
      .spyOn(fs, 'lchownSync')
      .mockImplementation(() => {});

    setupDirectories(
      path.join(tmpDir, 'data', 'uploads'),
      path.join(tmpDir, 'public', 'uploads'),
      bulkExportDir,
    );

    expect(fs.existsSync(bulkExportDir)).toBe(true);
    const stat = fs.statSync(bulkExportDir);
    expect(stat.mode & 0o777).toBe(0o700);

    chownSyncSpy.mockRestore();
    lchownSyncSpy.mockRestore();
  });
});
