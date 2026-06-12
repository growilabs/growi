import { useId } from 'react';
import { useTranslation } from 'next-i18next';
import type { UseFormRegister } from 'react-hook-form';

import AdminAppContainer from '~/client/services/AdminAppContainer';

import { withUnstatedContainers } from '../../UnstatedUtils';

type Props = {
  adminAppContainer?: AdminAppContainer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
};

const OAuth2Setting = (props: Props): JSX.Element => {
  const { t } = useTranslation();
  const { register } = props;

  const userInputId = useId();
  const clientIdInputId = useId();
  const clientSecretInputId = useId();
  const refreshTokenInputId = useId();

  return (
    <div className="tab-pane active">
      <div className="row mb-3">
        <div className="col-md-12">
          <div className="alert alert-info">
            <span className="material-symbols-outlined">info</span>{' '}
            {t('admin:app_setting.oauth2_description')}
          </div>
        </div>
      </div>

      <div className="row">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
          htmlFor={userInputId}
        >
          {t('admin:app_setting.oauth2_user')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="email"
            id={userInputId}
            placeholder="user@example.com"
            {...register('oauth2User')}
          />
          <small className="form-text text-muted">
            {t('admin:app_setting.oauth2_user_help')}
          </small>
        </div>
      </div>

      <div className="row">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
          htmlFor={clientIdInputId}
        >
          {t('admin:app_setting.oauth2_client_id')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            id={clientIdInputId}
            {...register('oauth2ClientId')}
          />
        </div>
      </div>

      <div className="row">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
          htmlFor={clientSecretInputId}
        >
          {t('admin:app_setting.oauth2_client_secret')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="password"
            id={clientSecretInputId}
            placeholder={t('admin:app_setting.placeholder_leave_blank')}
            autoComplete="new-password"
            {...register('oauth2ClientSecret')}
          />
        </div>
      </div>

      <div className="row">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
          htmlFor={refreshTokenInputId}
        >
          {t('admin:app_setting.oauth2_refresh_token')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="password"
            id={refreshTokenInputId}
            placeholder={t('admin:app_setting.placeholder_leave_blank')}
            autoComplete="new-password"
            {...register('oauth2RefreshToken')}
          />
          <small className="form-text text-muted">
            {t('admin:app_setting.oauth2_refresh_token_help')}
          </small>
        </div>
      </div>
    </div>
  );
};

export { OAuth2Setting };

/**
 * Wrapper component for using unstated
 */
const OAuth2SettingWrapper = withUnstatedContainers(OAuth2Setting, [
  AdminAppContainer,
]);

export default OAuth2SettingWrapper;
