import { relocateMathUrl } from './relocate-math-url';

describe('relocateMathUrl', () => {
  it.each`
    bakedMathUrl                               | drawioUri                                  | expected
    ${'https://viewer.diagrams.net/math/es5'}  | ${'http://localhost:8080'}                 | ${'http://localhost:8080/math/es5'}
    ${'https://viewer.diagrams.net/math4/es5'} | ${'http://localhost:8080'}                 | ${'http://localhost:8080/math4/es5'}
    ${'https://viewer.diagrams.net/math/es5'}  | ${'http://localhost:8080/'}                | ${'http://localhost:8080/math/es5'}
    ${'https://viewer.diagrams.net/math4/es5'} | ${'https://drawio.example.com:8443'}       | ${'https://drawio.example.com:8443/math4/es5'}
    ${'https://viewer.diagrams.net/math/es5'}  | ${'http://example.com/?offline=1&https=0'} | ${'http://example.com/math/es5'}
  `(
    'should move "$bakedMathUrl" onto the instance configured by "$drawioUri"',
    ({
      bakedMathUrl,
      drawioUri,
      expected,
    }: {
      bakedMathUrl: string;
      drawioUri: string;
      expected: string;
    }) => {
      expect(relocateMathUrl(bakedMathUrl, drawioUri)).toBe(expected);
    },
  );

  it('should keep the sub path when draw.io is deployed under one', () => {
    // The baked URL always has a root-relative path because viewer.diagrams.net serves
    // from the root, so the instance's own sub path has to be prepended.
    expect(
      relocateMathUrl(
        'https://viewer.diagrams.net/math4/es5',
        'http://example.com/drawio',
      ),
    ).toBe('http://example.com/drawio/math4/es5');
  });

  it.each`
    bakedMathUrl  | drawioUri                  | reason
    ${undefined}  | ${'http://localhost:8080'} | ${'the global is not set'}
    ${'math/es5'} | ${'http://localhost:8080'} | ${'the baked value is not absolute'}
    ${''}         | ${'http://localhost:8080'} | ${'the baked value is empty'}
  `(
    'should return undefined when $reason',
    ({
      bakedMathUrl,
      drawioUri,
    }: {
      bakedMathUrl: string | undefined;
      drawioUri: string;
    }) => {
      expect(relocateMathUrl(bakedMathUrl, drawioUri)).toBeUndefined();
    },
  );

  it('should return undefined when drawioUri cannot be parsed', () => {
    expect(
      relocateMathUrl('https://viewer.diagrams.net/math/es5', 'not-a-url'),
    ).toBeUndefined();
  });
});
