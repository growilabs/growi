export function handleUserPages(
  query: string,
  userPagesDisabled: boolean,
): string {
  if (!userPagesDisabled) {
    return query;
  }

  const cleanQuery = query.replace(/prefix:\/user/g, '').trim();

  if (!cleanQuery.includes('-prefix:/user')) {
    const queryWithUserPrefix = `${cleanQuery.trim()} -prefix:/user`;

    return queryWithUserPrefix;
  }

  return cleanQuery;
}
