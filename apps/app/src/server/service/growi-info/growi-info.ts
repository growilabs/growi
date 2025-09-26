import * as os from 'node:os';

import type {
  IGrowiInfo,
  GrowiInfoOptions,
  IGrowiAdditionalInfoResult,
} from '@growi/core';
import type { IUser } from '@growi/core/dist/interfaces';
import { GrowiWikiType } from '@growi/core/dist/interfaces';
import { pathUtils } from '@growi/core/dist/utils';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import { IExternalAuthProviderType } from '~/interfaces/external-auth-provider';
import { Config } from '~/server/models/config';
import createPageModel from '~/server/models/page';
import { aclService } from '~/server/service/acl';
import { configManager } from '~/server/service/config-manager';
import { getGrowiVersion } from '~/utils/growi-version';

// Local preset for full additional info
const FULL_ADDITIONAL_INFO_OPTIONS = {
  includeAttachmentInfo: true,
  includeInstalledInfo: true,
  includeUserCountInfo: true,
  includePageCountInfo: true,
} as const;


export class GrowiInfoService {

  /**
   * get the site url
   *
   * If the config for the site url is not set, this returns a message "[The site URL is not set. Please set it!]".
   *
   * With version 3.2.3 and below, there is no config for the site URL, so the system always uses auto-generated site URL.
   * With version 3.2.4 to 3.3.4, the system uses the auto-generated site URL only if the config is not set.
   * With version 3.3.5 and above, the system use only a value from the config.
   */
  getSiteUrl(): string {
    const siteUrl = configManager.getConfig('app:siteUrl');
    if (siteUrl != null) {
      return pathUtils.removeTrailingSlash(siteUrl);
    }
    return siteUrl ?? '[The site URL is not set. Please set it!]';
  }

  /**
   * Get GROWI information
   */
  getGrowiInfo(): Promise<IGrowiInfo<undefined>>;

  /**
   * Get GROWI information with flexible options
   * @param options options to determine what additional information to include
   */
  getGrowiInfo<T extends GrowiInfoOptions>(options: T): Promise<IGrowiInfo<IGrowiAdditionalInfoResult<T>>>;

  /**
   * Get GROWI information with additional information (legacy)
   * @param includeAdditionalInfo whether to include additional information
   * @deprecated Use getGrowiInfo(options) instead
   */
  getGrowiInfo(includeAdditionalInfo: true): Promise<IGrowiInfo<IGrowiAdditionalInfoResult<typeof FULL_ADDITIONAL_INFO_OPTIONS>>>;

  async getGrowiInfo<T extends GrowiInfoOptions>(
      optionsOrLegacyFlag?: T | true,
  ): Promise<IGrowiInfo<IGrowiAdditionalInfoResult<T>> | IGrowiInfo<undefined> | IGrowiInfo<IGrowiAdditionalInfoResult<typeof FULL_ADDITIONAL_INFO_OPTIONS>>> {

    const appSiteUrl = this.getSiteUrl();

    const isGuestAllowedToRead = aclService.isGuestAllowedToRead();
    const wikiType = isGuestAllowedToRead ? GrowiWikiType.open : GrowiWikiType.closed;

    const baseInfo = {
      serviceInstanceId: configManager.getConfig('app:serviceInstanceId'),
      version: getGrowiVersion(),
      osInfo: {
        type: os.type(),
        platform: os.platform(),
        arch: os.arch(),
        totalmem: os.totalmem(),
      },
      appSiteUrl,
      type: configManager.getConfig('app:serviceType'),
      wikiType,
      deploymentType: configManager.getConfig('app:deploymentType'),
    } satisfies IGrowiInfo<undefined>;

    if (optionsOrLegacyFlag == null) {
      return baseInfo;
    }

    let options: GrowiInfoOptions;

    // Handle different parameter types
    if (typeof optionsOrLegacyFlag === 'boolean') {
      // Legacy boolean parameter
      options = optionsOrLegacyFlag ? FULL_ADDITIONAL_INFO_OPTIONS : {};
    }
    else {
      // GrowiInfoOptions parameter
      options = optionsOrLegacyFlag;
    }

    const additionalInfo = await this.getAdditionalInfoByOptions(options);

    if (!additionalInfo) {
      return baseInfo as IGrowiInfo<IGrowiAdditionalInfoResult<T>>;
    }

    return {
      ...baseInfo,
      additionalInfo,
    } as IGrowiInfo<IGrowiAdditionalInfoResult<T>>;
  }

  private async getAdditionalInfoByOptions<T extends GrowiInfoOptions>(options: T): Promise<IGrowiAdditionalInfoResult<T>> {
    const User = mongoose.model<IUser, Model<IUser>>('User');
    const Page = createPageModel(null);
    // Check if any option is enabled to determine if we should return additional info
    const hasAnyOption = options.includeAttachmentInfo || options.includeInstalledInfo || options.includeUserCountInfo || options.includePageCountInfo;

    if (!hasAnyOption) {
      return undefined as IGrowiAdditionalInfoResult<T>;
    }

    // Include attachment info (required for all additional info)
    const activeExternalAccountTypes: IExternalAuthProviderType[] = Object.values(IExternalAuthProviderType).filter((type) => {
      return configManager.getConfig(`security:passport-${type}:isEnabled`);
    });

    // Build result incrementally with proper typing
    const partialResult: Partial<{
      attachmentType: unknown;
      activeExternalAccountTypes: IExternalAuthProviderType[];
      installedAt: Date | null;
      installedAtByOldestUser: Date | null;
      currentUsersCount: number;
      currentActiveUsersCount: number;
      currentPagesCount: number;
    }> = {
      attachmentType: configManager.getConfig('app:fileUploadType'),
      activeExternalAccountTypes,
    };

    if (options.includeInstalledInfo) {
      // Get the oldest user who probably installed this GROWI.
      const user = await User.findOne({ createdAt: { $ne: null } }).sort({ createdAt: 1 });
      const installedAtByOldestUser = user ? user.createdAt : null;

      const appInstalledConfig = await Config.findOne({ key: 'app:installed' });
      const oldestConfig = await Config.findOne().sort({ createdAt: 1 });
      const installedAt = installedAtByOldestUser ?? appInstalledConfig?.createdAt ?? oldestConfig?.createdAt ?? null;

      partialResult.installedAt = installedAt;
      partialResult.installedAtByOldestUser = installedAtByOldestUser;
    }

    if (options.includeUserCountInfo) {
      const currentUsersCount = await User.countDocuments();
      const currentActiveUsersCount = await (User as unknown as { countActiveUsers: () => Promise<number> }).countActiveUsers();

      partialResult.currentUsersCount = currentUsersCount;
      partialResult.currentActiveUsersCount = currentActiveUsersCount;
    }

    if (options.includePageCountInfo) {
      const currentPagesCount = await Page.countDocuments();
      partialResult.currentPagesCount = currentPagesCount;
    }

    return partialResult as IGrowiAdditionalInfoResult<T>;
  }

}

export const growiInfoService = new GrowiInfoService();
