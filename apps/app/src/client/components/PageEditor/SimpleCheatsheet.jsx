import React from 'react';

import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

class SimpleCheatsheet extends React.Component {

  render() {
    const { t } = this.props;

    return (
      <div className="card bg-default gfm-cheatsheet mb-0">
        <div className="card-body small p-b-0">
          <div className="row">
            <div className="col-sm-6">
              <p>
                # {t('sandbox.header_x', { index: '1' })}<br />
                ## {t('sandbox.header_x', { index: '2' })}
              </p>
              <p><i>*{t('sandbox.italics')}*</i>&nbsp;&nbsp;<b>**{t('sandbox.bold')}**</b></p>
              <p>
                [{t('sandbox.link')}](http://..)<br />
                [/Page1/ChildPage1]
              </p>
              <p>
                ```javascript:index.js<br />
                writeCode();<br />
                ```
              </p>
            </div>
            <div className="col-sm-6">
              <p>
                - {t('sandbox.unordered_list_x', { index: '1' })}<br />
                &nbsp;&nbsp;&nbsp;- {t('sandbox.unordered_list_x', { index: '1.1' })}<br />
                - {t('sandbox.unordered_list_x', { index: '2' })}<br />
                1. {t('sandbox.ordered_list_x', { index: '1' })}<br />
                1. {t('sandbox.ordered_list_x', { index: '2' })}
              </p>
              <hr />
              <p>[ ][ ] {t('sandbox.block_detail')}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

}

SimpleCheatsheet.propTypes = {
  t: PropTypes.func.isRequired, // i18next
};

const SimpleCheatsheetWrapperFC = (props) => {
  const { t } = useTranslation();
  return <SimpleCheatsheet t={t} {...props} />;
};

export default SimpleCheatsheetWrapperFC;
