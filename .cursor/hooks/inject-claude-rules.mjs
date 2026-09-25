#!/usr/bin/env node
/**
 * Cursor sessionStart hook: inject canonical Claude Code rules into agent context.
 *
 * Why: Cursor Project Rules' `@filename` include does not expand file contents yet.
 * Regenerating `.mdc` copies would be dual management. Instead, read `.claude/rules/`
 * (and apps/app scoped rules) at session start and return them as additional_context.
 *
 * Source of truth remains `.claude/` — edit those files only.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const ALWAYS_DIR = path.join(ROOT, '.claude', 'rules');
const APPS_APP_DIR = path.join(ROOT, 'apps', 'app', '.claude', 'rules');

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listMarkdownFiles(dir) {
  try {
    const names = await fs.readdir(dir);
    return names
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map((name) => path.join(dir, name));
  }
  catch (err) {
    if (err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * @param {string} filePath
 * @param {string} label
 */
async function formatRule(filePath, label) {
  const body = await fs.readFile(filePath, 'utf8');
  const rel = path.relative(ROOT, filePath).split(path.sep).join('/');
  return [
    `### ${label}: \`${rel}\``,
    '',
    body.replace(/\s+$/, ''),
    '',
  ].join('\n');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  // Drain sessionStart payload (unused; reserved for future filtering).
  await readStdin();

  const alwaysFiles = await listMarkdownFiles(ALWAYS_DIR);
  const appsAppFiles = await listMarkdownFiles(APPS_APP_DIR);

  /** @type {string[]} */
  const sections = [
    '# Claude Code rules (injected for Cursor Agent)',
    '',
    'Canonical source: `.claude/rules/` and `apps/app/.claude/rules/`.',
    'Do not edit copies under `.cursor/`; edit the `.claude/` files only.',
    '',
    '## Monorepo rules (always apply)',
    '',
  ];

  const alwaysParts = await Promise.all(
    alwaysFiles.map((filePath) => formatRule(filePath, 'Rule')),
  );
  sections.push(...alwaysParts);

  if (appsAppFiles.length > 0) {
    sections.push(
      '## Package-scoped rules (`apps/app`)',
      '',
      'Apply these when working under `apps/app/` (or on files that affect that package).',
      '',
    );
    const appParts = await Promise.all(
      appsAppFiles.map((filePath) => formatRule(filePath, 'apps/app rule')),
    );
    sections.push(...appParts);
  }

  const additional_context = `${sections.join('\n').replace(/\s+$/, '')}\n`;

  process.stdout.write(`${JSON.stringify({ additional_context })}\n`);
}

main().catch((err) => {
  // Fail open so a hook failure does not break session creation.
  process.stderr.write(`[inject-claude-rules] ${err.stack || err}\n`);
  process.stdout.write('{}\n');
  process.exit(0);
});
