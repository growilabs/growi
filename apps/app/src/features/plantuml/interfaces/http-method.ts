export type PlantumlHttpMethod = 'get' | 'post';

const PUBLIC_PLANTUML_HOST = 'plantuml.com';

// `configured` is the PLANTUML_HTTP_METHOD value; only `get` is honored, anything else falls back to auto-selection.
export function resolvePlantumlHttpMethod(
  plantumlUri: string,
  configured: string | undefined,
): PlantumlHttpMethod {
  if (configured?.toLowerCase() === 'get') {
    return 'get';
  }

  let hostname: string;
  try {
    hostname = new URL(plantumlUri).hostname.toLowerCase();
  } catch {
    return 'get';
  }

  if (
    hostname === PUBLIC_PLANTUML_HOST ||
    hostname.endsWith(`.${PUBLIC_PLANTUML_HOST}`)
  ) {
    return 'get';
  }
  return 'post';
}
