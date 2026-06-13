// --- Mock boundary ---------------------------------------------------------
//
// getServerSideGeneralPageProps builds the SSR props that hydrate the client's
// aiEnabledAtom, which gates the sidebar AI affordance. The contract under test
// is the SOURCE of serverConfig.aiEnabled: it must mirror the server-side AI
// readiness verdict isAiReady() (= enabled && configured), NOT the raw
// app:aiEnabled toggle. So we mock isAiReady() and assert the prop tracks its
// return value, independent of any config key. This is the regression we must
// catch: reverting the source to configManager.getConfig('app:aiEnabled') would
// report aiEnabled=true for an enabled-but-unconfigured provider (Req 7.4).
const { isAiReady } = vi.hoisted(() => ({
  isAiReady: vi.fn(),
}));

vi.mock('~/features/mastra/server/services/is-ai-configured', () => ({
  isAiReady,
}));

import type { GetServerSidePropsContext } from 'next';
import { mockDeep } from 'vitest-mock-extended';

import type { CrowiRequest } from '~/interfaces/crowi-request';

import { getServerSideGeneralPageProps } from './configuration-props';

// mockDeep recursively stubs the nested crowi graph the builder walks
// (crowi.configManager.getConfig, crowi.aclService.isAclEnabled, the upload /
// slack / passport services). We override nothing: aiEnabled's source no longer
// touches any of these, and the remaining props are irrelevant to this test.
const buildContext = (): GetServerSidePropsContext =>
  ({ req: mockDeep<CrowiRequest>() }) as unknown as GetServerSidePropsContext;

const getAiEnabledProp = async (): Promise<boolean> => {
  const result = await getServerSideGeneralPageProps(buildContext());
  if (!('props' in result)) {
    throw new Error('expected a props result');
  }
  const props = await result.props;
  return props.serverConfig.aiEnabled;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getServerSideGeneralPageProps - aiEnabled supply (Req 7.4)', () => {
  it('supplies aiEnabled=true when AI is ready (enabled && configured)', async () => {
    isAiReady.mockReturnValue(true);

    expect(await getAiEnabledProp()).toBe(true);
  });

  it('supplies aiEnabled=false when AI is not ready (e.g. enabled but unconfigured)', async () => {
    isAiReady.mockReturnValue(false);

    expect(await getAiEnabledProp()).toBe(false);
  });
});
