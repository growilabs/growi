import { buildLocalStoragePath } from './local-storage-path';

const BASE = '/var/growi/public/uploads';

describe('buildLocalStoragePath', () => {
  test('should join base, dirName and a flat fileName', () => {
    expect(buildLocalStoragePath(BASE, 'user', 'abc.png')).toBe(
      '/var/growi/public/uploads/user/abc.png',
    );
    expect(
      buildLocalStoragePath(BASE, 'attachment', 'e10adc3949ba59.png'),
    ).toBe('/var/growi/public/uploads/attachment/e10adc3949ba59.png');
  });

  // Sink-level backstop: even if a crafted fileName reaches storage (e.g. an
  // attachment document imported via g2g transfer), the resolved path must never
  // escape the uploads base — this guards write, read and delete paths alike.
  // The check is against the uploads base, so a traversal that only pops back
  // up to (but not above) the base is not an escape; the transfer-receive
  // boundary rejects any separator-bearing fileName before it can reach here.
  describe('rejects a fileName that escapes the uploads base directory', () => {
    test.each([
      ['parent traversal to web root', '../../evil.html'],
      ['deep traversal to app dir', '../../../app/secret'],
      ['deep traversal past root', '../../../../etc/passwd'],
    ])('should throw for %s', (_label, fileName) => {
      expect(() => buildLocalStoragePath(BASE, 'user', fileName)).toThrow();
    });
  });

  test('should not throw when traversal only stays within the uploads base', () => {
    // `user/../other` resolves to `<base>/other`, still inside the uploads base.
    expect(buildLocalStoragePath(BASE, 'user', '../other.png')).toBe(
      '/var/growi/public/uploads/other.png',
    );
  });
});
