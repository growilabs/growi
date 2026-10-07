import { EntityRepository, Repository } from 'typeorm';

import { SystemInformation } from '~/entities/system-information';

@EntityRepository(SystemInformation)
export class SystemInformationRepository extends Repository<SystemInformation> {
  async createOrUpdateUniqueRecordWithVersion(
    systemInfo: SystemInformation | undefined,
    proxyVersion: string,
  ): Promise<void> {
    // update the version if it exists
    if (systemInfo != null) {
      systemInfo.setVersion(proxyVersion);
      await this.save(systemInfo);
      return;
    }
    // create new system information object if it didn't exist
    const newSystemInfo = new SystemInformation();
    newSystemInfo.setVersion(proxyVersion);
    await this.save(newSystemInfo);
  }
}
