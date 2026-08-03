import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { isHttpMethod } from './http-methods';

type Operation = { operationId?: string };

/**
 * Fails when the spec at `file` is not safe to publish.
 *
 * This runs on the *finished artifact* instead of inside the generation step,
 * so it still fires when a generation step exits successfully without having
 * done its work. That is the failure mode behind #11634: the operationId
 * injection step never ran, the script reported success anyway, and the spec
 * published to docs.growi.org carried 4 operationIds instead of 241. Code
 * generators (orval, in `@growi/sdk-typescript`) fall back to naming functions
 * after the HTTP method and path when an operationId is absent, so the result
 * was a silent, wholesale rename of the generated client rather than an error.
 */
export const assertOperationIds = (file: string): void => {
  const spec = JSON.parse(readFileSync(file, 'utf8'));

  const operations = Object.entries<Record<string, unknown>>(
    spec.paths ?? {},
  ).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(([key]) => isHttpMethod(key))
      .map(([method, operation]) => ({
        label: `${method.toUpperCase()} ${path}`,
        operationId: (operation as Operation).operationId,
      })),
  );

  if (operations.length === 0) {
    throw new Error(
      `${file} declares no operations — the spec is empty or its paths could not be read`,
    );
  }

  const withoutId = operations.filter((op) => op.operationId == null);
  if (withoutId.length > 0) {
    throw new Error(
      `${withoutId.length} of ${operations.length} operations in ${file} have no operationId: ${withoutId
        .map((op) => op.label)
        .join(', ')}`,
    );
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const file = process.argv[2];
    if (file == null) {
      throw new Error('usage: assert-operation-ids <openapi-spec.json>');
    }
    assertOperationIds(file);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: this is a CLI entry point
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
