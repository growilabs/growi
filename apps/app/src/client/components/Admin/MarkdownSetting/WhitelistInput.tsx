import { useCallback, useRef, type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import type AdminMarkDownContainer from '~/client/services/AdminMarkDownContainer';
import { tagNames as recommendedTagNames, attributes as recommendedAttributes } from '~/services/renderer/recommended-whitelist';

type Props ={
  adminMarkDownContainer: AdminMarkDownContainer
}

export const WhitelistInput = (props: Props): JSX.Element => {

  const { t } = useTranslation('admin');
  const { adminMarkDownContainer } = props;

  const tagNamesRef = useRef<HTMLTextAreaElement>(null);
  const attrsRef = useRef<HTMLTextAreaElement>(null);

  const clickRecommendTagButtonHandler = useCallback(() => {
    if (tagNamesRef.current == null) {
      return;
    }

    const tagWhitelist = recommendedTagNames.join(',');
    tagNamesRef.current.value = tagWhitelist;
    adminMarkDownContainer.setState({ tagWhitelist });
  }, [adminMarkDownContainer]);

  const clickRecommendAttrButtonHandler = useCallback(() => {
    if (attrsRef.current == null) {
      return;
    }

    const attrWhitelist = JSON.stringify(recommendedAttributes);
    attrsRef.current.value = attrWhitelist;
    adminMarkDownContainer.setState({ attrWhitelist });
  }, [adminMarkDownContainer]);

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
          ref={tagNamesRef}
          className="form-control xss-list"
          name="recommendedTags"
          rows={6}
          cols={40}
          value={adminMarkDownContainer.state.tagWhitelist}
          onChange={(e) => { adminMarkDownContainer.setState({ tagWhitelist: e.target.value }) }}
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
          ref={attrsRef}
          className="form-control xss-list"
          name="recommendedAttrs"
          rows={6}
          cols={40}
          value={adminMarkDownContainer.state.attrWhitelist}
          onChange={(e) => { adminMarkDownContainer.setState({ attrWhitelist: e.target.value }) }}
        />
      </div>
    </>
  );

};
