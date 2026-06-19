import { type JSX, useId } from 'react';
import { useTranslation } from 'next-i18next';

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
        <button
          type="button"
          className={`btn btn-sm ${activeFilter === 'all' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => onChangeFilter('all')}
        >
          {t('in_app_notification.filter_all')}
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeFilter === 'notifications' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => onChangeFilter('notifications')}
        >
          {t('in_app_notification.notifications')}
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeFilter === 'news' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => onChangeFilter('news')}
        >
          {t('in_app_notification.news')}
        </button>
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
        <button
          type="button"
          className={`btn btn-sm btn-link text-decoration-none p-0 ${
            isMarkAllReadDisabled ? 'opacity-25' : ''
          }`}
          onClick={onMarkAllRead}
          disabled={isMarkAllReadDisabled}
        >
          {t('in_app_notification.mark_all_as_read')}
        </button>
      </div>
    </div>
  );
};
