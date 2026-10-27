import { readFileSync } from 'node:fs';
import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';

const APP_ROOT = path.resolve(import.meta.dirname, '../../../../..');
const ROUTES_GLOB = 'src/features/change-proposal/server/routes/*.ts';

type PathItem = Record<
  string,
  { tags?: string[]; operationId?: string; responses?: object }
>;

const EXPECTED_OPERATIONS: [string, string][] = [
  ['/change-proposals/{id}', 'get'],
  ['/change-proposals/mine', 'get'],
  ['/change-proposals/applied', 'get'],
  ['/change-proposals/revision-marks', 'post'],
  ['/change-proposals/{id}/approve', 'post'],
  ['/change-proposals/{id}/skip', 'post'],
  ['/change-proposals/{id}/discard', 'post'],
  ['/change-proposals/{id}/revert', 'post'],
  ['/change-proposals/{id}/per-page-notifications', 'put'],
];

describe('change-proposal OpenAPI documentation', () => {
  it('documents all nine routes under the ChangeProposals tag', () => {
    // WHY: swagger-jsdoc types its result as a bare object.
    const spec = swaggerJsdoc({
      definition: {
        openapi: '3.0.1',
        info: { title: 'test', version: '0.0.0' },
      },
      apis: [path.join(APP_ROOT, ROUTES_GLOB)],
      failOnErrors: true,
    }) as { paths?: Record<string, PathItem> };

    const documented = Object.entries(spec.paths ?? {}).flatMap(
      ([route, item]) => Object.keys(item).map((method) => [route, method]),
    );
    expect(documented).toEqual(expect.arrayContaining(EXPECTED_OPERATIONS));
    expect(documented).toHaveLength(EXPECTED_OPERATIONS.length);
    for (const [route, method] of EXPECTED_OPERATIONS) {
      const operation = spec.paths?.[route]?.[method];
      expect(operation?.tags).toEqual(['ChangeProposals']);
      expect(operation?.responses).toBeDefined();
    }
  });

  it('is scanned by the apiv3 spec generation script and grouped in the docs', () => {
    const script = readFileSync(
      path.join(APP_ROOT, 'bin/openapi/generate-spec-apiv3.sh'),
      'utf8',
    );
    const definition = readFileSync(
      path.join(APP_ROOT, 'bin/openapi/definition-apiv3.cjs'),
      'utf8',
    );

    expect(script).toContain(`"\${APP_PATH}/${ROUTES_GLOB}"`);
    expect(definition).toContain("'ChangeProposals'");
  });
});
