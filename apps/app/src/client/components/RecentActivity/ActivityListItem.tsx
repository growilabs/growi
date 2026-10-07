import { formatDistanceToNow } from 'date-fns/formatDistanceToNow';
import type { Locale } from 'date-fns/locale';
import { useTranslation } from 'next-i18next';

import type {
  ActivityHasTargetPage,
  SupportedActivityActionType,
} from '~/interfaces/activity';
import { ActivityLogActions } from '~/interfaces/activity';
import { getLocale } from '~/utils/locale-utils';

export const ActivityActionTranslationMap: Record<
  SupportedActivityActionType,
  string
> = {
  [ActivityLogActions.ACTION_PAGE_CREATE]: 'page_create',
  [ActivityLogActions.ACTION_PAGE_UPDATE]: 'page_update',
  [ActivityLogActions.ACTION_PAGE_DELETE]: 'page_delete',
  [ActivityLogActions.ACTION_PAGE_DELETE_COMPLETELY]: 'page_delete_completely',
  [ActivityLogActions.ACTION_PAGE_RENAME]: 'page_rename',
  [ActivityLogActions.ACTION_PAGE_REVERT]: 'page_revert',
  [ActivityLogActions.ACTION_PAGE_DUPLICATE]: 'page_duplicate',
  [ActivityLogActions.ACTION_PAGE_LIKE]: 'page_like',
  [ActivityLogActions.ACTION_COMMENT_CREATE]: 'comment_create',
};

export const IconActivityTranslationMap: Record<
  SupportedActivityActionType,
  string
> = {
  [ActivityLogActions.ACTION_PAGE_CREATE]: 'add_box',
  [ActivityLogActions.ACTION_PAGE_UPDATE]: 'edit',
  [ActivityLogActions.ACTION_PAGE_DELETE]: 'delete',
  [ActivityLogActions.ACTION_PAGE_DELETE_COMPLETELY]: 'delete_forever',
  [ActivityLogActions.ACTION_PAGE_RENAME]: 'label',
  [ActivityLogActions.ACTION_PAGE_REVERT]: 'undo',
  [ActivityLogActions.ACTION_PAGE_DUPLICATE]: 'content_copy',
  [ActivityLogActions.ACTION_PAGE_LIKE]: 'favorite',
  [ActivityLogActions.ACTION_COMMENT_CREATE]: 'comment',
};

type ActivityListItemProps = {
  activity: ActivityHasTargetPage;
};

type AllowPageDisplayPayload = {
  grant: number | undefined;
  status: string;
  wip: boolean;
  deletedAt?: Date;
  path: string;
};

const translateAction = (action: SupportedActivityActionType): string => {
  return ActivityActionTranslationMap[action] || 'unknown_action';
};

const setIcon = (action: SupportedActivityActionType): string => {
  return IconActivityTranslationMap[action] || 'question_mark';
};

const calculateTimePassed = (date: Date, locale: Locale): string => {
  const timePassed = formatDistanceToNow(date, {
    addSuffix: true,
    locale,
  });

  return timePassed;
};

const pageAllowedForDisplay = (
  allowDisplayPayload: AllowPageDisplayPayload,
): boolean => {
  const { grant, status, wip, deletedAt } = allowDisplayPayload;
  if (grant !== 1) return false;

  if (status !== 'published') return false;

  if (wip) return false;

  if (deletedAt) return false;

  return true;
};

const setPath = (path: string, allowed: boolean): string => {
  if (allowed) return path;

  return '';
};

export const ActivityListItem = ({
  props,
}: {
  props: ActivityListItemProps;
}): JSX.Element => {
  const { t, i18n } = useTranslation();
  const currentLangCode = i18n.language;
  const dateFnsLocale = getLocale(currentLangCode);

  const { activity } = props;

  const { path, grant, status, wip, deletedAt } = activity.target;

  const allowDisplayPayload: AllowPageDisplayPayload = {
    grant,
    status,
    wip,
    deletedAt,
    path,
  };

  const isPageAllowed = pageAllowedForDisplay(allowDisplayPayload);

  const action = activity.action as SupportedActivityActionType;
  const keyToTranslate = translateAction(action);
  const fullKeyPath = `user_home_page.${keyToTranslate}`;

  return (
    <div className="activity-row">
      <div className="d-flex align-items-center">
        <span className="material-symbols-outlined me-2 flex-shrink-0">
          {setIcon(action)}
        </span>

        <div className="flex-grow-1 ms-2">
          <div className="activity-path-line mb-0">
            <a
              href={setPath(path, isPageAllowed)}
              className="activity-target-link fw-bold text-wrap d-block"
            >
              <span>{setPath(path, isPageAllowed)}</span>
            </a>
          </div>

          <div className="activity-details-line d-flex">
            <span>{t(fullKeyPath)}</span>

            <span className="text-secondary small ms-3 align-self-center">
              {calculateTimePassed(activity.createdAt, dateFnsLocale)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
