import { readFileSync } from 'node:fs';
import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';

const APP_ROOT = path.resolve(import.meta.dirname, '../../../../..');
const ROUTES_GLOB = 'src/features/change-proposal/server/routes/*.ts';
const ADMIN_ROUTES_GLOB =
  'src/features/change-proposal/server/routes/admin/*.ts';

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

const documentedPaths = (glob: string): Record<string, PathItem> => {
  // WHY: swagger-jsdoc types its result as a bare object.
  const spec = swaggerJsdoc({
    definition: {
      openapi: '3.0.1',
      info: { title: 'test', version: '0.0.0' },
    },
    apis: [path.join(APP_ROOT, glob)],
    failOnErrors: true,
  }) as { paths?: Record<string, PathItem> };
  return spec.paths ?? {};
};

describe('change-proposal OpenAPI documentation', () => {
  it('documents the admin settings GET and PUT under the ChangeProposalSettings tag', () => {
    const paths = documentedPaths(ADMIN_ROUTES_GLOB);

    expect(Object.keys(paths)).toEqual(['/change-proposal-settings']);
    const item = paths['/change-proposal-settings'];
    expect(Object.keys(item).sort()).toEqual(['get', 'put']);
    for (const operation of Object.values(item)) {
      expect(operation.tags).toEqual(['ChangeProposalSettings']);
      expect(operation.responses).toBeDefined();
    }
  });

  it('documents all nine routes under the ChangeProposals tag', () => {
    const paths = documentedPaths(ROUTES_GLOB);

    const documented = Object.entries(paths).flatMap(([route, item]) =>
      Object.keys(item).map((method) => [route, method]),
    );
    expect(documented).toEqual(expect.arrayContaining(EXPECTED_OPERATIONS));
    expect(documented).toHaveLength(EXPECTED_OPERATIONS.length);
    for (const [route, method] of EXPECTED_OPERATIONS) {
      const operation = paths[route]?.[method];
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
    expect(script).toContain(`"\${APP_PATH}/${ADMIN_ROUTES_GLOB}"`);
    expect(definition).toContain("'ChangeProposalSettings'");
  });
});
