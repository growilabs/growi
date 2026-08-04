// @vitest-environment happy-dom

import { DEFAULT_DRAWIO_ORIGIN } from '../../consts';
import { prepareSelfHostedDrawio } from './index';

describe('prepareSelfHostedDrawio', () => {
  beforeEach(() => {
    window.STENCIL_PATH = undefined;
    window.MathJax = undefined;
  });

  it('should leave draw.io untouched when its own hosted viewer is configured', () => {
    prepareSelfHostedDrawio(`${DEFAULT_DRAWIO_ORIGIN}/`);

    expect(window.STENCIL_PATH).toBeUndefined();
    expect(window.MathJax).toBeUndefined();
  });

  it('should leave draw.io untouched when DRAWIO_URI holds nothing usable', () => {
    prepareSelfHostedDrawio('');

    expect(window.STENCIL_PATH).toBeUndefined();
    expect(window.MathJax).toBeUndefined();
  });

  it('should both rebase the asset paths and suppress the baked-in MathJax for a self-hosted instance', () => {
    prepareSelfHostedDrawio('http://localhost:8080/?offline=1&https=0');

    expect(window.STENCIL_PATH).toBeDefined();
    expect(window.MathJax).toBeDefined();
  });
});
