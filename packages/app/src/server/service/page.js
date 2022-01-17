import { pagePathUtils } from '@growi/core';

import loggerFactory from '~/utils/logger';
import { generateGrantCondition } from '~/server/models/page';

import { stringifySnapshot } from '~/models/serializers/in-app-notification-snapshot/page';

import ActivityDefine from '../util/activityDefine';

const mongoose = require('mongoose');
const escapeStringRegexp = require('escape-string-regexp');
const streamToPromise = require('stream-to-promise');
const pathlib = require('path');

const logger = loggerFactory('growi:services:page');
const debug = require('debug')('growi:services:page');
const { Writable } = require('stream');
const { createBatchStream } = require('~/server/util/batch-stream');

const { isCreatablePage, isDeletablePage, isTrashPage } = pagePathUtils;
const { serializePageSecurely } = require('../models/serializers/page-serializer');

const BULK_REINDEX_SIZE = 100;

class PageService {

  constructor(crowi) {
    this.crowi = crowi;
    this.pageEvent = crowi.event('page');
    this.tagEvent = crowi.event('tag');

    // init
    this.initPageEvent();
  }

  initPageEvent() {
    // create
    this.pageEvent.on('create', this.pageEvent.onCreate);

    // createMany
    this.pageEvent.on('createMany', this.pageEvent.onCreateMany);
    this.pageEvent.on('addSeenUsers', this.pageEvent.onAddSeenUsers);

    // update
    this.pageEvent.on('update', async(page, user) => {

      this.pageEvent.onUpdate();

      try {
        await this.createAndSendNotifications(page, user, ActivityDefine.ACTION_PAGE_UPDATE);
      }
      catch (err) {
        logger.error(err);
      }
    });

    // rename
    this.pageEvent.on('rename', async(page, user) => {
      try {
        await this.createAndSendNotifications(page, user, ActivityDefine.ACTION_PAGE_RENAME);
      }
      catch (err) {
        logger.error(err);
      }
    });

    // delete
    this.pageEvent.on('delete', async(page, user) => {
      try {
        await this.createAndSendNotifications(page, user, ActivityDefine.ACTION_PAGE_DELETE);
      }
      catch (err) {
        logger.error(err);
      }
    });

    // delete completely
    this.pageEvent.on('deleteCompletely', async(page, user) => {
      try {
        await this.createAndSendNotifications(page, user, ActivityDefine.ACTION_PAGE_DELETE_COMPLETELY);
      }
      catch (err) {
        logger.error(err);
      }
    });

    // likes
    this.pageEvent.on('like', async(page, user) => {
      try {
        await this.createAndSendNotifications(page, user, ActivityDefine.ACTION_PAGE_LIKE);
      }
      catch (err) {
        logger.error(err);
      }
    });

    // bookmark
    this.pageEvent.on('bookmark', async(page, user) => {
      try {
        await this.createAndSendNotifications(page, user, ActivityDefine.ACTION_PAGE_BOOKMARK);
      }
      catch (err) {
        logger.error(err);
      }
    });
  }

  async findPageAndMetaDataByViewer({ pageId, path, user }) {

    const Page = this.crowi.model('Page');

    let page;
    if (pageId != null) { // prioritized
      page = await Page.findByIdAndViewer(pageId, user);
    }
    else {
      page = await Page.findByPathAndViewer(path, user);
    }

    const result = {};

    if (page == null) {
      const isExist = await Page.count({ $or: [{ _id: pageId }, { path }] }) > 0;
      result.isForbidden = isExist;
      result.isNotFound = !isExist;
      result.isCreatable = isCreatablePage(path);
      result.isDeletable = false;
      result.canDeleteCompletely = false;
      result.page = page;

      return result;
    }

    result.page = page;
    result.isForbidden = false;
    result.isNotFound = false;
    result.isCreatable = false;
    result.isDeletable = isDeletablePage(path);
    result.isDeleted = page.isDeleted();
    result.canDeleteCompletely = user != null && user.canDeleteCompletely(page.creator);

    return result;
  }

  /**
   * go back by using redirectTo and return the paths
   *  ex: when
   *    '/page1' redirects to '/page2' and
   *    '/page2' redirects to '/page3'
   *    and given '/page3',
   *    '/page1' and '/page2' will be return
   *
   * @param {string} redirectTo
   * @param {object} redirectToPagePathMapping
   * @param {array} pagePaths
   */
  prepareShoudDeletePagesByRedirectTo(redirectTo, redirectToPagePathMapping, pagePaths = []) {
    const pagePath = redirectToPagePathMapping[redirectTo];

    if (pagePath == null) {
      return pagePaths;
    }

    pagePaths.push(pagePath);
    return this.prepareShoudDeletePagesByRedirectTo(pagePath, redirectToPagePathMapping, pagePaths);
  }

