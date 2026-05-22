import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import { DropdownItem } from 'reactstrap';

import { ReconcileTriggerModal } from './ReconcileTriggerModal';

// ============================================================================
// Types
// ============================================================================

type PageReconcileMenuItemProps = {
  /** The page path to pre-fill in the modal's target path input */
  targetPath: string;
};

// ============================================================================
// Component
// ============================================================================

/**
 * A dropdown menu item that opens a ReconcileTriggerModal for the user endpoint.
 * Pre-fills the target path with the given page path.
 *
 * Manages modal open/close state internally.
 */
export const PageReconcileMenuItem = (
  props: PageReconcileMenuItemProps,
): JSX.Element => {
  const { targetPath } = props;

  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpenModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  return (
    <>
      <DropdownItem
        onClick={handleOpenModal}
        className="grw-page-control-dropdown-item"
        data-testid="page-reconcile-menu-item"
      >
        <span className="material-symbols-outlined me-1 grw-page-control-dropdown-icon">
          sync
        </span>
        Reconcile Vault
      </DropdownItem>

      <ReconcileTriggerModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        apiEndpoint="/v3/vault/page/reconcile"
        defaultTargetPath={targetPath}
      />
    </>
  );
};
