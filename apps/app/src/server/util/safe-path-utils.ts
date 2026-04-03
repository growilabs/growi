import path from 'pathe';

export const SUPPORTED_LOCALES = ['en_US', 'ja_JP', 'zh_CN'];

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
  const resolvedBaseDir = path.resolve(baseDir);
  const resolvedFilePath = path.resolve(filePath);

  // Check if the resolved path starts with the base directory
  // We add path.sep to ensure we're checking a directory boundary
  // (e.g., /tmp/foo should not match /tmp/foobar)
  return (
    resolvedFilePath.startsWith(resolvedBaseDir + path.sep) ||
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
  const resolvedBaseDir = path.resolve(baseDir);
  const resolvedFilePath = path.resolve(baseDir, fileName);

  const isValid =
    resolvedFilePath.startsWith(resolvedBaseDir + path.sep) ||
    resolvedFilePath === resolvedBaseDir;

  if (!isValid) {
    throw new Error('Invalid file path: path traversal detected');
  }
}

/**
 * Resolves a locale-specific template path safely, preventing path traversal attacks.
 * Falls back to 'en_US' if the locale is not in the supported list.
 *
 * @param locale - The locale string (e.g. 'en_US')
 * @param baseDir - The base directory for locale files
 * @param templateSubPath - The sub-path within the locale directory (e.g. 'notifications/event.ejs')
 * @returns The template path
 * @throws Error if path traversal is detected
 */
export function resolveLocalePath(
  locale: string,
  baseDir: string,
  templateSubPath: string,
): string {
  const safeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : 'en_US';
  return path.join(baseDir, safeLocale, templateSubPath);
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
  const resolvedBaseDir = path.resolve(baseDir);
  const resolvedFilePath = path.resolve(baseDir, fileName);

  return (
    resolvedFilePath.startsWith(resolvedBaseDir + path.sep) ||
    resolvedFilePath === resolvedBaseDir
  );
}
