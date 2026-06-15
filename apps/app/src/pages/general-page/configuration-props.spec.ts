// --- Mock boundary ---------------------------------------------------------
//
// getServerSideGeneralPageProps builds the SSR props that hydrate the client's
// aiEnabledAtom, which gates the sidebar AI affordance. The contract under test
// is the SOURCE of serverConfig.aiEnabled: it must mirror crowi.isAiReady()
// (= enabled && configured), NOT the raw app:aiEnabled toggle. We stub
// crowi.isAiReady() on the request-scoped crowi and assert the prop tracks its
// return value, independent of any config key.
//
// Sourcing via crowi (rather than a direct isAiReady import) is itself part of
// the contract: this builder runs in the Next SSR realm, where a directly
// imported configManager is a separate, never-loaded instance. crowi.isAiReady()
// runs in the Express realm against the loaded config. Asserting the prop comes
// from crowi.isAiReady() guards against regressing to either the raw toggle or a
// direct (realm-unsafe) import.
import type { GetServerSidePropsContext } from 'next';
import { mockDeep } from 'vitest-mock-extended';

import type { CrowiRequest } from '~/interfaces/crowi-request';

import { getServerSideGeneralPageProps } from './configuration-props';

// mockDeep recursively stubs the nested crowi graph the builder walks
// (crowi.configManager.getConfig, crowi.aclService.isAclEnabled, the upload /
// slack / passport services, and crowi.isAiReady). Only crowi.isAiReady drives
// the assertion here; the remaining props are irrelevant to this test.
const buildContext = (isAiReady: boolean): GetServerSidePropsContext => {
  const req = mockDeep<CrowiRequest>();
  req.crowi.isAiReady.mockReturnValue(isAiReady);
  const context = mockDeep<GetServerSidePropsContext>();
  // The builder narrows context.req to CrowiRequest internally (configuration-props.ts:59);
  // localize the cast to the single req field rather than the whole context object.
  context.req = req as unknown as GetServerSidePropsContext['req'];
  return context;
};

const getAiEnabledProp = async (isAiReady: boolean): Promise<boolean> => {
  const result = await getServerSideGeneralPageProps(buildContext(isAiReady));
  if (!('props' in result)) {
    throw new Error('expected a props result');
  }
  const props = await result.props;
  return props.serverConfig.aiEnabled;
};

describe('getServerSideGeneralPageProps - aiEnabled supply (Req 7.4)', () => {
  it('supplies aiEnabled=true when AI is ready (enabled && configured)', async () => {
    expect(await getAiEnabledProp(true)).toBe(true);
  });

  it('supplies aiEnabled=false when AI is not ready (e.g. enabled but unconfigured)', async () => {
    expect(await getAiEnabledProp(false)).toBe(false);
  });
});
