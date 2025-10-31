import React, {
  memo, useCallback, useMemo, useState, type JSX,
} from 'react';

import {
  type EditorTheme, type KeyMapMode, PasteMode, AllPasteMode, DEFAULT_KEYMAP, DEFAULT_PASTE_MODE, DEFAULT_THEME,
} from '@growi/editor';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';
import Image from 'next/image';
import {
  Dropdown, DropdownToggle, DropdownMenu, Input, FormGroup,
} from 'reactstrap';

import { isIndentSizeForcedAtom } from '~/states/server-configurations';
import { useDeviceLargerThanMd } from '~/states/ui/device';
import { useCurrentIndentSize, useCurrentIndentSizeActions } from '~/states/ui/editor';
import { useEditorSettings } from '~/stores/editor';

type RadioListItemProps = {
  onClick: () => void,
  icon?: React.ReactNode,
  text: string,
  checked?: boolean
}

const RadioListItem = (props: RadioListItemProps): JSX.Element => {
  const {
    onClick, icon, text, checked,
  } = props;
  return (
    <li className="list-group-item border-0 d-flex align-items-center">
      <input
        onClick={onClick}
        className="form-check-input me-3"
        type="radio"
        name="listGroupRadio"
        id={`editor_config_radio_item_${text}`}
        checked={checked}
      />
      {icon}
      <label className="form-check-label stretched-link fs-6" htmlFor={`editor_config_radio_item_${text}`}>{text}</label>
    </li>
  );
};


type SelectorProps = {
  header: string,
  onClickBefore: () => void,
  items: JSX.Element,
}

const Selector = (props: SelectorProps): JSX.Element => {

  const { header, onClickBefore, items } = props;
  return (
    <div className="d-flex flex-column w-100">
      <button type="button" className="btn border-0 d-flex align-items-center text-muted ms-2" onClick={onClickBefore}>
        <span className="material-symbols-outlined fs-5 py-0 me-1">navigate_before</span>
        <label>{header}</label>
      </button>
      <hr className="my-1" />
      <ul className="list-group d-flex ms-2">
        {items}
      </ul>
    </div>
  );

};


type EditorThemeToLabel = {
  [key in EditorTheme]: string;
}

const EDITORTHEME_LABEL_MAP: EditorThemeToLabel = {
  defaultlight: 'DefaultLight',
  eclipse: 'Eclipse',
  basic: 'Basic',
  ayu: 'Ayu',
  rosepine: 'Rosé Pine',
  defaultdark: 'DefaultDark',
  material: 'Material',
  nord: 'Nord',
  cobalt: 'Cobalt',
  kimbie: 'Kimbie',
};

const ThemeSelector = memo(({ onClickBefore }: { onClickBefore: () => void }): JSX.Element => {

  const { t } = useTranslation();
  const { data: editorSettings, update } = useEditorSettings();
  const selectedTheme = editorSettings?.theme ?? DEFAULT_THEME;

  const listItems = useMemo(() => (
    <>
      {(Object.keys(EDITORTHEME_LABEL_MAP) as EditorTheme[]).map((theme) => {
        const themeLabel = EDITORTHEME_LABEL_MAP[theme];
        return (
          <RadioListItem onClick={() => update({ theme })} text={themeLabel} checked={theme === selectedTheme} />
        );
      })}
    </>
  ), [update, selectedTheme]);

  return (
    <Selector header={t('page_edit.theme')} onClickBefore={onClickBefore} items={listItems} />
  );
});
ThemeSelector.displayName = 'ThemeSelector';


type KeyMapModeToLabel = {
  [key in KeyMapMode]: string;
}

const KEYMAP_LABEL_MAP: KeyMapModeToLabel = {
  default: 'Default',
  vim: 'Vim',
  emacs: 'Emacs',
  vscode: 'Visual Studio Code',
};

