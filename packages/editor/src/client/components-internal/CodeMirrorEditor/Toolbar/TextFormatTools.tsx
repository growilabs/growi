import { type JSX, useCallback, useState } from 'react';
import { Collapse } from 'reactstrap';

import type { GlobalCodeMirrorEditorKey } from '../../../../consts';
import { useCodeMirrorEditorIsolated } from '../../../stores/codemirror-editor';

import styles from './TextFormatTools.module.scss';

const btnTextFormatToolsTogglerClass = styles['btn-text-format-tools-toggler'];

type TogglarProps = {
  isOpen: boolean;
  onClick?: () => void;
};

const TextFormatToolsToggler = (props: TogglarProps): JSX.Element => {
  const { isOpen, onClick } = props;

  const activeClass = isOpen ? 'active' : '';

  return (
    <button
      type="button"
      className={`btn btn-toolbar-button ${btnTextFormatToolsTogglerClass} ${activeClass}`}
      onClick={onClick}
    >
      <span className="material-symbols-outlined fs-3">match_case</span>
    </button>
  );
};

type TextFormatToolsType = {
  editorKey: string | GlobalCodeMirrorEditorKey;
  onTextFormatToolsCollapseChange: () => void;
};

export const TextFormatTools = (props: TextFormatToolsType): JSX.Element => {
  const { editorKey, onTextFormatToolsCollapseChange } = props;
  const [isOpen, setOpen] = useState(false);
  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(editorKey);

  const toggle = useCallback(() => {
    setOpen((bool) => !bool);
  }, []);

  const onClickInsertMarkdownElements = (prefix: string, suffix: string) => {
    codeMirrorEditor?.insertMarkdownElements(prefix, suffix);
  };

  const onClickInsertPrefix = (
    prefix: string,
    noSpaceIfPrefixExists?: boolean,
  ) => {
    codeMirrorEditor?.insertPrefix(prefix, noSpaceIfPrefixExists);
  };

  return (
    <div className="d-flex">
      <TextFormatToolsToggler isOpen={isOpen} onClick={toggle} />

      <Collapse
        isOpen={isOpen}
        horizontal
        onEntered={onTextFormatToolsCollapseChange}
        onExited={onTextFormatToolsCollapseChange}
      >
        <div className="d-flex px-1 gap-1" style={{ width: '220px' }}>
          <button
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertMarkdownElements('**', '**')}
          >
            <span className="material-symbols-outlined fs-5">format_bold</span>
          </button>
          <button
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertMarkdownElements('*', '*')}
          >
            <span className="material-symbols-outlined fs-5">
              format_italic
            </span>
          </button>
          <button
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertMarkdownElements('~', '~')}
          >
            <span className="material-symbols-outlined fs-5">
              format_strikethrough
            </span>
          </button>
          <button
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('#', true)}
          >
            {/* TODO: chack and fix font-size. see: https://redmine.weseek.co.jp/issues/143015 */}
            <span className="growi-custom-icons">header</span>
          </button>
          <button
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertMarkdownElements('`', '`')}
          >
            <span className="material-symbols-outlined fs-5">code</span>
          </button>
          <button
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('-')}
          >
            <span className="material-symbols-outlined fs-5">
              format_list_bulleted
            </span>
          </button>
          <button
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('1.')}
          >
            <span className="material-symbols-outlined fs-5">
              format_list_numbered
            </span>
          </button>
          <button
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('>')}
          >
            {/* TODO: chack and fix font-size. see: https://redmine.weseek.co.jp/issues/143015 */}
            <span className="growi-custom-icons">format_quote</span>
          </button>
          <button
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('- [ ]')}
          >
            <span className="material-symbols-outlined fs-5">checklist</span>
          </button>
        </div>
      </Collapse>
    </div>
  );
};
