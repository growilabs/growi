import { getIdStringForRef } from '@growi/core';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';

export const pageModel = (): PageModel =>
  mongoose.model<PageDocument, PageModel>('Page');

// An empty page only holds the tree together, so it does not occupy the path.
export const isPathOccupied = async (path: string): Promise<boolean> =>
  (await pageModel().exists({ path, isEmpty: false })) != null;

export const latestRevisionIdOf = (page: PageDocument): string | null =>
  page.revision == null ? null : getIdStringForRef(page.revision);
