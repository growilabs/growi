// The read-only "list what this GROWI is paired to" half of the admin
// screen (task 9.1, Requirement 12.5: "設定画面で...どちらの連携がどのチャット
// サービスに繋がっているかを区別して示す"). Kept as a thin pure function
// separate from `admin-router.ts` so the query shape is unit-testable
// without going through Express (`.claude/rules/coding-style.md`'s "Pure
// Function Extraction").
//
// Deliberately does NOT call the proxy here -- per-relation capability
// (Requirement 1.3) and connection health (Requirement 1.4) are live network
// calls (`fetchCapabilities`/`fetchConnectionStatus`, task 7.1), fetched by
// the admin screen ONE RELATION AT A TIME from `admin-router.ts` so that one
// unreachable proxy does not fail the whole relation list.

import { ChatRelation } from '../models/chat-relation';

export interface AdminRelationListItem {
  readonly relationId: string;
  readonly platform: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly label: string | null;
  readonly state: 'active' | 'unpaired';
  readonly createdAt: string;
  readonly unpairedAt: string | null;
}

/**
 * Every relation this GROWI has ever paired with, newest first -- both
 * `active` and `unpaired` rows (an operator needs to see a disconnected
 * relation too, not only the live ones; `unpairRelation` never deletes the
 * row, see `pairing-service.ts`).
 */
export const listRelationsForAdmin = async (): Promise<
  AdminRelationListItem[]
> => {
  const relations = await ChatRelation.find({}).sort({ createdAt: -1 }).lean();

  return relations.map((relation) => ({
    relationId: relation.relationId,
    platform: relation.platform,
    workspaceId: relation.workspaceId,
    workspaceName: relation.workspaceName,
    label: relation.label,
    state: relation.state,
    createdAt: relation.createdAt.toISOString(),
    unpairedAt: relation.unpairedAt?.toISOString() ?? null,
  }));
};
