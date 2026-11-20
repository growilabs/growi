// --- Mock boundary ---------------------------------------------------------
//
// getServerSideCommonInitialProps builds the SSR props that hydrate global
// atoms on every page; aiEnabled among them gates the sidebar AI affordance.
// The contract under test is the SOURCE of aiEnabled: it must mirror
// crowi.isAiReady() (= enabled && configured), NOT the raw app:aiEnabled toggle.
// We stub crowi.isAiReady() on the request-scoped crowi and assert the prop
// tracks its return value, independent of any config key.
//
// Sourcing via crowi (rather than a direct isAiReady import) is itself part of
// the contract: this builder runs in the Next SSR realm, where a directly
// imported configManager is a separate, never-loaded instance. crowi.isAiReady()
// runs in the Express realm against the loaded config. Asserting the prop comes
// from crowi.isAiReady() guards against regressing to either the raw toggle or a
// direct (realm-unsafe) import.
import type { GetServerSidePropsContext } from 'next';
import { mock, mockDeep } from 'vitest-mock-extended';

import type { CrowiRequest } from '~/interfaces/crowi-request';

import { getServerSideCommonInitialProps } from './commons';

// mockDeep recursively stubs the nested crowi graph the builder walks
// (appService, configManager, attachmentService, customizeService,
// growiInfoService and crowi.isAiReady). Only crowi.isAiReady drives the
// assertion here; the remaining props are irrelevant to this test.
const buildContext = (
  isAiReady: boolean,
  // Optional value for the raw app:aiEnabled toggle. Used to prove the prop
  // sources from isAiReady() and NOT this key (see the discriminating test).
  rawAiEnabledToggle?: boolean,
): GetServerSidePropsContext => {
  const req = mockDeep<CrowiRequest>();
  req.crowi.isAiReady.mockReturnValue(isAiReady);
  if (rawAiEnabledToggle != null) {
    req.crowi.configManager.getConfig.mockImplementation((key) =>
      key === 'app:aiEnabled' ? rawAiEnabledToggle : undefined,
    );
  }
  // The builder narrows context.req to CrowiRequest internally; localize the
  // cast to the single req field rather than the whole context object.
  return mock<GetServerSidePropsContext>({
    req: req as unknown as GetServerSidePropsContext['req'],
  });
};

const getAiEnabledProp = async (
  isAiReady: boolean,
  rawAiEnabledToggle?: boolean,
): Promise<boolean> => {
  const result = await getServerSideCommonInitialProps(
    buildContext(isAiReady, rawAiEnabledToggle),
  );
  if (!('props' in result)) {
    throw new Error('expected a props result');
  }
  const props = await result.props;
  return props.aiEnabled;
};

describe('getServerSideCommonInitialProps - aiEnabled supply', () => {
  it('supplies aiEnabled=true when AI is ready (enabled && configured)', async () => {
    expect(await getAiEnabledProp(true)).toBe(true);
  });

  it('supplies aiEnabled=false when AI is not ready (e.g. enabled but unconfigured)', async () => {
    expect(await getAiEnabledProp(false)).toBe(false);
  });

  it('mirrors isAiReady(), not the raw app:aiEnabled toggle (toggle on but not ready)', async () => {
    // The raw app:aiEnabled key is true, but isAiReady() (= enabled && configured)
    // is false. The prop must follow isAiReady(), proving it never reads the toggle.
    expect(await getAiEnabledProp(false, true)).toBe(false);
  });
});
