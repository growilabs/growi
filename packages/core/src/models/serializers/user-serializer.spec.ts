import ObjectId from 'bson-objectid';

import { serializeUserSecurely, toLegacyUserShape } from './user-serializer.js';

describe('toLegacyUserShape', () => {
  it('sets imageAttachment to imageAttachmentId', () => {
    const user = {
      id: new ObjectId().toString(),
      imageAttachmentId: new ObjectId().toString(),
    };

    expect(toLegacyUserShape(user)).toEqual({
      ...user,
      imageAttachment: user.imageAttachmentId,
    });
  });

  it('keeps imageAttachment null when the user has no image', () => {
    const user = {
      id: new ObjectId().toString(),
      imageAttachmentId: null,
    };

    expect(toLegacyUserShape(user)).toEqual({
      ...user,
      imageAttachment: null,
    });
  });
});

describe('serializeUserSecurely', () => {
  const userRow = {
    id: new ObjectId().toString(),
    name: null as string | null,
    password: 'hashed',
    apiToken: 'token',
    email: 'user@example.com',
    isEmailPublished: false,
  };

  it('omits password, apiToken and email from a Prisma user row', () => {
    const result = serializeUserSecurely(userRow);

    expect(result).toStrictEqual({
      id: userRow.id,
      name: null,
      isEmailPublished: false,
    });
  });

  it('keeps email when isEmailPublished is true', () => {
    const result = serializeUserSecurely({
      ...userRow,
      isEmailPublished: true,
    });

    expect(result).toStrictEqual({
      id: userRow.id,
      name: null,
      email: 'user@example.com',
      isEmailPublished: true,
    });
  });
});
