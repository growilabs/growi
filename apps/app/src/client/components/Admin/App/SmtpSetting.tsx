import React from 'react';
import { useTranslation } from 'next-i18next';
import type { UseFormRegister } from 'react-hook-form';

import AdminAppContainer from '~/client/services/AdminAppContainer';

import { withUnstatedContainers } from '../../UnstatedUtils';

type Props = {
  adminAppContainer?: AdminAppContainer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
};

const SmtpSetting = (props: Props): JSX.Element => {
  const { t } = useTranslation();
  const { register } = props;

  return (
    <React.Fragment>
      <div id="mail-smtp" className="tab-pane active">
        <div className="row">
          <label
            className="text-start text-md-end col-md-3 col-form-label"
            htmlFor="admin-smtp-host"
          >
            {t('admin:app_setting.host')}
          </label>
          <div className="col-md-6">
            <input
              className="form-control"
              type="text"
              id="admin-smtp-host"
              {...register('smtpHost')}
            />
          </div>
        </div>

        <div className="row">
          <label
            className="text-start text-md-end col-md-3 col-form-label"
            htmlFor="admin-smtp-port"
          >
            {t('admin:app_setting.port')}
          </label>
          <div className="col-md-6">
            <input
              className="form-control"
              id="admin-smtp-port"
              {...register('smtpPort')}
            />
          </div>
        </div>

        <div className="row">
          <label
            className="text-start text-md-end col-md-3 col-form-label"
            htmlFor="admin-smtp-user"
          >
            {t('admin:app_setting.user')}
          </label>
          <div className="col-md-6">
            <input
              className="form-control"
              type="text"
              id="admin-smtp-user"
              {...register('smtpUser')}
            />
          </div>
        </div>

        <div className="row">
          <label
            className="text-start text-md-end col-md-3 col-form-label"
            htmlFor="admin-smtp-password"
          >
            {t('Password')}
          </label>
          <div className="col-md-6">
            <input
              className="form-control"
              type="password"
              id="admin-smtp-password"
              {...register('smtpPassword')}
            />
          </div>
        </div>
      </div>
    </React.Fragment>
  );
};

export { SmtpSetting };

/**
 * Wrapper component for using unstated
 */
const SmtpSettingWrapper = withUnstatedContainers(SmtpSetting, [
  AdminAppContainer,
]);
export default SmtpSettingWrapper;
