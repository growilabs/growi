import { parseISO } from 'date-fns/parseISO';
import isIsoDate from 'is-iso-date';
import type { Schema } from 'mongoose';
import { type Document, Types } from 'mongoose';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:import:overwrite-function');

const { ObjectId } = Types;

export type OverwriteFunction = (
  value: unknown,
  ctx: { document: Document; propertyName: string; schema?: Schema },
) => unknown;

/**
 * keep original value
 * automatically convert ObjectId
 *
 * @param value value from imported document
 * @param ctx context object
 * @return new value for the document
 *
 * @see https://mongoosejs.com/docs/api/schematype.html#schematype_SchemaType-cast
 */
export const keepOriginal: OverwriteFunction = (
  value,
  { document, schema, propertyName },
) => {
  if (value == null) {
    return value;
  }

  // Model
  if (schema != null && schema.path(propertyName) != null) {
    const schemaType = schema.path(propertyName);

    // force to set schema to the document
    //  cz: SchemaArray.cast requires the document to have 'schema' property
    // ref: https://github.com/Automattic/mongoose/blob/6.11.4/lib/schema/array.js#L334
    document.schema = schema;

    try {
      return schemaType.cast(value, document, true);
    } catch (e) {
      logger.warn(`Failed to cast value for ${propertyName}`, e);
      // return original value
      return value;
    }
  }

  // _id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (propertyName === '_id' && ObjectId.isValid(value as any)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new ObjectId(value as any);
  }

  // Date
  if (isIsoDate(value)) {
    return parseISO(value as string);
  }

  return value;
};
