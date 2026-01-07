/* eslint-disable react/no-danger */
import React, { useCallback } from 'react';
import { useTranslation } from 'next-i18next';
import {
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
  UncontrolledDropdown,
} from 'reactstrap';

import AdminMarkDownContainer from '~/client/services/AdminMarkDownContainer';
import { toastError, toastSuccess } from '~/client/util/toastr';
import loggerFactory from '~/utils/logger';

import { withUnstatedContainers } from '../../UnstatedUtils';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

const logger = loggerFactory('growi:importer');

type Props = {
  adminMarkDownContainer: AdminMarkDownContainer;
};

const IndentForm = (props: Props) => {
  const { t } = useTranslation('admin');

  const onClickSubmit = useCallback(
    async (props) => {
      try {
        await props.adminMarkDownContainer.updateIndentSetting();
        toastSuccess(
          t('toaster.update_successed', {
            target: t('markdown_settings.indent_header'),
            ns: 'commons',
          }),
        );
      } catch (err) {
        toastError(err);
        logger.error(err);
      }
    },
    [t],
  );

  const renderIndentSizeOption = (props) => {
    const { adminMarkDownContainer } = props;
    const { adminPreferredIndentSize } = adminMarkDownContainer.state;

    return (
      <div className="col">
        <div>
          <label htmlFor="adminPreferredIndentSize" className="form-label">
            {t('markdown_settings.indent_options.indentSize')}
          </label>
          <UncontrolledDropdown id="adminPreferredIndentSize">
            <DropdownToggle
              caret
              className="col-3 col-sm-2 col-md-5 col-lg-5 col-xl-3 text-end"
            >
              <span className="float-start">
                {adminPreferredIndentSize || 4}
              </span>
            </DropdownToggle>
            <DropdownMenu className="dropdown-menu" role="menu">
              {[2, 4].map((num) => {
                return (
                  <DropdownItem
                    key={num}
                    role="presentation"
                    onClick={() =>
                      adminMarkDownContainer.setAdminPreferredIndentSize(num)
                    }
                  >
                    <span>{num}</span>
                  </DropdownItem>
                );
              })}
            </DropdownMenu>
          </UncontrolledDropdown>
        </div>
        <p className="form-text text-muted">
          {t('markdown_settings.indent_options.indentSize_desc')}
        </p>
      </div>
    );
  };

  const renderIndentForceOption = (props) => {
    const { adminMarkDownContainer } = props;
    const { isIndentSizeForced } = adminMarkDownContainer.state;

    const helpIndentInComment = {
      __html: t('markdown_settings.indent_options.disallow_indent_change_desc'),
    };

    return (
      <div className="col">
        <div className="form-check form-check-success">
          <input
            type="checkbox"
            className="form-check-input"
            id="isIndentSizeForced"
            checked={isIndentSizeForced || false}
            onChange={() => {
              adminMarkDownContainer.setState({
                isIndentSizeForced: !isIndentSizeForced,
              });
            }}
          />
          <label
            className="form-label form-check-label"
            htmlFor="isIndentSizeForced"
          >
            {t('markdown_settings.indent_options.disallow_indent_change')}
          </label>
        </div>
        <p
          className="form-text text-muted"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: translation contains HTML markup
          dangerouslySetInnerHTML={helpIndentInComment}
        />
      </div>
    );
  };

  const { adminMarkDownContainer } = props;

  return (
    <React.Fragment>
      <fieldset className="row row-cols-1 row-cols-md-2 mx-3">
        {renderIndentSizeOption(props)}
        {renderIndentForceOption(props)}
      </fieldset>
      <AdminUpdateButtonRow
        onClick={() => onClickSubmit(props)}
        disabled={adminMarkDownContainer.state.retrieveError != null}
      />
    </React.Fragment>
  );
};

/**
 * Wrapper component for using unstated
 */
const IndentFormWrapper = withUnstatedContainers(IndentForm, [
  AdminMarkDownContainer,
]);

export default IndentFormWrapper;
