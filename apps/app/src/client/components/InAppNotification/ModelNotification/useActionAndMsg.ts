import type { HasObjectId } from '@growi/core';

import { SupportedAction } from '~/interfaces/activity';
import type { IInAppNotification } from '~/interfaces/in-app-notification';

export type ActionMsgAndIconType = {
  actionMsg: string;
  actionIcon: string;
};

export const useActionMsgAndIconForModelNotification = (
  notification: IInAppNotification & HasObjectId,
): ActionMsgAndIconType => {
  const actionType: string = notification.action;
  let actionMsg: string;
  let actionIcon: string;

  switch (actionType) {
    case SupportedAction.ACTION_PAGE_LIKE:
      actionMsg = 'liked';
      actionIcon = 'favorite';
      break;
    case SupportedAction.ACTION_PAGE_BOOKMARK:
      actionMsg = 'bookmarked on';
      actionIcon = 'bookmark_add';
      break;
    case SupportedAction.ACTION_PAGE_UPDATE:
      actionMsg = 'updated on';
      actionIcon = 'update';
      break;
    case SupportedAction.ACTION_PAGE_RENAME:
      actionMsg = 'renamed';
      actionIcon = 'redo';
      break;
    case SupportedAction.ACTION_PAGE_DUPLICATE:
      actionMsg = 'duplicated';
      actionIcon = 'file_copy';
      break;
    case SupportedAction.ACTION_PAGE_DELETE:
      actionMsg = 'deleted';
      actionIcon = 'delete';
      break;
    case SupportedAction.ACTION_PAGE_DELETE_COMPLETELY:
      actionMsg = 'completely deleted';
      actionIcon = 'delete_forever';
      break;
    case SupportedAction.ACTION_PAGE_REVERT:
      actionMsg = 'reverted';
      actionIcon = 'undo';
      break;
    case SupportedAction.ACTION_PAGE_RECURSIVELY_RENAME:
      actionMsg = 'renamed under';
      actionIcon = 'redo';
      break;
    case SupportedAction.ACTION_PAGE_RECURSIVELY_DELETE:
      actionMsg = 'deleted under';
      actionIcon = 'delete_forever';
      break;
    case SupportedAction.ACTION_PAGE_RECURSIVELY_DELETE_COMPLETELY:
      actionMsg = 'deleted completely under';
      actionIcon = 'delete_forever';
      break;
    case SupportedAction.ACTION_PAGE_RECURSIVELY_REVERT:
      actionMsg = 'reverted under';
      actionIcon = 'undo';
      break;
    case SupportedAction.ACTION_COMMENT_CREATE:
      actionMsg = 'commented on';
      actionIcon = 'comment';
      break;
    case SupportedAction.ACTION_USER_REGISTRATION_APPROVAL_REQUEST:
      actionMsg = 'requested registration approval';
      actionIcon = 'add_comment';
      break;
    case SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED:
      actionMsg = 'export completed for';
      actionIcon = 'download';
      break;
    case SupportedAction.ACTION_PAGE_BULK_EXPORT_FAILED:
    case SupportedAction.ACTION_PAGE_BULK_EXPORT_JOB_EXPIRED:
      actionMsg = 'export failed for';
      actionIcon = 'error';
      break;
    case SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_COMPLETED:
      actionMsg = 'audit log export completed';
      actionIcon = 'download';
      break;
    case SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_FAILED:
    case SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_JOB_EXPIRED:
      actionMsg = 'audit log export failed';
      actionIcon = 'error';
      break;
    case SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_NO_RESULTS:
      actionMsg = 'audit log export had no results';
      actionIcon = 'error';
      break;
    default:
      actionMsg = '';
      actionIcon = '';
  }

  return {
    actionMsg,
    actionIcon,
  };
};
