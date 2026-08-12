import type { estypes } from '@elastic/elasticsearch9';

import { auditlogProperties } from './mappings-auditlog-properties';

type Mappings = {
  mappings: estypes.IndicesCreateRequest['mappings'];
};

export const mappings: Mappings = {
  mappings: {
    properties: auditlogProperties,
  },
};
