import { PageWriteGrant } from '@growi/core';
import type { Ref } from '@growi/core/dist/interfaces';

import type { PopulatedGrantedGroup } from '~/interfaces/page-grant';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { PageDocument } from '~/server/models/page';

function toStringId(id: unknown): string {
  return (id as any)?.toString?.() ?? String(id);
}

export type CanEditParams = {
  user:
    | ({ _id: ObjectIdLike } & { admin?: boolean; readOnly?: boolean })
    | null;
  page: Pick<
    PageDocument,
    'writeGrant' | 'writeGrantedUsers' | 'writeGrantedGroups' | 'readOnlyUserIds'
  >;
  userRelatedGroups?: PopulatedGrantedGroup[];
};

export function canEditPage({
  user,
  page,
  userRelatedGroups = [],
}: CanEditParams): boolean {
  if (user == null) return false;
  if (user.admin) return true;
  if (user.readOnly) return false;

  // Check per-page readOnly
  const readOnlyUserIds = page.readOnlyUserIds;
  if (readOnlyUserIds != null && readOnlyUserIds.length > 0) {
    const isReadOnlyForPage = readOnlyUserIds.some((readOnlyUserId) => {
      const id = toStringId(readOnlyUserId);
      return id === toStringId(user._id);
    });
    if (isReadOnlyForPage) return false;
  }

  const writeGrant = page.writeGrant ?? PageWriteGrant.WRITE_GRANT_PUBLIC;

  switch (writeGrant) {
    case PageWriteGrant.WRITE_GRANT_PUBLIC:
      return true;
    case PageWriteGrant.WRITE_GRANT_OWNER:
      return (page.writeGrantedUsers ?? []).some((u) => {
        const id = toStringId(u);
        return id === toStringId(user._id);
      });
    case PageWriteGrant.WRITE_GRANT_USER_GROUP: {
      const grantedGroupIds = (page.writeGrantedGroups ?? []).map((g) =>
        toStringId(g.item),
      );
      const userGroupIds = userRelatedGroups.map((g) =>
        toStringId(g.item._id ?? g.item),
      );
      return grantedGroupIds.some((id) => userGroupIds.includes(id));
    }
    default:
      return false;
  }
}
