import type { estypes } from '@elastic/elasticsearch9';

type Mappings = {
  settings: estypes.IndicesCreateRequest['settings'];
  mappings: estypes.IndicesCreateRequest['mappings'];
};

export const mappings: Mappings = {
  settings: {
    analysis: {
      filter: {
        english_stop: {
          type: 'stop',
          stopwords: '_english_',
        },
      },
      tokenizer: {
        edge_ngram_tokenizer: {
          type: 'edge_ngram',
          min_gram: 2,
          max_gram: 20,
          token_chars: ['letter', 'digit'],
        },
      },
      analyzer: {
        japanese: {
          type: 'custom',
          tokenizer: 'kuromoji_tokenizer',
          char_filter: ['icu_normalizer'],
        },
        english_edge_ngram: {
          type: 'custom',
          tokenizer: 'edge_ngram_tokenizer',
          filter: ['lowercase', 'english_stop'],
        },
      },
    },
  },
  mappings: {
    properties: {
      path: {
        type: 'text',
        fields: {
          raw: {
            type: 'text',
            analyzer: 'keyword',
          },
          ja: {
            type: 'text',
            analyzer: 'japanese',
          },
          en: {
            type: 'text',
            analyzer: 'english_edge_ngram',
            search_analyzer: 'standard',
          },
        },
      },
      body: {
        type: 'text',
        fields: {
          ja: {
            type: 'text',
            analyzer: 'japanese',
          },
          en: {
            type: 'text',
            analyzer: 'english_edge_ngram',
            search_analyzer: 'standard',
          },
        },
      },
      body_embedded: {
        type: 'dense_vector',
        dims: 768,
      },
      comments: {
        type: 'text',
        fields: {
          ja: {
            type: 'text',
            analyzer: 'japanese',
          },
          en: {
            type: 'text',
            analyzer: 'english_edge_ngram',
            search_analyzer: 'standard',
          },
        },
      },
      username: {
        type: 'keyword',
      },
      comment_count: {
        type: 'integer',
      },
      bookmark_count: {
        type: 'integer',
      },
      like_count: {
        type: 'integer',
      },
      grant: {
        type: 'integer',
      },
      granted_users: {
        type: 'keyword',
      },
      granted_groups: {
        type: 'keyword',
      },
      created_at: {
        type: 'date',
        format: 'date_optional_time',
      },
      updated_at: {
        type: 'date',
        format: 'date_optional_time',
      },
      tag_names: {
        type: 'keyword',
      },
    },
  },
};
