import { type Document, Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';

import { generateOverwriteParams } from '.';

const { ObjectId } = Types;

describe('overwrite-params for searchhistories', () => {
  const resolveUser = (value: unknown): unknown => {
    const params = generateOverwriteParams(
      'searchhistories',
      new ObjectId().toString(),
      mock<GrowiArchiveImportOption>(),
    );
    const convert = params.user;
    if (typeof convert !== 'function') {
      throw new Error('overwrite function for user is not registered');
    }
    return convert(value, {
      document: mock<Document>(),
      propertyName: 'user',
    });
  };

  it('converts the exported string user back to an ObjectId', () => {
    const userId = new ObjectId();

    const converted = resolveUser(userId.toString());

    expect(converted).toBeInstanceOf(ObjectId);
    expect(converted).toEqual(userId);
  });
});
