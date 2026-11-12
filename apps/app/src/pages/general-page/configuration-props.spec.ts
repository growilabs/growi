import type { GetServerSidePropsContext } from 'next';
import { mock } from 'vitest-mock-extended';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { RendererConfig } from '~/interfaces/services/renderer';

import {
  getServerSideRendererConfigProps,
  getServerSideShareLinkRendererConfigProps,
} from './configuration-props';

const buildContext = (
  configs: Record<string, unknown>,
): GetServerSidePropsContext => {
  const req = mock<CrowiRequest>({
    crowi: {
      configManager: {
        // The generic getConfig signature cannot be satisfied by a plain lookup table.
        getConfig: vi.fn((key: string) => configs[key] as never),
      },
    },
  });
  return mock<GetServerSidePropsContext>({ req });
};

const readRendererConfig = async (
  getProps: typeof getServerSideRendererConfigProps,
  configs: Record<string, unknown>,
): Promise<RendererConfig> => {
  const result = await getProps(buildContext(configs));
  if (!('props' in result)) {
    throw new Error('expected props');
  }
  return (await result.props).rendererConfig;
};

describe('rendererConfig.plantumlHttpMethod', () => {
  it.each([
    [
      'unset with the public server',
      'https://www.plantuml.com/plantuml',
      undefined,
      'get',
    ],
    [
      'unset with a self-hosted server',
      'http://localhost:8080/plantuml',
      undefined,
      'post',
    ],
    [
      'forced to get with a self-hosted server',
      'http://localhost:8080/plantuml',
      'get',
      'get',
    ],
  ])('is resolved from the config (%s)', async (_label, uri, method, expected) => {
    const rendererConfig = await readRendererConfig(
      getServerSideRendererConfigProps,
      { 'app:plantumlUri': uri, 'app:plantumlHttpMethod': method },
    );
    expect(rendererConfig.plantumlHttpMethod).toBe(expected);
  });

  it('is also provided to shared link pages', async () => {
    const rendererConfig = await readRendererConfig(
      getServerSideShareLinkRendererConfigProps,
      {
        'app:plantumlUri': 'http://localhost:8080/plantuml',
        'app:plantumlHttpMethod': undefined,
      },
    );
    expect(rendererConfig.isSharedPage).toBe(true);
    expect(rendererConfig.plantumlHttpMethod).toBe('post');
  });
});
