export const extractBearerToken = (
  authHeader: string | undefined,
): string | null => {
  if (authHeader == null) {
    return null;
  }

  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.substring(7); // Remove 'Bearer ' prefix
};
