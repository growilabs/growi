import type { IUserHasId } from '@growi/core/dist/interfaces';

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

export type SearchResultItem = {
  _score: number;
  _source: {
    path: string;
  };
  _highlight?: Record<string, string[]>;
};

export type SearchService = {
  searchKeyword(
    keyword: string,
    nqName: string | null,
    user: IUserHasId,
    userGroups: unknown,
    opts: Record<string, unknown>,
  ): Promise<[{ data: SearchResultItem[] }, unknown]>;
};
