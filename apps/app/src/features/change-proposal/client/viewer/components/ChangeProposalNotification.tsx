import type { JSX } from 'react';
import type { HasObjectId } from '@growi/core';
import { useTranslation } from 'next-i18next';

import type { ModelNotificationUtils } from '~/client/components/InAppNotification/ModelNotification';
import { buildActionUsersLabel } from '~/client/components/InAppNotification/ModelNotification/build-action-users-label';
import { ModelNotification } from '~/client/components/InAppNotification/ModelNotification/ModelNotification';
import { SupportedTargetModel } from '~/interfaces/activity';
import type { IInAppNotification } from '~/interfaces/in-app-notification';

import { buildProposalHref } from '../../shared';
import { parseChangeProposalNotification } from '../domain';

const MAX_LISTED_PATHS = 3;
const MAX_MESSAGE_LENGTH = 100;

const truncate = (text: string): string => {
  const codePoints = Array.from(text);
  return codePoints.length > MAX_MESSAGE_LENGTH
    ? `${codePoints.slice(0, MAX_MESSAGE_LENGTH).join('')}…`
    : text;
};

export const useChangeProposalModelNotification = (
  notification: IInAppNotification & HasObjectId,
): ModelNotificationUtils | null => {
  const { t } = useTranslation();

  if (notification.targetModel !== SupportedTargetModel.MODEL_CHANGE_PROPOSAL) {
    return null;
  }

  const parsed = parseChangeProposalNotification(
    notification.action,
    notification.snapshot,
  );
  if (parsed == null) {
    return null;
  }

  let actionMsg: string;
  let actionIcon: string;
  let subMsg: JSX.Element;
  switch (parsed.kind) {
    case 'apply':
    case 'revert': {
      if (parsed.kind === 'apply') {
        actionMsg = t('in_app_notification.change_proposal.applied', {
          ns: 'commons',
        });
        actionIcon = 'check_circle';
      } else {
        actionMsg = t('in_app_notification.change_proposal.reverted', {
          ns: 'commons',
        });
        actionIcon = 'undo';
      }
      const hasMore = parsed.pagePaths.length > MAX_LISTED_PATHS;
      subMsg = (
        <div className="text-truncate">
          {parsed.pagePaths.slice(0, MAX_LISTED_PATHS).map((path) => (
            <div key={path} className="text-truncate">
              {path}
            </div>
          ))}
          {hasMore && (
            <div>
              {t('in_app_notification.change_proposal.other_pages', {
                ns: 'commons',
              })}
            </div>
          )}
        </div>
      );
      break;
    }
    case 'revert-request':
      actionMsg = t('in_app_notification.change_proposal.revert_requested', {
        ns: 'commons',
      });
      actionIcon = 'undo';
      subMsg = (
        <div
          className="text-break"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {truncate(parsed.message)}
        </div>
      );
      break;
  }

  const actionUsers = buildActionUsersLabel(notification.actionUsers);

  const Notification = () => (
    <ModelNotification
      notification={notification}
      actionMsg={actionMsg}
      actionIcon={actionIcon}
      actionUsers={actionUsers}
      hidePath
      subMsg={subMsg}
    />
  );

  return {
    Notification,
    clickLink: buildProposalHref(parsed.proposalId),
  };
};
