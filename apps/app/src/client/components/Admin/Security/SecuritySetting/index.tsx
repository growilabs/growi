import React, { useCallback, useEffect } from 'react';

import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';

import AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../../UnstatedUtils';

import { CommentManageRightsSettings } from './CommentManageRightsSettings';
import { PageAccessRightsSettings } from './PageAccessRightsSettings';
import { PageDeleteRightsSettings } from './PageDeleteRightsSettings';
import { PageListDisplaySettings } from './PageListDisplaySettings';
import { SessionMaxAgeSettings } from './SessionMaxAgeSettings';
import { UserHomepageDeletionSettings } from './UserHomepageDeletionSettings';

type FormData = {
  sessionMaxAge: string;
};

type Props = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer;
};

const SecuritySettingComponent: React.FC<Props> = ({ adminGeneralSecurityContainer }) => {
  const { t } = useTranslation('admin');
  const { register, handleSubmit, reset } = useForm<FormData>();

  // Initialize form with current sessionMaxAge value
  useEffect(() => {
    reset({
      sessionMaxAge: adminGeneralSecurityContainer.state.sessionMaxAge || '',
    });
  }, [reset, adminGeneralSecurityContainer.state.sessionMaxAge]);

  const onSubmit = useCallback(async(data: FormData) => {
    try {
      // Update sessionMaxAge from form data
      await adminGeneralSecurityContainer.setSessionMaxAge(data.sessionMaxAge);
      // Save all security settings
      await adminGeneralSecurityContainer.updateGeneralSecuritySetting();
      toastSuccess(t('security_settings.updated_general_security_setting'));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminGeneralSecurityContainer, t]);

  if (adminGeneralSecurityContainer.state.retrieveError != null) {
    return (
      <div>
        <p>
          {t('Error occurred')} : {adminGeneralSecurityContainer.state.retrieveError}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="admin-security-setting">
      <h2 className="border-bottom mb-5">{t('security_settings.security_settings')}</h2>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="vstack gap-3">
          <PageListDisplaySettings adminGeneralSecurityContainer={adminGeneralSecurityContainer} t={t} />
          <PageAccessRightsSettings adminGeneralSecurityContainer={adminGeneralSecurityContainer} t={t} />
          <PageDeleteRightsSettings adminGeneralSecurityContainer={adminGeneralSecurityContainer} t={t} />
          <UserHomepageDeletionSettings adminGeneralSecurityContainer={adminGeneralSecurityContainer} t={t} />
          <CommentManageRightsSettings adminGeneralSecurityContainer={adminGeneralSecurityContainer} t={t} />
          <SessionMaxAgeSettings register={register} t={t} />

          <div className="text-center text-md-start offset-md-3 col-md-5">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={adminGeneralSecurityContainer.state.retrieveError != null}
            >
              {t('Update')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export const SecuritySetting = withUnstatedContainers(SecuritySettingComponent, [AdminGeneralSecurityContainer]);
