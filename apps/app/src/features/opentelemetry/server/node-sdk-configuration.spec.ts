const {
  mockHttpInstrumentationConstructor,
  mockExpressConstructor,
  mockMongoDBConstructor,
  mockMongooseConstructor,
} = vi.hoisted(() => ({
  mockHttpInstrumentationConstructor: vi.fn(),
  mockExpressConstructor: vi.fn(),
  mockMongoDBConstructor: vi.fn(),
  mockMongooseConstructor: vi.fn(),
}));

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

vi.mock('./anonymization', () => ({
  httpInstrumentationConfig: {
    startIncomingSpanHook: vi.fn(),
  },
  serverSpanAnonymizer: {
    onStart: vi.fn(),
    onEnd: vi.fn(),
    forceFlush: vi.fn(),
    shutdown: vi.fn(),
  },
}));

vi.mock('~/utils/growi-version', () => ({
  getGrowiVersion: vi.fn().mockReturnValue('1.0.0'),
}));

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

vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn(),
  },
}));

describe('generateNodeSDKConfiguration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('instrumentations', () => {
    it('should instantiate all 4 instrumentations', async () => {
      const { generateNodeSDKConfiguration } = await import(
        './node-sdk-configuration'
      );
      generateNodeSDKConfiguration();

      expect(mockHttpInstrumentationConstructor).toHaveBeenCalledTimes(1);
      expect(mockExpressConstructor).toHaveBeenCalledTimes(1);
      expect(mockMongoDBConstructor).toHaveBeenCalledTimes(1);
      expect(mockMongooseConstructor).toHaveBeenCalledTimes(1);
    });

    it('should pass anonymization config to HttpInstrumentation when enableAnonymization=true', async () => {
      const { generateNodeSDKConfiguration } = await import(
        './node-sdk-configuration'
      );
      const { httpInstrumentationConfig: anonymizeConfig } = await import(
        './anonymization'
      );

      generateNodeSDKConfiguration({ enableAnonymization: true });

      const httpConstructorArg =
        mockHttpInstrumentationConstructor.mock.calls[0][0];
      expect(httpConstructorArg).toMatchObject(
        anonymizeConfig as Record<string, unknown>,
      );
    });

    it('should not pass anonymization config to HttpInstrumentation when enableAnonymization=false', async () => {
      const { generateNodeSDKConfiguration } = await import(
        './node-sdk-configuration'
      );

      generateNodeSDKConfiguration({ enableAnonymization: false });

      const httpConstructorArg =
        mockHttpInstrumentationConstructor.mock.calls[0][0];
      expect(httpConstructorArg).toBeUndefined();
    });

    it('should not pass anonymization config to HttpInstrumentation when enableAnonymization is unset', async () => {
      const { generateNodeSDKConfiguration } = await import(
        './node-sdk-configuration'
      );

      generateNodeSDKConfiguration();

      const httpConstructorArg =
        mockHttpInstrumentationConstructor.mock.calls[0][0];
      expect(httpConstructorArg).toBeUndefined();
    });
  });

  describe('spanProcessors', () => {
    it('should anonymize server spans when enableAnonymization=true', async () => {
      const { generateNodeSDKConfiguration } = await import(
        './node-sdk-configuration'
      );
      const { serverSpanAnonymizer } = await import('./anonymization');

      const { spanProcessors } = generateNodeSDKConfiguration({
        enableAnonymization: true,
      });

      expect(spanProcessors).toContain(serverSpanAnonymizer);
    });

    it.each`
      enableAnonymization
      ${false}
      ${undefined}
    `(
      'should not anonymize server spans when enableAnonymization=$enableAnonymization',
      async ({ enableAnonymization }) => {
        const { generateNodeSDKConfiguration } = await import(
          './node-sdk-configuration'
        );
        const { serverSpanAnonymizer } = await import('./anonymization');

        const { spanProcessors } = generateNodeSDKConfiguration({
          enableAnonymization,
        });

        expect(spanProcessors).not.toContain(serverSpanAnonymizer);
      },
    );

    it.each`
      enableAnonymization
      ${true}
      ${false}
      ${undefined}
    `(
      'should export traces when enableAnonymization=$enableAnonymization',
      async ({ enableAnonymization }) => {
        const { generateNodeSDKConfiguration } = await import(
          './node-sdk-configuration'
        );
        const { BatchSpanProcessor } = await import(
          '@opentelemetry/sdk-trace-node'
        );

        const { spanProcessors } = generateNodeSDKConfiguration({
          enableAnonymization,
        });

        expect(spanProcessors).toContainEqual(expect.any(BatchSpanProcessor));
      },
    );
  });
});
