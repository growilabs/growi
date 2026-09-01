import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Drift guard for Rule 2 of the activity-recording convention
 * (`apps/app/.claude/rules/activity-recording.md`): in every apiv3 route,
 * `addActivity` must come BEFORE `apiV3FormValidator`. Otherwise a validation
 * failure — by an authenticated operator, or an anonymous abuse attempt against
 * a public endpoint — happens before the fail-safe finalizer is wired and is
 * silently NOT audited as `ACTION_UNSETTLED`.
 *
 * Rule 1 of that convention (emit the activity before the response is sent, so
 * the settled row keeps its operator) is verified behaviorally by
 * `page/update-page.integ.ts`, `page/create-page.integ.ts`, and
 * `import-executor.integ.ts`; it cannot be checked statically here.
 *
 * Static per-route scan (like `tools/lint/route-top-level-guard.cjs`): within
 * each `router.<method>(...)` array, the first `addActivity,` entry must precede
 * the first `apiV3FormValidator,` entry. Comments are stripped first so lines
 * that merely mention the names (including this rule's own pointer comments)
 * never match.
 */

const APIV3_DIR = dirname(fileURLToPath(import.meta.url));

const isRouteFile = (name: string): boolean =>
  /\.(ts|js)$/.test(name) && !/\.(spec|integ)\.[tj]s$/.test(name);

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRouteFiles(full));
    } else if (isRouteFile(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip `//` line comments and block comments so tokens inside comments never
 * match. Returns the code-only text of each line.
 */
function stripComments(source: string): string[] {
  const lines = source.split('\n');
  let inBlock = false;
  return lines.map((line) => {
    let out = '';
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i);
        if (end === -1) {
          i = line.length;
        } else {
          inBlock = false;
          i = end + 2;
        }
        continue;
      }
      if (line.startsWith('//', i)) break;
      if (line.startsWith('/*', i)) {
        inBlock = true;
        i += 2;
        continue;
      }
      out += line[i];
      i += 1;
    }
    return out;
  });
}

const ROUTE_RE = /\brouter\.(get|post|put|delete|patch)\s*\(/;
const ADD_ACTIVITY_RE = /\baddActivity\b\s*,/;
const FORM_VALIDATOR_RE = /\bapiV3FormValidator\b\s*,/;

type Violation = { file: string; method: string; routeLine: number };

function findViolations(file: string): Violation[] {
  const lines = stripComments(readFileSync(file, 'utf8'));
  const violations: Violation[] = [];
  let routeLine = -1;
  let method = '';
  let addAt = -1;
  let valAt = -1;
  const flush = (): void => {
    if (addAt >= 0 && valAt >= 0 && valAt < addAt) {
      violations.push({
        file: relative(APIV3_DIR, file),
        method,
        routeLine: routeLine + 1,
      });
    }
    addAt = -1;
    valAt = -1;
  };
  for (let i = 0; i < lines.length; i++) {
    const routeMatch = lines[i].match(ROUTE_RE);
    if (routeMatch != null) {
      flush();
      routeLine = i;
      method = routeMatch[1];
    }
    if (addAt < 0 && ADD_ACTIVITY_RE.test(lines[i])) addAt = i;
    if (valAt < 0 && FORM_VALIDATOR_RE.test(lines[i])) valAt = i;
  }
  flush();
  return violations;
}

describe('apiv3 middleware order — addActivity before apiV3FormValidator', () => {
  const routeFiles = collectRouteFiles(APIV3_DIR);

  it('scans a non-empty set of apiv3 route files', () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it('no route runs apiV3FormValidator before addActivity', () => {
    const violations = routeFiles.flatMap(findViolations);
    const report = violations
      .map((v) => `${v.file} [${v.method.toUpperCase()} @L${v.routeLine}]`)
      .join('\n');
    expect(
      violations,
      `apiV3FormValidator must not precede addActivity (see activity-recording rule):\n${report}`,
    ).toEqual([]);
  });
});
