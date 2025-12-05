import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'next-i18next';
import { type Locale } from 'date-fns/locale';
import { getLocale } from '~/server/util/locale-utils';
import type { ActivityHasUserId, SupportedActivityActionType } from '~/interfaces/activity';
import { ActivityLogActions } from '~/interfaces/activity';


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


export const ActivityListItem = ({ activity }: { activity: ActivityHasUserId }): JSX.Element => {
  const { t, i18n } = useTranslation();
  const currentLangCode = i18n.language;
  const dateFnsLocale = getLocale(currentLangCode);

  const action = activity.action as SupportedActivityActionType;
  const keyToTranslate = translateAction(action);
  const fullKeyPath = `user_home_page.${keyToTranslate}`;

  return (
    <div className="activity-row">
      <p className="mb-1">
        <span className="material-symbols-outlined me-2">{setIcon(action)}</span>

        <span className="dark:text-white">
          {' '}{t(fullKeyPath)}
        </span>

        <span className="text-secondary small ms-3">
          {calculateTimePassed(activity.createdAt, dateFnsLocale)}
        </span>
      </p>
    </div>
  );
};
