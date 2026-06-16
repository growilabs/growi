import type { HttpInstrumentationConfig } from '@opentelemetry/instrumentation-http';

import { anonymizationModules } from '~/features/opentelemetry/server/anonymization/handlers';

export const httpInstrumentationConfig: HttpInstrumentationConfig = {
  startIncomingSpanHook: (request) => {
    // Get URL from IncomingMessage (server-side requests)
    const incomingRequest = request;
    const url = incomingRequest.url || '';

    const attributes = {};

    // Use efficient module-based approach
    for (const anonymizationModule of anonymizationModules) {
      if (anonymizationModule.canHandle(url)) {
        const moduleAttributes = anonymizationModule.handle(
          incomingRequest,
          url,
        );
        if (moduleAttributes != null) {
          Object.assign(attributes, moduleAttributes);
        }
      }
    }

    return attributes;
  },
};
