import React, { useCallback, type JSX } from 'react';

import { useTranslation } from 'next-i18next';
import { Card, CardBody } from 'reactstrap';

import AdminCustomizeContainer from '~/client/services/AdminCustomizeContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../UnstatedUtils';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

import CustomizeFunctionOption from './CustomizeFunctionOption';
import PagingSizeUncontrolledDropdown from './PagingSizeUncontrolledDropdown';

type Props = {
  adminCustomizeContainer: AdminCustomizeContainer
}

const CustomizeFunctionSetting = (props: Props): JSX.Element => {

  const { adminCustomizeContainer } = props;
  const { t } = useTranslation();

  const onClickSubmit = useCallback(async() => {

    try {
      await adminCustomizeContainer.updateCustomizeFunction();
      toastSuccess(t('toaster.update_successed', { target: t('admin:customize_settings.function'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [t, adminCustomizeContainer]);

  return (
    <React.Fragment>
      <div className="row">
        <div className="col-12">
          <h2 className="admin-setting-header">{t('admin:customize_settings.function')}</h2>
          <Card className="card custom-card bg-body-tertiary my-3">
            <CardBody className="px-0 py-2">
              {t('admin:customize_settings.function_desc')}
            </CardBody>
          </Card>


          <div className="row mt-4">
            <div className="offset-md-2 col-md-7 text-start">
              <CustomizeFunctionOption
                optionId="isEnabledAttachTitleHeader"
                label={t('admin:customize_settings.function_options.attach_title_header')}
                isChecked={adminCustomizeContainer.state.isEnabledAttachTitleHeader}
                onChecked={() => { adminCustomizeContainer.switchEnabledAttachTitleHeader() }}
              >
                <p className="form-text text-muted">
                  {t('admin:customize_settings.function_options.attach_title_header_desc')}
                </p>
              </CustomizeFunctionOption>
            </div>
          </div>

          <PagingSizeUncontrolledDropdown
            label={t('admin:customize_settings.function_options.list_num_s')}
            desc={t('admin:customize_settings.function_options.list_num_desc_s')}
            toggleLabel={adminCustomizeContainer.state.pageLimitationS || 20}
            dropdownItemSize={[10, 20, 50, 100]}
            onChangeDropdownItem={adminCustomizeContainer.switchPageListLimitationS}
          />
          <PagingSizeUncontrolledDropdown
            label={t('admin:customize_settings.function_options.list_num_m')}
            desc={t('admin:customize_settings.function_options.list_num_desc_m')}
            toggleLabel={adminCustomizeContainer.state.pageLimitationM || 10}
            dropdownItemSize={[5, 10, 20, 50, 100]}
            onChangeDropdownItem={adminCustomizeContainer.switchPageListLimitationM}
          />
          <PagingSizeUncontrolledDropdown
            label={t('admin:customize_settings.function_options.list_num_l')}
            desc={t('admin:customize_settings.function_options.list_num_desc_l')}
            toggleLabel={adminCustomizeContainer.state.pageLimitationL || 50}
            dropdownItemSize={[20, 50, 100, 200]}
            onChangeDropdownItem={adminCustomizeContainer.switchPageListLimitationL}
          />
          <PagingSizeUncontrolledDropdown
            label={t('admin:customize_settings.function_options.list_num_xl')}
            desc={t('admin:customize_settings.function_options.list_num_desc_xl')}
            toggleLabel={adminCustomizeContainer.state.pageLimitationXL || 20}
            dropdownItemSize={[5, 10, 20, 50, 100]}
            onChangeDropdownItem={adminCustomizeContainer.switchPageListLimitationXL}
          />

          <div className="row">
            <div className="offset-md-2 col-md-7 text-start">
              <CustomizeFunctionOption
                optionId="isEnabledStaleNotification"
                label={t('admin:customize_settings.function_options.stale_notification')}
                isChecked={adminCustomizeContainer.state.isEnabledStaleNotification}
                onChecked={() => { adminCustomizeContainer.switchEnableStaleNotification() }}
              >
                <p className="form-text text-muted">
                  {t('admin:customize_settings.function_options.stale_notification_desc')}
                </p>
              </CustomizeFunctionOption>
            </div>
          </div>

          <div className="row">
            <div className="offset-md-2 col-md-7 text-start">
              <CustomizeFunctionOption
                optionId="isAllReplyShown"
                label={t('admin:customize_settings.function_options.show_all_reply_comments')}
                isChecked={adminCustomizeContainer.state.isAllReplyShown || false}
                onChecked={() => { adminCustomizeContainer.switchIsAllReplyShown() }}
              >
                <p className="form-text text-muted">
                  {t('admin:customize_settings.function_options.show_all_reply_comments_desc')}
                </p>
              </CustomizeFunctionOption>
            </div>
          </div>

          <div className="row">
            <div className="offset-md-2 col-md-7 text-start">
              <CustomizeFunctionOption
                optionId="isSearchScopeChildrenAsDefault"
                label={t('admin:customize_settings.function_options.select_search_scope_children_as_default')}
                isChecked={adminCustomizeContainer.state.isSearchScopeChildrenAsDefault || false}
                onChecked={() => { adminCustomizeContainer.switchIsSearchScopeChildrenAsDefault() }}
              >
                <p className="form-text text-muted">
                  {t('admin:customize_settings.function_options.select_search_scope_children_as_default_desc')}
                </p>
              </CustomizeFunctionOption>
            </div>
          </div>

          <div className="row">
            <div className="offset-md-2 col-md-7 text-start">
              <CustomizeFunctionOption
                optionId="showPageSideAuthors"
                label={t('admin:customize_settings.function_options.show_page_side_authors')}
                isChecked={adminCustomizeContainer.state.showPageSideAuthors}
                onChecked={() => { adminCustomizeContainer.switchShowPageSideAuthors() }}
              >
                <p className="form-text text-muted">
                  {t('admin:customize_settings.function_options.show_page_side_authors_desc')}
                </p>
              </CustomizeFunctionOption>
            </div>
          </div>

          <AdminUpdateButtonRow onClick={onClickSubmit} disabled={adminCustomizeContainer.state.retrieveError != null} />
        </div>
      </div>
    </React.Fragment>
  );

};

const CustomizeFunctionSettingWrapper = withUnstatedContainers(CustomizeFunctionSetting, [AdminCustomizeContainer]);

export default CustomizeFunctionSettingWrapper;
