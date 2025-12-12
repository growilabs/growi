import { Origin, YDocStatus } from '@growi/core';
import type { Delta } from '@growi/editor';
import type { Document } from 'y-socket.io/dist/server';

import loggerFactory from '~/utils/logger';

import { Revision } from '../../models/revision';
import { normalizeLatestRevisionIfBroken } from '../revision/normalize-latest-revision-if-broken';
import type { MongodbPersistence } from './extended/mongodb-persistence';

const logger = loggerFactory('growi:service:yjs:sync-ydoc');

type Context = {
  ydocStatus: YDocStatus;
};

/**
 * Sync the text and the meta data with the latest revision body
 * @param mdb
 * @param doc
 * @param context true to force sync
 */
export const syncYDoc = async (
  mdb: MongodbPersistence,
  doc: Document,
  context: true | Context,
): Promise<void> => {
  const pageId = doc.name;

  // Normalize the latest revision which was borken by the migration script '20211227060705-revision-path-to-page-id-schema-migration--fixed-7549.js'
  await normalizeLatestRevisionIfBroken(pageId);

  const revision = await Revision.findOne(
    // filter
    { pageId },
    // projection
    { body: 1, createdAt: 1, origin: 1 },
    // options
    { sort: { createdAt: -1 } },
  ).lean();

  if (revision == null) {
    logger.warn(
      `Synchronization has been canceled since the revision of the page ('${pageId}') could not be found`,
    );
    return;
  }

  const shouldSync =
    context === true ||
    (() => {
      switch (context.ydocStatus) {
        case YDocStatus.NEW:
          return true;
        case YDocStatus.OUTDATED:
          // should skip when the YDoc is outdated and the latest revision is created by the editor
          return revision.origin !== Origin.Editor;
        default:
          return false;
      }
    })();

  if (shouldSync) {
    logger.debug(
      `YDoc for the page ('${pageId}') is synced with the latest revision body`,
    );

    const ytext = doc.getText('codemirror');
    const delta: Delta = [];

    if (ytext.length > 0) {
      delta.push({ delete: ytext.length });
    }
    if (revision.body != null) {
      delta.push({ insert: revision.body });
    }

    ytext.applyDelta(delta, { sanitize: false });
  }

  const shouldSyncMeta =
    context === true ||
    context.ydocStatus === YDocStatus.NEW ||
    context.ydocStatus === YDocStatus.OUTDATED;

  if (shouldSyncMeta) {
    mdb.setMeta(
      doc.name,
      'updatedAt',
      revision.createdAt.getTime() ?? Date.now(),
    );
  }
};
