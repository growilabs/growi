import type { GetServerSideProps, GetServerSidePropsContext } from 'next';

import type { CrowiRequest } from '~/interfaces/crowi-request';

import type { AiConfigurationProps } from '../types';

export const getServerSideAiConfigProps: GetServerSideProps<
  AiConfigurationProps
  // biome-ignore lint/suspicious/useAwait: no-problem parallel execution not needed
> = async (context: GetServerSidePropsContext) => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;

  return {
    props: {
      // The sidebar AI affordance must reflect AI *usability*, not just the
      // on/off toggle: an enabled-but-unconfigured provider would otherwise
      // surface a dead entry point. crowi.isAiReady() = enabled && configured is
      // the same verdict the mastra route guard uses, keeping UI and API aligned.
      // This hydrates aiEnabledAtom (whose meaning is "AI ready").
      //
      // Routed through crowi (not a direct isAiReady import) on purpose: this
      // runs in the Next SSR realm, where a directly-imported configManager is a
      // separate, never-loaded instance. crowi.isAiReady() executes in the
      // Express realm against the loaded config, and importing the server-only
      // verdict module here would also leak the mongoose Config model into the
      // client bundle.
      aiEnabled: crowi.isAiReady(),
    },
  };
};
