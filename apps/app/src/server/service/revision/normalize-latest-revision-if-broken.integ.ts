import { getIdStringForRef } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose, { Types } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import PageModelFactory from '~/server/models/page';
import { Revision } from '~/server/models/revision';

import { normalizeLatestRevisionIfBroken } from './normalize-latest-revision-if-broken';

describe('normalizeLatestRevisionIfBroken', () => {
  beforeAll(async () => {
    await PageModelFactory(null);
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
