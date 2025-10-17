import { render, screen, fireEvent } from '@testing-library/react';

import { DescendantsPageListModal } from './DescendantsPageListModal';

const mockClose = vi.hoisted(() => vi.fn());
const useDeviceLargerThanLg = vi.hoisted(() => vi.fn().mockReturnValue([true]));

vi.mock('next/router', () => ({
  useRouter: () => ({
    events: {
      on: vi.fn(),
      off: vi.fn(),
    },
  }),
}));

vi.mock('~/stores/modal', () => ({
  useDescendantsPageListModal: vi.fn().mockReturnValue({
    data: { isOpened: true },
    close: mockClose,
  }),
}));

vi.mock('~/states/ui/device', () => ({
  useDeviceLargerThanLg,
}));

describe('DescendantsPageListModal.tsx', () => {

  it('should render the modal when isOpened is true', () => {
    render(<DescendantsPageListModal />);
    expect(screen.getByTestId('descendants-page-list-modal')).not.toBeNull();
  });

  it('should call close function when close button is clicked', () => {
    render(<DescendantsPageListModal />);
    const closeButton = screen.getByLabelText('Close');
    fireEvent.click(closeButton);
    expect(mockClose).toHaveBeenCalled();
  });

  describe('when device is larger than lg', () => {

    it('should render CustomNavTab', () => {
      render(<DescendantsPageListModal />);
      expect(screen.getByTestId('custom-nav-tab')).not.toBeNull();
    });

    it('should not render CustomNavDropdown', () => {
      render(<DescendantsPageListModal />);
      expect(screen.queryByTestId('custom-nav-dropdown')).toBeNull();
    });
  });

  describe('when device is smaller than lg', () => {
    beforeEach(() => {
      useDeviceLargerThanLg.mockReturnValue([false]);
    });

    it('should render CustomNavDropdown on devices smaller than lg', () => {
      render(<DescendantsPageListModal />);
      expect(screen.getByTestId('custom-nav-dropdown')).not.toBeNull();
    });

    it('should not render CustomNavTab', () => {
      render(<DescendantsPageListModal />);
      expect(screen.queryByTestId('custom-nav-tab')).toBeNull();
    });
  });
});
