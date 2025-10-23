/**
 * Client-side Text Normalization for GROWI Editor Assistant
 * Optimized for browser environment with performance considerations
 * Compatible with roo-code normalization patterns
 */

// -----------------------------------------------------------------------------
// Browser-Optimized Normalization Maps
// -----------------------------------------------------------------------------

export const CLIENT_NORMALIZATION_MAPS = {
  // Smart quotes to regular quotes (most common cases)
  SMART_QUOTES: {
    '\u201C': '"', // Left double quote (U+201C)
    '\u201D': '"', // Right double quote (U+201D)
    '\u2018': "'", // Left single quote (U+2018)
    '\u2019': "'", // Right single quote (U+2019)
    '\u201E': '"', // Double low-9 quote (U+201E)
    '\u201A': "'", // Single low-9 quote (U+201A)
  },
  // Typographic characters (browser-optimized subset)
  TYPOGRAPHIC: {
    '\u2026': '...', // Ellipsis
    '\u2014': '-', // Em dash
    '\u2013': '-', // En dash
    '\u00A0': ' ', // Non-breaking space
    '\u2009': ' ', // Thin space
    '\u200B': '', // Zero-width space
  },
} as const;

// Pre-compiled regex patterns for performance
const SMART_QUOTES_REGEX = /[\u201C\u201D\u201E]/g;
const SMART_SINGLE_QUOTES_REGEX = /[\u2018\u2019\u201A]/g;
const TYPOGRAPHIC_REGEX = /[\u2026\u2014\u2013\u00A0\u2009\u200B]/g;
const EXTRA_WHITESPACE_REGEX = /\s+/g;

// -----------------------------------------------------------------------------
// Normalization Options
// -----------------------------------------------------------------------------

export interface ClientNormalizeOptions {
  /** Replace smart quotes with straight quotes */
  smartQuotes?: boolean;
  /** Replace typographic characters */
  typographicChars?: boolean;
  /** Collapse multiple whitespace to single space */
  collapseWhitespace?: boolean;
  /** Trim whitespace from start and end */
  trim?: boolean;
  /** Apply Unicode NFC normalization */
  unicode?: boolean;
  /** Convert to lowercase for case-insensitive matching */
  lowercase?: boolean;
}

// Default options for general normalization (preserve formatting)
const GENERAL_OPTIONS: ClientNormalizeOptions = {
  smartQuotes: true,
  typographicChars: true,
  collapseWhitespace: false,
  trim: false,
  unicode: true,
  lowercase: false,
};

// -----------------------------------------------------------------------------
// Main Normalization Functions
// -----------------------------------------------------------------------------

/**
 * Fast browser-optimized normalization for fuzzy matching
 * This version prioritizes speed and compatibility for similarity comparison
 */
export function normalizeForBrowserFuzzyMatch(text: string): string {
  if (!text) return '';

  let normalized = text;

  // Fast smart quotes replacement
  normalized = normalized
    .replace(SMART_QUOTES_REGEX, '"')
    .replace(SMART_SINGLE_QUOTES_REGEX, "'");

  // Fast typographic character replacement
  normalized = normalized.replace(TYPOGRAPHIC_REGEX, (match) => {
    switch (match) {
      case '\u2026':
        return '...';
      case '\u2014':
      case '\u2013':
        return '-';
      case '\u00A0':
      case '\u2009':
        return ' ';
      case '\u200B':
        return '';
      default:
        return match;
    }
  });

  // Normalize whitespace and case for fuzzy matching
  normalized = normalized
    .replace(EXTRA_WHITESPACE_REGEX, ' ')
    .trim()
    .toLowerCase();

  // Unicode normalization (NFC)
  return normalized.normalize('NFC');
}

/**
 * General client-side string normalization with configurable options
 */
