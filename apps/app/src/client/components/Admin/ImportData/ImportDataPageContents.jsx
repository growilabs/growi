import React, { useEffect } from 'react';

import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import { useForm } from 'react-hook-form';

import AdminImportContainer from '~/client/services/AdminImportContainer';
import { toastError } from '~/client/util/toastr';
import { toArrayIfNot } from '~/utils/array-utils';
import loggerFactory from '~/utils/logger';

import { withUnstatedContainers } from '../../UnstatedUtils';

import GrowiArchiveSection from './GrowiArchiveSection';

const logger = loggerFactory('growi:importer');

const ImportDataPageContents = ({ t, adminImportContainer }) => {
  const { register: registerEsa, reset: resetEsa } = useForm();
  const { register: registerQiita, reset: resetQiita } = useForm();

  useEffect(() => {
    resetEsa({
      esaTeamName: adminImportContainer.state.esaTeamName || '',
      esaAccessToken: adminImportContainer.state.esaAccessToken || '',
    });
  }, [resetEsa, adminImportContainer.state.esaTeamName, adminImportContainer.state.esaAccessToken]);

  useEffect(() => {
    resetQiita({
      qiitaTeamName: adminImportContainer.state.qiitaTeamName || '',
      qiitaAccessToken: adminImportContainer.state.qiitaAccessToken || '',
    });
  }, [resetQiita, adminImportContainer.state.qiitaTeamName, adminImportContainer.state.qiitaAccessToken]);

  return (
    <div data-testid="admin-import-data">
      <GrowiArchiveSection />

      <form
        className="mt-5"
        id="importerSettingFormEsa"
        role="form"
      >
        <fieldset>
          <h2 className="admin-setting-header">{t('importer_management.import_from', { from: 'esa.io' })}</h2>
          <table className="table table-bordered table-mapping">
            <thead>
              <tr>
                <th width="45%">esa.io</th>
                <th width="10%"></th>
                <th>GROWI</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>{t('importer_management.article')}</th>
                <th><span className="material-symbols-outlined text-success">arrow_circle_right</span></th>
                <th>{t('importer_management.page')}</th>
              </tr>
              <tr>
                <th>{t('importer_management.category')}</th>
                <th><span className="material-symbols-outlined text-success">arrow_circle_right</span></th>
                <th>{t('importer_management.page_path')}</th>
              </tr>
              <tr>
                <th>{t('User')}</th>
                <th></th>
                <th>(TBD)</th>
              </tr>
            </tbody>
          </table>

          <div className="card custom-card bg-body-tertiary mb-0 small">
            <ul>
              <li>{t('importer_management.page_skip')}</li>
            </ul>
          </div>

          <div className="row mt-4">
            <input type="password" name="dummypass" style={{ display: 'none', top: '-100px', left: '-100px' }} />
          </div>

          <div className="row">
            <label htmlFor="settingForm[importer:esa:team_name]" className="text-start text-md-end col-md-3 col-form-label">
              {t('importer_management.esa_settings.team_name')}
            </label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...registerEsa('esaTeamName')}
              />
            </div>

          </div>

          <div className="row mt-3">
            <label htmlFor="settingForm[importer:esa:access_token]" className="text-start text-md-end col-md-3 col-form-label">
              {t('importer_management.esa_settings.access_token')}
            </label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="password"
                {...registerEsa('esaAccessToken')}
              />
            </div>
          </div>

          <div className="row mt-3">
            <div className="offset-md-3 col-md-6">
              <input
                id="testConnectionToEsa"
                type="button"
                className="btn btn-primary btn-esa me-3"
                name="Esa"
                onClick={adminImportContainer.esaHandleSubmit}
                value={t('importer_management.import')}
              />
              <input type="button" className="btn btn-secondary" onClick={adminImportContainer.esaHandleSubmitUpdate} value={t('Update')} />
              <span className="offset-0 offset-sm-1">
                <input
                  id="importFromEsa"
                  type="button"
                  name="Esa"
                  className="btn btn-secondary btn-esa"
                  onClick={adminImportContainer.esaHandleSubmitTest}
                  value={t('importer_management.esa_settings.test_connection')}
                />
              </span>

            </div>
          </div>
        </fieldset>
      </form>

      <form
        className="mt-5"
        id="importerSettingFormQiita"
        role="form"
      >
        <fieldset>
          <h2 className="admin-setting-header">{t('importer_management.import_from', { from: 'Qiita:Team' })}</h2>
          <table className="table table-bordered table-mapping">
            <thead>
              <tr>
                <th width="45%">Qiita:Team</th>
                <th width="10%"></th>
                <th>GROWI</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>{t('importer_management.article')}</th>
                <th><span className="material-symbols-outlined">arrow_circle_right</span></th>
                <th>{t('importer_management.page')}</th>
              </tr>
              <tr>
                <th>{t('importer_management.tag')}</th>
                <th></th>
                <th>-</th>
              </tr>
              <tr>
                <th>{t('importer_management.Directory_hierarchy_tag')}</th>
                <th></th>
                <th>(TBD)</th>
              </tr>
              <tr>
                <th>{t('User')}</th>
                <th></th>
                <th>(TBD)</th>
              </tr>
            </tbody>
          </table>
          <div className="card custom-card bg-body-tertiary mb-3 small">
            <ul>
              <li>{t('importer_management.page_skip')}</li>
            </ul>
          </div>

          <div className="row mt-3">
            <input type="password" name="dummypass" style={{ display: 'none', top: '-100px', left: '-100px' }} />
          </div>
          <div className="row mt-3">
            <label htmlFor="settingForm[importer:qiita:team_name]" className="text-start text-md-end col-md-3 col-form-label">
              {t('importer_management.qiita_settings.team_name')}
            </label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...registerQiita('qiitaTeamName')}
              />
            </div>
          </div>

          <div className="row mt-3">
            <label htmlFor="settingForm[importer:qiita:access_token]" className="text-start text-md-end col-md-3 col-form-label">
              {t('importer_management.qiita_settings.access_token')}
            </label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="password"
                {...registerQiita('qiitaAccessToken')}
              />
            </div>
          </div>


          <div className="row mt-3">
            <div className="offset-md-3 col-md-6">
              <input
                id="testConnectionToQiita"
                type="button"
                className="btn btn-primary btn-qiita me-3"
                name="Qiita"
                onClick={adminImportContainer.qiitaHandleSubmit}
                value={t('importer_management.import')}
              />
              <input type="button" className="btn btn-secondary" onClick={adminImportContainer.qiitaHandleSubmitUpdate} value={t('Update')} />
              <span className="offset-0 offset-sm-1">
                <input
                  name="Qiita"
                  type="button"
                  id="importFromQiita"
                  className="btn btn-secondary btn-qiita"
                  onClick={adminImportContainer.qiitaHandleSubmitTest}
                  value={t('importer_management.qiita_settings.test_connection')}
                />
              </span>

            </div>
          </div>


        </fieldset>


      </form>
    </div>
  );
};

ImportDataPageContents.propTypes = {
  t: PropTypes.func.isRequired,
  adminImportContainer: PropTypes.instanceOf(AdminImportContainer).isRequired,
};

const ImportDataPageContentsWrapperFc = (props) => {
  const { t } = useTranslation('admin');

  const { adminImportContainer } = props;

  useEffect(() => {
    const fetchImportSettingsData = async() => {
      await adminImportContainer.retrieveImportSettingsData();
    };

    try {
      fetchImportSettingsData();
    }
    catch (err) {
      const errs = toArrayIfNot(err);
      toastError(errs);
      logger.error(errs);
    }
  }, [adminImportContainer]);

  return <ImportDataPageContents t={t} {...props} />;
};

/**
 * Wrapper component for using unstated
 */
const ImportDataPageContentsWrapper = withUnstatedContainers(ImportDataPageContentsWrapperFc, [AdminImportContainer]);

export default ImportDataPageContentsWrapper;
