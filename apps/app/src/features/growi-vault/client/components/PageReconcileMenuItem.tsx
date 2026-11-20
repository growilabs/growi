import type { JSX } from 'react';
import { DropdownItem } from 'reactstrap';

// ============================================================================
// Types
// ============================================================================

type PageReconcileMenuItemProps = {
  /** Callback fired when the menu item is clicked. The parent owns modal state. */
  onClick: () => void;
};

// ============================================================================
// Component
// ============================================================================

/**
 * A dropdown menu item that requests a vault reconcile for the current page.
 *
 * The modal is owned by the parent (not by this component) because a parent
 * Dropdown auto-closes on outside-click, which would unmount any modal state
 * held here. The parent renders ReconcileTriggerModal as a sibling of its
 * Dropdown so the modal survives the dropdown closing.
 */
export const PageReconcileMenuItem = (
  props: PageReconcileMenuItemProps,
): JSX.Element => {
  const { onClick } = props;

  return (
    <DropdownItem
      onClick={onClick}
      className="grw-page-control-dropdown-item"
      data-testid="page-reconcile-menu-item"
    >
      <span className="material-symbols-outlined me-1 grw-page-control-dropdown-icon">
        sync
      </span>
      Reconcile Vault
    </DropdownItem>
  );
};
