import { YDocStatus } from '@growi/core/dist/consts';
import { mock } from 'vitest-mock-extended';

import type { IYjsService } from '~/server/service/yjs';

import { checkEditingPresence } from './editing-presence';

const PAGE_ID = '64b7f0c2a1b2c3d4e5f60718';

const createYjsService = (connectionCount: number, status: YDocStatus) =>
  mock<IYjsService>({
    getConnectionCount: () => connectionCount,
    getYDocStatus: async () => status,
  });

describe('checkEditingPresence', () => {
  it('reports connected-in-this-process when a connection exists', async () => {
    const yjsService = createYjsService(1, YDocStatus.SYNCED);

    await expect(checkEditingPresence(yjsService, PAGE_ID)).resolves.toEqual({
      isBeingEdited: true,
      cause: 'connected-in-this-process',
    });
  });

  it('reports unsaved-draft when nobody is connected but the Y.Doc has a draft', async () => {
    const yjsService = createYjsService(0, YDocStatus.DRAFT);

    await expect(checkEditingPresence(yjsService, PAGE_ID)).resolves.toEqual({
      isBeingEdited: true,
      cause: 'unsaved-draft',
    });
  });

  it('reports not being edited when nobody is connected and there is no draft', async () => {
    const yjsService = createYjsService(0, YDocStatus.SYNCED);

    await expect(checkEditingPresence(yjsService, PAGE_ID)).resolves.toEqual({
      isBeingEdited: false,
    });
  });

  it('treats a missing Y.Doc as not being edited', async () => {
    const yjsService = createYjsService(0, YDocStatus.NEW);

    await expect(checkEditingPresence(yjsService, PAGE_ID)).resolves.toEqual({
      isBeingEdited: false,
    });
  });

  it('prefers the connection cause when both a connection and a draft exist', async () => {
    const yjsService = createYjsService(2, YDocStatus.DRAFT);

    await expect(checkEditingPresence(yjsService, PAGE_ID)).resolves.toEqual({
      isBeingEdited: true,
      cause: 'connected-in-this-process',
    });
  });
});
