import {
  loadSettings,
  type Settings,
  toConversionLimits,
} from './load-settings';

const TOKEN = 'ATTACHMENT_EXTRACTOR_SERVICE_TOKEN';
const MIB = 1024 * 1024;

type Env = Readonly<Record<string, string | undefined>>;

const withToken = (env: Env = {}): Env => ({ [TOKEN]: 'tok', ...env });

const INT_SETTINGS: readonly (readonly [string, keyof Settings])[] = [
  ['MAX_FILE_SIZE_MB', 'maxFileSizeMb'],
  ['TIMEOUT_S', 'timeoutS'],
  ['UPLOAD_TIMEOUT_S', 'uploadTimeoutS'],
  ['MAX_CONCURRENCY', 'maxConcurrency'],
  ['MAX_CHILD_RSS_MB', 'maxChildRssMb'],
  ['MAX_XLSX_CELLS', 'maxXlsxCells'],
  ['MAX_RESULT_BYTES', 'maxResultBytes'],
  ['MAX_PDF_PAGES', 'maxPdfPages'],
  ['MAX_ARCHIVE_ENTRIES', 'maxArchiveEntries'],
  ['MAX_ARCHIVE_UNCOMPRESSED_MB', 'maxArchiveUncompressedMb'],
  ['MAX_CSV_BYTES', 'maxCsvBytes'],
  ['MAX_HTML_BYTES', 'maxHtmlBytes'],
];

describe('loadSettings: the service token is required (Req 1.5)', () => {
  it('fails when the token is not set', () => {
    expect(() => loadSettings({})).toThrow(TOKEN);
  });

  it('fails when the token is an empty string', () => {
    expect(() => loadSettings({ [TOKEN]: '' })).toThrow(TOKEN);
  });

  it('fails when the token is whitespace only', () => {
    expect(() => loadSettings({ [TOKEN]: '   ' })).toThrow(TOKEN);
  });
});

describe('loadSettings: defaults (Req 1.4)', () => {
  const settings = (): Settings =>
    loadSettings({ [TOKEN]: 'test-secret-token' });

  it('defaults MAX_FILE_SIZE_MB to 50', () => {
    expect(settings().maxFileSizeMb).toBe(50);
  });

  it('defaults TIMEOUT_S to 55', () => {
    expect(settings().timeoutS).toBe(55);
  });

  it('defaults MAX_CONCURRENCY to 3', () => {
    expect(settings().maxConcurrency).toBe(3);
  });

  it.each([
    ['MAX_CHILD_RSS_MB', 'maxChildRssMb', 320],
    ['MAX_XLSX_CELLS', 'maxXlsxCells', 70_000],
    ['MAX_RESULT_BYTES', 'maxResultBytes', 16 * MIB],
    ['MAX_PDF_PAGES', 'maxPdfPages', 5_000],
    ['MAX_ARCHIVE_ENTRIES', 'maxArchiveEntries', 10_000],
    ['MAX_ARCHIVE_UNCOMPRESSED_MB', 'maxArchiveUncompressedMb', 512],
    ['MAX_CSV_BYTES', 'maxCsvBytes', 8 * MIB],
    ['MAX_HTML_BYTES', 'maxHtmlBytes', 20 * MIB],
  ] as const)('defaults %s to %i', (_name, key, expected) => {
    expect(settings()[key]).toBe(expected);
  });

  it('defaults LOG_LEVEL to INFO', () => {
    expect(settings().logLevel).toBe('INFO');
  });

  it('exposes the token', () => {
    expect(settings().serviceToken).toBe('test-secret-token');
  });

  it('defaults UPLOAD_TIMEOUT_S to 15', () => {
    expect(loadSettings(withToken()).uploadTimeoutS).toBe(15);
  });
});

describe('loadSettings: environment overrides', () => {
  it('overrides MAX_FILE_SIZE_MB', () => {
    expect(
      loadSettings(withToken({ MAX_FILE_SIZE_MB: '100' })).maxFileSizeMb,
    ).toBe(100);
  });

  it('overrides TIMEOUT_S', () => {
    expect(loadSettings(withToken({ TIMEOUT_S: '120' })).timeoutS).toBe(120);
  });

  it('overrides LOG_LEVEL', () => {
    expect(loadSettings(withToken({ LOG_LEVEL: 'DEBUG' })).logLevel).toBe(
      'DEBUG',
    );
  });

  it('overrides MAX_CHILD_RSS_MB', () => {
    expect(
      loadSettings(withToken({ MAX_CHILD_RSS_MB: '640' })).maxChildRssMb,
    ).toBe(640);
  });

  it.each([
    ['MAX_CSV_BYTES', 'maxCsvBytes'],
    ['MAX_HTML_BYTES', 'maxHtmlBytes'],
  ] as const)('overrides the input size cap %s', (name, key) => {
    expect(loadSettings(withToken({ [name]: '1000' }))[key]).toBe(1000);
  });

  // Python (pydantic) accepts surrounding whitespace in an integer value.
  it.each(
    INT_SETTINGS,
  )('reads %s as an integer, ignoring surrounding whitespace', (name, key) => {
    expect(loadSettings(withToken({ [name]: ' 7 ' }))[key]).toBe(7);
  });
});

