import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';
import { useHydrateAtoms } from 'jotai/utils';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import { aiEnabledAtom } from '~/states/server-configurations';

import type { NextPageWithLayout } from '../_app.page';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const AiIntegration = dynamic(
  () =>
    import(
      // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
      '~/features/openai/client/components/AiIntegration/AiIntegration'
    ).then((mod) => mod.AiIntegration),
  { ssr: false },
);
const AiIntegrationDisableMode = dynamic(
  () =>
    import(
      // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
      '~/features/openai/client/components/AiIntegration/AiIntegrationDisableMode'
    ).then((mod) => mod.AiIntegrationDisableMode),
  { ssr: false },
);

type Props = AdminCommonProps & { aiEnabled: boolean };

const AdminAiIntegrationPage: NextPageWithLayout<Props> = ({
  aiEnabled,
}: Props) => {
  // Hydrate server-provided prop into atom (runs only on mount / hydration)
  useHydrateAtoms([[aiEnabledAtom, aiEnabled]], {
    dangerouslyForceHydrate: true,
  });
  return aiEnabled ? <AiIntegration /> : <AiIntegrationDisableMode />;
};

AdminAiIntegrationPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('ai_integration.ai_integration'),
});

export const getServerSideProps: GetServerSideProps = async (context) => {
  const baseResult = await getServerSideAdminCommonProps(context);
  if (!('props' in baseResult)) return baseResult; // redirect / notFound pass-through

  const req = context.req as CrowiRequest;
  const { configManager } = req.crowi;
  const aiEnabled = configManager.getConfig('app:aiEnabled');

  const aiPropsResult = { props: { aiEnabled } } as const;
  return mergeGetServerSidePropsResults(baseResult, aiPropsResult);
};

export default AdminAiIntegrationPage;
