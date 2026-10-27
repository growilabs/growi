import { YDocStatus } from '@growi/core/dist/consts';

import type { IYjsService } from '~/server/service/yjs';

export type EditingPresenceResult =
  | { readonly isBeingEdited: false }
  | {
      readonly isBeingEdited: true;
      readonly cause: 'connected-in-this-process' | 'unsaved-draft';
    };

// Known limitation (design OQ-6): getConnectionCount only sees connections held by
// this process. With several server processes, an editor connected to another
// process is invisible here; only the unsaved-draft check can still catch them.
export const checkEditingPresence = async (
  yjsService: IYjsService,
  pageId: string,
): Promise<EditingPresenceResult> => {
  if (yjsService.getConnectionCount(pageId) > 0) {
    return { isBeingEdited: true, cause: 'connected-in-this-process' };
  }

  if ((await yjsService.getYDocStatus(pageId)) === YDocStatus.DRAFT) {
    return { isBeingEdited: true, cause: 'unsaved-draft' };
  }

  return { isBeingEdited: false };
};
