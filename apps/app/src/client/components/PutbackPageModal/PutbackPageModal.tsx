import type { FC } from 'react';
import { useState, useCallback, useMemo } from 'react';

import { useTranslation } from 'next-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import { apiPost } from '~/client/util/apiv1-client';
import type { PutBackPageModalStatus } from '~/states/ui/modal/put-back-page';
import { usePutBackPageModalActions, usePutBackPageModalStatus } from '~/states/ui/modal/put-back-page';
import { mutateAllPageInfo } from '~/stores/page';

import ApiErrorMessageList from '../PageManagement/ApiErrorMessageList';

type ApiError = {
  data?: string;
};

type ApiResponse = {
  page: {
    path: string;
  };
};

type PutBackPageModalSubstanceProps = {
  pageDataToRevert: PutBackPageModalStatus & { page: NonNullable<PutBackPageModalStatus['page']> };
  closePutBackPageModal: () => void;
};

const PutBackPageModalSubstance: FC<PutBackPageModalSubstanceProps> = ({ pageDataToRevert, closePutBackPageModal }) => {
  const { t } = useTranslation();

  const { page } = pageDataToRevert;
  const { pageId, path } = page;
  const onPutBacked = pageDataToRevert.opts?.onPutBacked;

  const [errs, setErrs] = useState<ApiError[] | null>(null);
  const [targetPath, setTargetPath] = useState<string | null>(null);

  const [isPutbackRecursively, setIsPutbackRecursively] = useState(true);

  const changeIsPutbackRecursivelyHandler = useCallback(() => {
    setIsPutbackRecursively(!isPutbackRecursively);
  }, [isPutbackRecursively]);

  const putbackPageButtonHandler = useCallback(async() => {
    setErrs(null);

    try {
      // control flag
      // If is it not true, Request value must be `null`.
      const recursively = isPutbackRecursively ? true : null;

      const response = await apiPost<ApiResponse>('/pages.revertRemove', {
        page_id: pageId,
        recursively,
      });
      mutateAllPageInfo();

      if (onPutBacked != null) {
        onPutBacked(response.page.path);
      }
      closePutBackPageModal();
    }
    catch (err) {
      setTargetPath((err as ApiError).data ?? null);
      setErrs([err as ApiError]);
    }
  }, [pageId, isPutbackRecursively, onPutBacked, closePutBackPageModal]);

  const closeModalHandler = useCallback(() => {
    closePutBackPageModal();
    setErrs(null);
  }, [closePutBackPageModal]);

  const headerContent = useMemo(() => (
    <>
      <span className="material-symbols-outlined" aria-hidden="true">undo</span> { t('modal_putback.label.Put Back Page') }
    </>
  ), [t]);

  const bodyContent = useMemo(() => (
    <>
      <div>
        <label className="form-label">{t('modal_putback.label.Put Back Page')}:</label><br />
        <code>{path}</code>
      </div>
      <div className="form-check form-check-warning">
        <input
          className="form-check-input"
          id="cbPutBackRecursively"
          type="checkbox"
          checked={isPutbackRecursively}
          onChange={changeIsPutbackRecursivelyHandler}
        />
        <label htmlFor="cbPutBackRecursively" className="form-label form-check-label">
          { t('modal_putback.label.recursively') }
        </label>
        <p className="form-text text-muted mt-0">
          <code>{ path }</code>{ t('modal_putback.help.recursively') }
        </p>
      </div>
    </>
  ), [t, path, isPutbackRecursively, changeIsPutbackRecursivelyHandler]);

  const footerContent = useMemo(() => (
    <>
      <ApiErrorMessageList errs={errs} targetPath={targetPath} />
      <button type="button" className="btn btn-info" onClick={putbackPageButtonHandler} data-testid="put-back-execution-button">
        <span className="material-symbols-outlined" aria-hidden="true">undo</span> { t('Put Back') }
      </button>
    </>
  ), [errs, targetPath, putbackPageButtonHandler, t]);

  return (
    <>
      <ModalHeader tag="h4" toggle={closeModalHandler} className="text-info">
        {headerContent}
      </ModalHeader>
      <ModalBody>
        {bodyContent}
      </ModalBody>
      <ModalFooter>
        {footerContent}
      </ModalFooter>
    </>
  );
};

const PutBackPageModal: FC = () => {
  const pageDataToRevert = usePutBackPageModalStatus();
  const { close: closePutBackPageModal } = usePutBackPageModalActions();
  const { isOpened, page } = pageDataToRevert;

  const closeModalHandler = useCallback(() => {
    closePutBackPageModal();
  }, [closePutBackPageModal]);

  if (page == null) {
    return <></>;
  }

  return (
    <Modal isOpen={isOpened} toggle={closeModalHandler} data-testid="put-back-page-modal">
      {isOpened && (
        <PutBackPageModalSubstance
          pageDataToRevert={{ ...pageDataToRevert, page }}
          closePutBackPageModal={closePutBackPageModal}
        />
      )}
    </Modal>
  );
};

export { PutBackPageModal };
