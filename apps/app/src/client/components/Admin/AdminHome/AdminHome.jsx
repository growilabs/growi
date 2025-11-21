import React, { useEffect, useCallback } from 'react';

import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { Tooltip } from 'reactstrap';

import AdminHomeContainer from '~/client/services/AdminHomeContainer';
import { toastError } from '~/client/util/toastr';
import { useSWRxV5MigrationStatus } from '~/stores/page-listing';
import loggerFactory from '~/utils/logger';


import { withUnstatedContainers } from '../../UnstatedUtils';


import { EnvVarsTable } from './EnvVarsTable';
import SystemInfomationTable from './SystemInfomationTable';


const logger = loggerFactory('growi:admin');

const AdminHome = (props) => {
  const { adminHomeContainer } = props;
  const { t } = useTranslation();
  const { data: migrationStatus } = useSWRxV5MigrationStatus();

  const fetchAdminHomeData = useCallback(async() => {
    try {
      await adminHomeContainer.retrieveAdminHomeData();
    }
    catch (err) {
      toastError(err);
      logger.error(err);
    }
  }, [adminHomeContainer]);

  useEffect(() => {
    fetchAdminHomeData();
  }, [fetchAdminHomeData]);

  if (adminHomeContainer.state.growiVersion == null) {
    return <LoadingSpinner />;
  }

  return (
    <div data-testid="admin-home">
      {
        // Alert message will be displayed in case that the GROWI is under maintenance
        adminHomeContainer.state.isMaintenanceMode && (
          <div className="alert alert-danger alert-link" role="alert">
            <h3 className="alert-heading">
              {t('admin:maintenance_mode.maintenance_mode')}
            </h3>
            <p>
              {t('admin:maintenance_mode.description')}
            </p>
            <hr />
            <a className="btn-link" href="/admin/app" rel="noopener noreferrer">
              <span className="material-symbols-outlined ms-1" aria-hidden="true">link</span>
              <strong>{t('admin:maintenance_mode.end_maintenance_mode')}</strong>
            </a>
          </div>
        )
      }
      {
        // Alert message will be displayed in case that V5 migration has not been compleated
        (migrationStatus != null && !migrationStatus.isV5Compatible)
        && (
          <div className={`alert ${migrationStatus.isV5Compatible == null ? 'alert-warning' : 'alert-info'}`}>
            {t('admin:v5_page_migration.migration_desc')}
            <a className="btn-link" href="/admin/app" rel="noopener noreferrer">
              <span className="material-symbols-outlined ms-1" aria-hidden="true">link</span>
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
          <h2 className="admin-setting-header">{t('admin:admin_top.system_information')}</h2>
          <SystemInfomationTable />
        </div>
      </div>

      <div className="row mb-5">
        <div className="col-md-12">
          <h2 className="admin-setting-header">{t('admin:admin_top.list_of_env_vars')}</h2>
          <p>{t('admin:admin_top.env_var_priority')}</p>
          {/* eslint-disable-next-line react/no-danger */}
          <p dangerouslySetInnerHTML={{ __html: t('admin:admin_top.about_security') }} />
          {adminHomeContainer.state.envVars && <EnvVarsTable envVars={adminHomeContainer.state.envVars} />}
        </div>
      </div>

      <div className="row mb-5">
        <div className="col-md-12">
          <h2 className="admin-setting-header">{t('admin:admin_top.bug_report')}</h2>
          <div className="d-flex align-items-center">
            <CopyToClipboard
              text={adminHomeContainer.generatePrefilledHostInformationMarkdown()}
              onCopy={() => adminHomeContainer.onCopyPrefilledHostInformation()}
            >
              <button id="prefilledHostInformationButton" type="button" className="btn btn-primary">
                {t('admin:admin_top:copy_prefilled_host_information:default')}
              </button>
            </CopyToClipboard>
            <Tooltip
              placement="bottom"
              isOpen={adminHomeContainer.state.copyState === adminHomeContainer.copyStateValues.DONE}
              target="prefilledHostInformationButton"
              fade={false}
            >
              {t('admin:admin_top:copy_prefilled_host_information:done')}
            </Tooltip>
            {/* eslint-disable-next-line react/no-danger */}
            <span className="ms-2" dangerouslySetInnerHTML={{ __html: t('admin:admin_top:submit_bug_report') }} />
          </div>
        </div>
      </div>
    </div>
  );
};


const AdminHomeWrapper = withUnstatedContainers(AdminHome, [AdminHomeContainer]);

AdminHome.propTypes = {
  adminHomeContainer: PropTypes.instanceOf(AdminHomeContainer).isRequired,
};

export default AdminHomeWrapper;
