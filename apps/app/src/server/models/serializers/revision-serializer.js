import { serializeUserSecurely } from '@growi/core/dist/models/serializers';

function serializeInsecureUserAttributes(revision) {
  if (revision.author != null && revision.author._id != null) {
    revision.author = serializeUserSecurely(revision.author);
  }
  return revision;
}

export function serializeRevisionSecurely(revision) {
  const serialized = revision;

  serializeInsecureUserAttributes(serialized);

  return serialized;
}
