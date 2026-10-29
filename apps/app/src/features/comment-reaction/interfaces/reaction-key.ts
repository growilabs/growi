export type SkinTone = 2 | 3 | 4 | 5 | 6;

/** Canonical stored form, e.g. 'unicode:+1' or 'unicode:+1::skin-tone-3'. */
export type ReactionKey = string & { readonly __brand: 'ReactionKey' };

export type ParsedReactionKey = {
  readonly namespace: 'unicode';
  /** Canonical emoji-mart id (aliases resolved). */
  readonly shortcode: string;
  readonly skinTone: SkinTone | null;
};

export type ReactionKeyError =
  | { readonly kind: 'malformed' }
  | { readonly kind: 'unsupported-namespace'; readonly namespace: string }
  | { readonly kind: 'unknown-emoji'; readonly shortcode: string }
  | { readonly kind: 'skin-tone-not-supported'; readonly shortcode: string };

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
