import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { httpInstrumentationConfig } from './anonymize-http-requests';
import { COVERAGE_EXAMPLES } from './rules/coverage-examples';
import { ANONYMIZATION_RULES } from './rules/index';

// Single location of the spec file that holds the target table
const REQUIREMENTS_PATH = resolve(
  import.meta.dirname,
  '../../../../../../../.kiro/specs/opentelemetry-anonymization/requirements.md',
);
const TABLE_SECTION_HEADING = '## 匿名化対象一覧';
const HOST = 'wiki.example.com';

/** Row IDs in the first column of every table inside the target-table section */
const extractTableRowIds = (markdown: string): Set<string> => {
  const lines = markdown.split('\n');
  const start = lines.findIndex(
    (line) => line.trim() === TABLE_SECTION_HEADING,
  );
  if (start < 0) {
    throw new Error(
      `"${TABLE_SECTION_HEADING}" not found in ${REQUIREMENTS_PATH}`,
    );
  }

  const ids = new Set<string>();
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    const match = /^\|\s*`([A-Z]\d+)`\s*\|/.exec(line);
    if (match != null) {
      ids.add(match[1]);
    }
  }
  return ids;
};

const runHook = (url: string): Record<string, unknown> => {
  const hook = httpInstrumentationConfig.startIncomingSpanHook;
  if (hook == null) {
    throw new Error('startIncomingSpanHook is not configured');
  }
  return hook(mock<IncomingMessage>({ url, headers: { host: HOST } }));
};

describe('anonymization coverage', () => {
  describe('every example through the hook', () => {
    it.each(
      COVERAGE_EXAMPLES.map((example) => [
        example.id,
        example.method ?? 'GET',
        example.url,
        example,
      ]),
    )('%s: %s %s', (_id, _method, url, example) => {
      const attributes = runHook(url);

      if (example.expectedTarget == null) {
        expect(attributes).toEqual({});
        return;
      }
      expect(attributes['http.target']).toBe(example.expectedTarget);
      expect(attributes['http.url']).toBe(
        `http://${HOST}${example.expectedTarget}`,
      );
    });
  });

  describe('agreement with the target table in requirements.md', () => {
    const tableIds = extractTableRowIds(
      readFileSync(REQUIREMENTS_PATH, 'utf8'),
    );
    const exampleIds = new Set(COVERAGE_EXAMPLES.map(({ id }) => id));

    it('should find rows in the table', () => {
      expect(tableIds.size).toBeGreaterThan(0);
    });

    it('should have an example for every table row', () => {
      const missing = [...tableIds].filter((id) => !exampleIds.has(id));
      expect(missing).toEqual([]);
    });

    it('should not have an example whose ID is not in the table', () => {
      const extra = [...exampleIds].filter((id) => !tableIds.has(id));
      expect(extra).toEqual([]);
    });
  });

  describe('rule references', () => {
    const referenced = new Set(
      COVERAGE_EXAMPLES.flatMap(({ ruleIds }) => ruleIds),
    );

    it.each(
      ANONYMIZATION_RULES.pathRules.map((rule) => [rule.id]),
    )('path rule %s is referenced by an example', (ruleId) => {
      expect(referenced.has(ruleId)).toBe(true);
    });

    it('sensitive-query-params is referenced by an example', () => {
      expect(referenced.has('sensitive-query-params')).toBe(true);
    });

    it.each(
      ANONYMIZATION_RULES.sensitiveQueryParams.map((name) => [name]),
    )('sensitive query parameter %s is anonymized by an example', (name) => {
      const maskedByExample = COVERAGE_EXAMPLES.some(({ expectedTarget }) =>
        (expectedTarget ?? '')
          .split(/[?&]/)
          .some(
            (pair) =>
              pair.startsWith(`${name}=%5BANONYMIZED%5D`) ||
              pair.startsWith(`${name}[]=%5BANONYMIZED%5D`),
          ),
      );
      expect(maskedByExample).toBe(true);
    });
  });
});
