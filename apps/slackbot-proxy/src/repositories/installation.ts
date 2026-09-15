import { EntityRepository, Repository } from 'typeorm';

import { Installation } from '~/entities/installation';

@EntityRepository(Installation)
export class InstallationRepository extends Repository<Installation> {
  findByID(id: string): Promise<Installation | undefined> {
    return this.findOne(id);
  }

  // An org-wide install's stored row has no teamId, but a request from one of
  // its workspaces still carries that workspace's real teamId. Try teamId
  // first and fall back to the enterprise-wide row when it doesn't match.
  async findByTeamIdOrEnterpriseId(
    teamId?: string,
    enterpriseId?: string,
  ): Promise<Installation | undefined> {
    if (teamId != null) {
      const installation = await this.findOne({ where: { teamId } });
      if (installation != null) {
        return installation;
      }
    }
    if (enterpriseId != null) {
      return this.findOne({
        where: { enterpriseId, isEnterpriseInstall: true },
      });
    }
    return undefined;
  }

  // Falling back to the enterprise-wide row here would let a per-workspace
  // save overwrite it, so upsert must match the exact row for this install.
  findForUpsert(
    teamId?: string,
    enterpriseId?: string,
  ): Promise<Installation | undefined> {
    if (teamId != null) {
      return this.findOne({ where: { teamId } });
    }
    if (enterpriseId != null) {
      return this.findOne({
        where: { enterpriseId, isEnterpriseInstall: true },
      });
    }
    return Promise.resolve(undefined);
  }
}
