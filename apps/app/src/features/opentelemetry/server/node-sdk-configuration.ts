import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { MongooseInstrumentation } from '@opentelemetry/instrumentation-mongoose';
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
 * Build the instrumentations array based on OTEL_AUTO_INSTRUMENTATION_PROFILE env var.
 *
 * - "minimal" (default, unset): enable exactly the 4 instrumentations for GROWI
 * - "all": deprecated; emit warning then return the same 4-instrumentation set
 * - unknown value: emit warning then return the same 4-instrumentation set
 */
export const buildInstrumentations = (opts?: Option): Instrumentation[] => {
  const profile = process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE;

  if (profile === 'all') {
    logger.warn(
      'OTEL_AUTO_INSTRUMENTATION_PROFILE=all is deprecated. The minimal 4-instrumentation set is always used.',
    );
  } else if (profile != null && profile !== 'minimal') {
    // Unknown profile value: warn and treat as minimal
    logger.warn(
      { profile },
      'Unknown OTEL_AUTO_INSTRUMENTATION_PROFILE value, treating as minimal',
    );
  }

  // Always return the same 4 instrumentations used by GROWI
  const httpConfig = opts?.enableAnonymization
    ? { ...httpInstrumentationConfigForAnonymize }
    : undefined;

  return [
    new HttpInstrumentation(httpConfig),
    new ExpressInstrumentation(),
    new MongoDBInstrumentation(),
    new MongooseInstrumentation(),
  ];
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
