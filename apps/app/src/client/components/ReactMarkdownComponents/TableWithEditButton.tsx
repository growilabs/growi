import React, { useCallback, type JSX } from 'react';

import { globalEventTarget } from '@growi/core/dist/utils';
import type { Element } from 'hast';

import type { LaunchHandsonTableModalEventDetail } from '~/client/interfaces/handsontable-modal';
import { useCurrentPageYjsData } from '~/features/collaborative-editor/states';
import { useIsGuestUser, useIsReadOnlyUser, useIsSharedUser } from '~/states/context';
import { useShareLinkId } from '~/states/page/hooks';
import { useIsRevisionOutdated } from '~/stores/page';

import styles from './TableWithEditButton.module.scss';


type TableWithEditButtonProps = {
  children: React.ReactNode,
  node: Element,
  className?: string
}

const TableWithEditButtonNoMemorized = (props: TableWithEditButtonProps): JSX.Element => {
  const { children, node, className } = props;

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const isSharedUser = useIsSharedUser();
  const shareLinkId = useShareLinkId();
  const isRevisionOutdated = useIsRevisionOutdated();
  const currentPageYjsData = useCurrentPageYjsData();

  const bol = node.position?.start.line ?? 0;
  const eol = node.position?.end.line ?? 0;

  const editButtonClickHandler = useCallback(() => {
    globalEventTarget.dispatchEvent(new CustomEvent<LaunchHandsonTableModalEventDetail>('launchHandsonTableModal', {
      detail: {
        bol,
        eol,
      },
    }));
  }, [bol, eol]);

  const isNoEditingUsers = currentPageYjsData?.awarenessStateSize == null || currentPageYjsData?.awarenessStateSize === 0;
  const showEditButton = isNoEditingUsers
    && !isRevisionOutdated
    && !isGuestUser
    && !isReadOnlyUser
    && !isSharedUser
    && shareLinkId == null;

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
};
TableWithEditButtonNoMemorized.displayName = 'TableWithEditButton';
export const TableWithEditButton = React.memo(TableWithEditButtonNoMemorized) as typeof TableWithEditButtonNoMemorized;
