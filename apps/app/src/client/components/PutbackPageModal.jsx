import React, { useState, useCallback, useMemo } from 'react';


import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import { apiPost } from '~/client/util/apiv1-client';
import { usePutBackPageModalActions, usePutBackPageModalStatus } from '~/states/ui/modal/put-back-page';
import { mutateAllPageInfo } from '~/stores/page';

import ApiErrorMessageList from './PageManagement/ApiErrorMessageList';

const PutBackPageModalSubstance = ({ pageDataToRevert, closePutBackPageModal }) => {
  const { t } = useTranslation();

  const { page } = pageDataToRevert;
  const { pageId, path } = page;
  const onPutBacked = pageDataToRevert.opts?.onPutBacked;

  const [errs, setErrs] = useState(null);
  const [targetPath, setTargetPath] = useState(null);

  const [isPutbackRecursively, setIsPutbackRecursively] = useState(true);

  const changeIsPutbackRecursivelyHandler = useCallback(() => {
    setIsPutbackRecursively(!isPutbackRecursively);
  }, [isPutbackRecursively]);

  const putbackPageButtonHandler = useCallback(async () => {
    setErrs(null);

    try {
      // control flag
      // If is it not true, Request value must be `null`.
      const recursively = isPutbackRecursively ? true : null;

      const response = await apiPost('/pages.revertRemove', {
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
      setTargetPath(err.data);
      setErrs([err]);
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

PutBackPageModalSubstance.propTypes = {
  pageDataToRevert: PropTypes.shape({
    page: PropTypes.shape({
      pageId: PropTypes.string,
      path: PropTypes.string,
    }),
    opts: PropTypes.shape({
      onPutBacked: PropTypes.func,
    }),
  }).isRequired,
  closePutBackPageModal: PropTypes.func.isRequired,
};

const PutBackPageModal = () => {
  const pageDataToRevert = usePutBackPageModalStatus();
  const { close: closePutBackPageModal } = usePutBackPageModalActions();
  const { isOpened } = pageDataToRevert;

  const closeModalHandler = useCallback(() => {
    closePutBackPageModal();
  }, [closePutBackPageModal]);

  return (
    <Modal isOpen={isOpened} toggle={closeModalHandler} data-testid="put-back-page-modal">
      {isOpened && (
        <PutBackPageModalSubstance
          pageDataToRevert={pageDataToRevert}
          closePutBackPageModal={closePutBackPageModal}
        />
      )}
    </Modal>
  );
};

export default PutBackPageModal;
