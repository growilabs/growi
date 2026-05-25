import { buildInstrumentations } from './node-sdk-configuration';

// Hoist mock variables so they are available inside vi.mock() factory closures
const {
  mockWarn,
  mockHttpInstrumentationConstructor,
  mockExpressConstructor,
  mockMongoDBConstructor,
  mockMongooseConstructor,
} = vi.hoisted(() => ({
  mockWarn: vi.fn(),
  mockHttpInstrumentationConstructor: vi.fn(),
  mockExpressConstructor: vi.fn(),
  mockMongoDBConstructor: vi.fn(),
  mockMongooseConstructor: vi.fn(),
}));

// Mock all 4 instrumentation packages individually
vi.mock('@opentelemetry/instrumentation-http', () => ({
  HttpInstrumentation: mockHttpInstrumentationConstructor,
}));

vi.mock('@opentelemetry/instrumentation-express', () => ({
  ExpressInstrumentation: mockExpressConstructor,
}));

vi.mock('@opentelemetry/instrumentation-mongodb', () => ({
  MongoDBInstrumentation: mockMongoDBConstructor,
}));

vi.mock('@opentelemetry/instrumentation-mongoose', () => ({
  MongooseInstrumentation: mockMongooseConstructor,
}));

// Mock anonymization module
vi.mock('./anonymization', () => ({
  httpInstrumentationConfig: {
    startIncomingSpanHook: vi.fn(),
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

  describe('returns exactly 4 instrumentations (Req 1.3)', () => {
    it('should return an array of length 4 with all 4 constructors called once', () => {
      const result = buildInstrumentations();

      expect(result).toHaveLength(4);
      expect(mockHttpInstrumentationConstructor).toHaveBeenCalledTimes(1);
      expect(mockExpressConstructor).toHaveBeenCalledTimes(1);
      expect(mockMongoDBConstructor).toHaveBeenCalledTimes(1);
      expect(mockMongooseConstructor).toHaveBeenCalledTimes(1);
    });
  });

  describe('OTEL_AUTO_INSTRUMENTATION_PROFILE behavior', () => {
    describe('unset (Req 4.1)', () => {
      it('should return 4 instrumentations without deprecation warning when env var is unset', () => {
        delete process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE;

        const result = buildInstrumentations();

        expect(result).toHaveLength(4);
        expect(mockWarn).not.toHaveBeenCalled();
      });
    });

    describe('=minimal (Req 4.2)', () => {
      it('should return 4 instrumentations without deprecation warning when profile=minimal', () => {
        process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE = 'minimal';

        const result = buildInstrumentations();

        expect(result).toHaveLength(4);
        expect(mockWarn).not.toHaveBeenCalled();
      });
    });

    describe('=all (Req 4.3)', () => {
      it('should emit deprecation warning exactly once and still return 4 instrumentations', () => {
        process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE = 'all';

        const result = buildInstrumentations();

        expect(result).toHaveLength(4);
        expect(mockWarn).toHaveBeenCalledTimes(1);
        expect(mockWarn).toHaveBeenCalledWith(
          expect.stringContaining(
            'OTEL_AUTO_INSTRUMENTATION_PROFILE=all is deprecated',
          ),
        );
      });
    });

    describe('unknown value (Req 4.4)', () => {
      it('should emit warning with "Unknown OTEL_AUTO_INSTRUMENTATION_PROFILE value" and return 4 instrumentations', () => {
        process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE = 'custom';

        const result = buildInstrumentations();

        expect(result).toHaveLength(4);
        expect(mockWarn).toHaveBeenCalledTimes(1);
        expect(mockWarn).toHaveBeenCalledWith(
          { profile: 'custom' },
          expect.stringContaining(
            'Unknown OTEL_AUTO_INSTRUMENTATION_PROFILE value',
          ),
        );
      });
    });

    describe('never throws (Req 4.5)', () => {
      it('should not throw for any profile value', () => {
        const testValues = [
          undefined,
          'minimal',
          'all',
          'custom',
          '',
          'MINIMAL',
          'ALL',
        ];

        for (const value of testValues) {
          if (value === undefined) {
            delete process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE;
          } else {
            process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE = value;
          }

          expect(() => buildInstrumentations()).not.toThrow();
          vi.clearAllMocks();
        }
      });
    });
  });

  describe('HTTP anonymization config merging', () => {
    it('should pass anonymization config to HttpInstrumentation when enableAnonymization=true (Req 3.1, Req 3.3)', async () => {
      delete process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE;
      const { httpInstrumentationConfig: anonymizeConfig } = await import(
        './anonymization'
      );

      buildInstrumentations({ enableAnonymization: true });

      // The first argument passed to HttpInstrumentation constructor should contain anonymization config fields
      const httpConstructorArg =
        mockHttpInstrumentationConstructor.mock.calls[0][0];
      expect(httpConstructorArg).toBeDefined();
      expect(httpConstructorArg).toMatchObject(
        anonymizeConfig as Record<string, unknown>,
      );
    });

    it('should NOT pass anonymization config to HttpInstrumentation when enableAnonymization=false (Req 3.2)', () => {
      delete process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE;

      buildInstrumentations({ enableAnonymization: false });

      // The first argument passed to HttpInstrumentation constructor should be undefined (no anonymization config)
      const httpConstructorArg =
        mockHttpInstrumentationConstructor.mock.calls[0][0];
      expect(httpConstructorArg).toBeUndefined();
    });

    it('should NOT pass anonymization config to HttpInstrumentation when enableAnonymization is unset (Req 3.2)', () => {
      delete process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE;

      buildInstrumentations();

      // The first argument passed to HttpInstrumentation constructor should be undefined (no anonymization config)
      const httpConstructorArg =
        mockHttpInstrumentationConstructor.mock.calls[0][0];
      expect(httpConstructorArg).toBeUndefined();
    });

    it('should pass anonymization config even when profile=all (Req 3.1)', async () => {
      process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE = 'all';
      const { httpInstrumentationConfig: anonymizeConfig } = await import(
        './anonymization'
      );

      buildInstrumentations({ enableAnonymization: true });

      const httpConstructorArg =
        mockHttpInstrumentationConstructor.mock.calls[0][0];
      expect(httpConstructorArg).toBeDefined();
      expect(httpConstructorArg).toMatchObject(
        anonymizeConfig as Record<string, unknown>,
      );
    });
  });
});
