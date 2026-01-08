import type { FC } from 'react';
import { useId, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { Tooltip } from 'reactstrap';

import { useSWRxAdminHome } from '~/stores/admin/admin-home';
import { useSWRxV5MigrationStatus } from '~/stores/page-listing';
import { generatePrefilledHostInformationMarkdown } from '~/utils/admin-home';

import { EnvVarsTable } from './EnvVarsTable';
import SystemInfomationTable from './SystemInfomationTable';

const COPY_STATE = {
  DEFAULT: 'default',
  DONE: 'done',
} as const;

const AdminHome: FC = () => {
  const { t } = useTranslation();
  const { data: adminHomeData } = useSWRxAdminHome();
  const { data: migrationStatus } = useSWRxV5MigrationStatus();
  const [copyState, setCopyState] = useState<string>(COPY_STATE.DEFAULT);

  const handleCopyPrefilledHostInformation = () => {
    setCopyState(COPY_STATE.DONE);
    setTimeout(() => {
      setCopyState(COPY_STATE.DEFAULT);
    }, 500);
  };

  // Generate CSS-safe ID by removing colons from useId() result
  const copyButtonIdRaw = useId();
  const copyButtonId = `copy-button-${copyButtonIdRaw.replace(/:/g, '')}`;

  return (
    <div data-testid="admin-home">
      {
        // Alert message will be displayed in case that the GROWI is under maintenance
        adminHomeData?.isMaintenanceMode && (
          <div className="alert alert-danger alert-link" role="alert">
            <h3 className="alert-heading">
              {t('admin:maintenance_mode.maintenance_mode')}
            </h3>
            <p>{t('admin:maintenance_mode.description')}</p>
            <hr />
            <a className="btn-link" href="/admin/app" rel="noopener noreferrer">
              <span
                className="material-symbols-outlined ms-1"
                aria-hidden="true"
              >
                link
              </span>
              <strong>
                {t('admin:maintenance_mode.end_maintenance_mode')}
              </strong>
            </a>
          </div>
        )
      }
      {
        // Alert message will be displayed in case that V5 migration has not been compleated
        migrationStatus != null && !migrationStatus.isV5Compatible && (
          <div
            className={`alert ${migrationStatus.isV5Compatible == null ? 'alert-warning' : 'alert-info'}`}
          >
            {t('admin:v5_page_migration.migration_desc')}
            <a className="btn-link" href="/admin/app" rel="noopener noreferrer">
              <span
                className="material-symbols-outlined ms-1"
                aria-hidden="true"
              >
                link
              </span>
              <strong>{t('admin:v5_page_migration.upgrade_to_v5')}</strong>
            </a>
          </div>
        )
      }
      <p>
        {t('admin:admin_top.wiki_administrator')}
        <br></br>
        {t('admin:admin_top.assign_administrator')}
      </p>

      <div className="row mb-5">
        <div className="col-lg-12">
          <h2 className="admin-setting-header">
            {t('admin:admin_top.system_information')}
          </h2>
          <SystemInfomationTable />
        </div>
      </div>

      <div className="row mb-5">
        <div className="col-md-12">
          <h2 className="admin-setting-header">
            {t('admin:admin_top.list_of_env_vars')}
          </h2>
          <p>{t('admin:admin_top.env_var_priority')}</p>
          <p
            // biome-ignore lint/security/noDangerouslySetInnerHtml: ignore
            dangerouslySetInnerHTML={{
              __html: t('admin:admin_top.about_security'),
            }}
          />
          <EnvVarsTable envVars={adminHomeData?.envVars} />
        </div>
      </div>

      <div className="row mb-5">
        <div className="col-md-12">
          <h2 className="admin-setting-header">
            {t('admin:admin_top.bug_report')}
          </h2>
          <ol className="mb-0">
            <li className="mb-3">
              <CopyToClipboard
                text={generatePrefilledHostInformationMarkdown({
                  growiVersion: adminHomeData?.growiVersion,
                  nodeVersion: adminHomeData?.nodeVersion,
                  npmVersion: adminHomeData?.npmVersion,
                  pnpmVersion: adminHomeData?.pnpmVersion,
                })}
                onCopy={handleCopyPrefilledHostInformation}
              >
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  style={{ verticalAlign: 'baseline' }}
                  onClick={(e) => e.preventDefault()}
                >
                  <span
                    id={copyButtonId}
                    className="material-symbols-outlined"
                    aria-hidden="true"
                  >
                    content_copy
                  </span>
                  {t('admin:admin_top:copy_prefilled_host_information:default')}
                </button>
              </CopyToClipboard>
              <Tooltip
                placement="bottom"
                isOpen={copyState === COPY_STATE.DONE}
                target={copyButtonId}
                fade={false}
              >
                {t('admin:admin_top:copy_prefilled_host_information:done')}
              </Tooltip>
            </li>
            <li>
              <a
                className="link-secondary link-offset-1"
                style={{ textDecoration: 'underline' }}
                href="https://github.com/growilabs/growi/issues/new?assignees=&labels=bug&template=bug-report.md&title=Bug%3A"
                target="_blank"
                rel="noreferrer"
              >
                {t('admin:admin_top:submit_bug_report')}
              </a>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default AdminHome;
