import { type JSX, useCallback } from 'react';
import type { IAttachmentHasId } from '@growi/core';
import { Attachment, LoadingSpinner } from '@growi/ui/dist/components';

import { ExtractedAttachments } from './ExtractedAttachments';
import type { RefsContext } from './util/refs-context';

import styles from './AttachmentList.module.scss';

const AttachmentLink = Attachment;

type Props = {
  refsContext: RefsContext;
  isLoading: boolean;
  error?: Error;
  attachments: IAttachmentHasId[];
};

export const AttachmentList = ({
  refsContext,
  isLoading,
  error,
  attachments,
}: Props): JSX.Element => {
  const renderNoAttachmentsMessage = useCallback(() => {
    return (
      <div className="text-muted">
        <small>
          <span
            className="material-symbols-outlined fs-5 me-1"
            aria-hidden="true"
          >
            info
          </span>
          {refsContext.options?.prefix != null
            ? `${refsContext.options.prefix} and descendant pages have no attachments`
            : `${refsContext.pagePath} has no attachments`}
        </small>
      </div>
    );
  }, [refsContext]);

  const renderContents = useCallback(() => {
    if (isLoading) {
      return (
        <div className="text-muted">
          <LoadingSpinner className="me-1" />
          <span className="attachment-refs-blink">
            {refsContext.toString()}
          </span>
        </div>
      );
    }
    if (error != null) {
      return (
        <div className="text-warning">
          <span className="material-symbols-outlined me-1">warning</span>
          {refsContext.toString()} (-&gt; <small>{error.message}</small>)
        </div>
      );
    }

    // no attachments
    if (attachments.length === 0) {
      return renderNoAttachmentsMessage();
    }

    return refsContext.isExtractImage ? (
      <ExtractedAttachments
        attachments={attachments}
        refsContext={refsContext}
      />
    ) : (
      attachments.map((attachment) => {
        return (
          <AttachmentLink
            key={attachment._id}
            attachment={attachment}
            inUse={false}
          />
        );
      })
    );
  }, [isLoading, error, attachments, refsContext, renderNoAttachmentsMessage]);

  return <div className={styles['attachment-refs']}>{renderContents()}</div>;
};
