import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PlantUmlViewer } from './PlantUmlViewer';

describe('PlantUmlViewer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should render with rendering-status attribute set to "true" initially', () => {
    const { container } = render(
      <PlantUmlViewer src="http://example.com/plantuml.png" />,
    );
    const div = container.firstElementChild as HTMLElement;
    expect(div.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR)).toBe('true');
  });

  it('should set rendering-status attribute to "false" when image loads', () => {
    const { container } = render(
      <PlantUmlViewer src="http://example.com/plantuml.png" />,
    );
    const div = container.firstElementChild as HTMLElement;
    const img = div.querySelector('img') as HTMLImageElement;

    expect(div.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR)).toBe('true');

    fireEvent.load(img);

    expect(div.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR)).toBe('false');
  });

  it('should set rendering-status attribute to "false" when image fails to load', () => {
    const { container } = render(
      <PlantUmlViewer src="http://example.com/nonexistent.png" />,
    );
    const div = container.firstElementChild as HTMLElement;
    const img = div.querySelector('img') as HTMLImageElement;

    expect(div.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR)).toBe('true');

    fireEvent.error(img);

    expect(div.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR)).toBe('false');
  });

  it('should render an img element with the provided src', () => {
    render(<PlantUmlViewer src="http://example.com/diagram.png" />);
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('http://example.com/diagram.png');
  });
});
