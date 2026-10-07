import { DEFAULT_DRAWIO_ORIGIN } from './consts';
import { isSelfHostedDrawio } from './is-self-hosted-drawio';

describe('isSelfHostedDrawio', () => {
  it.each`
    drawioUri                              | expected | reason
    ${'http://localhost:8080/?offline=1'}  | ${true}  | ${'a local instance'}
    ${'https://drawio.example.com/'}       | ${true}  | ${'an instance the organisation runs'}
    ${'https://drawio.example.com/drawio'} | ${true}  | ${'an instance under a sub path'}
    ${`${DEFAULT_DRAWIO_ORIGIN}/`}         | ${false} | ${"draw.io's own hosted viewer"}
    ${`${DEFAULT_DRAWIO_ORIGIN}/?lang=ja`} | ${false} | ${"draw.io's own viewer with parameters"}
    ${'not-a-url'}                         | ${false} | ${'an unparsable value, which leaves draw.io defaults in place'}
    ${''}                                  | ${false} | ${'an empty value, which is what an unset DRAWIO_URI amounts to'}
  `(
    'should be $expected for $reason',
    ({ drawioUri, expected }: { drawioUri: string; expected: boolean }) => {
      expect(isSelfHostedDrawio(drawioUri)).toBe(expected);
    },
  );
});
