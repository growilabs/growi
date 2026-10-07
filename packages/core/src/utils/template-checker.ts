/**
 * templateChecker
 */

export function checkTemplatePath(path: string): boolean {
  if (path.match(/^.*\/_{1,2}template$/)) {
    return true;
  }

  return false;
}
