import assert from 'node:assert';
import type { IPage, IUser } from '@growi/core/dist/interfaces';
import { isPopulated } from '@growi/core/dist/interfaces';

import { serializePageSecurely } from '../serializers/page-serializer';

/**
 * Server-to-client message VO
 */
export class S2cMessagePageUpdated {
  pageId: string;

  revisionId: string;

  revisionBody: string;

  revisionUpdateAt: Date;

  revisionOrigin: string | undefined;

  remoteLastUpdateUser?: IUser;

  lastUpdateUsername?: string;

  constructor(page: IPage, user?: IUser) {
    const serializedPage = serializePageSecurely(page);

    const { _id, revision, updatedAt } = serializedPage;

    assert(page.revision != null && isPopulated(page.revision));

    this.pageId = _id;
    this.revisionId = revision;
    this.revisionBody = page.revision.body;
    this.revisionUpdateAt = updatedAt;
    this.revisionOrigin = page.revision.origin;

    if (user != null) {
      this.remoteLastUpdateUser = user;
      // TODO remove lastUpdateUsername and refactor parts that lastUpdateUsername is used
      this.lastUpdateUsername = user.name;
    }
  }
}

/**
 * Server-to-client message VO for page seenUsers update
 */
export class S2cMessagePageSeenUsersUpdated {
  pageId: string;

  seenUserIds: string[];

  seenUsersCount: number;

  constructor(page: IPage) {
    const serializedPage = serializePageSecurely(page);

    this.pageId = serializedPage._id;
    this.seenUserIds = serializedPage.seenUsers
      .slice(0, 15)
      .map((id: any) => (typeof id === 'string' ? id : id.toString()));
    this.seenUsersCount = serializedPage.seenUsers.length;
  }
}
