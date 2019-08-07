import React, { Fragment } from 'react';
import { withTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import AppContainer from '../../services/AppContainer';
import { createSubscribedElement } from '../UnstatedUtils';
import { toastSuccess, toastError } from '../../util/apiNotification';

class Importer extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
      esaTeamName: '',
      esaAccessToken: '',
    };
    this.esaHandleSubmit = this.esaHandleSubmit.bind(this);
    this.esaHandleSubmitTest = this.esaHandleSubmitTest.bind(this);
    this.esaHandleSubmitUpdate = this.esaHandleSubmitUpdate.bind(this);
    this.handleInputValue = this.handleInputValue.bind(this);
  }

  handleInputValue(event) {
    this.setState({
      [event.target.name]: event.target.value,
    });
  }

  esaHandleSubmit() {
    try {
      const params = {
        'importer:esa:team_name': this.state.esaTeamName,
        'importer:esa:access_token': this.state.esaAccessToken,
      };
      this.props.appContainer.apiPost('/admin/import/esa', params);
      toastSuccess('Import posts from esa success.');
    }
    catch (error) {
      toastError(error, 'Error occurred in importing pages from esa.io');
    }
  }

  esaHandleSubmitTest() {
    try {
      const params = {
        'importer:esa:team_name': this.state.esaTeamName,
        'importer:esa:access_token': this.state.esaAccessToken,

      };

      this.props.appContainer.apiPost('/admin/import/testEsaAPI', params);
      toastSuccess('Test connection to esa success.');
    }
    catch (error) {
      toastError(error, 'Test connection to esa failed.');
    }
  }

  esaHandleSubmitUpdate() {
    try {
      const params = {
        'importer:esa:team_name': this.state.esaTeamName,
        'importer:esa:access_token': this.state.esaAccessToken,
      };
      this.props.appContainer.apiPost('/admin/settings/importerEsa', params);
      toastSuccess('Update');
    }
    catch (error) {
      toastError(error);
    }
  }

  render() {
    const { esaTeamName, esaAccessToken } = this.state;
    const { t } = this.props;
    return (
      <Fragment>
        <form
          className="form-horizontal"
          id="importerSettingFormEsa"
          role="form"
        >
          <fieldset>
            <legend>{ t('importer_management.import_from_esa') }</legend>
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
                  <th>{ t('Article') }</th>
                  <th><i className="icon-arrow-right-circle text-success"></i></th>
                  <th>{ t('Page') }</th>
                </tr>
                <tr>
                  <th>{ t('Category') }</th>
                  <th><i className="icon-arrow-right-circle text-success"></i></th>
                  <th>{ t('Page Path') }</th>
                </tr>
                <tr>
                  <th>{ t('User') }</th>
                  <th></th>
                  <th>(TBD)</th>
                </tr>
              </tbody>
            </table>

            <div className="well well-sm mb-0 small">
              <ul>
                <li>{ t('importer_management.page_skip') }</li>
              </ul>
            </div>

            <div className="form-group">
              <input type="password" name="dummypass" style={{ display: 'none', top: '-100px', left: '-100px' }} />
            </div>

            <div className="form-group">
              <label htmlFor="settingForm[importer:esa:team_name]" className="col-xs-3 control-label">
                { t('importer_management.esa_settings.team_name') }
              </label>
              <div className="col-xs-6">
                <input className="form-control" type="text" name="esaTeamName" value={esaTeamName} onChange={this.handleInputValue} />
              </div>

            </div>

            <div className="form-group">
              <label htmlFor="settingForm[importer:esa:access_token]" className="col-xs-3 control-label">
                { t('importer_management.esa_settings.access_token') }
              </label>
              <div className="col-xs-6">
                <input className="form-control" type="password" name="esaAccessToken" value={esaAccessToken} onChange={this.handleInputValue} />
              </div>
            </div>

            <div className="form-group">
              <div className="col-xs-offset-3 col-xs-6">
                <input
                  id="testConnectionToEsa"
                  type="button"
                  className="btn btn-primary btn-esa"
                  name="Esa"
                  onClick={this.esaHandleSubmit}
                  value={t('importer_management.import')}
                />
                <input type="button" className="btn btn-secondary" onClick={this.esaHandleSubmitUpdate} value={t('Update')} />
                <span className="col-xs-offset-1">
                  <input
                    name="Esa"
                    type="button"
                    id="importFromEsa"
                    className="btn btn-default btn-esa"
                    onClick={this.esaHandleSubmitTest}
                    value={t('importer_management.esa_settings.test_connection')}
                  />
                </span>

              </div>
            </div>
          </fieldset>
        </form>
      </Fragment>

    );
  }

}

/**
 * Wrapper component for using unstated
 */
const ImporterWrapper = (props) => {
  return createSubscribedElement(Importer, props, [AppContainer]);
};

Importer.propTypes = {
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,
  t: PropTypes.func.isRequired, // i18next
  csrf: PropTypes.string,
};

export default withTranslation()(ImporterWrapper);
