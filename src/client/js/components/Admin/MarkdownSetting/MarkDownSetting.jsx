import React from 'react';
import PropTypes from 'prop-types';
import { withTranslation } from 'react-i18next';

import { createSubscribedElement } from '../../UnstatedUtils';

import AppContainer from '../../../services/AppContainer';
import LineBreakForm from './LineBreakForm';
import PresentationForm from './PresentationForm';
import XssForm from './XssForm';

class MarkdownSetting extends React.Component {

  render() {
    const { t } = this.props;

    return (
      <React.Fragment>
        {/* Line Break Setting */}
        <div className="row mb-5">
          <h2 className="border-bottom">{ t('markdown_setting.line_break_setting') }</h2>
          <p className="well">{ t('markdown_setting.line_break_setting_desc') }</p>
          <LineBreakForm />
        </div>

        {/* Presentation Setting */}
        <div className="row mb-5">
          <h2 className="border-bottom">{ t('markdown_setting.presentation_setting') }</h2>
          <p className="well">{ t('markdown_setting.presentation_setting_desc') }</p>
          <PresentationForm />
        </div>

        {/* XSS Setting */}
        <div className="row mb-5">
          <h2 className="border-bottom">{ t('markdown_setting.XSS_setting') }</h2>
          <p className="well">{ t('markdown_setting.XSS_setting_desc') }</p>
          <XssForm />
        </div>
      </React.Fragment>
    );
  }

}

const MarkdownSettingWrapper = (props) => {
  return createSubscribedElement(MarkdownSetting, props, [AppContainer]);
};

MarkdownSetting.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,

};

export default withTranslation()(MarkdownSettingWrapper);
