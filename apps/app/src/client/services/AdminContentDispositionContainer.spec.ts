import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

import * as apiv3Client from '../util/apiv3-client';

import AdminContentDispositionContainer from './AdminContentDispositionContainer';

// Mock apiv3-client
vi.mock('../util/apiv3-client', () => ({
  apiv3Get: vi.fn(),
  apiv3Put: vi.fn(),
}));

// Mock @growi/core/dist/utils to make isServer return false
vi.mock('@growi/core/dist/utils', () => ({
  isServer: vi.fn(() => false),
}));

describe('AdminContentDispositionContainer', () => {
  let container: AdminContentDispositionContainer;
  let mockAppContainer: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppContainer = {};
    container = new AdminContentDispositionContainer(mockAppContainer);
  });

  describe('retrieveContentDispositionSettings', () => {
    it('should retrieve and set content disposition settings', async() => {
      const mockSettings = {
        'text/html': 'attachment' as const,
        'image/svg+xml': 'attachment' as const,
        'image/png': 'inline' as const,
        'application/pdf': 'inline' as const,
      };

      vi.mocked(apiv3Client.apiv3Get).mockResolvedValue({
        data: {
          contentDispositionSettings: mockSettings,
        },
      } as any);

      await container.retrieveContentDispositionSettings();

      expect(apiv3Client.apiv3Get).toHaveBeenCalledWith('/content-disposition-settings/');
      expect(container.state.contentDispositionSettings).toEqual(mockSettings);
    });
  });

  describe('setInline', () => {
    it('should set a MIME type to inline', async() => {
      const mimeType = 'application/json';

      vi.mocked(apiv3Client.apiv3Put).mockResolvedValue({
        data: {
          mimeType,
          disposition: 'inline',
        },
      } as any);

      await container.setInline(mimeType);

      expect(apiv3Client.apiv3Put).toHaveBeenCalledWith(
        `/content-disposition-settings/${encodeURIComponent(mimeType)}`,
        { disposition: 'inline' },
      );
      expect(container.state.contentDispositionSettings[mimeType]).toBe('inline');
    });

    it('should handle MIME types with special characters', async() => {
      const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      vi.mocked(apiv3Client.apiv3Put).mockResolvedValue({
        data: {
          mimeType,
          disposition: 'inline',
        },
      } as any);

      await container.setInline(mimeType);

      expect(apiv3Client.apiv3Put).toHaveBeenCalledWith(
        `/content-disposition-settings/${encodeURIComponent(mimeType)}`,
        { disposition: 'inline' },
      );
    });
  });

  describe('setAttachment', () => {
    it('should set a MIME type to attachment', async() => {
      const mimeType = 'text/html';

      vi.mocked(apiv3Client.apiv3Put).mockResolvedValue({
        data: {
          mimeType,
          disposition: 'attachment',
        },
      } as any);

      await container.setAttachment(mimeType);

      expect(apiv3Client.apiv3Put).toHaveBeenCalledWith(
        `/content-disposition-settings/${encodeURIComponent(mimeType)}`,
        { disposition: 'attachment' },
      );
      expect(container.state.contentDispositionSettings[mimeType]).toBe('attachment');
    });
  });

  describe('getDispositionForMimeType', () => {
    it('should return the disposition for a specific MIME type', async() => {
      await container.setState({
        contentDispositionSettings: {
          'text/html': 'attachment',
          'image/png': 'inline',
        },
      });

      expect(container.getDispositionForMimeType('text/html')).toBe('attachment');
      expect(container.getDispositionForMimeType('image/png')).toBe('inline');
    });

    it('should return undefined for unconfigured MIME types', async() => {
      await container.setState({
        contentDispositionSettings: {},
      });

      expect(container.getDispositionForMimeType('text/html')).toBeUndefined();
    });
  });

  describe('getInlineMimeTypes', () => {
    it('should return all MIME types set to inline', async() => {
      await container.setState({
        contentDispositionSettings: {
          'text/html': 'attachment',
          'image/png': 'inline',
          'image/jpeg': 'inline',
          'application/pdf': 'inline',
          'image/svg+xml': 'attachment',
        },
      });

      const inlineTypes = container.getInlineMimeTypes();

      expect(inlineTypes).toHaveLength(3);
      expect(inlineTypes).toContain('image/png');
      expect(inlineTypes).toContain('image/jpeg');
      expect(inlineTypes).toContain('application/pdf');
      expect(inlineTypes).not.toContain('text/html');
      expect(inlineTypes).not.toContain('image/svg+xml');
    });

    it('should return empty array when no inline types exist', async() => {
      await container.setState({
        contentDispositionSettings: {
          'text/html': 'attachment',
          'image/svg+xml': 'attachment',
        },
      });

      expect(container.getInlineMimeTypes()).toEqual([]);
    });
  });

  describe('getAllConfiguredMimeTypes', () => {
    it('should return all configured MIME types', async() => {
      await container.setState({
        contentDispositionSettings: {
          'text/html': 'attachment',
          'image/png': 'inline',
          'image/svg+xml': 'attachment',
          'application/pdf': 'inline',
        },
      });

      const allTypes = container.getAllConfiguredMimeTypes();

      expect(allTypes).toHaveLength(4);
      expect(allTypes).toContain('text/html');
      expect(allTypes).toContain('image/png');
      expect(allTypes).toContain('image/svg+xml');
      expect(allTypes).toContain('application/pdf');
    });

    it('should return empty array when no types are configured', async() => {
      await container.setState({
        contentDispositionSettings: {},
      });

      expect(container.getAllConfiguredMimeTypes()).toEqual([]);
    });
  });

  describe('integration scenarios', () => {
    it('should handle a complete workflow of setting MIME types', async() => {
      // Initial state - retrieve settings
      vi.mocked(apiv3Client.apiv3Get).mockResolvedValue({
        data: {
          contentDispositionSettings: {
            'text/html': 'attachment',
            'image/png': 'inline',
          },
        },
      } as any);

      await container.retrieveContentDispositionSettings();

      expect(container.getInlineMimeTypes()).toEqual(['image/png']);

      // Set a new inline MIME type
      vi.mocked(apiv3Client.apiv3Put).mockResolvedValue({
        data: {
          mimeType: 'application/pdf',
          disposition: 'inline',
        },
      } as any);

      await container.setInline('application/pdf');

      expect(container.getInlineMimeTypes()).toContain('application/pdf');

      // Change inline to attachment
      vi.mocked(apiv3Client.apiv3Put).mockResolvedValue({
        data: {
          mimeType: 'image/png',
          disposition: 'attachment',
        },
      } as any);

      await container.setAttachment('image/png');

      expect(container.getDispositionForMimeType('image/png')).toBe('attachment');
    });

    it('should correctly manage state when updating multiple MIME types', async() => {
      await container.setState({
        contentDispositionSettings: {
          'text/html': 'attachment',
        },
      });

      // Set first MIME type
      vi.mocked(apiv3Client.apiv3Put).mockResolvedValueOnce({
        data: {
          mimeType: 'image/png',
          disposition: 'inline',
        },
      } as any);

      await container.setInline('image/png');

      // Set second MIME type
      vi.mocked(apiv3Client.apiv3Put).mockResolvedValueOnce({
        data: {
          mimeType: 'application/pdf',
          disposition: 'inline',
        },
      } as any);

      await container.setInline('application/pdf');

      // Verify both are in state
      expect(container.state.contentDispositionSettings).toEqual({
        'text/html': 'attachment',
        'image/png': 'inline',
        'application/pdf': 'inline',
      });

      expect(container.getInlineMimeTypes()).toHaveLength(2);
    });
  });
});
