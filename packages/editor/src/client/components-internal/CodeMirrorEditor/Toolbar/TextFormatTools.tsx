import { type JSX, useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

  const id = useId();
  const { t } = useTranslation('translation');
  const activeClass = isOpen ? 'active' : '';

  return (
    <>
      <button
        id={id}
        type="button"
        className={`btn btn-toolbar-button ${btnTextFormatToolsTogglerClass} ${activeClass}`}
        onClick={onClick}
      >
        <span className="material-symbols-outlined fs-3">match_case</span>
      </button>
      <UncontrolledTooltip placement="top" target={CSS.escape(id)}>
        {t('toolbar.text_formatting')}
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
  const baseId = useId();
  const { t } = useTranslation('translation');
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
            id={`${baseId}-bold`}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertMarkdownElements('**', '**')}
          >
            <span className="material-symbols-outlined fs-5">format_bold</span>
          </button>
          <UncontrolledTooltip
            placement="top"
            target={CSS.escape(`${baseId}-bold`)}
          >
            {t('toolbar.bold')}
          </UncontrolledTooltip>
          <button
            id={`${baseId}-italic`}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertMarkdownElements('*', '*')}
          >
            <span className="material-symbols-outlined fs-5">
              format_italic
            </span>
          </button>
          <UncontrolledTooltip
            placement="top"
            target={CSS.escape(`${baseId}-italic`)}
          >
            {t('toolbar.italic')}
          </UncontrolledTooltip>
          <button
            id={`${baseId}-strikethrough`}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertMarkdownElements('~', '~')}
          >
            <span className="material-symbols-outlined fs-5">
              format_strikethrough
            </span>
          </button>
          <UncontrolledTooltip
            placement="top"
            target={CSS.escape(`${baseId}-strikethrough`)}
          >
            {t('toolbar.strikethrough')}
          </UncontrolledTooltip>
          <button
            id={`${baseId}-heading`}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('#', true)}
          >
            {/* TODO: chack and fix font-size. see: https://redmine.weseek.co.jp/issues/143015 */}
            <span className="growi-custom-icons">header</span>
          </button>
          <UncontrolledTooltip
            placement="top"
            target={CSS.escape(`${baseId}-heading`)}
          >
            {t('toolbar.heading')}
          </UncontrolledTooltip>
          <button
            id={`${baseId}-code`}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertMarkdownElements('`', '`')}
          >
            <span className="material-symbols-outlined fs-5">code</span>
          </button>
          <UncontrolledTooltip
            placement="top"
            target={CSS.escape(`${baseId}-code`)}
          >
            {t('toolbar.code')}
          </UncontrolledTooltip>
          <button
            id={`${baseId}-bullet-list`}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('-')}
          >
            <span className="material-symbols-outlined fs-5">
              format_list_bulleted
            </span>
          </button>
          <UncontrolledTooltip
            placement="top"
            target={CSS.escape(`${baseId}-bullet-list`)}
          >
            {t('toolbar.bullet_list')}
          </UncontrolledTooltip>
          <button
            id={`${baseId}-numbered-list`}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('1.')}
          >
            <span className="material-symbols-outlined fs-5">
              format_list_numbered
            </span>
          </button>
          <UncontrolledTooltip
            placement="top"
            target={CSS.escape(`${baseId}-numbered-list`)}
          >
            {t('toolbar.numbered_list')}
          </UncontrolledTooltip>
          <button
            id={`${baseId}-quote`}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('>')}
          >
            {/* TODO: chack and fix font-size. see: https://redmine.weseek.co.jp/issues/143015 */}
            <span className="growi-custom-icons">format_quote</span>
          </button>
          <UncontrolledTooltip
            placement="top"
            target={CSS.escape(`${baseId}-quote`)}
          >
            {t('toolbar.quote')}
          </UncontrolledTooltip>
          <button
            id={`${baseId}-checklist`}
            type="button"
            className="btn btn-toolbar-button"
            onClick={() => onClickInsertPrefix('- [ ]')}
          >
            <span className="material-symbols-outlined fs-5">checklist</span>
          </button>
          <UncontrolledTooltip
            placement="top"
            target={CSS.escape(`${baseId}-checklist`)}
          >
            {t('toolbar.checklist')}
          </UncontrolledTooltip>
        </div>
      </Collapse>
    </div>
  );
};
