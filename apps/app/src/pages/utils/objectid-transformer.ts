// !!! Do NOT import 'mongoose' to reduce bundle size !!!
import { objectIdUtils } from '@growi/core/dist/utils';
import type ObjectId from 'bson-objectid';
import superjson from 'superjson';

export const registerTransformerForObjectId = (): void => {
  superjson.registerCustom<ObjectId | string, string>(
    {
      isApplicable: (v): v is ObjectId => {
        if (v == null) {
          return false;
        }
        // Only evaluate types for string and ObjectId
        if (typeof v !== 'string' && typeof v.toHexString !== 'function') {
          return false;
        }
        return objectIdUtils.isValidObjectId(v);
      },
      serialize: (v) => (typeof v === 'string' ? v : v.toHexString()),
      deserialize: (v) => v,
    },
    'ObjectidTransformer',
  );
};
