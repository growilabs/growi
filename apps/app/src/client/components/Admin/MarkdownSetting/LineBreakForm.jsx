/* eslint-disable react/no-danger */
import React from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

import AdminMarkDownContainer from '~/client/services/AdminMarkDownContainer';
import { toastError, toastSuccess } from '~/client/util/toastr';
import loggerFactory from '~/utils/logger';

import { withUnstatedContainers } from '../../UnstatedUtils';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

const logger = loggerFactory('growi:importer');

class LineBreakForm extends React.Component {
  constructor(props) {
    super(props);

    this.onClickSubmit = this.onClickSubmit.bind(this);
  }

  async onClickSubmit() {
    const { t } = this.props;

    try {
      await this.props.adminMarkDownContainer.updateLineBreakSetting();
      toastSuccess(
        t('toaster.update_successed', {
          target: t('markdown_settings.lineBreak_header'),
          ns: 'commons',
        }),
      );
    } catch (err) {
      toastError(err);
      logger.error(err);
    }
  }

  renderLineBreakOption() {
    const { t, adminMarkDownContainer } = this.props;
    const { isEnabledLinebreaks } = adminMarkDownContainer.state;

    const helpLineBreak = {
      __html: t('markdown_settings.lineBreak_options.enable_lineBreak_desc'),
    };

    return (
      <div className="col">
        <div className="form-check form-check-success">
          <input
            type="checkbox"
            className="form-check-input"
            id="isEnabledLinebreaks"
            checked={isEnabledLinebreaks}
            onChange={() => {
              adminMarkDownContainer.setState({
                isEnabledLinebreaks: !isEnabledLinebreaks,
              });
            }}
          />
          <label
            className="form-label form-check-label"
            htmlFor="isEnabledLinebreaks"
          >
            {t('markdown_settings.lineBreak_options.enable_lineBreak')}
          </label>
        </div>
        <p
          className="form-text text-muted"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: translation contains HTML markup
          dangerouslySetInnerHTML={helpLineBreak}
        />
      </div>
    );
  }

  renderLineBreakInCommentOption() {
    const { t, adminMarkDownContainer } = this.props;
    const { isEnabledLinebreaksInComments } = adminMarkDownContainer.state;

    const helpLineBreakInComment = {
      __html: t(
        'markdown_settings.lineBreak_options.enable_lineBreak_for_comment_desc',
      ),
    };

    return (
      <div className="col">
        <div className="form-check form-check-success">
          <input
            type="checkbox"
            className="form-check-input"
            id="isEnabledLinebreaksInComments"
            checked={isEnabledLinebreaksInComments}
            onChange={() => {
              adminMarkDownContainer.setState({
                isEnabledLinebreaksInComments: !isEnabledLinebreaksInComments,
              });
            }}
          />
          <label
            className="form-label form-check-label"
            htmlFor="isEnabledLinebreaksInComments"
          >
            {t(
              'markdown_settings.lineBreak_options.enable_lineBreak_for_comment',
            )}
          </label>
        </div>
        <p
          className="form-text text-muted"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: translation contains HTML markup
          dangerouslySetInnerHTML={helpLineBreakInComment}
        />
      </div>
    );
  }

  render() {
    const { adminMarkDownContainer } = this.props;

    return (
      <React.Fragment>
        <fieldset className="row row-cols-1 row-cols-md-2 mx-3">
          {this.renderLineBreakOption()}
          {this.renderLineBreakInCommentOption()}
        </fieldset>
        <AdminUpdateButtonRow
          onClick={this.onClickSubmit}
          disabled={adminMarkDownContainer.state.retrieveError != null}
        />
      </React.Fragment>
    );
  }
}

const LineBreakFormFC = (props) => {
  const { t } = useTranslation('admin');
  return <LineBreakForm t={t} {...props} />;
};

/**
 * Wrapper component for using unstated
 */
const LineBreakFormWrapper = withUnstatedContainers(LineBreakFormFC, [
  AdminMarkDownContainer,
]);

LineBreakForm.propTypes = {
  t: PropTypes.func.isRequired,
  adminMarkDownContainer: PropTypes.instanceOf(AdminMarkDownContainer)
    .isRequired,
};

export default LineBreakFormWrapper;
