import { getIdStringForRef } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose, { connection, Types } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import PageModelFactory from '~/server/models/page';
import { Revision } from '~/server/models/revision';

import {
  __resetCacheForTesting,
  getAppliedAtForRevisionFilter,
  normalizeLatestRevisionIfBroken,
} from './normalize-latest-revision-if-broken';

const OLD_MIGRATION_FILE_NAME =
  '20211227060705-revision-path-to-page-id-schema-migration--fixed-7549';
const NEW_MIGRATION_FILE_NAME =
  '20211227060705-revision-path-to-page-id-schema-migration--fixed-8998';

describe('normalizeLatestRevisionIfBroken', () => {
  beforeAll(async () => {
    await PageModelFactory(null);
    // Insert migration record to simulate affected instance
    const migrationCollection = connection.collection('migrations');
    await migrationCollection.insertOne({
      fileName: OLD_MIGRATION_FILE_NAME,
      appliedAt: new Date('2024-01-01'),
    });
  });

  afterAll(async () => {
    // Clean up migration record
    const migrationCollection = connection.collection('migrations');
    await migrationCollection.deleteOne({ fileName: OLD_MIGRATION_FILE_NAME });
  });

  test('should update the latest revision', async () => {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );

    // == Arrange
    const page = await Page.create({ path: '/foo' });
    const revision = await Revision.create({ pageId: page._id, body: '' });
    // connect the page and the revision
    page.revision = revision._id;
    await page.save();
    // break the revision
    await Revision.updateOne(
      { _id: revision._id },
      { pageId: new Types.ObjectId() },
    );

    // spy
    const updateOneSpy = vi.spyOn(Revision, 'updateOne');

    // == Act
    await normalizeLatestRevisionIfBroken(page._id);

    // == Assert
    // assert spy
    expect(updateOneSpy).toHaveBeenCalled();

    // assert revision
    const revisionById = await Revision.findById(revision._id);
    const revisionByPageId = await Revision.findOne({ pageId: page._id });
    expect(revisionById).not.toBeNull();
    expect(revisionByPageId).not.toBeNull();
    assert(revisionById != null);
    assert(revisionByPageId != null);
    expect(revisionById._id).toEqual(revisionByPageId._id);
    expect(getIdStringForRef(revisionById.pageId)).toEqual(page._id.toString());
  });

  describe('should returns without any operation', () => {
    test('when the page has revisions at least one', async () => {
      const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
        'Page',
      );

      // Arrange
      const page = await Page.create({ path: '/foo' });
      await Revision.create({ pageId: page._id, body: '' });
      // spy
      const updateOneSpy = vi.spyOn(Revision, 'updateOne');

      // Act
      await normalizeLatestRevisionIfBroken(page._id);

      // Assert
      expect(updateOneSpy).not.toHaveBeenCalled();
    });

    test('when the page is not found', async () => {
      // Arrange
      const pageIdOfRevision = new Types.ObjectId();
      // create an orphan revision
      await Revision.create({ pageId: pageIdOfRevision, body: '' });

      // spy
      const updateOneSpy = vi.spyOn(Revision, 'updateOne');

      // Act
      await normalizeLatestRevisionIfBroken(pageIdOfRevision);

      // Assert
      expect(updateOneSpy).not.toHaveBeenCalled();
    });

    test('when the page.revision is null', async () => {
      const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
        'Page',
      );

      // Arrange
      const page = await Page.create({ path: '/foo' });
      // create an orphan revision
      await Revision.create({ pageId: page._id, body: '' });

      // spy
      const updateOneSpy = vi.spyOn(Revision, 'updateOne');

      // Act
      await normalizeLatestRevisionIfBroken(page._id);

      // Assert
      expect(updateOneSpy).not.toHaveBeenCalled();
    });

    test('when the page.revision does not exist', async () => {
      const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
        'Page',
      );

      // Arrange
      const revisionNonExistent = new Types.ObjectId();
      const page = await Page.create({
        path: '/foo',
        revision: revisionNonExistent,
      });
      // create an orphan revision
      await Revision.create({ pageId: page._id, body: '' });

      // spy
      const updateOneSpy = vi.spyOn(Revision, 'updateOne');

      // Act
      await normalizeLatestRevisionIfBroken(page._id);

      // Assert
      expect(updateOneSpy).not.toHaveBeenCalled();
    });
  });
});

describe('getAppliedAtForRevisionFilter', () => {
  const migrationCollection = () => connection.collection('migrations');

  beforeEach(() => {
    __resetCacheForTesting();
  });

  afterEach(async () => {
    // Clean up all migration records
    await migrationCollection().deleteMany({
      fileName: { $in: [OLD_MIGRATION_FILE_NAME, NEW_MIGRATION_FILE_NAME] },
    });
  });

  test('should return null when only new migration exists (fresh installation)', async () => {
    // Arrange
    await migrationCollection().insertOne({
      fileName: NEW_MIGRATION_FILE_NAME,
      appliedAt: new Date('2024-06-01'),
    });

    // Act
    const result = await getAppliedAtForRevisionFilter();

    // Assert
    expect(result).toBeNull();
  });

  test('should return appliedAt when old migration exists (affected instance)', async () => {
    // Arrange
    const appliedAt = new Date('2024-01-01');
    await migrationCollection().insertOne({
      fileName: OLD_MIGRATION_FILE_NAME,
      appliedAt,
    });

    // Act
    const result = await getAppliedAtForRevisionFilter();

    // Assert
    expect(result).toEqual(appliedAt);
  });

  test('should return appliedAt when both migrations exist (upgraded instance)', async () => {
    // Arrange
    const oldAppliedAt = new Date('2024-01-01');
    await migrationCollection().insertOne({
      fileName: OLD_MIGRATION_FILE_NAME,
      appliedAt: oldAppliedAt,
    });
    await migrationCollection().insertOne({
      fileName: NEW_MIGRATION_FILE_NAME,
      appliedAt: new Date('2024-06-01'),
    });

    // Act
    const result = await getAppliedAtForRevisionFilter();

    // Assert
    expect(result).toEqual(oldAppliedAt);
  });

  test('should return null when neither migration exists', async () => {
    // Arrange - no migrations inserted

    // Act
    const result = await getAppliedAtForRevisionFilter();

    // Assert
    expect(result).toBeNull();
  });

  test('should cache the result', async () => {
    // Arrange
    const appliedAt = new Date('2024-01-01');
    await migrationCollection().insertOne({
      fileName: OLD_MIGRATION_FILE_NAME,
      appliedAt,
    });

    // Act - call twice
    const result1 = await getAppliedAtForRevisionFilter();
    // Remove the migration record
    await migrationCollection().deleteOne({
      fileName: OLD_MIGRATION_FILE_NAME,
    });
    const result2 = await getAppliedAtForRevisionFilter();

    // Assert - both should return the same cached value
    expect(result1).toEqual(appliedAt);
    expect(result2).toEqual(appliedAt);
  });
});
