import type { ObjectIdLike } from '../../interfaces/mongoose-utils';

/** A revision ID taken from a request says nothing about which page it belongs to; check before trusting it. */
export const isRevisionOfPage = (
  revision: { pageId: string } | null | undefined,
  pageId: ObjectIdLike,
): revision is { pageId: string } =>
  revision != null && revision.pageId === pageId.toString();
