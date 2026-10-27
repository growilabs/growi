import type { HttpInstrumentationConfig } from '@opentelemetry/instrumentation-http';

import { ATTR_HTTP_TARGET } from '../semconv';
import { anonymizationModules } from './handlers';
import {
  buildUrlAttributes,
  isStableHttpSemconvEnabled,
} from './utils/build-url-attributes';

export const httpInstrumentationConfig: HttpInstrumentationConfig = {
  startIncomingSpanHook: (request) => {
    // Get URL from IncomingMessage (server-side requests)
    const incomingRequest = request;
    const url = incomingRequest.url || '';

    const attributes: Record<string, string> = {};

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

    const anonymizedTarget = attributes[ATTR_HTTP_TARGET];
    if (anonymizedTarget == null) {
      return attributes;
    }

    // The instrumentation also derives http.url (and url.path / url.query when
    // stable semconv is opted in) from the raw URL; overwrite them as well
    return {
      ...attributes,
      ...buildUrlAttributes(
        incomingRequest,
        anonymizedTarget,
        isStableHttpSemconvEnabled(process.env.OTEL_SEMCONV_STABILITY_OPT_IN),
      ),
    };
  },
};
