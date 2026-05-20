import type { estypes } from '@elastic/elasticsearch7';

type Mappings = {
  mappings: estypes.MappingTypeMapping;
};

export const mappings: Mappings = {
  mappings: {
    properties: {
      username: { type: 'keyword' },
      created_at: { type: 'date' },
    },
  },
};
