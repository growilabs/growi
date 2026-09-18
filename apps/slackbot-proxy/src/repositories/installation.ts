import { EntityRepository, Repository } from 'typeorm';

import { Installation } from '~/entities/installation';

@EntityRepository(Installation)
export class InstallationRepository extends Repository<Installation> {
  findByID(id: string): Promise<Installation | undefined> {
    return this.findOne(id);
  }

  // An org-wide install covers every workspace of its organization, so it is
  // tried first and the workspace-level row is only reached when the
  // organization has none. Slack keeps both rows alive -- a workspace-level
  // install stays valid after an org-wide one, and a workspace installed
  // afterwards inherits the org-wide scopes -- so coexistence is permanent and
  // the org-wide token is the one to use once it exists.
  // https://docs.slack.dev/enterprise/migrating-to-organization-wide-deployment
  //
  // isEnterpriseInstall reflects Slack's own signal for this request, not our
  // stored data, which could be momentarily stale right after an org-wide
  // install. When Slack says false, skip the org-wide lookup even if
  // enterpriseId is present. Callers without this signal simply omit it.
  async findByTeamIdOrEnterpriseId(
    teamId?: string,
    enterpriseId?: string,
    isEnterpriseInstall?: boolean,
  ): Promise<Installation | undefined> {
    if (enterpriseId != null && isEnterpriseInstall !== false) {
      const orgWideInstallation = await this.findOne({
        where: { enterpriseId, isEnterpriseInstall: true },
      });
      if (orgWideInstallation != null) {
        return orgWideInstallation;
      }
    }
    if (teamId != null) {
      return this.findOne({ where: { teamId } });
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
