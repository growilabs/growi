import { useCallback, type JSX } from 'react';

import { useTranslation } from 'next-i18next';
import type { UseFormRegister, UseFormSetValue } from 'react-hook-form';

import type AdminMarkDownContainer from '~/client/services/AdminMarkDownContainer';
import { tagNames as recommendedTagNames, attributes as recommendedAttributes } from '~/services/renderer/recommended-whitelist';

type FormValues = {
  tagWhitelist: string,
  attrWhitelist: string,
}

type Props ={
  adminMarkDownContainer: AdminMarkDownContainer,
  register: UseFormRegister<FormValues>,
  setValue: UseFormSetValue<FormValues>,
}

export const WhitelistInput = (props: Props): JSX.Element => {

  const { t } = useTranslation('admin');
  const { adminMarkDownContainer, register, setValue } = props;

  const clickRecommendTagButtonHandler = useCallback(() => {
    const tagWhitelist = recommendedTagNames.join(',');
    setValue('tagWhitelist', tagWhitelist);
    adminMarkDownContainer.setState({ tagWhitelist });
  }, [adminMarkDownContainer, setValue]);

  const clickRecommendAttrButtonHandler = useCallback(() => {
    const attrWhitelist = JSON.stringify(recommendedAttributes);
    setValue('attrWhitelist', attrWhitelist);
    adminMarkDownContainer.setState({ attrWhitelist });
  }, [adminMarkDownContainer, setValue]);

  return (
    <>
      <div className="mt-4">
        <div className="d-flex justify-content-between">
          {t('markdown_settings.xss_options.tag_names')}
          <p id="btn-import-tags" className="btn btn-sm btn-primary" onClick={clickRecommendTagButtonHandler}>
            {t('markdown_settings.xss_options.import_recommended', { target: 'Tags' })}
          </p>
        </div>
        <textarea
          className="form-control xss-list"
          rows={6}
          cols={40}
          {...register('tagWhitelist')}
        />
      </div>
      <div className="mt-4">
        <div className="d-flex justify-content-between">
          {t('markdown_settings.xss_options.tag_attributes')}
          <p id="btn-import-tags" className="btn btn-sm btn-primary" onClick={clickRecommendAttrButtonHandler}>
            {t('markdown_settings.xss_options.import_recommended', { target: 'Attrs' })}
          </p>
        </div>
        <textarea
          className="form-control xss-list"
          rows={6}
          cols={40}
          {...register('attrWhitelist')}
        />
      </div>
    </>
  );

};
