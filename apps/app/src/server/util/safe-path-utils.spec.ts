import path from 'pathe';

import {
  assertFileNameSafeForBaseDir,
  isFileNameSafeForBaseDir,
  isPathWithinBase,
} from './safe-path-utils';

describe('path-utils', () => {
  describe('isPathWithinBase', () => {
    const baseDir = '/tmp/growi-export';

    describe('valid paths', () => {
      test('should return true for file directly in baseDir', () => {
        const filePath = '/tmp/growi-export/test.json';
        expect(isPathWithinBase(filePath, baseDir)).toBe(true);
      });

      test('should return true for file in subdirectory', () => {
        const filePath = '/tmp/growi-export/subdir/test.json';
        expect(isPathWithinBase(filePath, baseDir)).toBe(true);
      });

      test('should return true for baseDir itself', () => {
        expect(isPathWithinBase(baseDir, baseDir)).toBe(true);
      });

      test('should handle relative paths correctly', () => {
        const filePath = path.join(baseDir, 'test.json');
        expect(isPathWithinBase(filePath, baseDir)).toBe(true);
      });
    });

    describe('invalid paths (path traversal attacks)', () => {
      test('should return false for path outside baseDir', () => {
        const filePath = '/etc/passwd';
        expect(isPathWithinBase(filePath, baseDir)).toBe(false);
      });

      test('should return false for path traversal with ../', () => {
        const filePath = '/tmp/growi-export/../etc/passwd';
        expect(isPathWithinBase(filePath, baseDir)).toBe(false);
      });

      test('should return false for sibling directory', () => {
        const filePath = '/tmp/other-dir/test.json';
        expect(isPathWithinBase(filePath, baseDir)).toBe(false);
      });

      test('should return false for directory with similar prefix', () => {
        // /tmp/growi-export-evil should not match /tmp/growi-export
        const filePath = '/tmp/growi-export-evil/test.json';
        expect(isPathWithinBase(filePath, baseDir)).toBe(false);
      });
    });
  });

  describe('isFileNameSafeForBaseDir', () => {
    const baseDir = '/tmp/growi-export';

    describe('valid file names', () => {
      test('should return true for simple filename', () => {
        expect(isFileNameSafeForBaseDir('test.json', baseDir)).toBe(true);
      });

      test('should return true for filename in subdirectory', () => {
        expect(isFileNameSafeForBaseDir('subdir/test.json', baseDir)).toBe(
          true,
        );
      });

      test('should return true for deeply nested file', () => {
        expect(isFileNameSafeForBaseDir('a/b/c/d/test.json', baseDir)).toBe(
          true,
        );
      });
    });

    describe('path traversal attacks', () => {
      test('should return false for ../etc/passwd', () => {
        expect(isFileNameSafeForBaseDir('../etc/passwd', baseDir)).toBe(false);
      });

      test('should return false for ../../etc/passwd', () => {
        expect(isFileNameSafeForBaseDir('../../etc/passwd', baseDir)).toBe(
          false,
        );
      });

      test('should return false for subdir/../../../etc/passwd', () => {
        expect(
          isFileNameSafeForBaseDir('subdir/../../../etc/passwd', baseDir),
        ).toBe(false);
      });

      test('should return false for absolute path outside baseDir', () => {
        expect(isFileNameSafeForBaseDir('/etc/passwd', baseDir)).toBe(false);
      });

      test('should return false for path escaping to sibling directory', () => {
        expect(
          isFileNameSafeForBaseDir('subdir/../../other-dir/file.json', baseDir),
        ).toBe(false);
      });
    });

    describe('edge cases', () => {
      test('should handle empty filename', () => {
        // Empty filename resolves to baseDir itself, which is valid
        expect(isFileNameSafeForBaseDir('', baseDir)).toBe(true);
      });

      test('should handle . (current directory)', () => {
        expect(isFileNameSafeForBaseDir('.', baseDir)).toBe(true);
      });

      test('should handle ./filename', () => {
        expect(isFileNameSafeForBaseDir('./test.json', baseDir)).toBe(true);
      });
    });
  });

  describe('assertFileNameSafeForBaseDir', () => {
    const baseDir = '/tmp/growi-export';

    describe('valid file names (should not throw)', () => {
      test('should not throw for simple filename', () => {
        expect(() => {
          assertFileNameSafeForBaseDir('test.json', baseDir);
        }).not.toThrow();
      });

      test('should not throw for filename in subdirectory', () => {
        expect(() => {
          assertFileNameSafeForBaseDir('subdir/test.json', baseDir);
        }).not.toThrow();
      });
    });

    describe('path traversal attacks (should throw)', () => {
      test('should throw for ../etc/passwd', () => {
        expect(() => {
          assertFileNameSafeForBaseDir('../etc/passwd', baseDir);
        }).toThrow('Invalid file path: path traversal detected');
      });

      test('should throw for ../../etc/passwd', () => {
        expect(() => {
          assertFileNameSafeForBaseDir('../../etc/passwd', baseDir);
        }).toThrow('Invalid file path: path traversal detected');
      });

      test('should throw for absolute path outside baseDir', () => {
        expect(() => {
          assertFileNameSafeForBaseDir('/etc/passwd', baseDir);
        }).toThrow('Invalid file path: path traversal detected');
      });

      test('should throw for path escaping to sibling directory', () => {
        expect(() => {
          assertFileNameSafeForBaseDir(
            'subdir/../../other-dir/file.json',
            baseDir,
          );
        }).toThrow('Invalid file path: path traversal detected');
      });
    });
  });
});
