import ObjectId from 'bson-objectid';

import { toLegacyUserShape } from './user-serializer.js';

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
