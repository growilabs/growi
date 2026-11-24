import { SpanKind } from '@opentelemetry/api';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import type { Span, SpanProcessor } from '@opentelemetry/sdk-trace-node';

import { ATTR_HTTP_TARGET } from '../semconv';
import { anonymizeUrl } from './anonymize-url';
import { ANONYMIZATION_RULES } from './rules';

// Its spans start with the target startIncomingSpanHook already anonymized;
// anonymizing that again would hash a hashed path (see design.md ServerSpanAnonymizer)
const HTTP_INSTRUMENTATION_SCOPE = new HttpInstrumentation({ enabled: false })
  .instrumentationName;

const anonymizeTarget = (span: Span): void => {
  if (
    span.kind !== SpanKind.SERVER ||
    span.instrumentationScope.name === HTTP_INSTRUMENTATION_SCOPE
  ) {
    return;
  }
  const target = span.attributes[ATTR_HTTP_TARGET];
  if (typeof target !== 'string') {
    return;
  }
  const anonymized = anonymizeUrl(target, ANONYMIZATION_RULES);
  if (anonymized != null) {
    span.setAttribute(ATTR_HTTP_TARGET, anonymized);
  }
};

export const serverSpanAnonymizer: SpanProcessor = {
  onStart: anonymizeTarget,
  onEnd: () => {},
  forceFlush: async () => {},
  shutdown: async () => {},
};
