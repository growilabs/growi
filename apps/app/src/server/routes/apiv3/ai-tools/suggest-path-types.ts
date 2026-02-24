export const SuggestionType = {
  MEMO: 'memo',
  SEARCH: 'search',
  CATEGORY: 'category',
} as const;

export type SuggestionType =
  (typeof SuggestionType)[keyof typeof SuggestionType];

export type PathSuggestion = {
  type: SuggestionType;
  path: string;
  label: string;
  description: string;
  grant: number;
  informationType?: InformationType;
};

export type InformationType = 'flow' | 'stock';

export type ContentAnalysis = {
  keywords: string[];
  informationType: InformationType;
};

export type SearchCandidate = {
  pagePath: string;
  snippet: string;
  score: number;
};

export type EvaluatedSuggestion = {
  path: string;
  label: string;
  description: string;
};

export type SuggestPathResponse = {
  suggestions: PathSuggestion[];
};
