import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type {
  PageLinkDocument,
  PageLinkModel,
} from '../../interfaces/page-link';

const pageLinkSchema = new Schema<PageLinkDocument, PageLinkModel>({
  fromPage: {
    type: Schema.Types.ObjectId,
    ref: 'Page',
    required: true,
    index: true,
  },
  toPath: {
    type: String,
    required: true,
    index: true,
  },
  toPage: {
    type: Schema.Types.ObjectId,
    ref: 'Page',
    default: null,
    index: true,
  },
});

pageLinkSchema.index({ fromPage: 1, toPath: 1 }, { unique: true });

export default getOrCreateModel<PageLinkDocument, PageLinkModel>(
  'PageLink',
  pageLinkSchema,
);
