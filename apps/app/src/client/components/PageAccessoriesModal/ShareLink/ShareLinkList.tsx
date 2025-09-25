import React, { type JSX } from 'react';

import { format as dateFnsFormat } from 'date-fns/format';
import { useTranslation } from 'next-i18next';

import { CopyDropdown } from '../../Common/CopyDropdown';


type ShareLinkTrProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shareLink: any,
  isAdmin?: boolean,
  onDelete?: () => void,
}

const ShareLinkTr = (props: ShareLinkTrProps): JSX.Element => {
  const { t } = useTranslation();

  const { isAdmin, shareLink, onDelete } = props;

  const { _id: shareLinkId, relatedPage } = shareLink;

  const isRelatedPageExists = relatedPage != null;

  return (
    <tr key={shareLinkId}>
      <td className="d-flex justify-content-between align-items-center">
        <span data-testid="share-link">{shareLinkId}</span>

        { isRelatedPageExists && (
          <CopyDropdown
            pagePath={relatedPage.path}
            dropdownToggleId={`copydropdown-for-share-link-list-${shareLinkId}`}
            pageId={shareLinkId}
            isShareLinkMode
          >
            Copy Link
          </CopyDropdown>
        ) }
      </td>
      { isAdmin && (
        <td>
          { isRelatedPageExists
            ? <a href={relatedPage.path}>{relatedPage.path}</a>
            : '(Page is not found)'
          }
        </td>
      ) }
      <td style={{ verticalAlign: 'middle' }}>
        {shareLink.description}
      </td>
      <td style={{ verticalAlign: 'middle' }}>
        {shareLink.expiredAt && <span>{dateFnsFormat(new Date(shareLink.expiredAt), 'yyyy-MM-dd HH:mm')}</span>}
      </td>
      <td style={{ maxWidth: '50', textAlign: 'center' }}>
        <button className="btn btn-outline-danger" type="button" onClick={onDelete}>
          <span className="material-symbols-outlined">delete</span>{t('Delete')}
        </button>
      </td>
    </tr>
  );
};


type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shareLinks: any[],
  onClickDeleteButton?: (shareLinkId: string) => void,
  isAdmin?: boolean,
}

const ShareLinkList = (props: Props): JSX.Element => {

  const { t } = useTranslation('commons');

  function renderShareLinks() {
    return (
      <>
        {props.shareLinks.map(shareLink => (
          <ShareLinkTr
            key={shareLink._id}
            isAdmin={props.isAdmin}
            shareLink={shareLink}
            onDelete={() => {
              if (props.onClickDeleteButton == null) {
                return;
              }
              props.onClickDeleteButton(shareLink._id);
            }}
          />
        ))}
      </>
    );
  }

  return (
    <div className="table-responsive">
      <table className="table table-bordered">
        <thead>
          <tr>
            <th style={{ width: '350px' }}>{t('share_links.Share Link', { ns: 'commons' })}</th>
            {props.isAdmin && <th>{t('share_links.Page Path', { ns: 'commons' })}</th>}
            <th>{t('share_links.description', { ns: 'commons' })}</th>
            <th style={{ width: '150px' }}>{t('share_links.expire', { ns: 'commons' })}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {renderShareLinks()}
        </tbody>
      </table>
    </div>
  );
};

export default ShareLinkList;
