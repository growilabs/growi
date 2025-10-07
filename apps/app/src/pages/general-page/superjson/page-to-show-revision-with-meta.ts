import type {
  IDataWithMeta,
} from '@growi/core';
import superjson from 'superjson';

import type { IPageToShowRevisionWithMeta } from '../types';

type IPageToShowRevisionWithMetaSerialized = IDataWithMeta<string, string | undefined>;

let isRegistered = false;

export const registerPageToShowRevisionWithMeta = (): void => {
  if (isRegistered) return;

  superjson.registerCustom<IPageToShowRevisionWithMeta, IPageToShowRevisionWithMetaSerialized>(
    {
      isApplicable: (v): v is IPageToShowRevisionWithMeta => {
        const data = v?.data;
        return data != null
          && data.toObject != null
          && data.revision != null && typeof data.revision === 'object';
      },
      serialize: (v) => {
        return {
          data: superjson.stringify(v.data.toObject()),
          meta: v.meta != null ? superjson.stringify(v.meta) : undefined,
        };
      },
      deserialize: (v) => {
        return {
          data: superjson.parse(v.data),
          meta: v.meta != null ? superjson.parse(v.meta) : undefined,
        };
      },
    },
    'IPageToShowRevisionWithMetaTransformer',
  );

  isRegistered = true;
};
