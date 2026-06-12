import type { JSX } from 'react';

import { usePageSeenUsersUpdatedEffect } from '~/client/services/side-effects/page-seen-users-updated.js';
import { usePageUpdatedEffect } from '~/client/services/side-effects/page-updated.js';
import {
  useAwarenessSyncingEffect,
  useCurrentPageYjsDataAutoLoadEffect,
  useNewlyYjsDataSyncingEffect,
} from '~/features/collaborative-editor/side-effects/index.js';

export const EditablePageEffects = (): JSX.Element => {
  usePageUpdatedEffect();
  usePageSeenUsersUpdatedEffect();

  useCurrentPageYjsDataAutoLoadEffect();
  useNewlyYjsDataSyncingEffect();
  useAwarenessSyncingEffect();

  return <></>;
};
