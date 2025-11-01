import { defaultSupportedSlackEventActions } from '@growi/slack';
import crypto from 'crypto';
import mongoose from 'mongoose';

import { configManager } from '../service/config-manager';
import { getModelSafely } from '../util/mongoose-utils';

const schema = new mongoose.Schema({
  tokenGtoP: { type: String, required: true, unique: true },
  tokenPtoG: { type: String, required: true, unique: true },
  isPrimary: { type: Boolean, unique: true, sparse: true },
  permissionsForBroadcastUseCommands: Map,
  permissionsForSingleUseCommands: Map,
  permissionsForSlackEventActions: {
    type: Map,
    default: new Map(
      defaultSupportedSlackEventActions.map((action) => [action, false]),
    ),
  },
});

class SlackAppIntegration {
  static generateAccessTokens(saltForGtoP, saltForPtoG) {
    const now = new Date().getTime();
    const hasher1 = crypto.createHash('sha512');
    const hasher2 = crypto.createHash('sha512');
    const tokenGtoP = hasher1
      .update(`gtop-${saltForGtoP}-${now.toString()}`)
      .digest('base64');
    const tokenPtoG = hasher2
      .update(`ptog-${saltForPtoG}-${now.toString()}`)
      .digest('base64');
    return [tokenGtoP, tokenPtoG];
  }

  static async generateUniqueAccessTokens() {
    let duplicateTokens;
    let tokenGtoP;
    let tokenPtoG;
    let generateTokens;

    // get salt strings
    const saltForGtoP = configManager.getConfig(
      'slackbot:withProxy:saltForGtoP',
    );
    const saltForPtoG = configManager.getConfig(
      'slackbot:withProxy:saltForPtoG',
    );

    do {
      generateTokens = SlackAppIntegration.generateAccessTokens(
        saltForGtoP,
        saltForPtoG,
      );
      tokenGtoP = generateTokens[0];
      tokenPtoG = generateTokens[1];
      // biome-ignore lint/complexity/noThisInStatic: 'this' refers to the mongoose model here, not the class defined in this file
      duplicateTokens = await this.findOne({
        $or: [{ tokenGtoP }, { tokenPtoG }],
      });
    } while (duplicateTokens != null);

    return { tokenGtoP, tokenPtoG };
  }
}

const factory = (crowi) => {
  const modelExists = getModelSafely('SlackAppIntegration');
  if (modelExists != null) {
    return modelExists;
  }

  schema.loadClass(SlackAppIntegration);
  return mongoose.model('SlackAppIntegration', schema);
};

export default factory;
