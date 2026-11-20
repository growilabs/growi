import * as apiv3Client from '~/client/util/apiv3-client';

import { fetchMentionUsers } from './fetch-mention-users';

vi.mock('~/client/util/apiv3-client');
const mockedApiv3Get = vi.mocked(apiv3Client.apiv3Get);

describe('fetchMentionUsers', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('maps the paginated docs to { username, name } on a successful response', async () => {
    mockedApiv3Get.mockResolvedValueOnce({
      data: {
        paginateResult: {
          docs: [
            { username: 'alice', name: 'Alice Example' },
            { username: 'bob', name: 'Bob Example' },
          ],
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal AxiosResponse stub for this test
    } as any);

    const result = await fetchMentionUsers('al');

    expect(result).toEqual([
      { username: 'alice', name: 'Alice Example' },
      { username: 'bob', name: 'Bob Example' },
    ]);
    expect(mockedApiv3Get).toHaveBeenCalledWith('/users/', {
      searchText: 'al',
      sort: 'username',
      sortOrder: 'asc',
      page: 1,
    });
  });

  it('returns an empty array when the API call rejects', async () => {
    mockedApiv3Get.mockRejectedValueOnce(new Error('network error'));

    const result = await fetchMentionUsers('al');

    expect(result).toEqual([]);
  });
});
