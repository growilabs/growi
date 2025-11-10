import React, {
  type ReactNode, useCallback, useMemo, type JSX,
} from 'react';

import { Origin } from '@growi/core';
import { getParentPath } from '@growi/core/dist/utils/path-utils';
import { useTranslation } from 'next-i18next';

import { useCreatePage } from '~/client/services/create-page';
import { toastError } from '~/client/util/toastr';
import { useCurrentPageYjsData } from '~/features/collaborative-editor/states';
import { usePageNotFound } from '~/states/page';
import { useDeviceLargerThanMd } from '~/states/ui/device';
import { useEditorMode, EditorMode } from '~/states/ui/editor';

import { shouldCreateWipPage } from '../../../utils/should-create-wip-page';


import styles from './PageEditorModeManager.module.scss';


type PageEditorModeButtonProps = {
  currentEditorMode: EditorMode,
  editorMode: EditorMode,
  children?: ReactNode,
  isBtnDisabled?: boolean,
  onClick?: () => void,
}
const PageEditorModeButton = React.memo((props: PageEditorModeButtonProps) => {
  const {
    currentEditorMode, isBtnDisabled, editorMode, children, onClick,
  } = props;

  const classNames = ['btn py-1 px-2 d-flex align-items-center justify-content-center'];
  if (currentEditorMode === editorMode) {
    classNames.push('active');
  }
  if (isBtnDisabled) {
    classNames.push('disabled');
  }

  return (
    <button
      type="button"
      className={classNames.join(' ')}
      onClick={onClick}
      data-testid={`${editorMode}-button`}
    >
      {children}
    </button>
  );
});

type Props = {
  editorMode: EditorMode | undefined,
  isBtnDisabled: boolean,
  path?: string,
}

export const PageEditorModeManager = (props: Props): JSX.Element => {
  const {
    editorMode = EditorMode.View,
    isBtnDisabled,
    path,
  } = props;

  const { t } = useTranslation('commons');

  const isNotFound = usePageNotFound();
  const { setEditorMode } = useEditorMode();
  const [isDeviceLargerThanMd] = useDeviceLargerThanMd();
  const currentPageYjsData = useCurrentPageYjsData();

  const { isCreating, create } = useCreatePage();

  const editButtonClickedHandler = useCallback(async () => {
    if (!isNotFound) {
      setEditorMode(EditorMode.Editor);
      return;
    }

    // Create a new page if it does not exist and transit to the editor mode
    try {
      const parentPath = path != null ? getParentPath(path) : undefined; // does not have to exist
      await create(
        {
          path, parentPath, wip: shouldCreateWipPage(path), origin: Origin.View,
        },
      );

      setEditorMode(EditorMode.Editor);
    }
    catch (err) {
      toastError(t('toaster.create_failed', { target: path }));
    }
  }, [create, isNotFound, setEditorMode, path, t]);

  const _isBtnDisabled = isCreating || isBtnDisabled;

  const circleColor = useMemo(() => {
    if ((currentPageYjsData?.awarenessStateSize ?? 0) > 0) {
      return 'bg-primary';
    }

    if (currentPageYjsData?.hasYdocsNewerThanLatestRevision ?? false) {
      return 'bg-secondary';
    }
  }, [currentPageYjsData]);

  return (
    <>
      <div
        className={`btn-group grw-page-editor-mode-manager ${styles['grw-page-editor-mode-manager']}`}
        role="group"
        aria-label="page-editor-mode-manager"
        id="grw-page-editor-mode-manager"
        data-testid="grw-page-editor-mode-manager"
      >
        {(isDeviceLargerThanMd || editorMode !== EditorMode.View) && (
          <PageEditorModeButton
            currentEditorMode={editorMode}
            editorMode={EditorMode.View}
            isBtnDisabled={_isBtnDisabled}
            onClick={() => setEditorMode(EditorMode.View)}
          >
            <span className="material-symbols-outlined fs-4">play_arrow</span>{t('View')}
          </PageEditorModeButton>
        )}
        {(isDeviceLargerThanMd || editorMode === EditorMode.View) && (
          <PageEditorModeButton
            currentEditorMode={editorMode}
            editorMode={EditorMode.Editor}
            isBtnDisabled={_isBtnDisabled}
            onClick={editButtonClickedHandler}
          >
            <span className="material-symbols-outlined me-1 fs-5">edit_square</span>{t('Edit')}
            {circleColor != null && <span className={`position-absolute top-0 start-100 translate-middle p-1 rounded-circle ${circleColor}`} />}
          </PageEditorModeButton>
        )}
      </div>
    </>
  );

};
