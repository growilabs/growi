import type { HydratedDocument, Model } from 'mongoose';
import { Schema } from 'mongoose';

import type { ITransferKey } from '~/interfaces/transfer-key';

import { getOrCreateModel } from '../util/mongoose-utils';

interface ITransferKeyMethods {
  findOneActiveTransferKey(
    key: string,
  ): Promise<HydratedDocument<ITransferKey, ITransferKeyMethods> | null>;
}

type TransferKeyModel = Model<ITransferKey, any, ITransferKeyMethods>;

const schema = new Schema<ITransferKey, TransferKeyModel, ITransferKeyMethods>(
  {
    expireAt: { type: Date, default: () => new Date(), expires: '30m' },
    keyString: { type: String, unique: true }, // original key string
    key: { type: String, unique: true },
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
  },
);

// TODO: validate createdAt
schema.statics.findOneActiveTransferKey = async function (
  key: string,
): Promise<HydratedDocument<ITransferKey, ITransferKeyMethods> | null> {
  return this.findOne({ key });
};

export default getOrCreateModel('TransferKey', schema);
