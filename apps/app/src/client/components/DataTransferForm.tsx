import React, { type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import { useGenerateTransferKey } from '~/client/services/g2g-transfer';
import { useGrowiDocumentationUrl } from '~/states/context';

import CustomCopyToClipBoard from './Common/CustomCopyToClipBoard';

const DataTransferForm = (): JSX.Element => {
  const { t } = useTranslation('commons');
  const { transferKey, generateTransferKey } = useGenerateTransferKey();
  const documentationUrl = useGrowiDocumentationUrl();

  return (
    <div data-testid="installerForm" className="py-3 px-4">
      <p className="text-white fs-5 mt-2">
        <strong>{ t('g2g_data_transfer.transfer_data_to_this_growi')}</strong>
      </p>

      <div className="row mt-3">
        <div className="col-md-12">
          <button type="button" className="btn btn-primary w-100" onClick={generateTransferKey}>
            {t('g2g_data_transfer.publish_transfer_key')}
          </button>
        </div>
        <div className="col-md-12 mt-2">
          <div className="d-flex">
            <input className="form-control" type="text" value={transferKey} readOnly />
            <CustomCopyToClipBoard textToBeCopied={transferKey} message="copied_to_clipboard" />
          </div>
        </div>
      </div>

      <div className="alert alert-warning mt-4">
        <p className="mb-1">{t('g2g_data_transfer.transfer_key_limit')}</p>
        <p className="mb-1">{t('g2g_data_transfer.once_transfer_key_used')}</p>
        <p
          className="mb-0"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: t('g2g_data_transfer.transfer_to_growi_cloud', { documentationUrl }),
          }}
        />
      </div>
    </div>
  );
};

export default DataTransferForm;
