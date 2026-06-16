import { mock } from 'vitest-mock-extended';

import type { ESQueryTerms } from '~/server/interfaces/search';
import type { SocketIoService } from '~/server/service/socket-io/socket-io';

import { configManager } from '../config-manager';
import ElasticsearchDelegator from './elasticsearch';

export const createMockESQueryTerms = (
  overrides: Partial<ESQueryTerms> = {},
): ESQueryTerms => {
  return {
    match: [],
    not_match: [],
    phrase: [],
    not_phrase: [],
    prefix: [],
    not_prefix: [],
    tag: [],
    not_tag: [],
    author: [],
    not_author: [],
    editor: [],
    not_editor: [],
    group: [],
    not_group: [],
    ...overrides,
  };
};

vi.mock('~/server/service/config-manager/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
  default: { getConfig: vi.fn() },
}));
const socket = mock<SocketIoService>();

let delegator: ElasticsearchDelegator;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
    return key === 'app:elasticsearchVersion' ? 9 : undefined;
  });

  delegator = new ElasticsearchDelegator(socket);
});

describe('appendCriteriaForGroupFilter()', () => {
  it('should push the correct group terms into the filter query', () => {
    const terms = createMockESQueryTerms({ group: ['bob'] });
    const query = delegator.createSearchQuery();

    const resolvedFilterData = {
      groupIds: ['id1'],
      notGroupIds: [],
    };

    delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

    expect(query.body?.query.bool?.filter).toContainEqual({
      terms: { granted_groups: ['id1'] },
    });
  });
});
