import type { Resource } from '@opentelemetry/resources';
import type { NodeSDK } from '@opentelemetry/sdk-node';

/**
 * Get resource from SDK instance
 * Note: This uses internal API of NodeSDK
 */
export const getResource = (sdk: NodeSDK): Resource => {
  // This cast is necessary as _resource is a private property
  const resource = (sdk as any)._resource;
  if (!resource || typeof resource !== 'object' || !resource.attributes) {
    throw new Error('Failed to access SDK resource');
  }
  return resource;
};

/**
 * Set resource to SDK instance
 * Note: This uses internal API of NodeSDK
 * @throws Error if resource cannot be set
 */
export const setResource = (sdk: NodeSDK, resource: Resource): void => {
  // Verify that we can access the _resource property
  try {
    getResource(sdk);
  } catch (e) {
    throw new Error('Failed to access SDK resource');
  }

  // This cast is necessary as _resource is a private property
  (sdk as any)._resource = resource;
};
