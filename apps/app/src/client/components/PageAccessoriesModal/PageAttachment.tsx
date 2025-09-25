import React, {
  useCallback, useMemo, useState, type JSX,
} from 'react';

import type { IAttachmentHasId } from '@growi/core';
import { LoadingSpinner } from '@growi/ui/dist/components';

import { useIsGuestUser, useIsReadOnlyUser } from '~/stores-universal/context';
import { useSWRxAttachments } from '~/stores/attachment';
import { useDeleteAttachmentModal } from '~/stores/modal';
import { useSWRxCurrentPage, useCurrentPageId } from '~/stores/page';

import { PageAttachmentList } from '../PageAttachment/PageAttachmentList';
import PaginationWrapper from '../PaginationWrapper';

// Utility
const checkIfFileInUse = (markdown: string, attachment): boolean => {
  return markdown.indexOf(attachment._id) >= 0;
};

const PageAttachment = (): JSX.Element => {

  // Static SWRs
  const { data: pageId } = useCurrentPageId();
  const { data: isGuestUser } = useIsGuestUser();
  const { data: isReadOnlyUser } = useIsReadOnlyUser();

  const isPageAttachmentDisabled = !!isGuestUser || !!isReadOnlyUser;

  // States
  const [pageNumber, setPageNumber] = useState(1);

  // SWRs
  const { data: dataAttachments, remove } = useSWRxAttachments(pageId, pageNumber);
  const { open: openDeleteAttachmentModal } = useDeleteAttachmentModal();
  const { data: currentPage } = useSWRxCurrentPage();
  const markdown = currentPage?.revision?.body;

  // Custom hooks
  const inUseAttachmentsMap: { [id: string]: boolean } | undefined = useMemo(() => {
    if (markdown == null || dataAttachments == null) {
      return undefined;
    }

    const attachmentEntries = dataAttachments.attachments
      .map((attachment) => {
        return [attachment._id, checkIfFileInUse(markdown, attachment)];
      });

    return Object.fromEntries(attachmentEntries);
  }, [dataAttachments, markdown]);

  // Methods
  const onChangePageHandler = useCallback((newPageNumber: number) => {
    setPageNumber(newPageNumber);
  }, []);

  const onAttachmentDeleteClicked = useCallback((attachment: IAttachmentHasId) => {
    openDeleteAttachmentModal(attachment, remove);
  }, [openDeleteAttachmentModal, remove]);

  // Renderers
  const renderPageAttachmentList = useCallback(() => {
    if (dataAttachments == null || inUseAttachmentsMap == null) {
      return (
        <div className="text-muted text-center">
          <LoadingSpinner className="me-1 fs-3" />
        </div>
      );
    }

    return (
      <PageAttachmentList
        attachments={dataAttachments.attachments}
        inUse={inUseAttachmentsMap}
        onAttachmentDeleteClicked={onAttachmentDeleteClicked}
        isUserLoggedIn={!isPageAttachmentDisabled}
      />
    );
  }, [dataAttachments, inUseAttachmentsMap, isPageAttachmentDisabled, onAttachmentDeleteClicked]);

  const renderPaginationWrapper = useCallback(() => {
    if (dataAttachments == null || dataAttachments.attachments.length === 0) {
      return <></>;
    }

    return (
      <PaginationWrapper
        activePage={pageNumber}
        changePage={onChangePageHandler}
        totalItemsCount={dataAttachments.totalAttachments}
        pagingLimit={dataAttachments.limit}
        align="center"
      />
    );
  }, [dataAttachments, onChangePageHandler, pageNumber]);

  return (
    <div data-testid="page-attachment">
      {renderPageAttachmentList()}
      {renderPaginationWrapper()}
    </div>
  );
};

export default PageAttachment;
