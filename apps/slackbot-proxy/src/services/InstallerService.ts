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
          const teamIdOrEnterpriseId =
            slackInstallation.team?.id || slackInstallation.enterprise?.id;

          if (teamIdOrEnterpriseId == null) {
            throw new Error('teamId or enterpriseId is required.');
          }

          const existedInstallation =
            await repository.findByTeamIdOrEnterpriseId(teamIdOrEnterpriseId);

          if (existedInstallation != null) {
            existedInstallation.setData(slackInstallation);
            await repository.save(existedInstallation);
            return;
          }

          const installation = new Installation();
          installation.setData(slackInstallation);
          await repository.save(installation);
          return;
        },
        fetchInstallation: async (installQuery: InstallationQuery<boolean>) => {
          const id = installQuery.enterpriseId || installQuery.teamId;

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const installation = await repository.findByTeamIdOrEnterpriseId(id!);

          if (installation == null) {
            throw new Error('Failed fetching installation');
          }

          return installation.data;
        },
      },
    });
  }
}
