import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react';

import { PageSelectModalLazyLoaded } from './dynamic';

// The modal reports itself as opened.
vi.mock('~/states/ui/modal/page-select', () => ({
  usePageSelectModalStatus: () => ({ isOpened: true }),
}));

// Make the lazy loader return our component synchronously so we can control
// whether it throws during render.
let lazyComponent: ComponentType | null = null;
vi.mock('~/components/utils/use-lazy-loader', () => ({
  useLazyLoader: () => lazyComponent,
}));

const ThrowingModal = (): never => {
  throw new Error('boom in modal subtree');
};

describe('PageSelectModalLazyLoaded error containment (issue #11422)', () => {
  it('keeps sibling app content mounted when the modal subtree throws', () => {
    lazyComponent = ThrowingModal;

    // If the boundary did not contain the error, this render() call would throw
    // and the sibling would be unmounted (the "blank screen" symptom).
    expect(() =>
      render(
        <>
          <div data-testid="app-content">editor and sidebar</div>
          <PageSelectModalLazyLoaded />
        </>,
      ),
    ).not.toThrow();

    // The rest of the app survives.
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
  });

  it('renders the modal normally when it does not throw', () => {
    const OkModal = () => <div data-testid="modal-ok">modal</div>;
    lazyComponent = OkModal;

    render(<PageSelectModalLazyLoaded />);

    expect(screen.getByTestId('modal-ok')).toBeInTheDocument();
  });
});
