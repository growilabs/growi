import { buildInstrumentations } from './node-sdk-configuration';

// Hoist mock variables so they are available inside vi.mock() factory closures
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

// Mock getNodeAutoInstrumentations to capture the config passed to it
vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: vi.fn((config) => ({
    __instrumentationConfig: config,
  })),
}));

// Mock anonymization module
vi.mock('./anonymization', () => ({
  httpInstrumentationConfig: {
    requestHook: vi.fn(),
    responseHook: vi.fn(),
  },
}));

// Mock growi-version
vi.mock('~/utils/growi-version', () => ({
  getGrowiVersion: vi.fn().mockReturnValue('1.0.0'),
}));

// Mock logger to capture warn calls
vi.mock('~/utils/logger', () => ({
  default: vi.fn().mockReturnValue({
    warn: mockWarn,
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

// Mock configManager
vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn(),
  },
}));

// Mock resource modules to avoid external calls
vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: vi.fn().mockReturnValue({ merge: vi.fn() }),
}));

vi.mock('@opentelemetry/exporter-metrics-otlp-grpc', () => ({
  OTLPMetricExporter: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@opentelemetry/exporter-trace-otlp-grpc', () => ({
  OTLPTraceExporter: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('./semconv', () => ({
  ATTR_SERVICE_INSTANCE_ID: 'service.instance.id',
}));

/**
 * Helper to extract the config object that was passed to getNodeAutoInstrumentations
 * from the result of buildInstrumentations
 */
const getPassedConfig = (
  instrumentations: ReturnType<typeof buildInstrumentations>,
): Record<string, { enabled?: boolean; [key: string]: unknown }> => {
  const mocked = instrumentations[0] as unknown as {
    __instrumentationConfig: Record<
      string,
      { enabled?: boolean; [key: string]: unknown }
    >;
  };
  return mocked.__instrumentationConfig;
};

describe('buildInstrumentations', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWarn.mockClear();
    process.env = { ...originalEnv };
    delete process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('minimal profile (default - env var unset)', () => {
    it('should disable non-allow-list instrumentations (e.g. dns)', () => {
      delete process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE;
      const instrumentations = buildInstrumentations();
      const config = getPassedConfig(instrumentations);

      expect(config['@opentelemetry/instrumentation-dns']).toEqual({
        enabled: false,
      });
    });

    it('should enable the 4 allow-list instrumentations', () => {
      delete process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE;
      const instrumentations = buildInstrumentations();
      const config = getPassedConfig(instrumentations);

      // Allow-list items should not be set to disabled
      expect(config['@opentelemetry/instrumentation-http']?.enabled).not.toBe(
        false,
      );
      expect(
        config['@opentelemetry/instrumentation-express']?.enabled,
      ).not.toBe(false);
      expect(
        config['@opentelemetry/instrumentation-mongodb']?.enabled,
      ).not.toBe(false);
      expect(
        config['@opentelemetry/instrumentation-mongoose']?.enabled,
      ).not.toBe(false);
    });

    it('should also disable other non-allow-list instrumentations', () => {
      delete process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE;
      const instrumentations = buildInstrumentations();
      const config = getPassedConfig(instrumentations);

      expect(config['@opentelemetry/instrumentation-amqplib']).toEqual({
        enabled: false,
      });
      expect(config['@opentelemetry/instrumentation-redis']).toEqual({
        enabled: false,
      });
      expect(config['@opentelemetry/instrumentation-grpc']).toEqual({
        enabled: false,
      });
    });
  });

  describe('minimal profile (explicitly set)', () => {
    it('should disable non-allow-list instrumentations when OTEL_AUTO_INSTRUMENTATION_PROFILE=minimal', () => {
      process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE = 'minimal';
      const instrumentations = buildInstrumentations();
      const config = getPassedConfig(instrumentations);

      expect(config['@opentelemetry/instrumentation-dns']).toEqual({
        enabled: false,
      });
    });
  });

  describe('all profile', () => {
    it('should disable ONLY pino and fs (legacy behavior)', () => {
      process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE = 'all';
      const instrumentations = buildInstrumentations();
      const config = getPassedConfig(instrumentations);

      expect(config['@opentelemetry/instrumentation-pino']).toEqual({
        enabled: false,
      });
      expect(config['@opentelemetry/instrumentation-fs']).toEqual({
        enabled: false,
      });
    });

    it('should NOT disable dns (or other instrumentations not pino/fs)', () => {
      process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE = 'all';
      const instrumentations = buildInstrumentations();
      const config = getPassedConfig(instrumentations);

      // dns should not be disabled in "all" mode
      expect(config['@opentelemetry/instrumentation-dns']?.enabled).not.toBe(
        false,
      );
    });

    it('should enable http in all profile', () => {
      process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE = 'all';
      const instrumentations = buildInstrumentations();
      const config = getPassedConfig(instrumentations);

      expect(config['@opentelemetry/instrumentation-http']?.enabled).toBe(true);
    });
  });

  describe('unknown profile value', () => {
    it('should treat unknown profile as minimal (disable non-allow-list)', () => {
      process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE = 'custom';
      const instrumentations = buildInstrumentations();
      const config = getPassedConfig(instrumentations);

      // Should behave like minimal
      expect(config['@opentelemetry/instrumentation-dns']).toEqual({
        enabled: false,
      });
    });

    it('should issue a warn for unknown profile values', () => {
      process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE = 'custom';

      buildInstrumentations();

      // Logger warn should have been called with the unknown profile value
      expect(mockWarn).toHaveBeenCalledWith(
        { profile: 'custom' },
        expect.stringContaining('Unknown OTEL_AUTO_INSTRUMENTATION_PROFILE'),
      );
    });
  });

  describe('HTTP anonymization config merging', () => {
    it('should merge anonymization config into http instrumentation when enableAnonymization=true', async () => {
      delete process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE;
      const { httpInstrumentationConfig: anonymizeConfig } = await import(
        './anonymization'
      );

      const instrumentations = buildInstrumentations({
        enableAnonymization: true,
      });
      const config = getPassedConfig(instrumentations);

      // The anonymization config should be merged into http instrumentation
      const httpConfig = config['@opentelemetry/instrumentation-http'];
      expect(httpConfig).toBeDefined();
      // Should contain anonymization hooks
      expect(httpConfig).toMatchObject(
        anonymizeConfig as Record<string, unknown>,
      );
    });

    it('should NOT merge anonymization config when enableAnonymization=false', () => {
      delete process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE;
      const instrumentations = buildInstrumentations({
        enableAnonymization: false,
      });
      const config = getPassedConfig(instrumentations);

      const httpConfig = config['@opentelemetry/instrumentation-http'];
      // requestHook and responseHook should not be present if not anonymizing
      expect(httpConfig?.requestHook).toBeUndefined();
      expect(httpConfig?.responseHook).toBeUndefined();
    });

    it('should merge anonymization config in all profile too', async () => {
      process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE = 'all';
      const { httpInstrumentationConfig: anonymizeConfig } = await import(
        './anonymization'
      );

      const instrumentations = buildInstrumentations({
        enableAnonymization: true,
      });
      const config = getPassedConfig(instrumentations);

      const httpConfig = config['@opentelemetry/instrumentation-http'];
      expect(httpConfig).toMatchObject(
        anonymizeConfig as Record<string, unknown>,
      );
    });
  });
});
