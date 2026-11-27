/**
 * Returns the id of a page's revision, which is either an ObjectId or a
 * populated Revision document; undefined when the page has no revision.
 */
export const resolveRevisionId = (revision: unknown): string | undefined => {
  if (revision == null) {
    return undefined;
  }
  return typeof revision === 'object' && '_id' in revision
    ? (revision as { _id: { toString(): string } })._id.toString()
    : (revision as { toString(): string }).toString();
};
