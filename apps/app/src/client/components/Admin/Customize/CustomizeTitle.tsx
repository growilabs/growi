import type { FC } from 'react';
import React, { useCallback, useEffect } from 'react';

import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';
import { Card, CardBody } from 'reactstrap';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useCustomizeTitle } from '~/stores-universal/context';

import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

export const CustomizeTitle: FC = () => {

  const { t } = useTranslation('admin');

  const { data: customizeTitle } = useCustomizeTitle();

  const {
    register,
    handleSubmit,
    reset,
  } = useForm();

  // Sync form with store data
  useEffect(() => {
    reset({
      customizeTitle: customizeTitle ?? '',
    });
  }, [customizeTitle, reset]);

  const onSubmit = useCallback(async(data) => {
    try {
      await apiv3Put('/customize-setting/customize-title', {
        customizeTitle: data.customizeTitle,
      });
      toastSuccess(t('toaster.update_successed', { target: t('admin:customize_settings.custom_title'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [t]);

  return (
    <React.Fragment>
      <div className="row">
        <div className="col-12">
          <h2 className="admin-setting-header">{t('admin:customize_settings.custom_title')}</h2>
        </div>

        <div className="col-12">
          <Card className="card custom-card bg-body-tertiary mb-3">
            <CardBody className="px-0 py-2">
              {/* eslint-disable react/no-danger */}
              <p dangerouslySetInnerHTML={{ __html: t('admin:customize_settings.custom_title_detail') }} />
              <ul>
                <li>
                  <span dangerouslySetInnerHTML={{ __html: t('admin:customize_settings.custom_title_detail_placeholder1') }} />
                </li>
                <li>
                  <span dangerouslySetInnerHTML={{ __html: t('admin:customize_settings.custom_title_detail_placeholder2') }} />
                </li>
                <li>
                  <span dangerouslySetInnerHTML={{ __html: t('admin:customize_settings.custom_title_detail_placeholder3') }} />
                </li>
              </ul>
              {/* eslint-enable react/no-danger */}
            </CardBody>
          </Card>
        </div>

        {/* TODO i18n */}
        <div className="form-text text-muted col-12 mb-3">
          Default Value: <code>&#123;&#123;pagename&#125;&#125; - &#123;&#123;sitename&#125;&#125;</code>
          <br />
          Default Output Example: <code className="xml">&lt;title&gt;Page name - My GROWI&lt;&#047;title&gt;</code>
        </div>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="col-12">
            <input
              className="form-control"
              {...register('customizeTitle')}
            />
          </div>
          <div className="col-12">
            <AdminUpdateButtonRow type="submit" disabled={false} />
          </div>
        </form>
      </div>
    </React.Fragment>
  );
};
