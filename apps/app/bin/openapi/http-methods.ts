/**
 * The operation keys of an OpenAPI Path Item Object.
 *
 * A path item also carries non-operation keys (`parameters`, `summary`,
 * `$ref`, ...), so anything walking a spec's operations has to filter by this
 * list. Declared once here so the generator and the artifact assertion cannot
 * drift apart on which keys count as an operation.
 */
export const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'options',
  'head',
  'trace',
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export const isHttpMethod = (key: string): key is HttpMethod =>
  (HTTP_METHODS as readonly string[]).includes(key);
