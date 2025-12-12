import { useEffect, useRef } from 'react';

import { useTranslation } from 'next-i18next';

import { useStartEditing } from '~/client/services/use-start-editing';
import { toastError } from '~/client/util/toastr';
import { useCurrentPathname } from '~/states/global';
import { useIsEditable, useCurrentPagePath } from '~/states/page';

type Props = {
  onDeleteRender: () => void,
}

const EditPage = (props: Props): null => {
  const { t } = useTranslation('commons');
  const isEditable = useIsEditable();
  const startEditing = useStartEditing();
  const currentPagePath = useCurrentPagePath();
  const currentPathname = useCurrentPathname();
  const path = currentPagePath ?? currentPathname;
  const isExecutedRef = useRef(false);

  // setup effect
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
        toastError(t('toaster.create_failed', { target: path }));
      }

      // remove this
      props.onDeleteRender();
    })();
  }, [startEditing, isEditable, path, props, t]);

  return null;
};

EditPage.getHotkeyStrokes = () => {
  return [['e']];
};

export default EditPage;
