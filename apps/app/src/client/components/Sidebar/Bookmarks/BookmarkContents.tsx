import React, { useCallback, useState, type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import { BookmarkFolderNameInput } from '~/client/components/Bookmarks/BookmarkFolderNameInput';
import { BookmarkFolderTree } from '~/client/components/Bookmarks/BookmarkFolderTree';
import { addNewFolder } from '~/client/util/bookmark-utils';
import { toastError } from '~/client/util/toastr';
import { useCurrentUser } from '~/states/global';
import { useSWRxBookmarkFolderAndChild } from '~/stores/bookmark-folder';

export const BookmarkContents = (): JSX.Element => {

  const { t } = useTranslation();
  const [isCreateAction, setIsCreateAction] = useState<boolean>(false);

  const currentUser = useCurrentUser();
  const { mutate: mutateBookmarkFolders } = useSWRxBookmarkFolderAndChild(currentUser?._id);

  const onClickNewBookmarkFolder = useCallback(() => {
    setIsCreateAction(true);
  }, []);

  const cancel = useCallback(() => {
    setIsCreateAction(false);
  }, []);

  const create = useCallback(async(folderName: string) => {
    if (folderName.trim() === '') {
      return cancel();
    }

    try {
      await addNewFolder(folderName.trim(), null);
      await mutateBookmarkFolders();
      setIsCreateAction(false);
    }
    catch (err) {
      toastError(err);
    }
  }, [cancel, mutateBookmarkFolders]);

  return (
    <div>
      <div className="mb-2">
        <button
          type="button"
          className="btn btn-outline-secondary rounded-pill d-flex justify-content-start align-middle"
          onClick={onClickNewBookmarkFolder}
        >

          <div className="d-flex align-items-center">
            <span className="material-symbols-outlined">create_new_folder</span>
            <span className="ms-2">{t('bookmark_folder.new_folder')}</span>
          </div>
        </button>
      </div>
      {isCreateAction && (
        <div className="col-12 mb-2 ">
          <BookmarkFolderNameInput
            onSubmit={create}
            onCancel={cancel}
          />
        </div>
      )}
      <BookmarkFolderTree isOperable userId={currentUser?._id} />
    </div>
  );
};
