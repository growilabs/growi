import React from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

const ApiErrorMessage = (props) => {
  const { t } = useTranslation();
  const { errorCode, errorMessage, targetPath } = props;

  function reload() {
    window.location.reload();
  }

  function renderMessageByErrorCode() {
    switch (errorCode) {
      case 'already_exists':
        return (
          <>
            <strong>
              <span className="material-symbols-outlined me-1">cancel</span>
              {t('page_api_error.already_exists')}
            </strong>
            <small>
              <a href={targetPath}>
                {targetPath}{' '}
                <span className="material-symbols-outlined me-1">login</span>
              </a>
            </small>
          </>
        );
      case 'notfound_or_forbidden':
        return (
          <strong>
            <span className="material-symbols-outlined me-1">cancel</span>
            {t('page_api_error.notfound_or_forbidden')}
          </strong>
        );
      case 'user_not_admin':
        return (
          <strong>
            <span className="material-symbols-outlined me-1">cancel</span>
            {t('page_api_error.user_not_admin')}
          </strong>
        );
      case 'complete_deletion_not_allowed_for_user':
        return (
          <strong>
            <span className="material-symbols-outlined me-1">cancel</span>
            {t('page_api_error.complete_deletion_not_allowed_for_user')}
          </strong>
        );
      case 'outdated':
        return (
          <>
            <strong>
              <span className="material-symbols-outlined me-1">lightbulb</span>{' '}
              {t('page_api_error.outdated')}
            </strong>
            <button type="button" className="btn-link" onClick={reload}>
              <span className="material-symbols-outlined">
                keyboard_double_arrow_right
              </span>{' '}
              {t('Load latest')}
            </button>
          </>
        );
      case 'invalid_path':
        return (
          <strong>
            <span className="material-symbols-outlined me-1">cancel</span>{' '}
            Invalid path
          </strong>
        );
      case 'single_deletion_empty_pages':
        return (
          <strong>
            <span className="material-symbols-outlined me-1">cancel</span>
            {t('page_api_error.single_deletion_empty_pages')}
          </strong>
        );
      default:
        return (
          <strong>
            <span className="material-symbols-outlined me-1">cancel</span>{' '}
            Unknown error occured
          </strong>
        );
    }
  }

  if (errorCode != null) {
    return <span className="text-danger">{renderMessageByErrorCode()}</span>;
  }

  if (errorMessage != null) {
    return <span className="text-danger">{errorMessage}</span>;
  }

  // render null if no error has occurred
  return null;
};

ApiErrorMessage.propTypes = {
  errorCode: PropTypes.string,
  errorMessage: PropTypes.string,
  targetPath: PropTypes.string,
};

export default ApiErrorMessage;
