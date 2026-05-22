import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import type { Resource } from '@opentelemetry/resources';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import { configManager } from '~/server/service/config-manager';
import { getGrowiVersion } from '~/utils/growi-version';
import loggerFactory from '~/utils/logger';

import { httpInstrumentationConfig as httpInstrumentationConfigForAnonymize } from './anonymization';
import { ATTR_SERVICE_INSTANCE_ID } from './semconv';

const logger = loggerFactory('growi:opentelemetry:node-sdk-configuration');

type Option = {
  enableAnonymization?: boolean;
};

type Configuration = Partial<NodeSDKConfiguration> & {
  resource: Resource;
};

let resource: Resource;
let configuration: Configuration;

/**
 * All instrumentation package names supported by @opentelemetry/auto-instrumentations-node.
 * These are used to build the deny-list for the minimal profile.
 */
const ALL_AUTO_INSTRUMENTATION_PACKAGES = [
  '@opentelemetry/instrumentation-amqplib',
  '@opentelemetry/instrumentation-aws-lambda',
  '@opentelemetry/instrumentation-aws-sdk',
  '@opentelemetry/instrumentation-bunyan',
  '@opentelemetry/instrumentation-cassandra-driver',
  '@opentelemetry/instrumentation-connect',
  '@opentelemetry/instrumentation-cucumber',
  '@opentelemetry/instrumentation-dataloader',
  '@opentelemetry/instrumentation-dns',
  '@opentelemetry/instrumentation-express',
  '@opentelemetry/instrumentation-fs',
  '@opentelemetry/instrumentation-generic-pool',
  '@opentelemetry/instrumentation-graphql',
  '@opentelemetry/instrumentation-grpc',
  '@opentelemetry/instrumentation-hapi',
  '@opentelemetry/instrumentation-http',
  '@opentelemetry/instrumentation-ioredis',
  '@opentelemetry/instrumentation-kafkajs',
  '@opentelemetry/instrumentation-knex',
  '@opentelemetry/instrumentation-koa',
  '@opentelemetry/instrumentation-lru-memoizer',
  '@opentelemetry/instrumentation-memcached',
  '@opentelemetry/instrumentation-mongodb',
  '@opentelemetry/instrumentation-mongoose',
  '@opentelemetry/instrumentation-mysql2',
  '@opentelemetry/instrumentation-mysql',
  '@opentelemetry/instrumentation-nestjs-core',
  '@opentelemetry/instrumentation-net',
  '@opentelemetry/instrumentation-openai',
  '@opentelemetry/instrumentation-oracledb',
  '@opentelemetry/instrumentation-pg',
  '@opentelemetry/instrumentation-pino',
  '@opentelemetry/instrumentation-redis',
  '@opentelemetry/instrumentation-restify',
  '@opentelemetry/instrumentation-router',
  '@opentelemetry/instrumentation-runtime-node',
  '@opentelemetry/instrumentation-socket.io',
  '@opentelemetry/instrumentation-tedious',
  '@opentelemetry/instrumentation-undici',
  '@opentelemetry/instrumentation-winston',
] as const;

/**
 * The allow-list: only these instrumentations are enabled in the minimal profile.
 * These are the libraries actually used by GROWI.
 */
const ALLOW_LIST_INSTRUMENTATION_PACKAGES = new Set([
  '@opentelemetry/instrumentation-http',
  '@opentelemetry/instrumentation-express',
  '@opentelemetry/instrumentation-mongodb',
  '@opentelemetry/instrumentation-mongoose',
]);

/**
 * Build the instrumentations array based on OTEL_AUTO_INSTRUMENTATION_PROFILE env var.
 *
 * - "minimal" (default, unset): enable only the 4 allow-list instrumentations
 * - "all": legacy behavior (only pino + fs disabled)
 * - unknown value: warn log + treat as "minimal"
 */
export const buildInstrumentations = (
  opts?: Option,
): ReturnType<typeof getNodeAutoInstrumentations>[] => {
  const profile = process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE ?? 'minimal';
  const httpInstrumentationConfig = opts?.enableAnonymization
    ? httpInstrumentationConfigForAnonymize
    : {};

  if (profile === 'all') {
    // Legacy behavior: only disable pino and fs
    return [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-pino': { enabled: false },
        // Disable fs instrumentation since this generates very large amount of traces
        // see: https://opentelemetry.io/docs/languages/js/libraries/#registration
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          enabled: true,
          ...httpInstrumentationConfig,
        },
      }),
    ] as unknown as ReturnType<typeof getNodeAutoInstrumentations>[];
  }

  if (profile !== 'minimal') {
    // Unknown profile value: warn and treat as minimal
    logger.warn(
      { profile },
      'Unknown OTEL_AUTO_INSTRUMENTATION_PROFILE value, treating as minimal',
    );
  }

  // Minimal profile: build deny-list config — disable everything except the allow-list
  const instrumentationConfig: Record<
    string,
    { enabled: boolean } | Record<string, unknown>
  > = {};

  for (const pkg of ALL_AUTO_INSTRUMENTATION_PACKAGES) {
    if (ALLOW_LIST_INSTRUMENTATION_PACKAGES.has(pkg)) {
      // Allow-list packages: enable them (http gets merged with anonymization config)
      if (pkg === '@opentelemetry/instrumentation-http') {
        instrumentationConfig[pkg] = {
          enabled: true,
          ...httpInstrumentationConfig,
        };
      } else {
        instrumentationConfig[pkg] = { enabled: true };
      }
    } else {
      // Non-allow-list packages: explicitly disable
      instrumentationConfig[pkg] = { enabled: false };
    }
  }

  return [
    getNodeAutoInstrumentations(instrumentationConfig),
  ] as unknown as ReturnType<typeof getNodeAutoInstrumentations>[];
};

export const generateNodeSDKConfiguration = (opts?: Option): Configuration => {
  if (configuration == null) {
    const version = getGrowiVersion();

    resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'growi',
      [ATTR_SERVICE_VERSION]: version,
    });

    configuration = {
      resource,
      traceExporter: new OTLPTraceExporter(),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 300000, // 5 minute
      }),
      instrumentations: buildInstrumentations(opts),
    };
  }

  return configuration;
};

/**
 * Generate additional attributes after database initialization
 * This function should be called after database is available
 */
export const generateAdditionalResourceAttributes = async (
  _opts?: Option,
): Promise<Resource> => {
  if (resource == null) {
    throw new Error(
      'Resource is not initialized. Call generateNodeSDKConfiguration first.',
    );
  }

  const serviceInstanceId =
    configManager.getConfig('otel:serviceInstanceId') ??
    configManager.getConfig('app:serviceInstanceId');

  const { getApplicationResourceAttributes, getOsResourceAttributes } =
    await import('./custom-resource-attributes');

  return resource.merge(
    resourceFromAttributes({
      [ATTR_SERVICE_INSTANCE_ID]: serviceInstanceId,
      ...(await getApplicationResourceAttributes()),
      ...(await getOsResourceAttributes()),
    }),
  );
};
