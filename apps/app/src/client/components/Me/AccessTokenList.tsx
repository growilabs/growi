import React, { useState } from 'react';

import { useTranslation } from 'react-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter, Button,
} from 'reactstrap';

import type { IResGetAccessToken } from '~/interfaces/access-token';

type AccessTokenListProps = {
  accessTokens: IResGetAccessToken[];
  deleteHandler?: (tokenId: string) => void;
}
export const AccessTokenList = React.memo((props: AccessTokenListProps): JSX.Element => {


  const { t } = useTranslation();
  const { accessTokens, deleteHandler } = props;
  const [tokenToDelete, setTokenToDelete] = useState<string | null>(null);

  const handleDeleteClick = (tokenId: string) => {
    setTokenToDelete(tokenId);
  };

  const handleConfirmDelete = () => {
    if (tokenToDelete != null && deleteHandler != null) {
      deleteHandler(tokenToDelete);
      setTokenToDelete(null);
    }
  };

  const toggleModal = () => {
    setTokenToDelete(null);
  };

  return (
    <>
      <div className="table">
        <table className="table table-bordered">
          <thead>
            <tr>
              <th>{t('page_me_access_token.description')}</th>
              <th>{t('page_me_access_token.expiredAt')}</th>
              <th>{t('page_me_access_token.scope')}</th>
              <th>{t('page_me_access_token.action')}</th>
            </tr>
          </thead>
          <tbody>
            {(accessTokens.length === 0)
              ? (
                <tr>
                  <td colSpan={4} className="text-center">
                    {t('page_me_access_token.no_tokens_found')}
                  </td>
                </tr>
              )
              : (
                <>{
                  accessTokens.map(token => (
                    <tr key={token._id}>
                      <td className="text-break">{token.description}</td>
                      <td>{token.expiredAt.toString().split('T')[0]}</td>
                      <td>{token.scopes.join(', ')}</td>
                      <td>
                        <button
                          className="btn btn-danger"
                          type="button"
                          onClick={() => handleDeleteClick(token._id)}
                          data-testid="grw-accesstoken-delete-button"
                        >
                          {t('Delete')}
                        </button>
                      </td>
                    </tr>
                  ))
                }
                </>
              )}
          </tbody>
        </table>
      </div>

      {/* Confirmation Modal using Reactstrap */}
      <Modal isOpen={tokenToDelete !== null} toggle={toggleModal} centered>
        <ModalHeader tag="h4" toggle={toggleModal} className="bg-danger text-white">
          <span className="material-symbols-outlined me-1">warning</span>
          {t('Warning')}
        </ModalHeader>
        <ModalBody>
          <p>{t('page_me_access_token.modal.message')}</p>
          <p className="text-danger fw-bold">{t('page_me_access_token.modal.alert')}</p>
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" onClick={toggleModal} data-testid="grw-accesstoken-cancel-button-in-modal">
            {t('Cancel')}
          </Button>
          <Button color="danger" onClick={handleConfirmDelete} data-testid="grw-accesstoken-delete-button-in-modal">
            {t('page_me_access_token.modal.delete_token')}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
});
AccessTokenList.displayName = 'AccessTokenList';
