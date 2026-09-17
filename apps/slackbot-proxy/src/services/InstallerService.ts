import {
  InstallationQuery,
  InstallProvider,
  Installation as SlackInstallation,
} from '@slack/oauth';
import { Inject, Service } from '@tsed/di';

import { Installation } from '~/entities/installation';
import { InstallationRepository } from '~/repositories/installation';

@Service()
export class InstallerService {
  installer: InstallProvider;

  @Inject()
  private readonly repository: InstallationRepository;

  $onInit(): Promise<any> | void {
    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    const stateSecret = process.env.SLACK_INSTALLPROVIDER_STATE_SECRET;

    if (clientId === undefined) {
      throw new Error(
        "The environment variable 'SLACK_CLIENT_ID' must be defined.",
      );
    }
    if (clientSecret === undefined) {
      throw new Error(
        "The environment variable 'SLACK_CLIENT_SECRET' must be defined.",
      );
    }

    const { repository } = this;

    this.installer = new InstallProvider({
      clientId,
      clientSecret,
      stateSecret,
      legacyStateVerification: true,
      installationStore: {
        // upsert
        storeInstallation: async (
          slackInstallation: SlackInstallation<'v1' | 'v2', boolean>,
        ) => {
          const teamId = slackInstallation.team?.id;
          const enterpriseId = slackInstallation.enterprise?.id;

          if (teamId == null && enterpriseId == null) {
            throw new Error('teamId or enterpriseId is required.');
          }

          const existedInstallation = await repository.findForUpsert(
            teamId,
            enterpriseId,
          );

          const installation = existedInstallation ?? new Installation();
          installation.setData(slackInstallation);
          await repository.save(installation);

          if (slackInstallation.isEnterpriseInstall && enterpriseId != null) {
            await repository.deactivateWorkspaceLevelInstallations(
              enterpriseId,
            );
          }
        },
        fetchInstallation: async (installQuery: InstallationQuery<boolean>) => {
          const installation = await repository.findByTeamIdOrEnterpriseId(
            installQuery.teamId ?? undefined,
            installQuery.enterpriseId ?? undefined,
          );

          if (installation == null) {
            throw new Error('Failed fetching installation');
          }

          return installation.data;
        },
      },
    });
  }
}
