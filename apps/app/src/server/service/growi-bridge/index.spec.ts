import fs from 'node:fs';
import path from 'pathe';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

import { GrowiBridgeService } from './index';

vi.mock('fs');

describe('GrowiBridgeService', () => {
  let growiBridgeService: GrowiBridgeService;

  beforeEach(() => {
    vi.clearAllMocks();
    const crowiMock = mock<Crowi>();
    growiBridgeService = new GrowiBridgeService(crowiMock);
  });

  describe('getFile', () => {
    const baseDir = '/tmp/growi-export';

    beforeEach(() => {
      // Mock fs.accessSync to not throw (file exists)
      vi.mocked(fs.accessSync).mockImplementation(() => undefined);
    });

    describe('valid file paths', () => {
      test('should return resolved path for a simple filename', () => {
        const fileName = 'test.json';
        const result = growiBridgeService.getFile(fileName, baseDir);

        expect(result).toBe(path.resolve(baseDir, fileName));
        expect(fs.accessSync).toHaveBeenCalledWith(
          path.resolve(baseDir, fileName),
        );
      });

      test('should return resolved path for a filename in subdirectory', () => {
        const fileName = 'subdir/test.json';
        const result = growiBridgeService.getFile(fileName, baseDir);

        expect(result).toBe(path.resolve(baseDir, fileName));
      });

      test('should handle baseDir with trailing slash', () => {
        const fileName = 'test.json';
        const baseDirWithSlash = '/tmp/growi-export/';
        const result = growiBridgeService.getFile(fileName, baseDirWithSlash);

        expect(result).toBe(path.resolve(baseDirWithSlash, fileName));
      });
    });

    describe('path traversal attack prevention', () => {
      test('should throw error for path traversal with ../', () => {
        const fileName = '../etc/passwd';

        expect(() => {
          growiBridgeService.getFile(fileName, baseDir);
        }).toThrow('Invalid file path: path traversal detected');
      });

      test('should throw error for path traversal with multiple ../', () => {
        const fileName = '../../etc/passwd';

        expect(() => {
          growiBridgeService.getFile(fileName, baseDir);
        }).toThrow('Invalid file path: path traversal detected');
      });

      test('should throw error for path traversal in middle of path', () => {
        const fileName = 'subdir/../../../etc/passwd';

        expect(() => {
          growiBridgeService.getFile(fileName, baseDir);
        }).toThrow('Invalid file path: path traversal detected');
      });

      test('should throw error for absolute path outside baseDir', () => {
        const fileName = '/etc/passwd';

        expect(() => {
          growiBridgeService.getFile(fileName, baseDir);
        }).toThrow('Invalid file path: path traversal detected');
      });

      test('should throw error for path traversal at the end of path', () => {
        // e.g., trying to access sibling directory
        const fileName = 'subdir/../../other-dir/file.json';

        expect(() => {
          growiBridgeService.getFile(fileName, baseDir);
        }).toThrow('Invalid file path: path traversal detected');
      });
    });

    describe('file access check', () => {
      test('should throw error if file does not exist', () => {
        const fileName = 'nonexistent.json';
        vi.mocked(fs.accessSync).mockImplementation(() => {
          throw new Error('ENOENT: no such file or directory');
        });

        expect(() => {
          growiBridgeService.getFile(fileName, baseDir);
        }).toThrow('ENOENT: no such file or directory');
      });
    });
  });

  describe('getEncoding', () => {
    test('should return utf-8', () => {
      expect(growiBridgeService.getEncoding()).toBe('utf-8');
    });
  });

  describe('getMetaFileName', () => {
    test('should return meta.json', () => {
      expect(growiBridgeService.getMetaFileName()).toBe('meta.json');
    });
  });
});
