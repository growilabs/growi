// How to decide "is this actor a workspace/installation admin?" for each of
// the 4 chat services -- declared as data, next to the capability table,
// exactly as design.md requires: "調べ方はサービスごとに違うので、能力表の
// 隣にデータとして持つ...`if (platform === ...)` と書かない".
//
// This is a lookup table describing WHICH field(s)/role values each
// service's admin check must look at -- it is deliberately NOT the actual
// per-service API call. Making the real `isAdmin(...)` call against each
// platform's API is later work (whichever task implements it reads this
// table to know which field to check, rather than branching on
// `platform`).
import type { PlatformName } from '@growi/chat';

/**
 * `fields` names the role/permission value(s) that, if the actor has any
 * one of them, mean "is an admin" for this service. `description` is the
 * human-readable form of the same fact, for logs/docs.
 */
export interface AdminCheckMethod {
  readonly description: string;
  readonly fields: ReadonlyArray<string>;
}

/** design.md's 管理者かどうかの調べ方 table, transcribed verbatim. */
export const ADMIN_CHECK_TABLE: Readonly<
  Record<PlatformName, AdminCheckMethod>
> = {
  slack: {
    description: "user info's is_admin or is_owner",
    fields: ['is_admin', 'is_owner'],
  },
  discord: {
    description: 'guild permission bits: ADMINISTRATOR or MANAGE_GUILD',
    fields: ['ADMINISTRATOR', 'MANAGE_GUILD'],
  },
  teams: {
    description: 'membership role is owner',
    fields: ['owner'],
  },
  mattermost: {
    description:
      "user's role is system_admin, or team_admin on the target team",
    fields: ['system_admin', 'team_admin'],
  },
};
