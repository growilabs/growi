export type PathRuleId =
  | 'next-data'
  | 'static-files'
  | 'secret-path-segments'
  | 'api-path-segments'
  | 'kept-pages'
  | 'page-markdown'
  | 'trash-page'
  | 'page-view';

export type RedactPattern = {
  readonly pattern: string; // e.g. '/share/:linkId'
  readonly params: readonly string[]; // e.g. ['linkId']
};

export type PathAction =
  | { readonly kind: 'keep' }
  | { readonly kind: 'unwrap-next-data' }
  | {
      readonly kind: 'redact-pattern-params';
      readonly patterns: readonly RedactPattern[];
    }
  | { readonly kind: 'hash-page-path' }
  | { readonly kind: 'hash-page-path-with-suffix'; readonly suffix: string }
  | { readonly kind: 'hash-page-path-under-prefix'; readonly prefix: string };

export type RequestPath = {
  readonly raw: string; // as received (percent-encoded)
  readonly decoded: string; // decodePathname(raw)
};

export type PathRule = {
  readonly id: PathRuleId;
  readonly matches: (path: RequestPath) => boolean;
  readonly action: PathAction;
};

export type AnonymizationRules = {
  readonly pathRules: readonly PathRule[];
  readonly sensitiveQueryParams: readonly string[];
};
