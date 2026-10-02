import { describe, expect, test } from 'vitest';

import {
  type SupportedImageMimeType,
  validateImageContentType,
} from './image-content-type-validator';

describe('validateImageContentType', () => {
  describe('valid cases', () => {
    // Test supported MIME types
    const supportedTypes: SupportedImageMimeType[] = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/gif',
      'image/webp',
      'image/avif',
      'image/heic',
      'image/heif',
      'image/tiff',
      'image/svg+xml',
    ];

    test.each(supportedTypes)('should accept %s', (mimeType) => {
      const result = validateImageContentType(mimeType);
      expect(result.isValid).toBe(true);
      expect(result.contentType).toBe(mimeType);
      expect(result.error).toBeUndefined();
    });

    test('should accept MIME type with surrounding whitespace', () => {
      const result = validateImageContentType('  image/png  ');
      expect(result.isValid).toBe(true);
      expect(result.contentType).toBe('image/png');
      expect(result.error).toBeUndefined();
    });
  });

  describe('invalid cases', () => {
    // Test invalid input types
    test.each([
      ['undefined', undefined],
      ['null', null],
      ['number', 42],
      ['object', {}],
    ])('should reject %s', (_, input) => {
      const result = validateImageContentType(input as unknown as string);
      expect(result.isValid).toBe(false);
      expect(result.contentType).toBeNull();
      expect(result.error).toBe('Invalid MIME type format');
    });

    // Test invalid MIME types
    test.each([
      ['empty string', ''],
      ['whitespace only', '   '],
      ['non-image type', 'text/plain'],
      ['unknown image type', 'image/unknown'],
      ['multiple MIME types', 'text/plain, image/png'],
      ['multiple image types', 'image/png, image/jpeg'],
      ['MIME type with comma', 'image/png,'],
    ])('should reject %s', (_, input) => {
      const result = validateImageContentType(input);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid file type');
    });
  });
});
