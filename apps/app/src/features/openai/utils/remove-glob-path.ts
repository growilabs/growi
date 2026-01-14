export const removeGlobPath = (pagePathPattens?: string[]): string[] => {
  if (pagePathPattens == null) {
    return [];
  }
  return pagePathPattens.map((pagePathPattern) => {
    return pagePathPattern.endsWith('/*')
      ? pagePathPattern.slice(0, -2)
      : pagePathPattern;
  });
};