export function clientNormalizeString(
  str: string,
  options: ClientNormalizeOptions = GENERAL_OPTIONS,
): string {
  if (!str) return str;

  let normalized = str;

  // Apply smart quotes normalization
  if (options.smartQuotes) {
    normalized = normalized
      .replace(SMART_QUOTES_REGEX, '"')
      .replace(SMART_SINGLE_QUOTES_REGEX, "'");
  }

  // Apply typographic character normalization
  if (options.typographicChars) {
    normalized = normalized.replace(TYPOGRAPHIC_REGEX, (match) => {
      return (
        CLIENT_NORMALIZATION_MAPS.TYPOGRAPHIC[
          match as keyof typeof CLIENT_NORMALIZATION_MAPS.TYPOGRAPHIC
        ] || match
      );
    });
  }

  // Collapse extra whitespace
  if (options.collapseWhitespace) {
    normalized = normalized.replace(EXTRA_WHITESPACE_REGEX, ' ');
  }

  // Trim whitespace
  if (options.trim) {
    normalized = normalized.trim();
  }

  // Convert to lowercase
  if (options.lowercase) {
    normalized = normalized.toLowerCase();
  }

  // Unicode normalization
  if (options.unicode) {
    normalized = normalized.normalize('NFC');
  }

  return normalized;
}

/**
 * Quick fuzzy match normalization (optimized for performance)
 * Uses pre-compiled patterns and minimal operations
 */
export function quickNormalizeForFuzzyMatch(text: string): string {
  if (!text) return '';

  return (
    text
      // Smart quotes (fastest replacement)
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      // Basic whitespace normalization
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  );
}

// -----------------------------------------------------------------------------
// Comparison and Utility Functions
// -----------------------------------------------------------------------------

/**
 * Check if two strings are equal after client-side normalization
 */
export function clientNormalizedEquals(
  str1: string,
  str2: string,
  options?: ClientNormalizeOptions,
): boolean {
  return (
    clientNormalizeString(str1, options) ===
    clientNormalizeString(str2, options)
  );
}

/**
 * Browser-safe regex escaping
 */
export function clientEscapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fast similarity preparation for browser processing
 */
export function prepareSimilarityText(text: string): string {
  // Quick normalization optimized for Levenshtein distance calculation
  return text
    .normalize('NFC')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Performance-measured normalization with browser optimization
 */
export function measureNormalization<T>(
  text: string,
  normalizer: (text: string) => T,
  label = 'Text normalization',
): { result: T; duration: number } {
  const start = performance.now();
  const result = normalizer(text);
  const duration = performance.now() - start;

  // Log slow normalizations for optimization
  if (duration > 10) {
    // eslint-disable-next-line no-console
    console.warn(
      `${label} took ${duration.toFixed(2)}ms for ${text.length} characters`,
    );
  }

  return { result, duration };
}

// -----------------------------------------------------------------------------
// Browser Environment Detection
// -----------------------------------------------------------------------------

/**
 * Check if advanced Unicode features are supported
 */
export function checkUnicodeSupport(): {
  nfc: boolean;
  smartQuotes: boolean;
  typographic: boolean;
} {
  try {
    const testString = 'Test\u201C\u2019\u2026';
    const normalized = testString.normalize('NFC');

    return {
      nfc: normalized === testString.normalize('NFC'),
      smartQuotes: testString.includes('\u201C'),
      typographic: testString.includes('\u2026'),
    };
  } catch (error) {
    return {
      nfc: false,
      smartQuotes: false,
      typographic: false,
    };
  }
}

// -----------------------------------------------------------------------------
// Export Optimized Defaults
// -----------------------------------------------------------------------------

/**
 * Default fuzzy match normalizer optimized for browser
 */
export const defaultFuzzyNormalizer = normalizeForBrowserFuzzyMatch;

/**
 * Quick normalizer for performance-critical operations
 */
export const quickNormalizer = quickNormalizeForFuzzyMatch;

/**
 * Unicode support detection result (cached)
 */
export const unicodeSupport = checkUnicodeSupport();
