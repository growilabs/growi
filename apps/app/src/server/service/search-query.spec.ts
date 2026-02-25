import { vi } from 'vitest';

import { configManager } from '~/server/service/config-manager/config-manager';

import SearchService from './search';

// Intercept the singleton import inside the search service
vi.mock('~/server/service/config-manager/config-manager', () => {
  return {
    default: {
      getConfig: vi.fn(),
    },
    configManager: {
      getConfig: vi.fn(),
    },
  };
});

describe('searchParseQuery()', () => {
  let searchService: SearchService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock the internal generators to skip constructor side-effects
    vi.spyOn(
      SearchService.prototype,
      'generateFullTextSearchDelegator',
    ).mockReturnValue({
      init: vi.fn(),
    } as any);
    vi.spyOn(SearchService.prototype, 'generateNQDelegators').mockReturnValue(
      {} as any,
    );
    vi.spyOn(SearchService.prototype, 'registerUpdateEvent').mockImplementation(
      () => {},
    );
    vi.spyOn(SearchService.prototype, 'isConfigured', 'get').mockReturnValue(
      false,
    );

    const mockCrowi = { configManager } as any;
    searchService = new SearchService(mockCrowi);
  });

  it('should contain /user in the query not_prefix when user pages are disabled', async () => {
    // Mock disableUserPages value
    vi.mocked(configManager.getConfig).mockImplementation(() => {
      return true;
    });

    const result = await (searchService as any).parseSearchQuery(
      '/user/settings',
      null,
    );

    expect(configManager.getConfig).toHaveBeenCalledWith(
      'security:disableUserPages',
    );
    expect(result.terms.not_prefix).toContain('/user');
    expect(result.terms.prefix).toHaveLength(0);
  });

  it('should add specific user prefixes in the query when user pages are enabled', async () => {
    // Mock disableUserPages value
    vi.mocked(configManager.getConfig).mockImplementation(() => {
      return false;
    });

    const result = await (searchService as any).parseSearchQuery(
      '/user/settings',
      null,
    );

    expect(configManager.getConfig).toHaveBeenCalledWith(
      'security:disableUserPages',
    );
    expect(result.terms.not_prefix).not.toContain('/user');
    expect(result.terms.match).toContain('/user/settings');
  });
});
