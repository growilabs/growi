import React, { useCallback, useState, type JSX } from 'react';

import type EventEmitter from 'events';

import {
  DrawioViewer,
  type DrawioEditByViewerProps,
  type DrawioViewerProps,
} from '@growi/remark-drawio';
import { useTranslation } from 'next-i18next';

import { useCurrentPageYjsData } from '~/features/collaborative-editor/states';
import { useIsGuestUser, useIsReadOnlyUser, useIsSharedUser } from '~/states/context';
import { useIsRevisionOutdated } from '~/states/page';
import { useShareLinkId } from '~/states/page/hooks';

import '@growi/remark-drawio/dist/style.css';
import styles from './DrawioViewerWithEditButton.module.scss';


declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var globalEmitter: EventEmitter;
}


export const DrawioViewerWithEditButton = React.memo((props: DrawioViewerProps): JSX.Element => {
  const { t } = useTranslation();

  const { bol, eol } = props;

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const isSharedUser = useIsSharedUser();
  const shareLinkId = useShareLinkId();
  const isRevisionOutdated = useIsRevisionOutdated();
  const currentPageYjsData = useCurrentPageYjsData();

  const [isRendered, setRendered] = useState(false);
  const [mxfile, setMxfile] = useState('');

  const editButtonClickHandler = useCallback(() => {
    const data: DrawioEditByViewerProps = {
      bol, eol, drawioMxFile: mxfile,
    };
    globalEmitter.emit('launchDrawioModal', data);
  }, [bol, eol, mxfile]);

  const renderingStartHandler = useCallback(() => {
    setRendered(false);
  }, []);

  const renderingUpdatedHandler = useCallback((mxfile: string | null) => {
    setRendered(mxfile != null);

    if (mxfile != null) {
      setMxfile(mxfile);
    }
  }, []);

  const isNoEditingUsers = currentPageYjsData?.awarenessStateSize == null || currentPageYjsData?.awarenessStateSize === 0;
  const showEditButton = isNoEditingUsers
     && !isRevisionOutdated
     && isRendered
     && !isGuestUser
     && !isReadOnlyUser
     && !isSharedUser
     && shareLinkId == null;

  return (
    <div className={`drawio-viewer-with-edit-button ${styles['drawio-viewer-with-edit-button']}`}>
      { showEditButton && (
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary btn-edit-drawio"
          onClick={editButtonClickHandler}
        >
          <span className="material-symbols-outlined me-1">edit_square</span>{t('Edit')}
        </button>
      ) }
      <DrawioViewer {...props} onRenderingStart={renderingStartHandler} onRenderingUpdated={renderingUpdatedHandler} />
    </div>
  );
});
DrawioViewerWithEditButton.displayName = 'DrawioViewerWithEditButton';
