import { type JSX, useEffect, useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';

import { useCloseOnOutsideMouseDown } from './use-close-on-outside-mouse-down';

// Appends a node React does not render, the way CodeMirror builds its own DOM.
const ImperativeChild = (): JSX.Element => {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = document.createElement('span');
    node.dataset.testid = 'imperative-inside';
    hostRef.current?.appendChild(node);
    return () => node.remove();
  }, []);
  return <div ref={hostRef} />;
};

const Closable = ({ onClose }: { onClose?: () => void }): JSX.Element => {
  const { onMouseDownCapture } = useCloseOnOutsideMouseDown(onClose);
  return (
    <div data-testid="root" onMouseDownCapture={onMouseDownCapture}>
      <button type="button" data-testid="inside">
        inside
      </button>
      <ImperativeChild />
      {createPortal(
        <div data-testid="portaled">
          {createPortal(
            <button type="button" data-testid="nested-portaled">
              nested
            </button>,
            document.body,
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};

const renderWithOutside = (onClose?: () => void) =>
  render(
    <>
      <Closable onClose={onClose} />
      <button type="button" data-testid="outside">
        outside
      </button>
    </>,
  );

describe('useCloseOnOutsideMouseDown', () => {
  it('closes on a mousedown outside the tree', () => {
    const onClose = vi.fn();
    renderWithOutside(onClose);

    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an element it renders', 'inside'],
    ['DOM inside it that React did not render', 'imperative-inside'],
    ['UI it renders through a portal to document.body', 'portaled'],
    ['UI behind a portal nested in another portal', 'nested-portaled'],
  ])('does not close on a mousedown on %s', (_, testId) => {
    const onClose = vi.fn();
    renderWithOutside(onClose);

    fireEvent.mouseDown(screen.getByTestId(testId));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on a mousedown in the mention-completion popup CodeMirror appends to document.body', () => {
    const onClose = vi.fn();
    renderWithOutside(onClose);
    const popup = document.createElement('div');
    popup.className = 'cm-tooltip-autocomplete';
    const option = document.createElement('li');
    popup.appendChild(option);
    document.body.appendChild(popup);

    fireEvent.mouseDown(option);

    expect(onClose).not.toHaveBeenCalled();
    popup.remove();
  });

  it('still closes on an outside mousedown that follows an inside one', () => {
    const onClose = vi.fn();
    renderWithOutside(onClose);

    fireEvent.mouseDown(screen.getByTestId('portaled'));
    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops closing once unmounted', () => {
    const onClose = vi.fn();
    const { unmount } = render(<Closable onClose={onClose} />);
    unmount();

    fireEvent.mouseDown(document.body);

    expect(onClose).not.toHaveBeenCalled();
  });
});
