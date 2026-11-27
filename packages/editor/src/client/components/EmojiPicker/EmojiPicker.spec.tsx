import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import type { EmojiPicker as EmojiPickerComponent } from './EmojiPicker.js';

const loadCounter = { picker: 0, data: 0 };

describe('EmojiPicker', () => {
  let EmojiPicker: typeof EmojiPickerComponent;

  // Register the mocks and re-import the component per test so the load counter
  // reflects only this test, regardless of test order.
  beforeEach(async () => {
    loadCounter.picker = 0;
    loadCounter.data = 0;
    vi.resetModules();
    vi.doMock('@emoji-mart/react', () => {
      loadCounter.picker += 1;
      return {
        default: (props: {
          onEmojiSelect: (emoji: { id: string; skin?: number }) => void;
        }) => (
          <div data-testid="fake-picker">
            <button
              type="button"
              onClick={() => props.onEmojiSelect({ id: 'thumbsup', skin: 3 })}
            >
              pick-with-skin
            </button>
            <button
              type="button"
              onClick={() => props.onEmojiSelect({ id: 'smile' })}
            >
              pick-without-skin
            </button>
          </div>
        ),
      };
    });
    vi.doMock('@emoji-mart/data', () => {
      loadCounter.data += 1;
      return { default: { emojis: {} } };
    });
    ({ EmojiPicker } = await import('./EmojiPicker.js'));
  });

  it('does not load the picker or emoji data while it has never been opened', async () => {
    const { container } = render(
      <EmojiPicker isOpen={false} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    await act(async () => {});

    expect(loadCounter).toEqual({ picker: 0, data: 0 });
    expect(screen.queryByTestId('fake-picker')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('loads and shows the picker once it is opened', async () => {
    const { rerender } = render(
      <EmojiPicker isOpen={false} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    rerender(<EmojiPicker isOpen onSelect={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByTestId('fake-picker')).toBeTruthy();
    expect(loadCounter).toEqual({ picker: 1, data: 1 });
  });

  it('leaves no visible frame (background, border, shadow) around the picker', async () => {
    render(<EmojiPicker isOpen onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByTestId('fake-picker');

    const content = document.querySelector('.modal-content');
    expect(content?.classList.contains('bg-transparent')).toBe(true);
    expect(content?.classList.contains('border-0')).toBe(true);
    expect(content?.classList.contains('shadow-none')).toBe(true);
  });

  it('passes a native selection with the emoji id and skin tone number to onSelect', async () => {
    const onSelect = vi.fn();
    render(<EmojiPicker isOpen onSelect={onSelect} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('pick-with-skin'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'native',
      id: 'thumbsup',
      skin: 3,
    });
  });

  it('passes a native selection with only the id when the emoji has no skin tone', async () => {
    const onSelect = vi.fn();
    render(<EmojiPicker isOpen onSelect={onSelect} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('pick-without-skin'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({
      kind: 'native',
      id: 'smile',
    });
    expect(onSelect.mock.calls[0][0].skin).toBeUndefined();
  });

  it('calls onClose and never onSelect when dismissed without a selection', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<EmojiPicker isOpen onSelect={onSelect} onClose={onClose} />);
    await screen.findByTestId('fake-picker');

    const modal = document.querySelector('.modal');
    expect(modal).not.toBeNull();
    fireEvent.keyUp(modal as Element, { key: 'Escape', keyCode: 27 });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  describe('when loading the picker fails', () => {
    let failLoading: boolean;

    beforeEach(async () => {
      failLoading = true;
      vi.resetModules();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.doMock('@emoji-mart/react', () => {
        if (failLoading) {
          throw new Error('chunk load failed');
        }
        return { default: () => <div data-testid="fake-picker" /> };
      });
      vi.doMock('@emoji-mart/data', () => ({ default: { emojis: {} } }));
      ({ EmojiPicker } = await import('./EmojiPicker.js'));
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('calls onClose so the parent can reset its open state', async () => {
      const onClose = vi.fn();
      render(<EmojiPicker isOpen onSelect={vi.fn()} onClose={onClose} />);

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId('fake-picker')).toBeNull();
    });

    it('records the error instead of swallowing it', async () => {
      const onClose = vi.fn();
      render(<EmojiPicker isOpen onSelect={vi.fn()} onClose={onClose} />);

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      // biome-ignore lint/suspicious/noConsole: asserting the error is recorded
      expect(console.error).toHaveBeenCalled();
    });

    it('retries loading when reopened after a failure', async () => {
      const onClose = vi.fn();
      const { rerender } = render(
        <EmojiPicker isOpen onSelect={vi.fn()} onClose={onClose} />,
      );
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

      rerender(
        <EmojiPicker isOpen={false} onSelect={vi.fn()} onClose={onClose} />,
      );
      failLoading = false;
      rerender(<EmojiPicker isOpen onSelect={vi.fn()} onClose={onClose} />);

      expect(await screen.findByTestId('fake-picker')).toBeTruthy();
    });

    it('neither calls onClose nor records an error when closed before the load fails', async () => {
      let rejectLoad: (reason: Error) => void = () => {};
      const gate = new Promise<never>((_, reject) => {
        rejectLoad = reject;
      });
      vi.resetModules();
      vi.doMock('@emoji-mart/react', async () => {
        await gate;
        return { default: () => null };
      });
      ({ EmojiPicker } = await import('./EmojiPicker.js'));

      const onClose = vi.fn();
      const { rerender } = render(
        <EmojiPicker isOpen onSelect={vi.fn()} onClose={onClose} />,
      );
      rerender(
        <EmojiPicker isOpen={false} onSelect={vi.fn()} onClose={onClose} />,
      );
      rejectLoad(new Error('chunk load failed'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(onClose).not.toHaveBeenCalled();
      // biome-ignore lint/suspicious/noConsole: asserting no error is recorded
      expect(console.error).not.toHaveBeenCalled();
    });
  });
});
