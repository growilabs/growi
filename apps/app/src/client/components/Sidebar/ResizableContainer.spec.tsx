// @vitest-environment happy-dom

import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { ResizableContainer } from './ResizableContainer';

const Counter = (): React.JSX.Element => {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((v) => v + 1)}>
      count: {count}
    </button>
  );
};

describe('ResizableContainer', () => {
  it('keeps the state of its children once the page has finished loading', async () => {
    render(
      <ResizableContainer>
        <Counter />
      </ResizableContainer>,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('count: 1');

    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(screen.getByRole('button').textContent).toBe('count: 1');
  });
});