const KeymapSelector = memo(({ onClickBefore }: { onClickBefore: () => void }): JSX.Element => {

  const { t } = useTranslation();
  const { data: editorSettings, update } = useEditorSettings();
  const selectedKeymapMode = editorSettings?.keymapMode ?? DEFAULT_KEYMAP;

  const listItems = useMemo(() => (
    <>
      {(Object.keys(KEYMAP_LABEL_MAP) as KeyMapMode[]).map((keymapMode) => {
        const keymapLabel = KEYMAP_LABEL_MAP[keymapMode];
        const icon = (keymapMode !== 'default')
          ? <Image src={`/images/icons/${keymapMode}.png`} width={16} height={16} className="me-2" alt={keymapMode} />
          : null;
        return (
          <RadioListItem onClick={() => update({ keymapMode })} icon={icon} text={keymapLabel} checked={keymapMode === selectedKeymapMode} />
        );
      })}
    </>
  ), [update, selectedKeymapMode]);


  return (
    <Selector header={t('page_edit.keymap')} onClickBefore={onClickBefore} items={listItems} />
  );
});
KeymapSelector.displayName = 'KeymapSelector';


const TYPICAL_INDENT_SIZE = [2, 4];

const IndentSizeSelector = memo(({ onClickBefore }: { onClickBefore: () => void }): JSX.Element => {

  const { t } = useTranslation();
  const currentIndentSize = useCurrentIndentSize();
  const { mutate: mutateCurrentIndentSize } = useCurrentIndentSizeActions();

  const listItems = useMemo(() => (
    <>
      {TYPICAL_INDENT_SIZE.map((indent) => {
        return (
          <RadioListItem onClick={() => mutateCurrentIndentSize(indent)} text={indent.toString()} checked={indent === currentIndentSize} />
        );
      })}
    </>
  ), [currentIndentSize, mutateCurrentIndentSize]);

  return (
    <Selector header={t('page_edit.indent')} onClickBefore={onClickBefore} items={listItems} />
  );
});
IndentSizeSelector.displayName = 'IndentSizeSelector';


const PasteSelector = memo(({ onClickBefore }: { onClickBefore: () => void }): JSX.Element => {

  const { t } = useTranslation();
  const { data: editorSettings, update } = useEditorSettings();
  const selectedPasteMode = editorSettings?.pasteMode ?? DEFAULT_PASTE_MODE;

  const listItems = useMemo(() => (
    <>
      {(AllPasteMode).map((pasteMode) => {
        return (
          <RadioListItem onClick={() => update({ pasteMode })} text={t(`page_edit.paste.${pasteMode}`) ?? ''} checked={pasteMode === selectedPasteMode} />
        );
      })}
    </>
  ), [update, t, selectedPasteMode]);

  return (
    <Selector header={t('page_edit.paste.title')} onClickBefore={onClickBefore} items={listItems} />
  );
});
PasteSelector.displayName = 'PasteSelector';


type SwitchItemProps = {
  inputId: string,
  onChange: () => void,
  checked: boolean,
  text: string,
};
const SwitchItem = memo((props: SwitchItemProps): JSX.Element => {
  const {
    inputId, onChange, checked, text,
  } = props;
  return (
    <FormGroup switch>
      <Input id={inputId} type="switch" checked={checked} onChange={onChange} />
      <label htmlFor={inputId}>{text}</label>
    </FormGroup>

  );
});

const ConfigurationSelector = memo((): JSX.Element => {
  const { t } = useTranslation();

  const { data: editorSettings, update } = useEditorSettings();

  const renderActiveLineMenuItem = useCallback(() => {
    if (editorSettings == null) {
      return <></>;
    }

    const isActive = editorSettings.styleActiveLine;

    return (
      <SwitchItem
        inputId="switchActiveLine"
        onChange={() => update({ styleActiveLine: !isActive })}
        checked={isActive}
        text={t('page_edit.Show active line')}
      />
    );
  }, [editorSettings, update, t]);

  const renderMarkdownTableAutoFormattingMenuItem = useCallback(() => {
    if (editorSettings == null) {
      return <></>;
    }

    const isActive = editorSettings.autoFormatMarkdownTable;

    return (
      <SwitchItem
        inputId="switchTableAutoFormatting"
        onChange={() => update({ autoFormatMarkdownTable: !isActive })}
        checked={isActive}
        text={t('page_edit.auto_format_table')}
      />
    );
  }, [editorSettings, t, update]);

  return (
    <div className="mx-3 mt-1">
      {renderActiveLineMenuItem()}
      {renderMarkdownTableAutoFormattingMenuItem()}
    </div>
  );
});
ConfigurationSelector.displayName = 'ConfigurationSelector';