  /**
   * Generate read stream to operate descendants of the specified page path
   * @param {string} targetPagePath
   * @param {User} viewer
   */
  async generateReadStreamToOperateOnlyDescendants(targetPagePath, userToOperate) {
    const Page = this.crowi.model('Page');
    const { PageQueryBuilder } = Page;

    const builder = new PageQueryBuilder(Page.find())
      .addConditionToExcludeRedirect()
      .addConditionToListOnlyDescendants(targetPagePath);

    await Page.addConditionToFilteringByViewerToEdit(builder, userToOperate);

    return builder
      .query
      .lean()
      .cursor({ batchSize: BULK_REINDEX_SIZE });
  }

  async renamePage(page, newPagePath, user, options, isRecursively = false) {

    const Page = this.crowi.model('Page');
    const Revision = this.crowi.model('Revision');
    const path = page.path;
    const createRedirectPage = options.createRedirectPage || false;
    const updateMetadata = options.updateMetadata || false;

    // sanitize path
    newPagePath = this.crowi.xss.process(newPagePath); // eslint-disable-line no-param-reassign

    // create descendants first
    if (isRecursively) {
      await this.renameDescendantsWithStream(page, newPagePath, user, options);
    }

    const update = {};
    // update Page
    update.path = newPagePath;
    if (updateMetadata) {
      update.lastUpdateUser = user;
      update.updatedAt = Date.now();
    }
    const renamedPage = await Page.findByIdAndUpdate(page._id, { $set: update }, { new: true });

    // update Rivisions
    await Revision.updateRevisionListByPath(path, { path: newPagePath }, {});

    if (createRedirectPage) {
      const body = `redirect ${newPagePath}`;
      await Page.create(path, body, user, { redirectTo: newPagePath });
    }

    this.pageEvent.emit('rename', page, user);

    return renamedPage;
  }


  async renameDescendants(pages, user, options, oldPagePathPrefix, newPagePathPrefix) {
    const Page = this.crowi.model('Page');

    const pageCollection = mongoose.connection.collection('pages');
    const revisionCollection = mongoose.connection.collection('revisions');
    const { updateMetadata, createRedirectPage } = options;

    const unorderedBulkOp = pageCollection.initializeUnorderedBulkOp();
    const createRediectPageBulkOp = pageCollection.initializeUnorderedBulkOp();
    const revisionUnorderedBulkOp = revisionCollection.initializeUnorderedBulkOp();
    const createRediectRevisionBulkOp = revisionCollection.initializeUnorderedBulkOp();

    pages.forEach((page) => {
      const newPagePath = page.path.replace(oldPagePathPrefix, newPagePathPrefix);
      const revisionId = new mongoose.Types.ObjectId();

      if (updateMetadata) {
        unorderedBulkOp
          .find({ _id: page._id })
          .update({ $set: { path: newPagePath, lastUpdateUser: user._id, updatedAt: new Date() } });
      }
      else {
        unorderedBulkOp.find({ _id: page._id }).update({ $set: { path: newPagePath } });
      }
      if (createRedirectPage) {
        createRediectPageBulkOp.insert({
          path: page.path, revision: revisionId, creator: user._id, lastUpdateUser: user._id, status: Page.STATUS_PUBLISHED, redirectTo: newPagePath,
        });
        createRediectRevisionBulkOp.insert({
          _id: revisionId, path: page.path, body: `redirect ${newPagePath}`, author: user._id, format: 'markdown',
        });
      }
      revisionUnorderedBulkOp.find({ path: page.path }).update({ $set: { path: newPagePath } }, { multi: true });
    });

    try {
      await unorderedBulkOp.execute();
      await revisionUnorderedBulkOp.execute();
      // Execute after unorderedBulkOp to prevent duplication
      if (createRedirectPage) {
        await createRediectPageBulkOp.execute();
        await createRediectRevisionBulkOp.execute();
      }
    }
    catch (err) {
      if (err.code !== 11000) {
        throw new Error('Failed to rename pages: ', err);
      }
    }

    this.pageEvent.emit('updateMany', pages, user);
  }

