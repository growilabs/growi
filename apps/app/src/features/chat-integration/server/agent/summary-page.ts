// Creating the page a conversation summary goes to (design.md SummaryPage).

import type { AgentFailureReason } from '@growi/chat';

import type Crowi from '~/server/crowi';

import {
  type CommandAuditContext,
  performWriteCommand,
  type WriteActor,
} from '../command/perform-write-command';
import { decideSummaryPath } from './summary-page-path';

export type SummaryPageResult =
  | { readonly kind: 'created'; readonly pageId: string; readonly path: string }
  | {
      readonly kind: 'failed';
      readonly reason: Extract<
        AgentFailureReason,
        'path-conflict' | 'forbidden'
      >;
    };

/**
 * Creates the summary page as `user`, WIP and without the auto-delete expiry
 * (Requirements 5.9, 5.18), at the requested path or in the user's memo area
 * (5.10). An existing page or a refused creation is a `failed` result, never
 * a throw (5.11).
 */
export const createSummaryPage = async (params: {
  readonly crowi: Crowi;
  readonly user: WriteActor;
  readonly requestedPath: string | null;
  readonly title: string;
  readonly body: string;
  readonly now: Date;
  /** Already carries the channel tag (the agent request row's `auditContext`). */
  readonly auditContext: CommandAuditContext;
}): Promise<SummaryPageResult> => {
  const { crowi, user, requestedPath, title, body, now, auditContext } = params;
  const target = decideSummaryPath({
    requestedPath,
    user,
    title,
    now,
    disableUserPages: crowi.configManager.getConfig(
      'security:disableUserPages',
    ),
  });

  const result = await performWriteCommand({
    path: target.path,
    actor: user,
    crowi,
    auditContext,
    buildBody: async () => body,
    createOptions: { wip: true, grant: target.grant },
    clearWipExpiry: true,
  });

  switch (result.kind) {
    case 'created':
      return result;
    case 'path-conflict':
      return { kind: 'failed', reason: 'path-conflict' };
    case 'forbidden':
      return { kind: 'failed', reason: 'forbidden' };
  }
};
