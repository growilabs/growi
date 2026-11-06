import { validateAttachmentMetadata } from './g2g-transfer-attachment-metadata';

describe('validateAttachmentMetadata', () => {
  test('should return null for a valid flat fileName and non-negative integer fileSize', () => {
    const result = validateAttachmentMetadata({
      fileName: 'e10adc3949ba59abbe56e057f20f883e.png',
      fileSize: 1024,
    });
    expect(result).toBeNull();
  });

  test('should accept fileSize of 0', () => {
    expect(
      validateAttachmentMetadata({ fileName: 'abc.bin', fileSize: 0 }),
    ).toBeNull();
  });

  describe('rejects invalid metadata shape', () => {
    test.each([
      ['null', null],
      ['a string', 'not-an-object'],
      ['a number', 123],
    ])('should reject when metadata is %s', (_label, meta) => {
      const result = validateAttachmentMetadata(meta);
      expect(result).not.toBeNull();
      expect(result?.code).toBe('invalid_metadata');
    });
  });

  describe('rejects invalid fileName', () => {
    test.each([
      ['missing (undefined)', undefined],
      ['a number', 42],
      ['empty', ''],
      ['longer than 256 chars', 'a'.repeat(257)],
    ])('should reject fileName that is %s', (_label, fileName) => {
      const result = validateAttachmentMetadata({ fileName, fileSize: 1 });
      expect(result).not.toBeNull();
      expect(result?.code).toBe('invalid_metadata');
    });
  });

  // Core of the path-traversal fix: a client-supplied fileName must be a plain
  // basename. Any directory separator, parent reference or NUL byte is rejected
  // so it can never escape the attachment storage directory
  // (<publicDir>/uploads/user) at the local file-uploader sink.
  describe('rejects path traversal in fileName', () => {
    test.each([
      ['parent traversal to web root', '../../evil.html'],
      ['single parent traversal', '../evil'],
      ['bare double dot', '..'],
      ['bare single dot', '.'],
      ['forward-slash subpath', 'sub/dir/file.txt'],
      ['leading slash (absolute-ish)', '/etc/passwd'],
      ['backslash traversal (Windows)', '..\\..\\evil'],
      ['backslash subpath', 'sub\\file'],
      ['embedded NUL byte', 'evil\u0000.png'],
    ])('should reject fileName with %s', (_label, fileName) => {
      const result = validateAttachmentMetadata({ fileName, fileSize: 1 });
      expect(result).not.toBeNull();
      expect(result?.code).toBe('invalid_metadata');
    });
  });

  describe('rejects invalid fileSize', () => {
    test.each([
      ['a string', '1024'],
      ['negative', -1],
      ['a float', 1.5],
      ['NaN', Number.NaN],
      ['missing (undefined)', undefined],
    ])('should reject fileSize that is %s', (_label, fileSize) => {
      const result = validateAttachmentMetadata({
        fileName: 'abc.png',
        fileSize,
      });
      expect(result).not.toBeNull();
      expect(result?.code).toBe('invalid_metadata');
    });
  });
});
