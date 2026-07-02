import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type {
  PageLink,
  PageLinkDocument,
  PageLinkModel,
} from '../../interfaces/page-link';

const PageLinkSchema = new Schema<PageLink>({
  fromPage: {
    type: Schema.Types.ObjectId,
  },
  toPath: {
    type: String,
  },
  toPage: {
    type: Schema.Types.ObjectId,
    default: null,
  },
});

export default getOrCreateModel<PageLinkDocument, PageLinkModel>(
  'PageLink',
  PageLinkSchema,
);
