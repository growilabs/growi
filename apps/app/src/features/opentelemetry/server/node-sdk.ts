import { ConfigSource } from '@growi/core/dist/interfaces';
import type { NodeSDK } from '@opentelemetry/sdk-node';

import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import { setupCustomMetrics } from './custom-metrics';
import { setResource } from './node-sdk-resource';

const logger = loggerFactory('growi:opentelemetry:server');

let sdkInstance: NodeSDK | undefined;

/**
 * Overwrite "OTEL_SDK_DISABLED" env var before sdk.start() is invoked if needed.
 * Since otel library sees it.
 */
function overwriteSdkDisabled(): void {
  const instrumentationEnabled = configManager.getConfig(
    'otel:enabled',
    ConfigSource.env,
  );

  if (
    instrumentationEnabled &&
    (process.env.OTEL_SDK_DISABLED === 'true' ||
      process.env.OTEL_SDK_DISABLED === '1')
  ) {
    logger.warn(
      "OTEL_SDK_DISABLED overwritten with 'false' since GROWI's 'otel:enabled' config is true.",
    );
    process.env.OTEL_SDK_DISABLED = 'false';
    return;
  }

  if (
    !instrumentationEnabled &&
    (process.env.OTEL_SDK_DISABLED === 'false' ||
      process.env.OTEL_SDK_DISABLED === '0')
  ) {
    logger.warn(
      "OTEL_SDK_DISABLED is overwritten with 'true' since GROWI's 'otel:enabled' config is false.",
    );
    process.env.OTEL_SDK_DISABLED = 'true';
    return;
  }
}

export const initInstrumentation = async (): Promise<void> => {
  if (sdkInstance != null) {
    logger.warn('OpenTelemetry instrumentation already started');
    return;
  }

  // load configs from env
  await configManager.loadConfigs({ source: ConfigSource.env });

  overwriteSdkDisabled();

  const instrumentationEnabled = configManager.getConfig(
    'otel:enabled',
    ConfigSource.env,
  );
  if (instrumentationEnabled) {
    logger.info(`GROWI now collects anonymous telemetry.

This data is used to help improve GROWI, but you can opt-out at any time.

For more information, see https://docs.growi.org/en/admin-guide/admin-cookbook/telemetry.html.
`);

    // initialize global logger for development
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      const { initLogger } = await import('./logger');
      initLogger();
    }

    // instanciate NodeSDK
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { generateNodeSDKConfiguration } = await import(
      './node-sdk-configuration'
    );
    // get resource from configuration
    const enableAnonymization = configManager.getConfig(
      'otel:anonymizeInBestEffort',
      ConfigSource.env,
    );

    const sdkConfig = generateNodeSDKConfiguration({ enableAnonymization });

    sdkInstance = new NodeSDK(sdkConfig);
  }
};

export const setupAdditionalResourceAttributes = async (): Promise<void> => {
  const instrumentationEnabled = configManager.getConfig(
    'otel:enabled',
    ConfigSource.env,
  );

  if (instrumentationEnabled) {
    if (sdkInstance == null) {
      throw new Error('OpenTelemetry instrumentation is not initialized');
    }

    const { generateAdditionalResourceAttributes } = await import(
      './node-sdk-configuration'
    );
    // get resource from configuration
    const enableAnonymization = configManager.getConfig(
      'otel:anonymizeInBestEffort',
      ConfigSource.env,
    );

    // generate additional resource attributes
    const updatedResource = await generateAdditionalResourceAttributes({
      enableAnonymization,
    });

    // set resource to sdk instance
    setResource(sdkInstance, updatedResource);
  }
};

export const startOpenTelemetry = (): void => {
  const instrumentationEnabled = configManager.getConfig(
    'otel:enabled',
    ConfigSource.env,
  );

  if (instrumentationEnabled && sdkInstance != null) {
    if (sdkInstance == null) {
      throw new Error('OpenTelemetry instrumentation is not initialized');
    }
    sdkInstance.start();

    // setup custom metrics after SDK start
    setupCustomMetrics();
  }
};

// For testing purposes only
export const __testing__ = {
  getSdkInstance: (): NodeSDK | undefined => sdkInstance,
  reset: (): void => {
    sdkInstance = undefined;
  },
};
