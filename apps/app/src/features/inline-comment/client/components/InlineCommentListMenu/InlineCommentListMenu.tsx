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
  /** Material Symbols ligature shown before the label when set. */
  icon?: string;
};

type InlineCommentListMenuProps = {
  items: readonly InlineCommentListMenuItem[];
  /**
   * i18n key for the toggle's accessible name. Defaults to the list-wide
   * menu label; the per-item actions menu on narrow viewports passes its
   * own key (Requirement 24).
   */
  ariaLabelKey?: string;
  /** Optional test id for the toggle button. */
  toggleTestId?: string;
};

export const InlineCommentListMenu = (
  props: InlineCommentListMenuProps,
): JSX.Element => {
  const {
    items,
    ariaLabelKey = 'inline_comment.list_menu',
    toggleTestId,
  } = props;
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dropdown isOpen={isOpen} toggle={() => setIsOpen((prev) => !prev)}>
      {/* `transparent` matches PageItemControl / bookmark menus — theme-
          following with no filled background. */}
      <DropdownToggle
        type="button"
        color="transparent"
        className="btn-sm border-0 d-inline-flex align-items-center justify-content-center p-1"
        aria-label={t(ariaLabelKey)}
        data-testid={toggleTestId}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          more_vert
        </span>
      </DropdownToggle>
      <DropdownMenu end>
        {items.map((item) => (
          <DropdownItem
            key={item.id}
            disabled={item.disabled}
            onClick={item.onSelect}
          >
            {item.icon != null && (
              <span
                className="material-symbols-outlined me-1"
                aria-hidden="true"
              >
                {item.icon}
              </span>
            )}
            {t(item.labelKey)}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
};
