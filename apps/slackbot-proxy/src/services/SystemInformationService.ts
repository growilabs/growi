import { Inject, Service } from '@tsed/di';
import readPkgUp from 'read-pkg-up';

import { SystemInformation } from '~/entities/system-information';
import { SystemInformationRepository } from '~/repositories/system-information';
import loggerFactory from '~/utils/logger';

import { RelationsService } from './RelationsService';

const logger = loggerFactory(
  'slackbot-proxy:services:SystemInformationService',
);

@Service()
export class SystemInformationService {
  @Inject()
  private readonly repository: SystemInformationRepository;

  @Inject()
  relationsService: RelationsService;

  async $onInit(): Promise<void> {
    await this.onInitCheckVersion();
  }

  /*
   * updates version or create new system information record
   * make all relations expired if the previous version was <= 4.4.8
   */
  async onInitCheckVersion(): Promise<void> {
    const readPkgUpResult = await readPkgUp();
    const proxyVersion = readPkgUpResult?.packageJson.version;
    if (proxyVersion == null) return logger.error('version is null');

    const systemInfo: SystemInformation | undefined =
      await this.repository.findOne();

    // return if the version didn't change
    if (systemInfo != null && systemInfo.version === proxyVersion) {
      return;
    }

    await this.repository.createOrUpdateUniqueRecordWithVersion(
      systemInfo,
      proxyVersion,
    );

    // make relations expired
    await this.relationsService.resetAllExpiredAtCommands();
  }
}
