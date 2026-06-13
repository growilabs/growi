import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
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

import { httpInstrumentationConfig as httpInstrumentationConfigForAnonymize } from '~/features/opentelemetry/server/anonymization/index.js';
import { ATTR_SERVICE_INSTANCE_ID } from '~/features/opentelemetry/server/semconv.js';
import { configManager } from '~/server/service/config-manager/index.js';
import { getGrowiVersion } from '~/utils/growi-version.js';

type Option = {
  enableAnonymization?: boolean;
};

type Configuration = Partial<NodeSDKConfiguration> & {
  resource: Resource;
};

let resource: Resource;
let configuration: Configuration;

export const generateNodeSDKConfiguration = (opts?: Option): Configuration => {
  if (configuration == null) {
    const version = getGrowiVersion();

    resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'growi',
      [ATTR_SERVICE_VERSION]: version,
    });

    const httpConfig = opts?.enableAnonymization
      ? { ...httpInstrumentationConfigForAnonymize }
      : undefined;

    configuration = {
      resource,
      traceExporter: new OTLPTraceExporter(),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 300000, // 5 minute
      }),
      instrumentations: [
        new HttpInstrumentation(httpConfig),
        new ExpressInstrumentation(),
        new MongoDBInstrumentation(),
        new MongooseInstrumentation(),
      ],
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
    await import(
      '~/features/opentelemetry/server/custom-resource-attributes/index.js'
    );

  return resource.merge(
    resourceFromAttributes({
      [ATTR_SERVICE_INSTANCE_ID]: serviceInstanceId,
      ...(await getApplicationResourceAttributes()),
      ...(await getOsResourceAttributes()),
    }),
  );
};
