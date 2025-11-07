import React, { useCallback, useEffect } from 'react';

import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import { useForm } from 'react-hook-form';

import AdminMarkDownContainer from '~/client/services/AdminMarkDownContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { RehypeSanitizeType } from '~/interfaces/services/rehype-sanitize';
import { tagNames as recommendedTagNames, attributes as recommendedAttributes } from '~/services/renderer/recommended-whitelist';
import loggerFactory from '~/utils/logger';

import { withUnstatedContainers } from '../../UnstatedUtils';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

import { WhitelistInput } from './WhitelistInput';

const logger = loggerFactory('growi:importer');

const XssForm = (props) => {
  const { t, adminMarkDownContainer } = props;
  const {
    xssOption, tagWhitelist, attrWhitelist, retrieveError,
  } = adminMarkDownContainer.state;

  const {
    register, handleSubmit, reset, setValue,
  } = useForm();

  // Sync form with container state
  useEffect(() => {
    reset({
      tagWhitelist,
      attrWhitelist,
    });
  }, [reset, tagWhitelist, attrWhitelist]);

  const onClickSubmit = useCallback(async(data) => {
    try {
      await adminMarkDownContainer.setState({ tagWhitelist: data.tagWhitelist ?? '' });
      await adminMarkDownContainer.setState({ attrWhitelist: data.attrWhitelist ?? '' });
      await adminMarkDownContainer.updateXssSetting();
      toastSuccess(t('toaster.update_successed', { target: t('markdown_settings.xss_header'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
      logger.error(err);
    }
  }, [adminMarkDownContainer, t]);

  const xssOptions = useCallback(() => {

    const rehypeRecommendedTags = recommendedTagNames.join(',');
    const rehypeRecommendedAttributes = JSON.stringify(recommendedAttributes);

    return (
      <div className="col-12 mt-3">
        <div className="row">

          <div className="col-md-6 col-sm-12 align-self-start">
            <div className="form-check">
              <input
                type="radio"
                className="form-check-input"
                id="xssOption1"
                name="XssOption"
                checked={xssOption === RehypeSanitizeType.RECOMMENDED}
                onChange={() => { adminMarkDownContainer.setState({ xssOption: RehypeSanitizeType.RECOMMENDED }) }}
              />
              <label className="form-label form-check-label w-100" htmlFor="xssOption1">
                <p className="fw-bold">{t('markdown_settings.xss_options.recommended_setting')}</p>
                <div className="mt-4">
                  <div className="d-flex justify-content-between">
                    {t('markdown_settings.xss_options.tag_names')}
                  </div>
                  <textarea
                    className="form-control xss-list"
                    name="recommendedTags"
                    rows="6"
                    cols="40"
                    readOnly
                    defaultValue={rehypeRecommendedTags}
                  />
                </div>
                <div className="mt-4">
                  <div className="d-flex justify-content-between">
                    {t('markdown_settings.xss_options.tag_attributes')}
                  </div>
                  <textarea
                    className="form-control xss-list"
                    name="recommendedAttrs"
                    rows="6"
                    cols="40"
                    readOnly
                    defaultValue={rehypeRecommendedAttributes}
                  />
                </div>
              </label>
            </div>
          </div>

          <div className="col-md-6 col-sm-12 align-self-start">
            <div className="form-check">
              <input
                type="radio"
                className="form-check-input"
                id="xssOption2"
                name="XssOption"
                checked={xssOption === RehypeSanitizeType.CUSTOM}
                onChange={() => { adminMarkDownContainer.setState({ xssOption: RehypeSanitizeType.CUSTOM }) }}
              />
              <label className="form-label form-check-label w-100" htmlFor="xssOption2">
                <p className="fw-bold">{t('markdown_settings.xss_options.custom_whitelist')}</p>
                <WhitelistInput adminMarkDownContainer={adminMarkDownContainer} register={register} setValue={setValue} />
              </label>
            </div>
          </div>
        </div>
      </div>
    );
  }, [t, adminMarkDownContainer, xssOption, register, setValue]);

  const { isEnabledXss } = adminMarkDownContainer.state;

  return (
    <form onSubmit={handleSubmit(onClickSubmit)}>
      <React.Fragment>
        <fieldset className="col-12">
          <div>
            <div className="col-8 offset-4 mt-3">
              <div className="form-check form-switch form-check-success">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="XssEnable"
                  name="isEnabledXss"
                  checked={isEnabledXss}
                  onChange={adminMarkDownContainer.switchEnableXss}
                />
                <label className="form-label form-check-label w-100" htmlFor="XssEnable">
                  {t('markdown_settings.xss_options.enable_xss_prevention')}
                </label>
              </div>
            </div>
          </div>

          <div className="col-12">
            {isEnabledXss && xssOptions()}
          </div>
        </fieldset>
        <AdminUpdateButtonRow
          disabled={retrieveError != null}
          onClick={handleSubmit(onClickSubmit)}
        />
      </React.Fragment>
    </form>
  );
};

XssForm.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  adminMarkDownContainer: PropTypes.instanceOf(AdminMarkDownContainer).isRequired,
};

const XssFormWrapperFC = (props) => {
  const { t } = useTranslation('admin');

  return <XssForm t={t} {...props} />;
};

const XssFormWrapper = withUnstatedContainers(XssFormWrapperFC, [AdminMarkDownContainer]);

export default XssFormWrapper;
