// @vitest-environment happy-dom

import { DEFAULT_DRAWIO_ORIGIN } from '../../consts';
import { isSelfHostedDrawio, prepareSelfHostedDrawio } from './index';

describe('isSelfHostedDrawio', () => {
  it.each`
    drawioUri                              | expected | reason
    ${'http://localhost:8080/?offline=1'}  | ${true}  | ${'a local instance'}
    ${'https://drawio.example.com/'}       | ${true}  | ${'an instance the organisation runs'}
    ${`${DEFAULT_DRAWIO_ORIGIN}/`}         | ${false} | ${"draw.io's own hosted viewer"}
    ${`${DEFAULT_DRAWIO_ORIGIN}/?lang=ja`} | ${false} | ${"draw.io's own viewer with parameters"}
    ${'not-a-url'}                         | ${false} | ${'an unparsable value, which leaves draw.io defaults in place'}
  `(
    'should be $expected for $reason',
    ({ drawioUri, expected }: { drawioUri: string; expected: boolean }) => {
      expect(isSelfHostedDrawio(drawioUri)).toBe(expected);
    },
  );
});

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

  it('should both rebase the asset paths and suppress the baked-in MathJax for a self-hosted instance', () => {
    prepareSelfHostedDrawio('http://localhost:8080/?offline=1&https=0');

    expect(window.STENCIL_PATH).toBeDefined();
    expect(window.MathJax).toBeDefined();
  });
});
