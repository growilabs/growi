import React, { Fragment } from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

import { apiv3Delete, apiv3Get } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

import ImportForm from './GrowiArchive/ImportForm';
import UploadForm from './GrowiArchive/UploadForm';

class GrowiArchiveSection extends React.Component {
  constructor(props) {
    super(props);

    this.initialState = {
      fileName: null,
      innerFileStats: null,
      isTheSameVersion: null,
    };

    this.state = this.initialState;

    this.handleUpload = this.handleUpload.bind(this);
    this.discardData = this.discardData.bind(this);
    this.resetState = this.resetState.bind(this);
    this.handleMismatchedVersions = this.handleMismatchedVersions.bind(this);
    this.renderDefferentVersionAlert =
      this.renderDefferentVersionAlert.bind(this);
  }

  async UNSAFE_componentWillMount() {
    // get uploaded file status
    const res = await apiv3Get('/import/status');

    if (res.data.zipFileStat != null) {
      const { fileName, innerFileStats } = res.data.zipFileStat;
      const { isTheSameVersion } = res.data;

      this.setState({ fileName, innerFileStats, isTheSameVersion });
    }
  }

  handleUpload({ meta, fileName, innerFileStats }) {
    this.setState({
      fileName,
      innerFileStats,
      isTheSameVersion: true,
    });
  }

  async discardData() {
    try {
      const { fileName } = this.state;
      await apiv3Delete('/import/all');
      this.resetState();

      toastSuccess(`Deleted ${fileName}`);
    } catch (err) {
      toastError(err);
    }
  }

  handleMismatchedVersions(err) {
    this.setState({
      isTheSameVersion: false,
    });
  }

  renderDefferentVersionAlert() {
    const { t } = this.props;
    return (
      <div className="alert alert-warning mt-3">
        {t('importer_management.growi_settings.errors.different_versions')}
      </div>
    );
  }

  resetState() {
    this.setState(this.initialState);
  }

  render() {
    const { t } = this.props;
    const { isTheSameVersion } = this.state;

    return (
      <Fragment>
        <h2 className="mb-3">
          {t('importer_management.import_growi_archive')}
        </h2>
        <div className="card custom-card bg-body-tertiary mb-4 small">
          <ul>
            <li>
              {t('importer_management.skip_username_and_email_when_overlapped')}
            </li>
            <li>
              {t('importer_management.prepare_new_account_for_migration')}
            </li>
            <li>
              <a
                href={`${t('importer_management.admin_archive_data_import_guide_url')}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('importer_management.archive_data_import_detail')}
              </a>
            </li>
          </ul>
        </div>

        {isTheSameVersion === false && this.renderDefferentVersionAlert()}
        {this.state.fileName != null && isTheSameVersion === true ? (
          <div className="px-4">
            <ImportForm
              fileName={this.state.fileName}
              innerFileStats={this.state.innerFileStats}
              onDiscard={this.discardData}
            />
          </div>
        ) : (
          <UploadForm
            onUpload={this.handleUpload}
            onDiscard={
              this.state.fileName != null ? this.discardData : undefined
            }
            onVersionMismatch={this.handleMismatchedVersions}
          />
        )}
      </Fragment>
    );
  }
}

GrowiArchiveSection.propTypes = {
  t: PropTypes.func.isRequired, // i18next
};

const GrowiArchiveSectionWrapperFc = (props) => {
  const { t } = useTranslation('admin');

  return <GrowiArchiveSection t={t} {...props} />;
};

export default GrowiArchiveSectionWrapperFc;
