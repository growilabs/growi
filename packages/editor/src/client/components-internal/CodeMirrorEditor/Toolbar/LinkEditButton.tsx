import { type JSX, useCallback } from 'react';
import { DropdownItem } from 'reactstrap';

import type { GlobalCodeMirrorEditorKey } from '../../../../consts';
import { useLinkEditModalActions } from '../../../../states/modal/link-edit';
import {
  getMarkdownLink,
  replaceFocusedMarkdownLinkWithEditor,
} from '../../../services-internal';
import { useCodeMirrorEditorIsolated } from '../../../stores/codemirror-editor';

type Props = {
  editorKey: string | GlobalCodeMirrorEditorKey;
};

export const LinkEditButton = (props: Props): JSX.Element => {
  const { editorKey } = props;
  const { open: openLinkEditModal } = useLinkEditModalActions();
  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(editorKey);

  const onClickOpenLinkEditModal = useCallback(() => {
    const editor = codeMirrorEditor?.view;
    if (editor == null) {
      return;
    }
    const onSubmit = (linkText: string) => {
      replaceFocusedMarkdownLinkWithEditor(editor, linkText);
      return;
    };

    const defaultMarkdownLink = getMarkdownLink(editor);

    openLinkEditModal(defaultMarkdownLink, onSubmit);
  }, [codeMirrorEditor?.view, openLinkEditModal]);

  return (
    <DropdownItem
      className="d-flex gap-2 align-items-center"
      onClick={onClickOpenLinkEditModal}
    >
      <span className="material-symbols-outlined fs-5">link</span>Link
    </DropdownItem>
  );
};
