import type { JSX } from 'react';

import {
  useAwarenessSyncingEffect,
  useCurrentPageYjsDataAutoLoadEffect,
  useNewlyYjsDataSyncingEffect,
} from '~/features/collaborative-editor/side-effects';

import { usePageSeenUsersUpdatedEffect } from '../../services/side-effects/page-seen-users-updated';
import { usePageUpdatedEffect } from '../../services/side-effects/page-updated';

export const EditablePageEffects = (): JSX.Element => {
  usePageUpdatedEffect();
  usePageSeenUsersUpdatedEffect();

  useCurrentPageYjsDataAutoLoadEffect();
  useNewlyYjsDataSyncingEffect();
  useAwarenessSyncingEffect();

  return <></>;
};
