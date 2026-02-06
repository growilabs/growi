import {
  vi, describe, it, expect, beforeEach,
} from 'vitest';

import { configManager } from '../../config-manager';

import { determineDisposition } from './headers';

vi.mock('../../config-manager', () => ({
  configManager: {
    getConfig: vi.fn(),
  },
}));

describe('determineDisposition', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const setupMocks = (inlineMimeTypes: string[], attachmentMimeTypes: string[]) => {
    vi.mocked(configManager.getConfig).mockImplementation(((key: string) => {
      if (key === 'attachments:contentDisposition:inlineMimeTypes') {
        return { inlineMimeTypes };
      }
      if (key === 'attachments:contentDisposition:attachmentMimeTypes') {
        return { attachmentMimeTypes };
      }
      return {};
    }) as typeof configManager.getConfig);
  };

  describe('priority: attachmentMimeTypes over inlineMimeTypes', () => {
    it('should return attachment when MIME type is in both lists', () => {
      setupMocks(['image/png'], ['image/png']);

      const result = determineDisposition('image/png');

      expect(result).toBe('attachment');
    });
  });

  describe('case-insensitive matching', () => {
    it('should match attachmentMimeTypes case-insensitively', () => {
      setupMocks([], ['image/png']);

      const result = determineDisposition('IMAGE/PNG');

      expect(result).toBe('attachment');
    });

    it('should match inlineMimeTypes case-insensitively', () => {
      setupMocks(['image/png'], []);

      const result = determineDisposition('IMAGE/PNG');

      expect(result).toBe('inline');
    });

    it('should match when config has uppercase MIME type', () => {
      setupMocks(['IMAGE/PNG'], []);

      const result = determineDisposition('image/png');

      expect(result).toBe('inline');
    });
  });

  describe('defaultContentDispositionSettings fallback', () => {
    it('should return inline for image/png when not in admin config', () => {
      setupMocks([], []);

      const result = determineDisposition('image/png');

      expect(result).toBe('inline');
    });

    it('should return attachment for text/html when not in admin config', () => {
      setupMocks([], []);

      const result = determineDisposition('text/html');

      expect(result).toBe('attachment');
    });
  });

  describe('unknown MIME types', () => {
    it('should return attachment for unknown MIME types', () => {
      setupMocks([], []);

      const result = determineDisposition('application/x-unknown-type');

      expect(result).toBe('attachment');
    });
  });

  describe('admin config takes priority over defaults', () => {
    it('should return attachment for image/png when in admin attachmentMimeTypes', () => {
      setupMocks([], ['image/png']);

      const result = determineDisposition('image/png');

      expect(result).toBe('attachment');
    });

    it('should return inline for text/html when in admin inlineMimeTypes', () => {
      setupMocks(['text/html'], []);

      const result = determineDisposition('text/html');

      expect(result).toBe('inline');
    });
  });
});
