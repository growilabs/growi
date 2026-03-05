import React, { type JSX } from 'react';
import { useTranslation } from 'next-i18next';

type Props = {
  isLinkSharingDisabled?: boolean;
};

const ForbiddenPage = React.memo((props: Props): JSX.Element => {
  const { t } = useTranslation();

  return (
    <>
      <div className="row not-found-message-row mb-4">
        <div className="col-lg-12">
          <h2 className="text-muted">
            <span className="material-symbols-outlined" aria-hidden="true">
              block
            </span>
            {t('Forbidden')}
          </h2>
        </div>
      </div>

      <div className="row row-alerts d-edit-none">
        <div className="col-sm-12">
          <p className="alert alert-primary py-3 px-4">
            <span className="material-symbols-outlined" aria-hidden="true">
              lock
            </span>
            {props.isLinkSharingDisabled
              ? t('share_links.link_sharing_is_disabled')
              : t('Browsing of this page is restricted')}
          </p>
        </div>
      </div>
    </>
  );
});

ForbiddenPage.displayName = 'ForbiddenPage';

export default ForbiddenPage;
