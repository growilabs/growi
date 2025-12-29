import React from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

import { apiv3PostForm } from '~/client/util/apiv3-client';
import { toastError } from '~/client/util/toastr';

class UploadForm extends React.Component {
  constructor(props) {
    super(props);

    this.inputRef = React.createRef();

    this.changeFileName = this.changeFileName.bind(this);
    this.uploadZipFile = this.uploadZipFile.bind(this);
    this.validateForm = this.validateForm.bind(this);
  }

  changeFileName(e) {
    // to trigger rerender at onChange event
    // eslint-disable-next-line react/no-unused-state
    this.setState({ dummy: e.target.files[0].name });
  }

  async uploadZipFile(e) {
    e.preventDefault();

    const formData = new FormData();
    formData.append('file', this.inputRef.current.files[0]);

    try {
      const { data } = await apiv3PostForm('/import/upload', formData);
      this.props.onUpload(data);
    } catch (err) {
      if (err[0].code === 'versions-are-not-met') {
        if (this.props.onVersionMismatch !== null) {
          this.props.onVersionMismatch(err[0].code);
        }
      } else {
        toastError(err);
      }
    }
  }

  validateForm() {
    return (
      this.inputRef.current && // null check
      this.inputRef.current.files[0] && // null check
      /\.zip$/.test(this.inputRef.current.files[0].name) // validate extension
    );
  }

  render() {
    const { t } = this.props;

    return (
      <form onSubmit={this.uploadZipFile}>
        <fieldset>
          <div className="row">
            <label
              htmlFor="file"
              className="col-md-3 col-form-label col-form-label-sm"
            >
              {t('admin:importer_management.growi_settings.growi_archive_file')}
            </label>
            <div className="col-md-6">
              <input
                type="file"
                name="file"
                accept=".zip"
                ref={this.inputRef}
                onChange={this.changeFileName}
              />
            </div>
          </div>
          <div className="row">
            <div className="mt-4 text-center">
              {this.props.onDiscard && (
                <button
                  type="button"
                  className="btn btn-outline-secondary mx-1"
                  onClick={this.props.onDiscard}
                >
                  {t('admin:importer_management.growi_settings.discard')}
                </button>
              )}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!this.validateForm()}
              >
                {t('admin:importer_management.growi_settings.upload')}
              </button>
            </div>
          </div>
        </fieldset>
      </form>
    );
  }
}

UploadForm.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  onUpload: PropTypes.func.isRequired,
  onDiscard: PropTypes.func,
  isTheSameVersion: PropTypes.bool,
  onVersionMismatch: PropTypes.func,
};

const UploadFormWrapperFc = (props) => {
  const { t } = useTranslation('admin');

  return <UploadForm t={t} {...props} />;
};

export default UploadFormWrapperFc;
