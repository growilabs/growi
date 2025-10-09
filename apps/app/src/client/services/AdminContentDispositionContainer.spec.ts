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

  beforeEach(() => {
    vi.clearAllMocks();
    container = new AdminContentDispositionContainer();
  });

  describe('retrieveContentDispositionSettings', () => {
    it('should retrieve and set content disposition settings', async() => {
      const mockResponse = {
        inlineDispositionSettings: {
          inlineMimeTypes: ['image/png', 'application/pdf'],
        },
        attachmentDispositionSettings: {
          attachmentMimeTypes: ['text/html', 'image/svg+xml'],
        },
      };

      vi.mocked(apiv3Client.apiv3Get).mockResolvedValue({
        data: mockResponse,
      } as any);

      await container.retrieveContentDispositionSettings();

      expect(apiv3Client.apiv3Get).toHaveBeenCalledWith('/content-disposition-settings/');
      expect(container.state.inlineMimeTypes).toEqual(['image/png', 'application/pdf']);
      expect(container.state.attachmentMimeTypes).toEqual(['text/html', 'image/svg+xml']);
    });
  });

  describe('updateContentDispositionSettings', () => {
    it('should update content disposition settings with new values', async() => {
      const newInline = ['application/json', 'image/png'];
      const newAttachment = ['text/html', 'image/svg+xml'];

      vi.mocked(apiv3Client.apiv3Put).mockResolvedValue({
        data: {
          currentDispositionSettings: {
            inlineMimeTypes: newInline,
            attachmentMimeTypes: newAttachment,
          },
        },
      } as any);

      await container.updateContentDispositionSettings(newInline, newAttachment);

      expect(apiv3Client.apiv3Put).toHaveBeenCalledWith(
        '/content-disposition-settings/',
        {
          newInlineMimeTypes: newInline,
          newAttachmentMimeTypes: newAttachment,
        },
      );
      expect(container.state.inlineMimeTypes).toEqual(newInline);
      expect(container.state.attachmentMimeTypes).toEqual(newAttachment);
    });

    it('should handle empty arrays', async() => {
      vi.mocked(apiv3Client.apiv3Put).mockResolvedValue({
        data: {
          currentDispositionSettings: {
            inlineMimeTypes: [],
            attachmentMimeTypes: [],
          },
        },
      } as any);

      await container.updateContentDispositionSettings([], []);

      expect(container.state.inlineMimeTypes).toEqual([]);
      expect(container.state.attachmentMimeTypes).toEqual([]);
    });
  });

  describe('getInlineMimeTypes', () => {
    it('should return all MIME types set to inline', async() => {
      await container.setState({
        inlineMimeTypes: ['image/png', 'image/jpeg', 'application/pdf'],
        attachmentMimeTypes: ['text/html', 'image/svg+xml'],
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
        inlineMimeTypes: [],
        attachmentMimeTypes: ['text/html', 'image/svg+xml'],
      });

      expect(container.getInlineMimeTypes()).toEqual([]);
    });
  });

  describe('getAllConfiguredMimeTypes', () => {
    it('should return all configured MIME types', async() => {
      await container.setState({
        inlineMimeTypes: ['image/png', 'application/pdf'],
        attachmentMimeTypes: ['text/html', 'image/svg+xml'],
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
        inlineMimeTypes: [],
        attachmentMimeTypes: [],
      });

      expect(container.getAllConfiguredMimeTypes()).toEqual([]);
    });
  });

  describe('integration scenarios', () => {
    it('should correctly manage state when updating multiple MIME types', async() => {
      await container.setState({
        inlineMimeTypes: [],
        attachmentMimeTypes: ['text/html'],
      });

      // Add multiple inline types at once
      vi.mocked(apiv3Client.apiv3Put).mockResolvedValueOnce({
        data: {
          currentDispositionSettings: {
            inlineMimeTypes: ['image/png', 'application/pdf'],
            attachmentMimeTypes: ['text/html'],
          },
        },
      } as any);

      await container.updateContentDispositionSettings(
        ['image/png', 'application/pdf'],
        ['text/html'],
      );

      // Verify both are in state
      expect(container.state.inlineMimeTypes).toEqual(['image/png', 'application/pdf']);
      expect(container.state.attachmentMimeTypes).toEqual(['text/html']);
      expect(container.getInlineMimeTypes()).toHaveLength(2);
    });
  });
});
