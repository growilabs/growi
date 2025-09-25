import type { InstrumentationConfigMap } from '@opentelemetry/auto-instrumentations-node';

import { anonymizationModules } from './handlers';

export const httpInstrumentationConfig: InstrumentationConfigMap['@opentelemetry/instrumentation-http'] =
  {
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
