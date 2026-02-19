import type { JSX } from 'react';

import { usePageSeenUsersUpdatedEffect } from '~/client/services/side-effects/page-seen-users-updated';
import { usePageUpdatedEffect } from '~/client/services/side-effects/page-updated';
import {
  useAwarenessSyncingEffect,
  useCurrentPageYjsDataAutoLoadEffect,
  useNewlyYjsDataSyncingEffect,
} from '~/features/collaborative-editor/side-effects';

export const EditablePageEffects = (): JSX.Element => {
  usePageUpdatedEffect();
  usePageSeenUsersUpdatedEffect();

  useCurrentPageYjsDataAutoLoadEffect();
  useNewlyYjsDataSyncingEffect();
  useAwarenessSyncingEffect();

  return <></>;
};
