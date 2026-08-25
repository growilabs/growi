import { fireEvent, render, screen } from '@testing-library/react';

import type { TransferPreflightResult } from '~/interfaces/g2g-transfer';
import type { TransferPreset } from '~/models/admin/g2g-transfer-preset';

import { G2GTransferConfirmModal } from './G2GTransferConfirmModal';

// --- module mocks -----------------------------------------------------------

// A small interpolation-capable fake, rather than the raw-key passthrough some
// sibling spec files use: this file's assertions are on the rendered counts and
// per-warning text, which a passthrough fake cannot distinguish from a
// hardcoded/omitted value.
const TRANSLATIONS: Record<string, string> = {
  'g2g_data_transfer.confirm_modal.title': 'Confirm transfer',
  'g2g_data_transfer.confirm_modal.description':
    'The destination holds the following data. It will be deleted and replaced:',
  'g2g_data_transfer.confirm_modal.counts.users': 'Users',
  'g2g_data_transfer.confirm_modal.counts.user_groups': 'User groups',
  'g2g_data_transfer.confirm_modal.counts.pages': 'Pages',
  'g2g_data_transfer.confirm_modal.warnings_heading': 'Before you continue:',
  'g2g_data_transfer.confirm_modal.warnings.password_seed_mismatch':
    'Password seed warning text',
  'g2g_data_transfer.confirm_modal.warnings.no_loginable_admin':
    'No loginable admin warning text',
  'g2g_data_transfer.confirm_modal.warnings.sessions_not_invalidatable':
    'Sessions not invalidatable warning text',
  'g2g_data_transfer.confirm_modal.warnings.local_auth_disabled_at_source':
    'Local auth disabled warning text',
  'maintenance_mode_notice.body_destination':
    'Destination stays in maintenance mode text',
  'maintenance_mode_notice.turn_it_off': 'Turn it off yourself text',
  'maintenance_mode_notice.cancel': 'Cancel',
  'maintenance_mode_notice.proceed': 'Understood, proceed',
};
const t = (key: string) => TRANSLATIONS[key] ?? key;
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t }) }));

// --- fixtures ----------------------------------------------------------------

const buildPreflightResult = (
  overrides: Partial<TransferPreflightResult> = {},
): TransferPreflightResult => ({
  destinationCounts: { users: 7, userGroups: 3, pages: 42 },
  blockers: [],
  warnings: [],
  ...overrides,
});

// --- helpers ------------------------------------------------------------------

interface RenderModalOptions {
  isOpen?: boolean;
  onClose?: () => void;
  onConfirm?: () => void;
  preflightResult?: TransferPreflightResult;
  transferPreset?: TransferPreset;
}

const renderModal = ({
  isOpen = true,
  onClose = vi.fn(),
  onConfirm = vi.fn(),
  preflightResult = buildPreflightResult(),
  transferPreset = 'migration',
}: RenderModalOptions = {}) =>
  render(
    <G2GTransferConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      preflightResult={preflightResult}
      transferPreset={transferPreset}
    />,
  );

const confirmButton = () =>
  screen.getByRole('button', { name: 'Understood, proceed' });
const cancelButton = () => screen.getByRole('button', { name: 'Cancel' });

describe('G2GTransferConfirmModal', () => {
  describe('under "migration"', () => {
    it('shows the destination counts the preflight result reported, not a hardcoded value', () => {
      // Requirement 3.1. A different fixture (13/5/99) is used deliberately so a
      // component that ignores `preflightResult` and always renders 0 -- or any other
      // fixed number -- fails this assertion instead of passing by coincidence.
      renderModal({
        transferPreset: 'migration',
        preflightResult: buildPreflightResult({
          destinationCounts: { users: 13, userGroups: 5, pages: 99 },
        }),
      });

      expect(screen.getByText('Users: 13')).toBeInTheDocument();
      expect(screen.getByText('User groups: 5')).toBeInTheDocument();
      expect(screen.getByText('Pages: 99')).toBeInTheDocument();
    });

    it('shows the deletion description', () => {
      renderModal({ transferPreset: 'migration' });

      expect(
        screen.getByText(
          'The destination holds the following data. It will be deleted and replaced:',
        ),
      ).toBeInTheDocument();
    });
  });

  describe('under "merge"', () => {
    // Requirements 3.1/3.2 are scoped to "migration"; requirement 6.1 keeps "merge"'s
    // behavior unchanged, and nothing on the destination is deleted there. Showing the
    // deletion description or the counts under "merge" would tell the operator
    // something false.
    it('does not show the deletion description or the destination counts', () => {
      renderModal({
        transferPreset: 'merge',
        preflightResult: buildPreflightResult({
          destinationCounts: { users: 13, userGroups: 5, pages: 99 },
        }),
      });

      expect(
        screen.queryByText(
          'The destination holds the following data. It will be deleted and replaced:',
        ),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Users: 13')).not.toBeInTheDocument();
      expect(screen.queryByText('User groups: 5')).not.toBeInTheDocument();
      expect(screen.queryByText('Pages: 99')).not.toBeInTheDocument();
    });

    it('still shows the maintenance-mode notice and any warnings (requirements 2.10, 6.3)', () => {
      renderModal({
        transferPreset: 'merge',
        preflightResult: buildPreflightResult({
          warnings: [{ type: 'password_seed_mismatch' }],
        }),
      });

      expect(
        screen.getByText('Destination stays in maintenance mode text'),
      ).toBeInTheDocument();
      expect(screen.getByText('Turn it off yourself text')).toBeInTheDocument();
      expect(
        screen.getByText('Password seed warning text'),
      ).toBeInTheDocument();
    });
  });

  it('shows no warning banner when the preflight result carries no warnings', () => {
    renderModal({ preflightResult: buildPreflightResult({ warnings: [] }) });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Before you continue:')).not.toBeInTheDocument();
  });

  it('shows the text for each reported warning type, mapped by its own type', () => {
    // Requirement 3.4/3.5/3.7. Two warnings whose text differs, so a mapping bug (e.g.
    // both rendered with the same text, or one silently dropped) is observable.
    renderModal({
      preflightResult: buildPreflightResult({
        warnings: [
          { type: 'password_seed_mismatch' },
          { type: 'no_loginable_admin' },
        ],
      }),
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Password seed warning text')).toBeInTheDocument();
    expect(
      screen.getByText('No loginable admin warning text'),
    ).toBeInTheDocument();
    // The two warnings this fixture did not include must not appear either --
    // otherwise a component that always renders all four regardless of input would
    // still pass the assertions above.
    expect(
      screen.queryByText('Sessions not invalidatable warning text'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Local auth disabled warning text'),
    ).not.toBeInTheDocument();
  });

  it('shows the maintenance-mode notice folded in from the former separate modal (task 4.4)', () => {
    renderModal();

    expect(
      screen.getByText('Destination stays in maintenance mode text'),
    ).toBeInTheDocument();
    expect(screen.getByText('Turn it off yourself text')).toBeInTheDocument();
  });

  it('does not call onConfirm or onClose merely by rendering', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderModal({ onConfirm, onClose });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onConfirm, and not onClose, when the operator clicks the confirm button', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderModal({ onConfirm, onClose });

    fireEvent.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose, and not onConfirm, when the operator clicks the cancel button', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderModal({ onConfirm, onClose });

    fireEvent.click(cancelButton());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing observable when closed', () => {
    renderModal({ isOpen: false });

    expect(screen.queryByText('Confirm transfer')).not.toBeInTheDocument();
  });
});
