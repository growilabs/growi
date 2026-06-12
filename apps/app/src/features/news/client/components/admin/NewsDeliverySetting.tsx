import type { FC } from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'next-i18next';

import { toastError, toastSuccess } from '~/client/util/toastr';
import loggerFactory from '~/utils/logger';

import {
  useSWRxNewsDeliverySetting,
  useUpdateNewsDeliverySetting,
} from '../../services/news-delivery-setting';

const logger = loggerFactory('growi:feature:news:admin:NewsDeliverySetting');

export const NewsDeliverySetting: FC = () => {
  const { t } = useTranslation('admin');

  const { data, isLoading } = useSWRxNewsDeliverySetting();
  const updateDeliverySetting = useUpdateNewsDeliverySetting();

  const isEnabled = data?.isDeliveryEnabled ?? true;

  const onChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.checked;
      try {
        await updateDeliverySetting(next);
        toastSuccess(
          t('admin:news_delivery.update_succeeded', {
            defaultValue: 'News delivery setting updated',
          }),
        );
      } catch (err) {
        toastError(err);
        logger.error(err);
      }
    },
    [updateDeliverySetting, t],
  );

  return (
    <div className="row mb-3">
      <label
        className="text-start text-md-end col-md-3 col-form-label"
        htmlFor="checkbox-news-is-delivery-enabled"
      >
        {t('admin:news_delivery.label', { defaultValue: 'News delivery' })}
      </label>
      <div className="col-md-6 py-2">
        <div className="form-check form-switch">
          <input
            type="checkbox"
            id="checkbox-news-is-delivery-enabled"
            className="form-check-input"
            checked={isEnabled}
            disabled={isLoading}
            onChange={onChange}
          />
          <label
            className="form-label form-check-label"
            htmlFor="checkbox-news-is-delivery-enabled"
          >
            {t('admin:news_delivery.enable', {
              defaultValue: 'Enable news delivery',
            })}
          </label>
        </div>
        <p className="form-text text-muted">
          {t('admin:news_delivery.description', {
            defaultValue:
              'Controls whether the cron job pulls the news feed and updates the local cache. Existing cached items remain visible while delivery is disabled.',
          })}
        </p>
      </div>
    </div>
  );
};
