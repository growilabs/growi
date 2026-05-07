import type { GetServerSidePropsContext } from 'next';
import { describe, expect, it } from 'vitest';

import { getServerSideSearchConfigurationProps } from './search-configurations';

// Helper to build a minimal context with configurable crowi dependencies
const createMockContext = (opts: {
  isConfigured: boolean;
  isReachable?: boolean;
  extractorUri?: string | null;
  extractorToken?: string | null;
  isSearchScopeChildrenAsDefault?: boolean;
}): GetServerSidePropsContext => {
  const {
    isConfigured,
    isReachable = false,
    extractorUri = 'http://markitdown:8080',
    extractorToken = 'secret-token',
    isSearchScopeChildrenAsDefault = false,
  } = opts;

  const configMap: Record<string, unknown> = {
    'customize:isSearchScopeChildrenAsDefault': isSearchScopeChildrenAsDefault,
    'app:attachmentFullTextSearch:extractorUri': extractorUri,
    'app:attachmentFullTextSearch:extractorToken': extractorToken,
  };

  const configManager = {
    getConfig: (key: string) => configMap[key],
  };

  const searchService = {
    isConfigured,
    isReachable,
  };

  return {
    req: {
      crowi: {
        configManager,
        searchService,
      },
    } as never,
    res: {} as never,
    params: {},
    query: {},
    resolvedUrl: '/',
    locale: 'en',
  } as GetServerSidePropsContext;
};

describe('getServerSideSearchConfigurationProps', () => {
  it('returns isAttachmentFullTextSearchEnabled=false when searchService is not configured', async () => {
    const ctx = createMockContext({
      isConfigured: false,
      extractorUri: 'http://markitdown:8080',
      extractorToken: 'secret-token',
    });

    const result = await getServerSideSearchConfigurationProps(ctx);
    expect(result).toHaveProperty('props');
    const { props } = result as {
      props: { searchConfig: Record<string, unknown> };
    };
    expect(props.searchConfig.isAttachmentFullTextSearchEnabled).toBe(false);
  });

  it('returns isAttachmentFullTextSearchEnabled=false when extractorUri is null', async () => {
    const ctx = createMockContext({
      isConfigured: true,
      extractorUri: null,
      extractorToken: 'secret-token',
    });

    const result = await getServerSideSearchConfigurationProps(ctx);
    const { props } = result as {
      props: { searchConfig: Record<string, unknown> };
    };
    expect(props.searchConfig.isAttachmentFullTextSearchEnabled).toBe(false);
  });

  it('returns isAttachmentFullTextSearchEnabled=false when extractorUri is empty string', async () => {
    const ctx = createMockContext({
      isConfigured: true,
      extractorUri: '',
      extractorToken: 'secret-token',
    });

    const result = await getServerSideSearchConfigurationProps(ctx);
    const { props } = result as {
      props: { searchConfig: Record<string, unknown> };
    };
    expect(props.searchConfig.isAttachmentFullTextSearchEnabled).toBe(false);
  });

  it('returns isAttachmentFullTextSearchEnabled=false when extractorToken is null', async () => {
    const ctx = createMockContext({
      isConfigured: true,
      extractorUri: 'http://markitdown:8080',
      extractorToken: null,
    });

    const result = await getServerSideSearchConfigurationProps(ctx);
    const { props } = result as {
      props: { searchConfig: Record<string, unknown> };
    };
    expect(props.searchConfig.isAttachmentFullTextSearchEnabled).toBe(false);
  });

  it('returns isAttachmentFullTextSearchEnabled=false when extractorToken is empty string', async () => {
    const ctx = createMockContext({
      isConfigured: true,
      extractorUri: 'http://markitdown:8080',
      extractorToken: '',
    });

    const result = await getServerSideSearchConfigurationProps(ctx);
    const { props } = result as {
      props: { searchConfig: Record<string, unknown> };
    };
    expect(props.searchConfig.isAttachmentFullTextSearchEnabled).toBe(false);
  });

  it('returns isAttachmentFullTextSearchEnabled=true when all conditions are met', async () => {
    const ctx = createMockContext({
      isConfigured: true,
      extractorUri: 'http://markitdown:8080',
      extractorToken: 'secret-token',
    });

    const result = await getServerSideSearchConfigurationProps(ctx);
    const { props } = result as {
      props: { searchConfig: Record<string, unknown> };
    };
    expect(props.searchConfig.isAttachmentFullTextSearchEnabled).toBe(true);
  });

  it('does NOT include the extractorToken string value in SSR props', async () => {
    const secretToken = 'super-secret-api-token-12345';
    const ctx = createMockContext({
      isConfigured: true,
      extractorUri: 'http://markitdown:8080',
      extractorToken: secretToken,
    });

    const result = await getServerSideSearchConfigurationProps(ctx);
    const { props } = result as {
      props: { searchConfig: Record<string, unknown> };
    };

    // Serialize the entire props to a string and ensure the token value never appears
    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain(secretToken);
  });

  it('does NOT include the extractorUri string value in SSR props', async () => {
    const extractorUri = 'http://internal-markitdown-service:9999';
    const ctx = createMockContext({
      isConfigured: true,
      extractorUri,
      extractorToken: 'secret-token',
    });

    const result = await getServerSideSearchConfigurationProps(ctx);
    const { props } = result as {
      props: { searchConfig: Record<string, unknown> };
    };

    // Ensure the internal URI is also not exposed
    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain(extractorUri);
  });

  it('preserves existing search config fields', async () => {
    const ctx = createMockContext({
      isConfigured: true,
      isReachable: true,
      isSearchScopeChildrenAsDefault: true,
      extractorUri: 'http://markitdown:8080',
      extractorToken: 'secret-token',
    });

    const result = await getServerSideSearchConfigurationProps(ctx);
    const { props } = result as {
      props: { searchConfig: Record<string, unknown> };
    };
    expect(props.searchConfig.isSearchServiceConfigured).toBe(true);
    expect(props.searchConfig.isSearchServiceReachable).toBe(true);
    expect(props.searchConfig.isSearchScopeChildrenAsDefault).toBe(true);
  });
});