type ChangeStateButtonProps = {
  onClick: () => void,
  header: string,
  data: string,
  disabled?: boolean,
}
const ChangeStateButton = memo((props: ChangeStateButtonProps): JSX.Element => {
  const {
    onClick, header, data, disabled,
  } = props;
  return (
    <button type="button" className="d-flex align-items-center btn btn-sm border-0 my-1" disabled={disabled} onClick={onClick}>
      <label className="ms-2 me-auto">{header}</label>
      <label className="text-muted d-flex align-items-center ms-2 me-1">
        {data}
        <span className="material-symbols-outlined fs-5 py-0">navigate_next</span>
      </label>
    </button>
  );
});


const OptionsStatus = {
  Home: 'Home',
  Theme: 'Theme',
  Keymap: 'Keymap',
  Indent: 'Indent',
  Paste: 'Paste',
} as const;
type OptionStatus = typeof OptionsStatus[keyof typeof OptionsStatus];

export const OptionsSelector = (): JSX.Element => {

  const { t } = useTranslation();

  const [dropdownOpen, setDropdownOpen] = useState(false);

  const [status, setStatus] = useState<OptionStatus>(OptionsStatus.Home);
  const { data: editorSettings } = useEditorSettings();
  const currentIndentSize = useCurrentIndentSize();
  const isIndentSizeForced = useAtomValue(isIndentSizeForcedAtom);
  const [isDeviceLargerThanMd] = useDeviceLargerThanMd();

  if (editorSettings == null || currentIndentSize == null || isIndentSizeForced == null) {
    return <></>;
  }

  return (
    <Dropdown isOpen={dropdownOpen} toggle={() => { setStatus(OptionsStatus.Home); setDropdownOpen(!dropdownOpen) }} direction="up" className="">
      <DropdownToggle
        className={`btn btn-sm btn-outline-neutral-secondary d-flex align-items-center justify-content-center
              ${isDeviceLargerThanMd ? '' : 'border-0'}
              ${dropdownOpen ? 'active' : ''}
              `}
      >
        <span className="material-symbols-outlined py-0 fs-5"> settings </span>
        {
          isDeviceLargerThanMd
            ? <label className="ms-1 me-1">{t('page_edit.editor_config')}</label>
            : <></>
        }
      </DropdownToggle>
      <DropdownMenu container="body">
        {
          status === OptionsStatus.Home && (
            <div className="d-flex flex-column">
              <label className="text-muted ms-3">
                {t('page_edit.editor_config')}
              </label>
              <hr className="my-1" />
              <ChangeStateButton
                onClick={() => setStatus(OptionsStatus.Theme)}
                header={t('page_edit.theme')}
                data={EDITORTHEME_LABEL_MAP[editorSettings.theme ?? ''] ?? ''}
              />
              <hr className="my-1" />
              <ChangeStateButton
                onClick={() => setStatus(OptionsStatus.Keymap)}
                header={t('page_edit.keymap')}
                data={KEYMAP_LABEL_MAP[editorSettings.keymapMode ?? ''] ?? ''}
              />
              <hr className="my-1" />
              <ChangeStateButton
                disabled={isIndentSizeForced}
                onClick={() => setStatus(OptionsStatus.Indent)}
                header={t('page_edit.indent')}
                data={currentIndentSize.toString() ?? ''}
              />
              <hr className="my-1" />
              <ChangeStateButton
                onClick={() => setStatus(OptionsStatus.Paste)}
                header={t('page_edit.paste.title')}
                data={t(`page_edit.paste.${editorSettings.pasteMode ?? PasteMode.both}`) ?? ''}
              />
              <hr className="my-1" />
              <ConfigurationSelector />
            </div>
          )
        }
        {status === OptionsStatus.Theme && (
          <ThemeSelector onClickBefore={() => setStatus(OptionsStatus.Home)} />
        )
        }
        {status === OptionsStatus.Keymap && (
          <KeymapSelector onClickBefore={() => setStatus(OptionsStatus.Home)} />
        )
        }
        {status === OptionsStatus.Indent && (
          <IndentSizeSelector onClickBefore={() => setStatus(OptionsStatus.Home)} />
        )
        }
        {status === OptionsStatus.Paste && (
          <PasteSelector onClickBefore={() => setStatus(OptionsStatus.Home)} />
        )}
      </DropdownMenu>
    </Dropdown>
  );
};
