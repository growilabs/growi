import type { JSX } from 'react';

import { usePageUpdatedEffect } from '~/client/services/side-effects/page-updated';
import {
  useAwarenessSyncingEffect,
  useCurrentPageYjsDataAutoLoadEffect,
  useNewlyYjsDataSyncingEffect,
} from '~/features/collaborative-editor/side-effects';

export const EditablePageEffects = (): JSX.Element => {
  usePageUpdatedEffect();

  useCurrentPageYjsDataAutoLoadEffect();
  useNewlyYjsDataSyncingEffect();
  useAwarenessSyncingEffect();

  return <></>;
};
