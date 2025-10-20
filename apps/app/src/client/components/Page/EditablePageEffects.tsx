import type { JSX } from 'react';

import { usePageUpdatedEffect } from '~/client/services/side-effects/page-updated';
import { useAwarenessSyncingEffect, useNewlyYjsDataSyncingEffect, useCurrentPageYjsDataAutoLoadEffect } from '~/features/collaborative-editor/side-effects';


export const EditablePageEffects = (): JSX.Element => {

  usePageUpdatedEffect();

  useCurrentPageYjsDataAutoLoadEffect();
  useNewlyYjsDataSyncingEffect();
  useAwarenessSyncingEffect();

  return <></>;

};
