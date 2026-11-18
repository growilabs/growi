import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IUserHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import { initAttachmentFullTextSearch } from '~/features/search-attachments/server';
import type Crowi from '~/server/crowi';
import { AttachmentType } from '~/server/interfaces/attachment';
import type { AttachmentWithComputed } from '~/server/models/attachment';
import { configManager } from '~/server/service/config-manager';
import type { FileUploader } from '~/server/service/file-uploader/file-uploader';
import SearchService from '~/server/service/search';
import ElasticsearchDelegator from '~/server/service/search-delegator/elasticsearch';

import { elasticsearchOrigin } from './es-inspection';

type ConfigKey = Parameters<typeof configManager.getConfig>[0];

/**
 * Answers the given keys from `values` (read on every call, so a test can
 * change them between steps) and every other key from the real config.
 * Must run before the parts read their config.
 */
export const overrideConfig = (
  values: Partial<Record<ConfigKey, unknown>>,
): void => {
  const original = configManager.getConfig.bind(configManager);
  vi.spyOn(configManager, 'getConfig').mockImplementation((key, source) =>
    key in values ? (values[key] as never) : original(key, source),
  );
};

/** An Elasticsearch URI whose path makes `pageIndexName` the page index name. */
export const elasticsearchUriFor = (pageIndexName: string): string =>
  `${elasticsearchOrigin()}/${pageIndexName}`;

class SearchServiceForTest extends SearchService {
  static forDelegator(
    crowi: Crowi,
    delegator: ElasticsearchDelegator,
  ): SearchServiceForTest {
    const service = new SearchServiceForTest();
    service.crowi = crowi;
    service.fullTextSearchDelegator = delegator;
    service.nqDelegators = service.generateNQDelegators(delegator);
    service.isErrorOccuredOnHealthcheck = false;
    return service;
  }
}

/**
 * Wires the feature the way the app does at boot (`initAttachmentFullTextSearch`)
 * against a search service whose page index name comes from the overridden
 * `app:elasticsearchUri`, so every index it touches is the test's own.
 */
export const wireAttachmentSearch = async (crowi: Crowi): Promise<void> => {
  const delegator = new ElasticsearchDelegator(crowi.socketIoService);
  await delegator.initClient();
  crowi.searchService = SearchServiceForTest.forDelegator(crowi, delegator);
  await initAttachmentFullTextSearch(crowi);
};

/**
 * An in-memory file store standing in for the configured uploader: storage is
 * not what these tests verify, and the extractor reads the bytes from it.
 */
export type FixtureFileStore = {
  readonly uploader: FileUploader;
  /** Writes a temp file holding `content`, as multer would hand it over. */
  file(name: string, content: string): Promise<Express.Multer.File>;
  cleanup(): Promise<void>;
};

export const createFixtureFileStore = async (): Promise<FixtureFileStore> => {
  const dir = await mkdtemp(join(tmpdir(), 'attachment-search-integ-'));
  const contents = new Map<string, string>();
  const uploader = mock<FileUploader>({
    checkLimit: async () => ({ isUploadable: true }),
    // Attachments other test files left in a shared database read as empty
    findDeliveryFile: async (attachment: AttachmentWithComputed) =>
      Readable.from([
        Buffer.from(contents.get(attachment.originalName ?? '') ?? ''),
      ]),
  });

  return {
    uploader,
    async file(name, content) {
      const path = join(dir, name);
      await writeFile(path, content);
      contents.set(name, content);
      return mock<Express.Multer.File>({
        path,
        originalname: name,
        mimetype: 'text/plain',
        size: Buffer.byteLength(content),
      });
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
};

/**
 * Uploads through the real AttachmentService and waits until its attach
 * handlers have settled (the dispose callback runs after all of them).
 */
export const uploadAttachment = async (
  crowi: Crowi,
  file: Express.Multer.File,
  user: IUserHasId,
  pageId: string | null,
): Promise<string> => {
  let handlersSettled: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    handlersSettled = resolve;
  });
  const attachment = await crowi.attachmentService.createAttachment(
    file,
    user,
    pageId,
    AttachmentType.WIKI_PAGE,
    () => handlersSettled(),
  );
  await settled;
  return attachment.id;
};
