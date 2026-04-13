import type { HydratedDocument } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShareLinkDocument } from '~/server/models/share-link';

import { validateShareLink } from './validate-share-link';

describe('validateShareLink', () => {
  const mockShareLinkId = '507f1f77bcf86cd799439011';
  const mockPageId = '507f1f77bcf86cd799439012';

  describe('success case', () => {
    it('should return success result when ShareLink exists, relatedPage matches, and is not expired', async () => {
      // Arrange
      const mockShareLink = {
        _id: mockShareLinkId,
        relatedPage: mockPageId,
        isExpired: () => false,
      } as unknown as HydratedDocument<ShareLinkDocument>;

      const mockFindOne = vi.fn().mockResolvedValue(mockShareLink);
      const mockShareLinkModel = { findOne: mockFindOne } as any;

      // Act
      const result = await validateShareLink(
        mockShareLinkModel,
        mockShareLinkId,
        mockPageId,
      );

      // Assert
      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.shareLink).toEqual(mockShareLink);
      }
      expect(mockFindOne).toHaveBeenCalledWith({
        _id: mockShareLinkId,
        relatedPage: mockPageId,
      });
    });
  });

  describe('not-found case', () => {
    it('should return not-found result when ShareLink does not exist', async () => {
      // Arrange
      const mockFindOne = vi.fn().mockResolvedValue(null);
      const mockShareLinkModel = { findOne: mockFindOne } as any;

      // Act
      const result = await validateShareLink(
        mockShareLinkModel,
        mockShareLinkId,
        mockPageId,
      );

      // Assert
      expect(result.type).toBe('not-found');
    });

    it('should return not-found result when relatedPage does not match', async () => {
      // Arrange
      const anotherPageId = '507f1f77bcf86cd799439099';
      const mockShareLink = {
        _id: mockShareLinkId,
        relatedPage: anotherPageId,
        isExpired: () => false,
      } as unknown as HydratedDocument<ShareLinkDocument>;

      const mockFindOne = vi.fn().mockResolvedValue(null);
      const mockShareLinkModel = { findOne: mockFindOne } as any;

      // Act
      const result = await validateShareLink(
        mockShareLinkModel,
        mockShareLinkId,
        mockPageId,
      );

      // Assert
      expect(result.type).toBe('not-found');
    });
  });

  describe('expired case', () => {
    it('should return expired result when ShareLink is expired', async () => {
      // Arrange
      const mockShareLink = {
        _id: mockShareLinkId,
        relatedPage: mockPageId,
        isExpired: () => true,
      } as unknown as HydratedDocument<ShareLinkDocument>;

      const mockFindOne = vi.fn().mockResolvedValue(mockShareLink);
      const mockShareLinkModel = { findOne: mockFindOne } as any;

      // Act
      const result = await validateShareLink(
        mockShareLinkModel,
        mockShareLinkId,
        mockPageId,
      );

      // Assert
      expect(result.type).toBe('expired');
    });
  });
});
