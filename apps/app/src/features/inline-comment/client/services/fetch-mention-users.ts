import type { FetchUsersFn } from '@growi/editor/dist/client/services';

import { apiv3Get } from '~/client/util/apiv3-client';

/**
 * User search used for the `@` mention completion and the explicit mention
 * picker within the `inline-comment` feature. Deliberately not shared with
 * `CommentEditor.tsx`'s own local implementation.
 */
export const fetchMentionUsers: FetchUsersFn = async (query: string) => {
  try {
    const res = await apiv3Get<{
      paginateResult: { docs: { username: string; name: string }[] };
    }>('/users/', {
      searchText: query,
      sort: 'username',
      sortOrder: 'asc',
      page: 1,
    });
    return (res.data.paginateResult?.docs ?? []).map((user) => ({
      username: user.username,
      name: user.name,
    }));
  } catch {
    return [];
  }
};
