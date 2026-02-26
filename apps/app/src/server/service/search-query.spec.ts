import { vi } from 'vitest';

import { configManager } from '~/server/service/config-manager/config-manager';

import NamedQuery from '../models/named-query';
import SearchService from './search';

vi.mock('~/server/models/named-query', () => {
  const mockModel = {
    findOne: vi.fn(),
  };
  return {
    NamedQuery: mockModel,
    default: mockModel,
  };
});

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

  it('should contain /user in the not_prefix query when user pages are disabled', async () => {
    vi.mocked(configManager.getConfig).mockReturnValue(true);

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

  it('should contain /user in the not_prefix even when search query is not a user page', async () => {
    vi.mocked(configManager.getConfig).mockReturnValue(true);

    const result = await (searchService as any).parseSearchQuery(
      '/new-task',
      null,
    );

    expect(configManager.getConfig).toHaveBeenCalledWith(
      'security:disableUserPages',
    );
    expect(result.terms.not_prefix).toContain('/user');
    expect(result.terms.prefix).toHaveLength(0);
  });

  it('should add specific user prefixes in the query when user pages are enabled', async () => {
    vi.mocked(configManager.getConfig).mockReturnValue(false);

    const result = await (searchService as any).parseSearchQuery(
      '/user/settings',
      null,
    );

    expect(configManager.getConfig).toHaveBeenCalledWith(
      'security:disableUserPages',
    );
    expect(result.terms.not_prefix).not.toContain('/user');
    expect(result.terms.not_prefix).not.toContain('/user/settings');
    expect(result.terms.match).toContain('/user/settings');
  });

  it('should filter user pages even when resolved from a named query alias', async () => {
    vi.mocked(configManager.getConfig).mockReturnValue(true);

    const shortcutName = 'my-shortcut';
    const aliasPath = '/user/my-private-page';

    // Mock the DB response
    vi.mocked(NamedQuery.findOne).mockResolvedValue({
      name: shortcutName,
      aliasOf: aliasPath,
    } as any);

    const result = await (searchService as any).parseSearchQuery(
      'dummy',
      shortcutName,
    );

    expect(configManager.getConfig).toHaveBeenCalledWith(
      'security:disableUserPages',
    );
    expect(result.terms.not_prefix).toContain('/user');
    expect(result.terms.match).toContain('/user/my-private-page');
  });
});
