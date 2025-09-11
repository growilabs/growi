import SwaggerParser from '@apidevtools/swagger-parser';
import type {
  OpenAPI3,
  OperationObject,
  PathItemObject,
} from 'openapi-typescript';

const toPascal = (s: string): string =>
  s
    .split('-')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join('');

const createParamSuffix = (params: string[]): string => {
  return params.length > 0
    ? params
        .reverse()
        .map((param) => `By${toPascal(param.slice(1, -1))}`)
        .join('')
    : '';
};

/**
 * Generates a PascalCase operation name based on the HTTP method and path.
 *
 * e.g.
 * - `GET /foo` -> `getFoo`
 * - `POST /bar` -> `postBar`
 * - `Get /foo/bar` -> `getBarForFoo`
 * - `GET /foo/{id}` -> `getFooById`
 * - `GET /foo/{id}/bar` -> `getBarByIdForFoo`
 * - `GET /foo/{id}/{page}/bar` -> `getBarByPageByIdForFoo`
 *
 */
function createOperationId(method: string, path: string): string {
  const segments = path.split('/').filter(Boolean);
  const params = segments.filter((s) => s.startsWith('{'));
  const paths = segments.filter((s) => !s.startsWith('{'));

  const paramSuffix = createParamSuffix(params);

  if (paths.length <= 1) {
    return `${method.toLowerCase()}${toPascal(paths[0] || 'root')}${paramSuffix}`;
  }

  const [resource, ...context] = paths.reverse();
  return `${method.toLowerCase()}${toPascal(resource)}${paramSuffix}For${context.reverse().map(toPascal).join('')}`;
}

export async function generateOperationIds(
  inputFile: string,
  opts?: { overwriteExisting: boolean },
): Promise<string> {
  const api = (await SwaggerParser.parse(inputFile)) as OpenAPI3;

  Object.entries(api.paths || {}).forEach(([path, pathItem]) => {
    const item = pathItem as PathItemObject;
    (
      [
        'get',
        'post',
        'put',
        'delete',
        'patch',
        'options',
        'head',
        'trace',
      ] as const
    ).forEach((method) => {
      const operation = item[method] as OperationObject | undefined;
      if (
        operation == null ||
        (operation.operationId != null && !opts?.overwriteExisting)
      ) {
        return;
      }
      operation.operationId = createOperationId(method, path);
    });
  });

  const output = JSON.stringify(api, null, 2);

  if (output == null) {
    throw new Error(`Failed to generate operation IDs for ${inputFile}`);
  }

  return output;
}
