const { serializePageSecurely } = require('./page-serializer');

function serializeInsecurePageAttributes(bookmark) {
  if (bookmark.page != null && bookmark.page._id != null) {
    bookmark.page = serializePageSecurely(bookmark.page);
  }
  return bookmark;
}

function serializeBookmarkSecurely(bookmark) {
  let serialized = bookmark;

  // invoke toObject if bookmark is a model instance
  if (bookmark.toObject != null) {
    serialized = bookmark.toObject();
  }

  serializeInsecurePageAttributes(serialized);

  return serialized;
}

module.exports = {
  serializeBookmarkSecurely,
};
