import { type JSX, useId } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from 'reactstrap';

import type { FilterType } from './types';

type InAppNotificationFormsProps = {
  isUnopendNotificationsVisible: boolean;
  onChangeUnopendNotificationsVisible: () => void;
  activeFilter: FilterType;
  onChangeFilter: (filter: FilterType) => void;
  onMarkAllRead: () => void;
  isMarkAllReadDisabled: boolean;
};

export const InAppNotificationForms = (
  props: InAppNotificationFormsProps,
): JSX.Element => {
  const {
    isUnopendNotificationsVisible,
    onChangeUnopendNotificationsVisible,
    activeFilter,
    onChangeFilter,
    onMarkAllRead,
    isMarkAllReadDisabled,
  } = props;
  const { t } = useTranslation('commons');
  const toggleId = useId();

  return (
    <div className="my-2">
      {/* Filter tabs */}
      <fieldset className="btn-group w-100 mb-2">
        <Button
          color={activeFilter === 'all' ? 'primary' : 'secondary'}
          outline={activeFilter !== 'all'}
          size="sm"
          onClick={() => onChangeFilter('all')}
        >
          {t('in_app_notification.filter_all')}
        </Button>
        <Button
          color={activeFilter === 'notifications' ? 'primary' : 'secondary'}
          outline={activeFilter !== 'notifications'}
          size="sm"
          onClick={() => onChangeFilter('notifications')}
        >
          {t('in_app_notification.notifications')}
        </Button>
        <Button
          color={activeFilter === 'news' ? 'primary' : 'secondary'}
          outline={activeFilter !== 'news'}
          size="sm"
          onClick={() => onChangeFilter('news')}
        >
          {t('in_app_notification.news')}
        </Button>
      </fieldset>

      {/* Unread-only toggle + mark-all-read button */}
      <div className="d-flex justify-content-between align-items-center">
        <div className="form-check form-switch mb-0">
          <label className="form-check-label" htmlFor={toggleId}>
            {t('in_app_notification.only_unread')}
          </label>
          <input
            id={toggleId}
            className="form-check-input"
            type="checkbox"
            role="switch"
            aria-checked={isUnopendNotificationsVisible}
            checked={isUnopendNotificationsVisible}
            onChange={onChangeUnopendNotificationsVisible}
          />
        </div>
        <Button
          color="neutral-secondary"
          outline
          size="sm"
          onClick={onMarkAllRead}
          disabled={isMarkAllReadDisabled}
        >
          {t('in_app_notification.mark_all_as_read')}
        </Button>
      </div>
    </div>
  );
};
