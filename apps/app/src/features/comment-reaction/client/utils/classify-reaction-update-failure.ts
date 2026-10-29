export type ReactionUpdateFailureKind =
  | 'kind-limit-exceeded'
  | 'comment-unavailable'
  | 'failed';

const KIND_BY_ERROR_CODE: Readonly<Record<string, ReactionUpdateFailureKind>> =
  {
    'reaction-kind-limit-exceeded': 'kind-limit-exceeded',
    notfound_or_forbidden: 'comment-unavailable',
  };

const readErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error == null) {
    return undefined;
  }
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
};

export const classifyReactionUpdateFailure = (
  errors: unknown,
): ReactionUpdateFailureKind => {
  if (!Array.isArray(errors)) {
    return 'failed';
  }
  for (const error of errors) {
    const code = readErrorCode(error);
    if (code != null && Object.hasOwn(KIND_BY_ERROR_CODE, code)) {
      return KIND_BY_ERROR_CODE[code];
    }
  }
  return 'failed';
};
