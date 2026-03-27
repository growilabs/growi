import { type JSX, useCallback, useRef, useState } from 'react';
import { Collapse, UncontrolledTooltip } from 'reactstrap';

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

  const buttonRef = useRef<HTMLButtonElement>(null);
  const activeClass = isOpen ? 'active' : '';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-toolbar-button ${btnTextFormatToolsTogglerClass} ${activeClass}`}
        onClick={onClick}
      >
        <span className="material-symbols-outlined fs-3">match_case</span>
      </button>
      <UncontrolledTooltip placement="top" target={buttonRef}>
        Text Formatting
      </UncontrolledTooltip>
    </>
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

  const boldRef = useRef<HTMLButtonElement>(null);
  const italicRef = useRef<HTMLButtonElement>(null);
  const strikethroughRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLButtonElement>(null);
  const codeRef = useRef<HTMLButtonElement>(null);
  const bulletListRef = useRef<HTMLButtonElement>(null);
  const numberedListRef = useRef<HTMLButtonElement>(null);
  const quoteRef = useRef<HTMLButtonElement>(null);
  const checklistRef = useRef<HTMLButtonElement>(null);

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
            ref={boldRef}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertMarkdownElements('**', '**')}
          >
            <span className="material-symbols-outlined fs-5">format_bold</span>
          </button>
          <UncontrolledTooltip placement="top" target={boldRef}>
            Bold
          </UncontrolledTooltip>
          <button
            ref={italicRef}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertMarkdownElements('*', '*')}
          >
            <span className="material-symbols-outlined fs-5">
              format_italic
            </span>
          </button>
          <UncontrolledTooltip placement="top" target={italicRef}>
            Italic
          </UncontrolledTooltip>
          <button
            ref={strikethroughRef}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertMarkdownElements('~', '~')}
          >
            <span className="material-symbols-outlined fs-5">
              format_strikethrough
            </span>
          </button>
          <UncontrolledTooltip placement="top" target={strikethroughRef}>
            Strikethrough
          </UncontrolledTooltip>
          <button
            ref={headingRef}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('#', true)}
          >
            {/* TODO: chack and fix font-size. see: https://redmine.weseek.co.jp/issues/143015 */}
            <span className="growi-custom-icons">header</span>
          </button>
          <UncontrolledTooltip placement="top" target={headingRef}>
            Heading
          </UncontrolledTooltip>
          <button
            ref={codeRef}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertMarkdownElements('`', '`')}
          >
            <span className="material-symbols-outlined fs-5">code</span>
          </button>
          <UncontrolledTooltip placement="top" target={codeRef}>
            Code
          </UncontrolledTooltip>
          <button
            ref={bulletListRef}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('-')}
          >
            <span className="material-symbols-outlined fs-5">
              format_list_bulleted
            </span>
          </button>
          <UncontrolledTooltip placement="top" target={bulletListRef}>
            Bullet List
          </UncontrolledTooltip>
          <button
            ref={numberedListRef}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('1.')}
          >
            <span className="material-symbols-outlined fs-5">
              format_list_numbered
            </span>
          </button>
          <UncontrolledTooltip placement="top" target={numberedListRef}>
            Numbered List
          </UncontrolledTooltip>
          <button
            ref={quoteRef}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('>')}
          >
            {/* TODO: chack and fix font-size. see: https://redmine.weseek.co.jp/issues/143015 */}
            <span className="growi-custom-icons">format_quote</span>
          </button>
          <UncontrolledTooltip placement="top" target={quoteRef}>
            Quote
          </UncontrolledTooltip>
          <button
            ref={checklistRef}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('- [ ]')}
          >
            <span className="material-symbols-outlined fs-5">checklist</span>
          </button>
          <UncontrolledTooltip placement="top" target={checklistRef}>
            Checklist
          </UncontrolledTooltip>
        </div>
      </Collapse>
    </div>
  );
};
