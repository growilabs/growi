import type { FC } from 'react';
import { useCallback, useState } from 'react';
import { isPopulated } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import { UserPicture } from '@growi/ui/dist/components';
import { format } from 'date-fns/format';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'reactstrap';

import type { IActivityHasId } from '~/interfaces/activity';

import { ActivitySnapshotDetail } from './snapshot-detail';

type Props = {
  activity: IActivityHasId;
};

// Disclosure + the 5 existing columns (user/date/action/ip/url).
const DETAIL_COLSPAN = 6;

const formatDate = (date: Date): string => {
  return format(new Date(date), 'yyyy/MM/dd HH:mm:ss');
};

/**
 * Renders a single activity as a table row.
 *
 * Owns row-local expand state: the leading disclosure cell toggles a
 * full-width sub-row that mounts ActivitySnapshotDetail only while expanded
 * (Requirements 1.4, 5.3). The 5 existing cells (user/date/action/ip/url)
 * are the same markup ActivityTable rendered directly before this component
 * was extracted, so existing DOM/visual output is unchanged.
 */
export const ActivityTableRow: FC<Props> = (props) => {
  const { activity } = props;
  const { t } = useTranslation();

  const [isExpanded, setIsExpanded] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const showToolTip = useCallback(() => {
    setIsTooltipOpen(true);
    setTimeout(() => {
      setIsTooltipOpen(false);
    }, 1000);
  }, []);

  return (
    <>
      <tr data-testid="activity-table">
        <td>
          <button
            type="button"
            className="btn btn-outline-secondary border-0"
            aria-expanded={isExpanded}
            aria-label="Toggle snapshot detail"
            onClick={toggleExpand}
          >
            <span
              className={`material-symbols-outlined ${isExpanded ? 'rotate-90' : ''}`}
              aria-hidden="true"
            >
              navigate_next
            </span>
          </button>
        </td>
        <td>
          {activity.user != null && (
            <>
              <UserPicture user={activity.user} />
              <a
                className="ms-2"
                href={
                  isPopulated(activity.user)
                    ? pagePathUtils.userHomepagePath(activity.user)
                    : undefined
                }
              >
                {activity.snapshot?.username}
              </a>
            </>
          )}
        </td>
        <td>{formatDate(activity.createdAt)}</td>
        <td>{t(`admin:audit_log_action.${activity.action}`)}</td>
        <td>{activity.ip}</td>
        <td className="audit-log-url-cell">
          <div className="d-flex align-items-center">
            <span className="flex-grow-1 text-truncate">
              {activity.endpoint}
            </span>
            <CopyToClipboard text={activity.endpoint} onCopy={showToolTip}>
              <button
                type="button"
                className="btn btn-outline-secondary border-0 ms-2"
                id={`tooltipTarget-${activity._id}`}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  content_paste
                </span>
              </button>
            </CopyToClipboard>
            <Tooltip
              placement="top"
              isOpen={isTooltipOpen}
              fade={false}
              target={`tooltipTarget-${activity._id}`}
            >
              copied!
            </Tooltip>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr data-testid="activity-snapshot-detail">
          <td colSpan={DETAIL_COLSPAN}>
            <ActivitySnapshotDetail activity={activity} />
          </td>
        </tr>
      )}
    </>
  );
};
