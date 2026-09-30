import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
} from 'reactstrap';

export type InlineCommentListMenuItem = {
  id: string;
  labelKey: string;
  disabled: boolean;
  onSelect: () => void;
};

type InlineCommentListMenuProps = {
  items: readonly InlineCommentListMenuItem[];
};

export const InlineCommentListMenu = (
  props: InlineCommentListMenuProps,
): JSX.Element => {
  const { items } = props;
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dropdown isOpen={isOpen} toggle={() => setIsOpen((prev) => !prev)}>
      {/* `color="link"` instead of the default `secondary`, whose background
          does not follow the active theme (same as `MentionPickerButton`). */}
      <DropdownToggle
        type="button"
        color="link"
        className="btn-sm btn-outline-neutral-secondary"
        aria-label={t('inline_comment.list_menu')}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          more_horiz
        </span>
      </DropdownToggle>
      <DropdownMenu end>
        {items.map((item) => (
          <DropdownItem
            key={item.id}
            disabled={item.disabled}
            onClick={item.onSelect}
          >
            {t(item.labelKey)}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
};
