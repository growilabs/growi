import React, { useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { Tooltip } from 'reactstrap';
import loggerFactory from '~/utils/logger';

import { toastError } from '~/client/util/apiNotification';

import { withUnstatedContainers } from '../../UnstatedUtils';
import AppContainer from '~/client/services/AppContainer';
import AdminHomeContainer from '~/client/services/AdminHomeContainer';
import { useSWRxV5MigrationStatus } from '~/stores/page-listing';
import SystemInfomationTable from './SystemInfomationTable';
import InstalledPluginTable from './InstalledPluginTable';
import EnvVarsTable from './EnvVarsTable';

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
      adminHomeContainer.setState({ retrieveError: err });
      toastError(err);
      logger.error(err);
    }
  }, [adminHomeContainer]);

  useEffect(() => {
    fetchAdminHomeData();
  }, [fetchAdminHomeData]);

  return (
    <>
      {
      // Alert message will be displayed in case that V5 migration has not been compleated
        (migrationStatus != null && !migrationStatus.isV5Compatible)
        && (
          <div className={`alert ${migrationStatus.isV5Compatible == null ? 'alert-warning' : 'alert-info'}`}>
            {t('admin:v5_page_migration.migration_desc')}
            <a className="btn-link" href="/admin/app" rel="noopener noreferrer">
              <i className="fa fa-link ml-1" aria-hidden="true"></i>
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
        <div className="col-lg-12">
          <h2 className="admin-setting-header">{t('admin:admin_top.list_of_installed_plugins')}</h2>
          <InstalledPluginTable />
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
            <span className="ml-2" dangerouslySetInnerHTML={{ __html: t('admin:admin_top:submit_bug_report') }} />
          </div>
        </div>
      </div>
    </>
  );
};


const AdminHomeWrapper = withUnstatedContainers(AdminHome, [AppContainer, AdminHomeContainer]);

AdminHome.propTypes = {
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,
  adminHomeContainer: PropTypes.instanceOf(AdminHomeContainer).isRequired,
};

export default AdminHomeWrapper;
