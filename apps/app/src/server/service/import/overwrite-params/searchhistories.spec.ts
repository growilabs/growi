import { type Document, Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';

import { generateOverwriteParams } from '.';

const { ObjectId } = Types;

describe('overwrite-params for searchhistories', () => {
  const resolve = (propertyName: string, value: unknown): unknown => {
    const params = generateOverwriteParams(
      'searchhistories',
      new ObjectId().toString(),
      mock<GrowiArchiveImportOption>(),
    );
    const convert = params[propertyName];
    if (typeof convert !== 'function') {
      throw new Error(
        `overwrite function for ${propertyName} is not registered`,
      );
    }
    return convert(value, {
      document: mock<Document>(),
      propertyName,
    });
  };

  it('converts the exported string user back to an ObjectId', () => {
    const userId = new ObjectId();

    const converted = resolve('user', userId.toString());

    expect(converted).toBeInstanceOf(ObjectId);
    expect(converted).toEqual(userId);
  });

  it('keeps a keyword shaped like an ISO date as the original string', () => {
    const keyword = '2024-10-30T00:00:00Z';

    expect(resolve('keyword', keyword)).toBe(keyword);
  });
});
