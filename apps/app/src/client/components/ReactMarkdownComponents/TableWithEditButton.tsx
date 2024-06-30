import React, { useCallback } from 'react';

import type EventEmitter from 'events';

import type { Element } from 'react-markdown/lib/rehype-filter';

import {
  useIsGuestUser, useIsReadOnlyUser, useIsSharedUser, useShareLinkId,
} from '~/stores-universal/context';
import { useIsRevisionOutdated } from '~/stores/page';

import styles from './TableWithEditButton.module.scss';

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var globalEmitter: EventEmitter;
}

type TableWithEditButtonProps = {
  children: React.ReactNode,
  node: Element,
  className?: string
}

export const TableWithEditButton = React.memo((props: TableWithEditButtonProps): JSX.Element => {

  const { children, node, className } = props;

  const { data: isGuestUser } = useIsGuestUser();
  const { data: isReadOnlyUser } = useIsReadOnlyUser();
  const { data: isSharedUser } = useIsSharedUser();
  const { data: shareLinkId } = useShareLinkId();
  const { data: isRevisionOutdated } = useIsRevisionOutdated();

  const bol = node.position?.start.line;
  const eol = node.position?.end.line;

  const editButtonClickHandler = useCallback(() => {
    globalEmitter.emit('launchHandsonTableModal', bol, eol);
  }, [bol, eol]);

  const showEditButton = !isRevisionOutdated && !isGuestUser && !isReadOnlyUser && !isSharedUser && shareLinkId == null;

  return (
    <div className={`editable-with-handsontable ${styles['editable-with-handsontable']}`}>
      { showEditButton && (
        <button type="button" className="handsontable-modal-trigger" onClick={editButtonClickHandler}>
          <span className="material-symbols-outlined">edit_square</span>
        </button>
      )}
      <table className={className}>
        {children}
      </table>
    </div>
  );
});
TableWithEditButton.displayName = 'TableWithEditButton';
