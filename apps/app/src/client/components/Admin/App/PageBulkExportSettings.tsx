import { type JSX, useCallback, useEffect, useState } from 'react';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

import { useSWRxAppSettings } from '~/stores/admin/app-settings';

import { apiv3Put } from '../../../util/apiv3-client';
import { toastError, toastSuccess } from '../../../util/toastr';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';
import { ConfirmModal } from './ConfirmModal';

const PageBulkExportSettings = (): JSX.Element => {
  const { t } = useTranslation(['admin', 'commons']);

  const { data, error, mutate } = useSWRxAppSettings();

  const [isBulkExportPagesEnabled, setIsBulkExportPagesEnabled] = useState(
    data?.isBulkExportPagesEnabled,
  );
  const [
    bulkExportDownloadExpirationSeconds,
    setBulkExportDownloadExpirationSeconds,
  ] = useState(data?.bulkExportDownloadExpirationSeconds);

  const [isReloadModalOpen, setReloadModalOpen] = useState(false);

  const changeBulkExportDownloadExpirationSeconds = (
    bulkExportDownloadExpirationDays: number,
  ) => {
    const bulkExportDownloadExpirationSeconds =
      bulkExportDownloadExpirationDays * 24 * 60 * 60;
    setBulkExportDownloadExpirationSeconds(bulkExportDownloadExpirationSeconds);
  };

  const onSubmitHandler = useCallback(async () => {
    // Only the enable flag affects the page-side export menu visibility, which
    // is hydrated once per page load and therefore needs a reload to reflect.
    // The expiration period is read server-side, so a reload prompt is unneeded.
    const isEnabledFlagChanged =
      isBulkExportPagesEnabled !== data?.isBulkExportPagesEnabled;
    try {
      await apiv3Put('/app-settings/page-bulk-export-settings', {
        isBulkExportPagesEnabled,
        bulkExportDownloadExpirationSeconds,
      });
      toastSuccess(
        t('commons:toaster.update_successed', {
          target: t('app_setting.page_bulk_export_settings'),
        }),
      );
      if (isEnabledFlagChanged) {
        setReloadModalOpen(true);
      }
    } catch (err) {
      toastError(err);
    }
    mutate();
  }, [
    isBulkExportPagesEnabled,
    bulkExportDownloadExpirationSeconds,
    data,
    mutate,
    t,
  ]);

  useEffect(() => {
    if (data?.useOnlyEnvVarForFileUploadType) {
      setIsBulkExportPagesEnabled(data?.envIsBulkExportPagesEnabled);
    } else {
      setIsBulkExportPagesEnabled(data?.isBulkExportPagesEnabled);
    }
    setBulkExportDownloadExpirationSeconds(
      data?.bulkExportDownloadExpirationSeconds,
    );
  }, [data]);

  const isLoading = data === undefined && error === undefined;

  return (
    <>
      {isLoading && (
        <div className="text-muted text-center mb-5">
          <LoadingSpinner className="me-1 fs-3" />
        </div>
      )}

      {!isLoading && (
        <>
          <p className="card custom-card bg-warning-subtle my-3">
            {t('admin:app_setting.page_bulk_export_explanation')} <br />
            <span className="text-danger mt-1">
              {t('admin:app_setting.page_bulk_export_warning')}
            </span>
          </p>

          <div className="my-4 row">
            <div className="text-start text-md-end col-md-3 col-form-label"></div>

            <div className="col-md-6">
              <div className="form-check form-switch form-check-info">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="cbIsPageBulkExportEnabled"
                  checked={isBulkExportPagesEnabled}
                  disabled={data?.useOnlyEnvVarsForIsBulkExportPagesEnabled}
                  onChange={(e) =>
                    setIsBulkExportPagesEnabled(e.target.checked)
                  }
                />
                <label
                  className="form-label form-check-label"
                  htmlFor="cbIsPageBulkExportEnabled"
                >
                  {t('app_setting.enable_page_bulk_export')}
                </label>
              </div>
              {data?.useOnlyEnvVarsForIsBulkExportPagesEnabled && (
                <p className="form-text text-muted">
                  <b
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: includes markup from i18n strings
                    dangerouslySetInnerHTML={{
                      __html: t('admin:app_setting.fixed_by_env_var', {
                        envKey: 'BULK_EXPORT_PAGES_ENABLED',
                        envVar: isBulkExportPagesEnabled,
                      }),
                    }}
                  />
                </p>
              )}
            </div>
          </div>

          <div className="mb-4">
            <div className="row">
              <label
                className="text-start text-md-end col-md-3 col-form-label"
                htmlFor="admin-page-bulk-export-expiration"
              >
                {t('app_setting.page_bulk_export_storage_period')}
              </label>

              <div className="col-md-2">
                <select
                  className="form-select"
                  id="admin-page-bulk-export-expiration"
                  value={
                    (bulkExportDownloadExpirationSeconds ?? 0) / (24 * 60 * 60)
                  }
                  onChange={(e) => {
                    changeBulkExportDownloadExpirationSeconds(
                      Number(e.target.value),
                    );
                  }}
                >
                  {Array.from({ length: 7 }, (_, i) => i + 1).map((number) => (
                    <option
                      key={`be-download-expiration-option-${number}`}
                      value={number}
                    >
                      {number} {t('admin:days')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <AdminUpdateButtonRow onClick={onSubmitHandler} />
        </>
      )}

      <ConfirmModal
        isModalOpen={isReloadModalOpen}
        title={t('admin:app_setting.page_bulk_export_reload_title')}
        headerClassName="text-primary"
        iconName="refresh"
        warningMessage={t('admin:app_setting.page_bulk_export_reload_prompt')}
        supplymentaryMessage={null}
        confirmButtonTitle={t('admin:app_setting.reload_page')}
        cancelButtonTitle={t(
          'admin:app_setting.page_bulk_export_reload_dismiss',
        )}
        onConfirm={() => {
          window.location.reload();
          return Promise.resolve();
        }}
        onCancel={() => setReloadModalOpen(false)}
      />
    </>
  );
};

export default PageBulkExportSettings;
