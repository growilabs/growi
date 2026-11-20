import type { HttpInstrumentationConfig } from '@opentelemetry/instrumentation-http';

import { ATTR_HTTP_TARGET } from '../semconv';
import { anonymizeUrl } from './anonymize-url';
import { ANONYMIZATION_RULES } from './rules';
import {
  buildUrlAttributes,
  isStableHttpSemconvEnabled,
} from './utils/build-url-attributes';

export const httpInstrumentationConfig: HttpInstrumentationConfig = {
  startIncomingSpanHook: (request) => {
    const target = anonymizeUrl(request.url ?? '', ANONYMIZATION_RULES);
    if (target == null) {
      return {};
    }

    // The instrumentation also derives http.url (and url.path / url.query when
    // stable semconv is opted in) from the raw URL; overwrite them as well
    return {
      [ATTR_HTTP_TARGET]: target,
      ...buildUrlAttributes(
        request,
        target,
        isStableHttpSemconvEnabled(process.env.OTEL_SEMCONV_STABILITY_OPT_IN),
      ),
    };
  },
};
