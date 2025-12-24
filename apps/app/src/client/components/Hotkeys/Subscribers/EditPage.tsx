import { useCallback, useEffect, useRef } from 'react';

import { useTranslation } from 'next-i18next';

import { useStartEditing } from '~/client/services/use-start-editing';
import { toastError } from '~/client/util/toastr';
import { useCurrentPathname } from '~/states/global';
import { useIsEditable, useCurrentPagePath } from '~/states/page';

type Props = {
  onDeleteRender: () => void,
}

/**
 * Custom hook for edit page logic
 */
const useEditPage = (
    onCompleted: () => void,
    onError?: (path: string) => void,
): void => {
  const isEditable = useIsEditable();
  const startEditing = useStartEditing();
  const currentPagePath = useCurrentPagePath();
  const currentPathname = useCurrentPathname();
  const path = currentPagePath ?? currentPathname;
  const isExecutedRef = useRef(false);

  useEffect(() => {
    (async() => {
      // Prevent multiple executions
      if (isExecutedRef.current) return;
      isExecutedRef.current = true;

      if (!isEditable) {
        return;
      }

      // ignore when dom that has 'modal in' classes exists
      if (document.getElementsByClassName('modal in').length > 0) {
        return;
      }

      try {
        await startEditing(path);
      }
      catch (err) {
        onError?.(path);
      }

      onCompleted();
    })();
  }, [startEditing, isEditable, path, onCompleted, onError]);
};

/**
 * EditPage component - handles hotkey 'e' for editing
 */
const EditPage = (props: Props): null => {
  const { t } = useTranslation('commons');

  const handleError = useCallback((path: string) => {
    toastError(t('toaster.create_failed', { target: path }));
  }, [t]);

  useEditPage(props.onDeleteRender, handleError);

  return null;
};

EditPage.getHotkeyStrokes = () => {
  return [['e']];
};

export default EditPage;
