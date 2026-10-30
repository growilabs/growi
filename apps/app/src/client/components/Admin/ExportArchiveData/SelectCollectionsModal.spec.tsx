import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SelectCollectionsModal from './SelectCollectionsModal';

vi.mock('~/client/util/apiv1-client', () => ({ apiPost: vi.fn() }));
vi.mock('~/client/util/toastr', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const PASSWORD_SEED_WARNING_KEY = 'admin:export_management.desc_password_seed';

const renderModal = (collections: string[]) =>
  render(
    <SelectCollectionsModal
      isOpen
      collections={collections}
      onExportingRequested={vi.fn()}
      onClose={vi.fn()}
    />,
  );

describe('SelectCollectionsModal', () => {
  it('shows the user-data warning when searchhistories is selected', () => {
    renderModal(['searchhistories']);
    expect(screen.queryByText(PASSWORD_SEED_WARNING_KEY)).toBeNull();

    fireEvent.click(screen.getByLabelText('searchhistories'));

    expect(screen.getByText(PASSWORD_SEED_WARNING_KEY)).toBeTruthy();
  });

  it('does not show the user-data warning for a collection outside the user-data group', () => {
    renderModal(['pages']);

    fireEvent.click(screen.getByLabelText('pages'));

    expect(screen.queryByText(PASSWORD_SEED_WARNING_KEY)).toBeNull();
  });
});
