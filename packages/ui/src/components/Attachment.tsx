import type { JSX } from 'react';
import type { IAttachmentHasId } from '@growi/core';
import { format } from 'date-fns/format';

import { UserPicture } from './UserPicture';

type AttachmentProps = {
  attachment: IAttachmentHasId;
  inUse: boolean;
  onAttachmentDeleteClicked?: (attachment: IAttachmentHasId) => void;
  isUserLoggedIn?: boolean;
};

export const Attachment = (props: AttachmentProps): JSX.Element => {
  const { attachment, inUse, isUserLoggedIn, onAttachmentDeleteClicked } =
    props;

  const _onAttachmentDeleteClicked = () => {
    if (onAttachmentDeleteClicked != null) {
      onAttachmentDeleteClicked(attachment);
    }
  };

  const formatIcon = attachment.fileFormat.match(/image\/.+/i)
    ? 'image'
    : 'description';
  const btnDownload = isUserLoggedIn ? (
    <a className="attachment-download" href={attachment.downloadPathProxied}>
      <span className="material-symbols-outlined">cloud_download</span>
    </a>
  ) : (
    ''
  );
  const btnTrash = isUserLoggedIn ? (
    <button
      className="text-danger attachment-delete btn btn-link p-0"
      onClick={_onAttachmentDeleteClicked}
      type="button"
    >
      <span className="material-symbols-outlined">delete</span>
    </button>
  ) : (
    ''
  );
  const fileType = (
    <span className="attachment-filetype badge bg-secondary rounded-pill">
      {attachment.fileFormat}
    </span>
  );
  const fileInUse = inUse ? (
    <span className="attachment-in-use badge bg-info rounded-pill">In Use</span>
  ) : (
    ''
  );
  // Should UserDate be used like PageRevisionTable ?
  const formatType = 'yyyy/MM/dd HH:mm:ss';
  const createdAt = format(new Date(attachment.createdAt), formatType);

  return (
    <div className="attachment mb-2">
      <span className="me-1 attachment-userpicture">
        <UserPicture user={attachment.creator} size="sm" />
      </span>
      <a
        className="me-2"
        href={attachment.filePathProxied}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="material-symbols-outlined ms-1">{formatIcon}</span>{' '}
        {attachment.originalName}
      </a>
      <span className="me-2">{fileType}</span>
      <span className="me-2">{createdAt}</span>
      <span className="me-2">{fileInUse}</span>
      <span className="me-2">{btnDownload}</span>
      <span className="me-2">{btnTrash}</span>
    </div>
  );
};