  /**
   * Create rename stream
   */
  async renameDescendantsWithStream(targetPage, newPagePath, user, options = {}) {

    const readStream = await this.generateReadStreamToOperateOnlyDescendants(targetPage.path, user);

    const newPagePathPrefix = newPagePath;
    const pathRegExp = new RegExp(`^${escapeStringRegexp(targetPage.path)}`, 'i');

    const renameDescendants = this.renameDescendants.bind(this);
    const pageEvent = this.pageEvent;
    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        try {
          count += batch.length;
          await renameDescendants(batch, user, options, pathRegExp, newPagePathPrefix);
          logger.debug(`Reverting pages progressing: (count=${count})`);
        }
        catch (err) {
          logger.error('revertPages error on add anyway: ', err);
        }

        callback();
      },
      final(callback) {
        logger.debug(`Reverting pages has completed: (totalCount=${count})`);
        // update  path
        targetPage.path = newPagePath;
        pageEvent.emit('syncDescendantsUpdate', targetPage, user);
        callback();
      },
    });

    readStream
      .pipe(createBatchStream(BULK_REINDEX_SIZE))
      .pipe(writeStream);

    await streamToPromise(readStream);
  }


  async deleteCompletelyOperation(pageIds, pagePaths) {
    // Delete Bookmarks, Attachments, Revisions, Pages and emit delete
    const Bookmark = this.crowi.model('Bookmark');
    const Comment = this.crowi.model('Comment');
    const Page = this.crowi.model('Page');
    const PageTagRelation = this.crowi.model('PageTagRelation');
    const ShareLink = this.crowi.model('ShareLink');
    const Revision = this.crowi.model('Revision');
    const Attachment = this.crowi.model('Attachment');

    const { attachmentService } = this.crowi;
    const attachments = await Attachment.find({ page: { $in: pageIds } });

    const pages = await Page.find({ redirectTo: { $ne: null } });
    const redirectToPagePathMapping = {};
    pages.forEach((page) => {
      redirectToPagePathMapping[page.redirectTo] = page.path;
    });

    const redirectedFromPagePaths = [];
    pagePaths.forEach((pagePath) => {
      redirectedFromPagePaths.push(...this.prepareShoudDeletePagesByRedirectTo(pagePath, redirectToPagePathMapping));
    });

    return Promise.all([
      Bookmark.deleteMany({ page: { $in: pageIds } }),
      Comment.deleteMany({ page: { $in: pageIds } }),
      PageTagRelation.deleteMany({ relatedPage: { $in: pageIds } }),
      ShareLink.deleteMany({ relatedPage: { $in: pageIds } }),
      Revision.deleteMany({ path: { $in: pagePaths } }),
      Page.deleteMany({ $or: [{ path: { $in: pagePaths } }, { path: { $in: redirectedFromPagePaths } }, { _id: { $in: pageIds } }] }),
      attachmentService.removeAllAttachments(attachments),
    ]);
  }

  async duplicate(page, newPagePath, user, isRecursively) {
    const Page = this.crowi.model('Page');
    const PageTagRelation = mongoose.model('PageTagRelation');
    // populate
    await page.populate({ path: 'revision', model: 'Revision', select: 'body' });

    // create option
    const options = { page };
    options.grant = page.grant;
    options.grantUserGroupId = page.grantedGroup;
    options.grantedUsers = page.grantedUsers;

    newPagePath = this.crowi.xss.process(newPagePath); // eslint-disable-line no-param-reassign

    const createdPage = await Page.create(
      newPagePath, page.revision.body, user, options,
    );

    if (isRecursively) {
      this.duplicateDescendantsWithStream(page, newPagePath, user);
    }

    // take over tags
    const originTags = await page.findRelatedTagsById();
    let savedTags = [];
    if (originTags != null) {
      await PageTagRelation.updatePageTags(createdPage.id, originTags);
      savedTags = await PageTagRelation.listTagNamesByPage(createdPage.id);
      this.tagEvent.emit('update', createdPage, savedTags);
    }

    const result = serializePageSecurely(createdPage);
    result.tags = savedTags;

    return result;
  }

  /**
   * Receive the object with oldPageId and newPageId and duplicate the tags from oldPage to newPage
   * @param {Object} pageIdMapping e.g. key: oldPageId, value: newPageId
   */
  async duplicateTags(pageIdMapping) {
    const PageTagRelation = mongoose.model('PageTagRelation');

    // convert pageId from string to ObjectId
    const pageIds = Object.keys(pageIdMapping);
    const stage = { $or: pageIds.map((pageId) => { return { relatedPage: mongoose.Types.ObjectId(pageId) } }) };

    const pagesAssociatedWithTag = await PageTagRelation.aggregate([
      {
        $match: stage,
      },
      {
        $group: {
          _id: '$relatedTag',
          relatedPages: { $push: '$relatedPage' },
        },
      },
    ]);

    const newPageTagRelation = [];
    pagesAssociatedWithTag.forEach(({ _id, relatedPages }) => {
      // relatedPages
      relatedPages.forEach((pageId) => {
        newPageTagRelation.push({
          relatedPage: pageIdMapping[pageId], // newPageId
          relatedTag: _id,
        });
      });
    });

    return PageTagRelation.insertMany(newPageTagRelation, { ordered: false });
  }

  async duplicateDescendants(pages, user, oldPagePathPrefix, newPagePathPrefix) {
    const Page = this.crowi.model('Page');
    const Revision = this.crowi.model('Revision');

    const paths = pages.map(page => (page.path));
    const revisions = await Revision.find({ path: { $in: paths } });

    // Mapping to set to the body of the new revision
    const pathRevisionMapping = {};
    revisions.forEach((revision) => {
      pathRevisionMapping[revision.path] = revision;
    });

    // key: oldPageId, value: newPageId
    const pageIdMapping = {};
    const newPages = [];
    const newRevisions = [];

    pages.forEach((page) => {
      const newPageId = new mongoose.Types.ObjectId();
      const newPagePath = page.path.replace(oldPagePathPrefix, newPagePathPrefix);
      const revisionId = new mongoose.Types.ObjectId();
      pageIdMapping[page._id] = newPageId;

      newPages.push({
        _id: newPageId,
        path: newPagePath,
        creator: user._id,
        grant: page.grant,
        grantedGroup: page.grantedGroup,
        grantedUsers: page.grantedUsers,
        lastUpdateUser: user._id,
        redirectTo: null,
        revision: revisionId,
      });

      newRevisions.push({
        _id: revisionId, path: newPagePath, body: pathRevisionMapping[page.path].body, author: user._id, format: 'markdown',
      });

    });

    await Page.insertMany(newPages, { ordered: false });
    await Revision.insertMany(newRevisions, { ordered: false });
    await this.duplicateTags(pageIdMapping);
  }

  async duplicateDescendantsWithStream(page, newPagePath, user) {

    const readStream = await this.generateReadStreamToOperateOnlyDescendants(page.path, user);

    const newPagePathPrefix = newPagePath;
    const pathRegExp = new RegExp(`^${escapeStringRegexp(page.path)}`, 'i');

    const duplicateDescendants = this.duplicateDescendants.bind(this);
    const pageEvent = this.pageEvent;
    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        try {
          count += batch.length;
          await duplicateDescendants(batch, user, pathRegExp, newPagePathPrefix);
          logger.debug(`Adding pages progressing: (count=${count})`);
        }
        catch (err) {
          logger.error('addAllPages error on add anyway: ', err);
        }

        callback();
      },
      final(callback) {
        logger.debug(`Adding pages has completed: (totalCount=${count})`);
        // update  path
        page.path = newPagePath;
        pageEvent.emit('syncDescendantsUpdate', page, user);
        callback();
      },
    });

    readStream
      .pipe(createBatchStream(BULK_REINDEX_SIZE))
      .pipe(writeStream);

  }


  async deletePage(page, user, options = {}, isRecursively = false) {
    const Page = this.crowi.model('Page');
    const PageTagRelation = this.crowi.model('PageTagRelation');
    const Revision = this.crowi.model('Revision');

    const newPath = Page.getDeletedPageName(page.path);
    const isTrashed = isTrashPage(page.path);

    if (isTrashed) {
      throw new Error('This method does NOT support deleting trashed pages.');
    }

    if (!Page.isDeletableName(page.path)) {
      throw new Error('Page is not deletable.');
    }

    if (isRecursively) {
      this.deleteDescendantsWithStream(page, user, options);
    }

    // update Rivisions
    await Revision.updateRevisionListByPath(page.path, { path: newPath }, {});
    const deletedPage = await Page.findByIdAndUpdate(page._id, {
      $set: {
        path: newPath, status: Page.STATUS_DELETED, deleteUser: user._id, deletedAt: Date.now(),
      },
    }, { new: true });
    await PageTagRelation.updateMany({ relatedPage: page._id }, { $set: { isPageTrashed: true } });
    const body = `redirect ${newPath}`;
    await Page.create(page.path, body, user, { redirectTo: newPath });

    this.pageEvent.emit('delete', page, user);
    this.pageEvent.emit('create', deletedPage, user);

    return deletedPage;
  }

  async deleteDescendants(pages, user) {
    const Page = this.crowi.model('Page');

    const pageCollection = mongoose.connection.collection('pages');
    const revisionCollection = mongoose.connection.collection('revisions');

    const deletePageBulkOp = pageCollection.initializeUnorderedBulkOp();
    const updateRevisionListOp = revisionCollection.initializeUnorderedBulkOp();
    const createRediectRevisionBulkOp = revisionCollection.initializeUnorderedBulkOp();
    const newPagesForRedirect = [];

    pages.forEach((page) => {
      const newPath = Page.getDeletedPageName(page.path);
      const revisionId = new mongoose.Types.ObjectId();
      const body = `redirect ${newPath}`;

      deletePageBulkOp.find({ _id: page._id }).update({
        $set: {
          path: newPath, status: Page.STATUS_DELETED, deleteUser: user._id, deletedAt: Date.now(),
        },
      });
      updateRevisionListOp.find({ path: page.path }).update({ $set: { path: newPath } });
      createRediectRevisionBulkOp.insert({
        _id: revisionId, path: page.path, body, author: user._id, format: 'markdown',
      });

      newPagesForRedirect.push({
        path: page.path,
        creator: user._id,
        grant: page.grant,
        grantedGroup: page.grantedGroup,
        grantedUsers: page.grantedUsers,
        lastUpdateUser: user._id,
        redirectTo: newPath,
        revision: revisionId,
      });
    });

    try {
      await deletePageBulkOp.execute();
      await updateRevisionListOp.execute();
      await createRediectRevisionBulkOp.execute();
      await Page.insertMany(newPagesForRedirect, { ordered: false });
    }
    catch (err) {
      if (err.code !== 11000) {
        throw new Error('Failed to revert pages: ', err);
      }
    }
    finally {
      this.pageEvent.emit('syncDescendantsDelete', pages, user);
    }
  }

  /**
   * Create delete stream
   */
  async deleteDescendantsWithStream(targetPage, user, options = {}) {

    const readStream = await this.generateReadStreamToOperateOnlyDescendants(targetPage.path, user);

    const deleteDescendants = this.deleteDescendants.bind(this);
    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        try {
          count += batch.length;
          deleteDescendants(batch, user);
          logger.debug(`Reverting pages progressing: (count=${count})`);
        }
        catch (err) {
          logger.error('revertPages error on add anyway: ', err);
        }

        callback();
      },
      final(callback) {
        logger.debug(`Reverting pages has completed: (totalCount=${count})`);

        callback();
      },
    });

    readStream
      .pipe(createBatchStream(BULK_REINDEX_SIZE))
      .pipe(writeStream);
  }

  // delete multiple pages
  async deleteMultipleCompletely(pages, user, options = {}) {
    const ids = pages.map(page => (page._id));
    const paths = pages.map(page => (page.path));

    logger.debug('Deleting completely', paths);

    await this.deleteCompletelyOperation(ids, paths);

    this.pageEvent.emit('syncDescendantsDelete', pages, user); // update as renamed page

    return;
  }

  async deleteCompletely(page, user, options = {}, isRecursively = false, preventEmitting = false) {
    const ids = [page._id];
    const paths = [page.path];

    logger.debug('Deleting completely', paths);

    await this.deleteCompletelyOperation(ids, paths);

    if (isRecursively) {
      this.deleteCompletelyDescendantsWithStream(page, user, options);
    }

    if (!preventEmitting) {
      this.pageEvent.emit('deleteCompletely', page, user);
    }

    return;
  }

  /**
   * Create delete completely stream
   */
  async deleteCompletelyDescendantsWithStream(targetPage, user, options = {}) {

    const readStream = await this.generateReadStreamToOperateOnlyDescendants(targetPage.path, user);

    const deleteMultipleCompletely = this.deleteMultipleCompletely.bind(this);
    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        try {
          count += batch.length;
          await deleteMultipleCompletely(batch, user, options);
          logger.debug(`Adding pages progressing: (count=${count})`);
        }
        catch (err) {
          logger.error('addAllPages error on add anyway: ', err);
        }

        callback();
      },
      final(callback) {
        logger.debug(`Adding pages has completed: (totalCount=${count})`);

        callback();
      },
    });

    readStream
      .pipe(createBatchStream(BULK_REINDEX_SIZE))
      .pipe(writeStream);
  }

  async revertDeletedDescendants(pages, user) {
    const Page = this.crowi.model('Page');
    const pageCollection = mongoose.connection.collection('pages');
    const revisionCollection = mongoose.connection.collection('revisions');

    const removePageBulkOp = pageCollection.initializeUnorderedBulkOp();
    const revertPageBulkOp = pageCollection.initializeUnorderedBulkOp();
    const revertRevisionBulkOp = revisionCollection.initializeUnorderedBulkOp();

    // e.g. key: '/test'
    const pathToPageMapping = {};
    const toPaths = pages.map(page => Page.getRevertDeletedPageName(page.path));
    const toPages = await Page.find({ path: { $in: toPaths } });
    toPages.forEach((toPage) => {
      pathToPageMapping[toPage.path] = toPage;
    });

    pages.forEach((page) => {

      // e.g. page.path = /trash/test, toPath = /test
      const toPath = Page.getRevertDeletedPageName(page.path);

      if (pathToPageMapping[toPath] != null) {
      // When the page is deleted, it will always be created with "redirectTo" in the path of the original page.
      // So, it's ok to delete the page
      // However, If a page exists that is not "redirectTo", something is wrong. (Data correction is needed).
        if (pathToPageMapping[toPath].redirectTo === page.path) {
          removePageBulkOp.find({ path: toPath }).delete();
        }
      }
      revertPageBulkOp.find({ _id: page._id }).update({
        $set: {
          path: toPath, status: Page.STATUS_PUBLISHED, lastUpdateUser: user._id, deleteUser: null, deletedAt: null,
        },
      });
      revertRevisionBulkOp.find({ path: page.path }).update({ $set: { path: toPath } }, { multi: true });
    });

    try {
      await removePageBulkOp.execute();
      await revertPageBulkOp.execute();
      await revertRevisionBulkOp.execute();
    }
    catch (err) {
      if (err.code !== 11000) {
        throw new Error('Failed to revert pages: ', err);
      }
    }
  }

  async revertDeletedPage(page, user, options = {}, isRecursively = false) {
    const Page = this.crowi.model('Page');
    const PageTagRelation = this.crowi.model('PageTagRelation');
    const Revision = this.crowi.model('Revision');

    const newPath = Page.getRevertDeletedPageName(page.path);
    const originPage = await Page.findByPath(newPath);
    if (originPage != null) {
      // When the page is deleted, it will always be created with "redirectTo" in the path of the original page.
      // So, it's ok to delete the page
      // However, If a page exists that is not "redirectTo", something is wrong. (Data correction is needed).
      if (originPage.redirectTo !== page.path) {
        throw new Error('The new page of to revert is exists and the redirect path of the page is not the deleted page.');
      }

      await this.deleteCompletely(originPage, user, options, false, true);
      this.pageEvent.emit('revert', page, user);
    }

    if (isRecursively) {
      this.revertDeletedDescendantsWithStream(page, user, options);
    }

    page.status = Page.STATUS_PUBLISHED;
    page.lastUpdateUser = user;
    debug('Revert deleted the page', page, newPath);
    const updatedPage = await Page.findByIdAndUpdate(page._id, {
      $set: {
        path: newPath, status: Page.STATUS_PUBLISHED, lastUpdateUser: user._id, deleteUser: null, deletedAt: null,
      },
    }, { new: true });
    await PageTagRelation.updateMany({ relatedPage: page._id }, { $set: { isPageTrashed: false } });
    await Revision.updateMany({ path: page.path }, { $set: { path: newPath } });

    return updatedPage;
  }

  /**
   * Create revert stream
   */
  async revertDeletedDescendantsWithStream(targetPage, user, options = {}) {

    const readStream = await this.generateReadStreamToOperateOnlyDescendants(targetPage.path, user);

    const revertDeletedDescendants = this.revertDeletedDescendants.bind(this);
    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        try {
          count += batch.length;
          revertDeletedDescendants(batch, user);
          logger.debug(`Reverting pages progressing: (count=${count})`);
        }
        catch (err) {
          logger.error('revertPages error on add anyway: ', err);
        }

        callback();
      },
      final(callback) {
        logger.debug(`Reverting pages has completed: (totalCount=${count})`);

        callback();
      },
    });

    readStream
      .pipe(createBatchStream(BULK_REINDEX_SIZE))
      .pipe(writeStream);
  }


  async handlePrivatePagesForGroupsToDelete(groupsToDelete, action, transferToUserGroupId, user) {
    const Page = this.crowi.model('Page');
    const pages = await Page.find({ grantedGroup: { $in: groupsToDelete } });

    let operationsToPublicize;
    switch (action) {
      case 'public':
        await Page.publicizePages(pages);
        break;
      case 'delete':
        return this.deleteMultipleCompletely(pages, user);
      case 'transfer':
        await Page.transferPagesToGroup(pages, transferToUserGroupId);
        break;
      default:
        throw new Error('Unknown action for private pages');
    }
  }

  async shortBodiesMapByPageIds(pageIds = [], user) {
    const Page = mongoose.model('Page');
    const MAX_LENGTH = 350;

    // aggregation options
    const viewerCondition = await generateGrantCondition(user, null);
    const filterByIds = {
      _id: { $in: pageIds.map(id => mongoose.Types.ObjectId(id)) },
    };

    let pages;
    try {
      pages = await Page
        .aggregate([
          // filter by pageIds
          {
            $match: filterByIds,
          },
          // filter by viewer
          viewerCondition,
          // lookup: https://docs.mongodb.com/v4.4/reference/operator/aggregation/lookup/
          {
            $lookup: {
              from: 'revisions',
              let: { localRevision: '$revision' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ['$_id', '$$localRevision'],
                    },
                  },
                },
                {
                  $project: {
                    revision: { $substr: ['$body', 0, MAX_LENGTH] },
                  },
                },
              ],
              as: 'revisionData',
            },
          },
          // projection
          {
            $project: {
              _id: 1,
              revisionData: 1,
            },
          },
        ]).exec();
    }
    catch (err) {
      logger.error('Error occurred while generating shortBodiesMap');
      throw err;
    }

    const shortBodiesMap = {};
    pages.forEach((page) => {
      shortBodiesMap[page._id] = page.revisionData?.[0]?.revision;
    });

    return shortBodiesMap;
  }

  validateCrowi() {
    if (this.crowi == null) {
      throw new Error('"crowi" is null. Init User model with "crowi" argument first.');
    }
  }

  createAndSendNotifications = async function(page, user, action) {
    const { activityService, inAppNotificationService } = this.crowi;

    const snapshot = stringifySnapshot(page);

    // Create activity
    const parameters = {
      user: user._id,
      targetModel: ActivityDefine.MODEL_PAGE,
      target: page,
      action,
    };
    const activity = await activityService.createByParameters(parameters);

    // Get user to be notified
    const targetUsers = await activity.getNotificationTargetUsers();

    // Create and send notifications
    await inAppNotificationService.upsertByActivity(targetUsers, activity, snapshot);
    await inAppNotificationService.emitSocketIo(targetUsers);
  };

  async v5MigrationByPageIds(pageIds) {
    const Page = mongoose.model('Page');

    if (pageIds == null || pageIds.length === 0) {
      logger.error('pageIds is null or 0 length.');
      return;
    }

    // generate regexps
    const regexps = await this._generateRegExpsByPageIds(pageIds);

    // migrate recursively
    try {
      await this._v5RecursiveMigration(null, regexps);
    }
    catch (err) {
      logger.error('V5 initial miration failed.', err);
      // socket.emit('v5InitialMirationFailed', { error: err.message }); TODO: use socket to tell user

      throw err;
    }
  }

  async _isPagePathIndexUnique() {
    const Page = this.crowi.model('Page');
    const now = (new Date()).toString();
    const path = `growi_check_is_path_index_unique_${now}`;

    let isUnique = false;

    try {
      await Page.insertMany([
        { path },
        { path },
      ]);
    }
    catch (err) {
      if (err?.code === 11000) { // Error code 11000 indicates the index is unique
        isUnique = true;
        logger.info('Page path index is unique.');
      }
      else {
        throw err;
      }
    }
    finally {
      await Page.deleteMany({ path: { $regex: new RegExp('growi_check_is_path_index_unique', 'g') } });
    }


    return isUnique;
  }

  // TODO: use socket to send status to the client
  async v5InitialMigration(grant) {
    // const socket = this.crowi.socketIoService.getAdminSocket();

    let isUnique;
    try {
      isUnique = await this._isPagePathIndexUnique();
    }
    catch (err) {
      logger.error('Failed to check path index status', err);
      throw err;
    }

    // drop unique index first
    if (isUnique) {
      try {
        await this._v5NormalizeIndex();
      }
      catch (err) {
        logger.error('V5 index normalization failed.', err);
        // socket.emit('v5IndexNormalizationFailed', { error: err.message });
        throw err;
      }
    }

    // then migrate
    try {
      await this._v5RecursiveMigration(grant, null, true);
    }
    catch (err) {
      logger.error('V5 initial miration failed.', err);
      // socket.emit('v5InitialMirationFailed', { error: err.message });

      throw err;
    }

    // update descendantCount of all public pages
    await this.updateSelfAndDescendantCount('/');
    await this._setIsV5CompatibleTrue();
  }

  /*
   * returns an array of js RegExp instance instead of RE2 instance for mongo filter
   */
  async _generateRegExpsByPageIds(pageIds) {
    const Page = mongoose.model('Page');

    let result;
    try {
      result = await Page.findListByPageIds(pageIds, null, false);
    }
    catch (err) {
      logger.error('Failed to find pages by ids', err);
      throw err;
    }

    const { pages } = result;
    const regexps = pages.map(page => new RegExp(`^${page.path}`));

    return regexps;
  }

  async _setIsV5CompatibleTrue() {
    try {
      await this.crowi.configManager.updateConfigsInTheSameNamespace('crowi', {
        'app:isV5Compatible': true,
      });
      logger.info('Successfully migrated all public pages.');
    }
    catch (err) {
      logger.warn('Failed to update app:isV5Compatible to true.');
      throw err;
    }
  }

  // TODO: use websocket to show progress
  async _v5RecursiveMigration(grant, regexps, publicOnly = false) {
    const BATCH_SIZE = 100;
    const PAGES_LIMIT = 1000;
    const Page = this.crowi.model('Page');
    const { PageQueryBuilder } = Page;

    // generate filter
    let filter = {
      parent: null,
      path: { $ne: '/' },
    };
    if (grant != null) {
      filter = {
        ...filter,
        grant,
      };
    }
    if (regexps != null && regexps.length !== 0) {
      filter = {
        ...filter,
        path: {
          $in: regexps,
        },
      };
    }

    const total = await Page.countDocuments(filter);

    let baseAggregation = Page
      .aggregate([
        {
          $match: filter,
        },
        {
          $project: { // minimize data to fetch
            _id: 1,
            path: 1,
          },
        },
      ]);

    // limit pages to get
    if (total > PAGES_LIMIT) {
      baseAggregation = baseAggregation.limit(Math.floor(total * 0.3));
    }

    const pagesStream = await baseAggregation.cursor({ batchSize: BATCH_SIZE });

    // use batch stream
    const batchStream = createBatchStream(BATCH_SIZE);

    let countPages = 0;
    let shouldContinue = true;

    // migrate all siblings for each page
    const migratePagesStream = new Writable({
      objectMode: true,
      async write(pages, encoding, callback) {
        // make list to create empty pages
        const parentPathsSet = new Set(pages.map(page => pathlib.dirname(page.path)));
        const parentPaths = Array.from(parentPathsSet);

        // fill parents with empty pages
        await Page.createEmptyPagesByPaths(parentPaths, publicOnly);

        // find parents again
        const builder = new PageQueryBuilder(Page.find({}, { _id: 1, path: 1 }), true);
        const parents = await builder
          .addConditionToListByPathsArray(parentPaths)
          .query
          .lean()
          .exec();

        // bulkWrite to update parent
        const updateManyOperations = parents.map((parent) => {
          const parentId = parent._id;

          // modify to adjust for RegExp
          let parentPath = parent.path === '/' ? '' : parent.path;
          // inject \ before brackets
          ['(', ')', '[', ']', '{', '}'].forEach((bracket) => {
            parentPath = parentPath.replace(bracket, `\\${bracket}`);
          });

          const filter = {
            // regexr.com/6889f
            // ex. /parent/any_child OR /any_level1
            path: { $regex: new RegExp(`^${parentPath}(\\/[^/]+)\\/?$`, 'g') },
          };
          if (grant != null) {
            filter.grant = grant;
          }

          return {
            updateMany: {
              filter,
              update: {
                parent: parentId,
              },
            },
          };
        });
        try {
          const res = await Page.bulkWrite(updateManyOperations);
          countPages += res.result.nModified;
          logger.info(`Page migration processing: (count=${countPages})`);

          // throw
          if (res.result.writeErrors.length > 0) {
            logger.error('Failed to migrate some pages', res.result.writeErrors);
            throw Error('Failed to migrate some pages');
          }

          // finish migration
          if (res.result.nModified === 0) { // TODO: find the best property to count updated documents
            shouldContinue = false;
            logger.error('Migration is unable to continue', 'parentPaths:', parentPaths, 'bulkWriteResult:', res);
          }
        }
        catch (err) {
          logger.error('Failed to update page.parent.', err);
          throw err;
        }

        callback();
      },
      final(callback) {
        callback();
      },
    });

    pagesStream
      .pipe(batchStream)
      .pipe(migratePagesStream);

    await streamToPromise(migratePagesStream);

    if (await Page.exists(filter) && shouldContinue) {
      return this._v5RecursiveMigration(grant, regexps, publicOnly);
    }

  }

  async _v5NormalizeIndex() {
    const collection = mongoose.connection.collection('pages');

    try {
      // drop pages.path_1 indexes
      await collection.dropIndex('path_1');
      logger.info('Succeeded to drop unique indexes from pages.path.');
    }
    catch (err) {
      logger.warn('Failed to drop unique indexes from pages.path.', err);
      throw err;
    }

    try {
      // create indexes without
      await collection.createIndex({ path: 1 }, { unique: false });
      logger.info('Succeeded to create non-unique indexes on pages.path.');
    }
    catch (err) {
      logger.warn('Failed to create non-unique indexes on pages.path.', err);
      throw err;
    }
  }

  async v5MigratablePrivatePagesCount(user) {
    if (user == null) {
      throw Error('user is required');
    }
    const Page = this.crowi.model('Page');
    return Page.count({ parent: null, creator: user, grant: { $ne: Page.GRANT_PUBLIC } });
  }

  /**
   * update descendantCount of the following pages
   * - page that has the same path as the provided path
   * - pages that are descendants of the above page
   */
  async updateSelfAndDescendantCount(path = '/') {
    const BATCH_SIZE = 200;
    const Page = this.crowi.model('Page');

    const aggregateCondition = Page.getAggrConditionForPageWithProvidedPathAndDescendants(path);
    const aggregatedPages = await Page.aggregate(aggregateCondition).cursor({ batchSize: BATCH_SIZE });

    const recountWriteStream = new Writable({
      objectMode: true,
      async write(pageDocuments, encoding, callback) {
        for (const document of pageDocuments) {
          // eslint-disable-next-line no-await-in-loop
          await Page.recountPage(document._id);
        }
        callback();
      },
      final(callback) {
        callback();
      },
    });
    aggregatedPages
      .pipe(createBatchStream(BATCH_SIZE))
      .pipe(recountWriteStream);
  }

}

module.exports = PageService;
