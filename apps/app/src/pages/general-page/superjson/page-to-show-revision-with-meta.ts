import type { IDataWithRequiredMeta } from '@growi/core';
import superjson from 'superjson';

import type { IPageToShowRevisionWithMeta } from '../types';

type IPageToShowRevisionWithMetaSerialized = IDataWithRequiredMeta<
  string,
  string
>;

let isRegistered = false;

export const registerPageToShowRevisionWithMeta = (): void => {
  if (isRegistered) return;

  superjson.registerCustom<
    IPageToShowRevisionWithMeta,
    IPageToShowRevisionWithMetaSerialized
  >(
    {
      isApplicable: (v): v is IPageToShowRevisionWithMeta => {
        const data = v?.data;
        return (
          data != null &&
          data.toObject != null &&
          data.revision != null &&
          typeof data.revision === 'object'
        );
      },
      serialize: (v) => {
        return {
          data: superjson.stringify(v.data.toObject()),
          meta: superjson.stringify(v.meta),
        };
      },
      deserialize: (v) => {
        return {
          data: superjson.parse(v.data),
          meta: superjson.parse(v.meta),
        };
      },
    },
    'IPageToShowRevisionWithMetaTransformer',
  );

  isRegistered = true;
};
