import { EntityRepository, Repository } from 'typeorm';

import { Installation } from '~/entities/installation';

@EntityRepository(Installation)
export class InstallationRepository extends Repository<Installation> {
  findByID(id: string): Promise<Installation | undefined> {
    return this.findOne(id);
  }

  async findByTeamIdOrEnterpriseId(
    teamIdOrEnterpriseId: string,
  ): Promise<Installation | undefined> {
    return this.findOne({
      where: [
        { teamId: teamIdOrEnterpriseId },
        { enterpriseId: teamIdOrEnterpriseId, isEnterpriseInstall: true },
      ],
    });
  }
}
