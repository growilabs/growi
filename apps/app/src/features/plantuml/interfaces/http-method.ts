export type PlantumlHttpMethod = 'get' | 'post';

const PUBLIC_PLANTUML_HOST = 'plantuml.com';

// `configured` is the raw PLANTUML_HTTP_METHOD value. The environment is not validated, so it
// is a plain string here; anything other than get/post (case-insensitive) is ignored.
export function resolvePlantumlHttpMethod(
  plantumlUri: string,
  configured: string | undefined,
): PlantumlHttpMethod {
  const explicit = configured?.toLowerCase();
  if (explicit === 'get') {
    return 'get';
  }

  let hostname: string;
  try {
    hostname = new URL(plantumlUri).hostname.toLowerCase();
  } catch {
    return 'get';
  }

  if (explicit === 'post') {
    return 'post';
  }

  if (
    hostname === PUBLIC_PLANTUML_HOST ||
    hostname.endsWith(`.${PUBLIC_PLANTUML_HOST}`)
  ) {
    return 'get';
  }
  return 'post';
}

// Used only to choose the error message after a GET failure; never blocks a request.
// Measured in research.md ("GET の URL 長の目安値").
export const PLANTUML_GET_URL_LIKELY_TOO_LONG = 6800;
