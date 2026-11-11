// The image check's client. It runs INSIDE the container, which has no
// network and no copy of this file, so the CI job hands the source to node:
//
//   docker exec -i <container> node --input-type=module -e "$(cat service-client.mjs)" -- <command> [options]
//
// Node built-ins only; the token comes from the container's own environment.
//
//   readyz                                    exit 0 when GET /readyz is 200
//   extract --filename F --mime M --expect T  the file on stdin; exit 0 when
//                                             POST /extract is 200 and the text holds T
//   openapi                                   prints GET /openapi.json
//   prlimit                                   exit 0 when a process started under
//                                             prlimit, as the runner starts a child,
//                                             has the limits asked for
//
// Options for all: --base-url (default http://127.0.0.1:8000).
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const TOKEN_NAME = 'ATTACHMENT_EXTRACTOR_SERVICE_TOKEN';
// What the runner asks prlimit for with today's default settings (320 + 2,304
// MiB of address space, 55 + 5 s of CPU time, hard +5). Only sample values to
// prove prlimit works here: src/runner/linux/prlimit-args.ts decides the real
// ones, and these need not follow it.
const LIMITS = { as: (320 + 2304) * 1024 * 1024, cpu: [60, 65], core: 1 };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'base-url': { type: 'string', default: 'http://127.0.0.1:8000' },
    filename: { type: 'string' },
    mime: { type: 'string' },
    expect: { type: 'string' },
    'prlimit-path': { type: 'string', default: '/usr/bin/prlimit' },
  },
});
const baseUrl = values['base-url'];

class CheckFailed extends Error {}

const stdinBytes = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const required = (name) => {
  const value = values[name];
  if (value === undefined || value === '')
    throw new CheckFailed(`--${name} is required`);
  return value;
};

const readyz = async () => {
  const response = await fetch(`${baseUrl}/readyz`);
  const text = await response.text();
  if (response.status !== 200)
    throw new CheckFailed(`GET /readyz answered ${response.status}: ${text}`);
  process.stdout.write(`${text}\n`);
};

const extract = async () => {
  const fileName = required('filename');
  const expected = required('expect');
  const form = new FormData();
  form.append(
    'file',
    new Blob([await stdinBytes()], { type: required('mime') }),
    fileName,
  );
  const response = await fetch(`${baseUrl}/extract`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env[TOKEN_NAME] ?? ''}` },
    body: form,
  });
  const text = await response.text();
  if (response.status !== 200)
    throw new CheckFailed(
      `POST /extract (${fileName}) answered ${response.status}: ${text.slice(0, 500)}`,
    );
  const { pages, mimeType, extractedCharacters } = JSON.parse(text);
  const content = pages.map((page) => page.content).join('\n');
  if (!content.includes(expected))
    throw new CheckFailed(
      `POST /extract (${fileName}) answered 200, but the text lacks ${JSON.stringify(expected)}: ${JSON.stringify(content.slice(0, 200))}`,
    );
  process.stdout.write(
    `${fileName}: 200, ${mimeType}, ${pages.length} page(s), ${extractedCharacters} character(s)\n`,
  );
};

const openapi = async () => {
  const response = await fetch(`${baseUrl}/openapi.json`);
  const text = await response.text();
  if (response.status !== 200)
    throw new CheckFailed(`GET /openapi.json answered ${response.status}`);
  process.stdout.write(text);
};

const limitRow = (limitsText, rowName) =>
  limitsText
    .split('\n')
    .find((line) => line.startsWith(rowName))
    ?.slice(rowName.length)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(':');

const prlimit = () => {
  const started = spawnSync(
    values['prlimit-path'],
    [
      `--as=${LIMITS.as}`,
      `--cpu=${LIMITS.cpu.join(':')}`,
      `--core=${LIMITS.core}`,
      '--',
      process.execPath,
      '-e',
      'process.stdout.write(require("node:fs").readFileSync("/proc/self/limits", "utf8"))',
    ],
    { encoding: 'utf8' },
  );
  if (started.error != null || started.status !== 0)
    throw new CheckFailed(
      `prlimit did not run: ${started.error?.message ?? `exit ${started.status}: ${started.stderr}`}`,
    );
  const expected = {
    'Max address space': `${LIMITS.as}:${LIMITS.as}`,
    'Max cpu time': LIMITS.cpu.join(':'),
    'Max core file size': `${LIMITS.core}:${LIMITS.core}`,
  };
  for (const [rowName, limits] of Object.entries(expected)) {
    const actual = limitRow(started.stdout, rowName);
    if (actual !== limits)
      throw new CheckFailed(
        `under prlimit, "${rowName}" is ${actual} (soft:hard), not ${limits}`,
      );
    process.stdout.write(`${rowName}: ${actual}\n`);
  }
};

const COMMANDS = { readyz, extract, openapi, prlimit };

try {
  const command = COMMANDS[positionals[0] ?? ''];
  if (command === undefined)
    throw new CheckFailed(
      `unknown command ${JSON.stringify(positionals[0])}: one of ${Object.keys(COMMANDS).join(', ')}`,
    );
  await command();
} catch (error) {
  // Only the message: a stack trace would bury it in the job log.
  const cause = error instanceof Error ? error.cause : undefined;
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}${cause instanceof Error ? ` (${cause.message})` : ''}\n`,
  );
  process.exitCode = 1;
}
