import { createRef } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RendererOptions } from '~/interfaces/renderer-options';

import RevisionRenderer from './RevisionRenderer';

const rendererOptions: RendererOptions = {
  remarkPlugins: [],
  rehypePlugins: [],
  components: {},
};

describe('RevisionRenderer', () => {
  it('renders the markdown content unchanged', () => {
    const { container } = render(
      <RevisionRenderer rendererOptions={rendererOptions} markdown="# Hello" />,
    );

    expect(container.querySelector('h1')?.textContent).toBe('Hello');
  });

  it('forwards a ref to the container div that wraps the rendered markdown', () => {
    const ref = createRef<HTMLDivElement>();

    render(
      <RevisionRenderer
        ref={ref}
        rendererOptions={rendererOptions}
        markdown="# Hello"
      />,
    );

    // The ref must resolve to the actual container DOM node,
    // i.e. the ancestor that contains the rendered markdown output.
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.querySelector('h1')?.textContent).toBe('Hello');
  });
});
