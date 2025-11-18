import { formatDistanceToNow } from 'date-fns';
import { type Locale } from 'date-fns/locale';
import { useTranslation } from 'next-i18next';

import type { SupportedActivityActionType, ActivityHasTargetPage } from '~/interfaces/activity';
import { ActivityLogActions } from '~/interfaces/activity';
import { getLocale } from '~/server/util/locale-utils';


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
  activity: ActivityHasTargetPage,
}

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


export const ActivityListItem = ({ props }: { props: ActivityListItemProps }): JSX.Element => {
  const { t, i18n } = useTranslation();
  const currentLangCode = i18n.language;
  const dateFnsLocale = getLocale(currentLangCode);

  const { activity } = props;
  const targetPagePath = activity.target.path;

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
              href={targetPagePath}
              className="activity-target-link fw-bold text-wrap d-block"
            >
              <span className="dark:text-white">
                {targetPagePath}
              </span>
            </a>
          </div>

          <div className="activity-details-line d-flex">
            <span className="dark:text-white">
              {t(fullKeyPath)}
            </span>

            <span className="text-secondary small ms-2">
              {calculateTimePassed(activity.createdAt, dateFnsLocale)}
            </span>

          </div>
        </div>
      </div>
    </div>
  );
};
