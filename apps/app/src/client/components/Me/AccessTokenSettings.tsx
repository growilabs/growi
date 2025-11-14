import React, { useCallback } from 'react';

import { useTranslation } from 'next-i18next';
import CopyToClipboard from 'react-copy-to-clipboard';

import { toastSuccess, toastError } from '~/client/util/toastr';
import type { IAccessTokenInfo } from '~/interfaces/access-token';
import { useSWRxAccessToken } from '~/stores/personal-settings';

import { AccessTokenForm } from './AccessTokenForm';
import { AccessTokenList } from './AccessTokenList';


const NewTokenDisplay = React.memo(({ newToken, closeNewTokenDisplay }: { newToken?: string, closeNewTokenDisplay: () => void }): JSX.Element => {

  const { t } = useTranslation();

  // Handle successful copy
  const handleCopySuccess = useCallback(() => {
    toastSuccess(t('page_me_access_token.new_token.copy_to_clipboard'));
  }, [t]);

  if (newToken == null) {
    return <></>;
  }

  return (
    <div className="alert alert-success mb-4" role="alert" data-testid="grw-accesstoken-new-token-display">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="mb-0">
          {t('page_me_access_token.new_token.title')}
        </h5>
        <button
          type="button"
          className="btn-close"
          onClick={closeNewTokenDisplay}
          aria-label="Close"
        >
        </button>
      </div>

      <p className="fw-bold mb-2">{t('page_me_access_token.new_token.message')}</p>

      <div className="input-group mb-2">
        <input
          type="text"
          className="form-control font-monospace"
          value={newToken}
          readOnly
          data-vrt-blackout
        />
        <CopyToClipboard text={newToken} onCopy={handleCopySuccess}>
          <button
            className="btn btn-outline-secondary"
            type="button"
          >
            <span className="material-symbols-outlined">content_copy</span>
          </button>
        </CopyToClipboard>
      </div>
    </div>
  );
});

export const AccessTokenSettings = React.memo((): JSX.Element => {

  const { t } = useTranslation();

  const [isFormOpen, setIsFormOpen] = React.useState<boolean>(false);
  const toggleFormOpen = useCallback(() => {
    setIsFormOpen(prev => !prev);
  }, []);

  const [newToken, setNewToken] = React.useState<string | undefined>(undefined);

  const {
    data: accessTokens, mutate, generateAccessToken, deleteAccessToken,
  } = useSWRxAccessToken();

  const closeNewTokenDisplay = useCallback(() => {
    setNewToken(undefined);
  }, []);

  const submitHandler = useCallback(async(info: IAccessTokenInfo) => {
    try {
      const result = await generateAccessToken(info);
      mutate();
      setIsFormOpen(false);

      // Store the newly generated token to display to the user
      if (result?.token) {
        setNewToken(result.token);
      }

      toastSuccess(t('toaster.add_succeeded', { target: t('page_me_access_token.access_token'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [t, generateAccessToken, mutate, setIsFormOpen]);

  const deleteHandler = useCallback(async(tokenId: string) => {
    try {
      await deleteAccessToken(tokenId);
      mutate();
      toastSuccess(t('toaster.delete_succeeded', { target: t('page_me_access_token.access_token'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [deleteAccessToken, mutate, t]);

  return (
    <>

      <div className="container p-0">

        <NewTokenDisplay newToken={newToken} closeNewTokenDisplay={closeNewTokenDisplay} />
        <AccessTokenList accessTokens={accessTokens ?? []} deleteHandler={deleteHandler} />

        <button
          className="btn btn-outline-secondary d-block mx-auto px-5"
          type="button"
          onClick={toggleFormOpen}
          data-testid="btn-accesstoken-toggleform"
        >
          {isFormOpen ? t('Close') : t('New')}
        </button>
        {isFormOpen && <AccessTokenForm submitHandler={submitHandler} />}
      </div>
    </>
  );
});

AccessTokenSettings.displayName = 'AccessTokenSettings';
