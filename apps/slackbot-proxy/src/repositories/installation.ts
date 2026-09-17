import { EntityRepository, IsNull, Repository } from 'typeorm';

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
      const installation = await this.findOne({
        where: { teamId, deactivatedAt: IsNull() },
      });
      if (installation != null) {
        return installation;
      }
    }
    if (enterpriseId != null) {
      return this.findOne({
        where: {
          enterpriseId,
          isEnterpriseInstall: true,
          deactivatedAt: IsNull(),
        },
      });
    }
    return undefined;
  }

  // Falling back to the enterprise-wide row here would let a per-workspace
  // save overwrite it, so upsert must match the exact row for this install.
  // Deactivated rows are included on purpose: re-installing on a workspace
  // reuses its row, which restores the relations that were registered on it.
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

  // An org-wide install supersedes every workspace-level install under the same
  // organization. Their rows are kept rather than deleted so that re-installing
  // on a workspace restores the relations registered on it.
  async deactivateWorkspaceLevelInstallations(
    enterpriseId: string,
  ): Promise<void> {
    await this.createQueryBuilder()
      .update()
      .set({ deactivatedAt: new Date() })
      .where('enterpriseId = :enterpriseId', { enterpriseId })
      .andWhere('isEnterpriseInstall = :isEnterpriseInstall', {
        isEnterpriseInstall: false,
      })
      .andWhere('deactivatedAt IS NULL')
      .execute();
  }
}
