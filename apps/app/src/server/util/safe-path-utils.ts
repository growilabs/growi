import path from 'pathe';

function isStringSafe(input: any): input is string {
  return typeof input === 'string' && input.length > 0 && !input.includes('\0');
}

function getSafeBasePrefix(resolvedBase: string): string {
  return resolvedBase.endsWith(path.sep)
    ? resolvedBase
    : resolvedBase + path.sep;
}

/**
 * Validates that the given file path is within the base directory.
 * This prevents path traversal attacks where an attacker could use sequences
 * like '../' to access files outside the intended directory.
 *
 * @param filePath - The file path to validate
 * @param baseDir - The base directory that the file path should be within
 * @returns true if the path is valid, false otherwise
 */
export function isPathWithinBase(filePath: string, baseDir: string): boolean {
  if (!isStringSafe(filePath) || !isStringSafe(baseDir)) return false;
  const resolvedBaseDir = path.resolve(baseDir);
  const resolvedFilePath = path.resolve(filePath);

  // Check if the resolved path starts with the base directory
  // We add path.sep to ensure we're checking a directory boundary
  // (e.g., /tmp/foo should not match /tmp/foobar)
  return (
    resolvedFilePath.startsWith(getSafeBasePrefix(resolvedBaseDir)) ||
    resolvedFilePath === resolvedBaseDir
  );
}

/**
 * Validates that joining baseDir with fileName results in a path within baseDir.
 * This is useful for validating user-provided file names before using them.
 *
 * @param fileName - The file name to validate
 * @param baseDir - The base directory
 * @returns true if the resulting path is valid, false otherwise
 * @throws Error if path traversal is detected
 */
export function assertFileNameSafeForBaseDir(
  fileName: string,
  baseDir: string,
): void {
  if (!isFileNameSafeForBaseDir(fileName, baseDir)) {
    throw new Error('Invalid file path: path traversal detected');
  }
}

/**
 * Validates that joining baseDir with fileName results in a path within baseDir.
 * This is useful for validating user-provided file names before using them.
 *
 * @param fileName - The file name to validate
 * @param baseDir - The base directory
 * @returns true if the resulting path is valid, false otherwise
 */
export function isFileNameSafeForBaseDir(
  fileName: string,
  baseDir: string,
): boolean {
  if (!isStringSafe(fileName) || !isStringSafe(baseDir)) return false;
  const resolvedBaseDir = path.resolve(baseDir);
  const resolvedFilePath = path.resolve(baseDir, fileName);

  return (
    resolvedFilePath.startsWith(getSafeBasePrefix(resolvedBaseDir)) ||
    resolvedFilePath === resolvedBaseDir
  );
}