// Each failure names the variable, so the operator can tell which setting to fix.
describe('loadSettings: invalid values fail at startup', () => {
  it.each([
    '0',
    '-1',
    'abc',
  ])('rejects UPLOAD_TIMEOUT_S=%j: it must be a positive integer', (value) => {
    expect(() => loadSettings(withToken({ UPLOAD_TIMEOUT_S: value }))).toThrow(
      'UPLOAD_TIMEOUT_S',
    );
  });

  it.each([
    ['MAX_CSV_BYTES', '0'],
    ['MAX_CSV_BYTES', '-1'],
    ['MAX_CSV_BYTES', 'abc'],
    ['MAX_HTML_BYTES', '0'],
    ['MAX_HTML_BYTES', '-1'],
    ['MAX_HTML_BYTES', 'abc'],
  ])('rejects %s=%j: the cap must be a positive integer', (name, value) => {
    expect(() => loadSettings(withToken({ [name]: value }))).toThrow(name);
  });

  // Python (pydantic) rejects a non-integer string for every integer setting.
  it.each(
    INT_SETTINGS.flatMap(([name]) => [
      [name, 'abc'],
      [name, '1.5'],
    ]),
  )('rejects %s=%j: it is not an integer', (name, value) => {
    expect(() => loadSettings(withToken({ [name]: value }))).toThrow(name);
  });

  it('normalises LOG_LEVEL to upper case', () => {
    expect(loadSettings(withToken({ LOG_LEVEL: 'warning' })).logLevel).toBe(
      'WARNING',
    );
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => loadSettings(withToken({ LOG_LEVEL: 'LOUD' }))).toThrow(
      'LOG_LEVEL',
    );
  });
});

describe('loadSettings: what it does not read', () => {
  // D1: WORKERS is abolished; a value left over from an old deployment changes nothing.
  it.each(['4', 'abc'])('ignores WORKERS=%j without failing', (value) => {
    expect(loadSettings(withToken({ WORKERS: value }))).toEqual(
      loadSettings(withToken()),
    );
  });

  describe('the process environment', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('reads only the env object it is given, never process.env', () => {
      vi.stubEnv(TOKEN, 'from-process-env');
      vi.stubEnv('MAX_FILE_SIZE_MB', '1');

      expect(() => loadSettings({})).toThrow(TOKEN);
      expect(loadSettings(withToken()).maxFileSizeMb).toBe(50);
    });
  });
});

describe('toConversionLimits', () => {
  it('builds the conversion limits from the defaults and ignores IPYNB_OUTPUT_MAX_CHARS', () => {
    const settings = loadSettings(withToken({ IPYNB_OUTPUT_MAX_CHARS: '1' }));

    expect(toConversionLimits(settings)).toEqual({
      maxXlsxCells: 70_000,
      maxPdfPages: 5_000,
      maxArchiveEntries: 10_000,
      maxArchiveUncompressedBytes: 512 * MIB,
      maxResultBytes: 16 * MIB,
      maxCsvBytes: 8 * MIB,
      maxHtmlBytes: 20 * MIB,
    });
  });

  it('takes every limit from its own setting', () => {
    const settings = loadSettings(
      withToken({
        MAX_XLSX_CELLS: '11',
        MAX_PDF_PAGES: '12',
        MAX_ARCHIVE_ENTRIES: '13',
        MAX_ARCHIVE_UNCOMPRESSED_MB: '14',
        MAX_RESULT_BYTES: '15',
        MAX_CSV_BYTES: '16',
        MAX_HTML_BYTES: '17',
      }),
    );

    expect(toConversionLimits(settings)).toEqual({
      maxXlsxCells: 11,
      maxPdfPages: 12,
      maxArchiveEntries: 13,
      maxArchiveUncompressedBytes: 14 * MIB,
      maxResultBytes: 15,
      maxCsvBytes: 16,
      maxHtmlBytes: 17,
    });
  });
});
