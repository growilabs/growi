import React, { type JSX } from 'react';

import type { IAttachmentHasId } from '@growi/core';
import { Attachment } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

type Props = {
  attachments: (IAttachmentHasId)[],
  inUse: { [id: string]: boolean },
  onAttachmentDeleteClicked: (attachment: IAttachmentHasId) => void,
  isUserLoggedIn?: boolean,
}

export const PageAttachmentList = (props: Props): JSX.Element => {
  const { t } = useTranslation();

  const {
    attachments, inUse, onAttachmentDeleteClicked, isUserLoggedIn,
  } = props;

  if (attachments.length === 0) {
    return <>{t('No_attachments_yet')}</>;
  }

  return (
    <div>
      <ul className="ps-2">
        {attachments.map((attachment) => {
          return (
            <Attachment
              key={`page:attachment:${attachment._id}`}
              attachment={attachment}
              inUse={inUse[attachment._id] || false}
              onAttachmentDeleteClicked={onAttachmentDeleteClicked}
              isUserLoggedIn={isUserLoggedIn}
            />
          );
        })}
      </ul>
    </div>
  );

};
