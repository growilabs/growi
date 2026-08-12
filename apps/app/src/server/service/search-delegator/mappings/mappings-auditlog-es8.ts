import type { estypes } from '@elastic/elasticsearch8';

import { auditlogProperties } from './mappings-auditlog-properties';

type Mappings = {
  mappings: estypes.IndicesCreateRequest['mappings'];
};

export const mappings: Mappings = {
  mappings: {
    properties: auditlogProperties,
  },
};
