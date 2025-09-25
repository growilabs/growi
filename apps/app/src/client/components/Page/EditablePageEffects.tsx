import type { JSX } from 'react';

import { usePageUpdatedEffect } from '~/client/services/side-effects/page-updated';
import { useCurrentPageYjsDataEffect } from '~/client/services/side-effects/yjs';


export const EditablePageEffects = (): JSX.Element => {

  usePageUpdatedEffect();
  useCurrentPageYjsDataEffect();

  return <></>;

};
