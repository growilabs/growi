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
};

export type SuggestPathResponse = {
  suggestions: PathSuggestion[];
};
