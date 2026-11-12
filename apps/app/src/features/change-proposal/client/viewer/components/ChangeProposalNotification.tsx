import type { HasObjectId } from '@growi/core';

import type { ModelNotificationUtils } from '~/client/components/InAppNotification/ModelNotification';
import type { IInAppNotification } from '~/interfaces/in-app-notification';

export const useChangeProposalModelNotification = (
  _notification: IInAppNotification & HasObjectId,
): ModelNotificationUtils | null => {
  throw new Error('Not implemented');
};
