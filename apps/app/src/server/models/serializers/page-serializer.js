import { serializeUserSecurely } from '@growi/core/dist/models/serializers';

function depopulate(page, attributeName) {
  // revert the ObjectID
  if (page[attributeName] != null && page[attributeName]._id != null) {
    page[attributeName] = page[attributeName]._id;
  }
}

function serializeInsecureUserAttributes(page) {
  if (page.lastUpdateUser != null && page.lastUpdateUser._id != null) {
    page.lastUpdateUser = serializeUserSecurely(page.lastUpdateUser);
  }
  if (page.creator != null && page.creator._id != null) {
    page.creator = serializeUserSecurely(page.creator);
  }
  if (
    page.revision != null &&
    page.revision.author != null &&
    page.revision.author._id != null
  ) {
    page.revision.author = serializeUserSecurely(page.revision.author);
  }
  return page;
}

export function serializePageSecurely(page) {
  let serialized = page;

  // invoke toObject if page is a model instance
  if (page.toObject != null) {
    serialized = page.toObject();
  }

  // depopulate revision
  depopulate(serialized, 'revision');

  serializeInsecureUserAttributes(serialized);

  return serialized;
}
