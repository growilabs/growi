import ObjectId from 'bson-objectid';

import { toLegacyAttachmentShape } from './attachment-serializer.js';

describe('toLegacyAttachmentShape', () => {
  it('sets creator to creatorId when creator is not included', () => {
    const attachment = {
      id: new ObjectId().toString(),
      pageId: new ObjectId().toString(),
      creatorId: new ObjectId().toString(),
    };

    expect(toLegacyAttachmentShape(attachment)).toEqual({
      ...attachment,
      page: attachment.pageId,
      creator: attachment.creatorId,
    });
  });

  it('keeps creator null when the included user no longer exists', () => {
    const attachment = {
      id: new ObjectId().toString(),
      pageId: new ObjectId().toString(),
      creatorId: new ObjectId().toString(),
      creator: null,
    };

    expect(toLegacyAttachmentShape(attachment)).toEqual({
      ...attachment,
      page: attachment.pageId,
      creator: null,
    });
  });

  it('converts an included creator to the legacy user shape with imageAttachment', () => {
    const creatorId = new ObjectId().toString();
    const attachment = {
      id: new ObjectId().toString(),
      pageId: new ObjectId().toString(),
      creatorId,
      creator: {
        id: creatorId,
        imageAttachmentId: new ObjectId().toString(),
      },
    };

    expect(toLegacyAttachmentShape(attachment)).toEqual({
      ...attachment,
      page: attachment.pageId,
      creator: {
        ...attachment.creator,
        imageAttachment: attachment.creator.imageAttachmentId,
      },
    });
  });
});
