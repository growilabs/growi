// The production HTTP layer and runner, built (dist/, which the vitest
// globalSetup rebuilds), in a process of their own, so a test can read this
// process's peak RSS without the test runner's memory in it (research.md
// 16.9 (d), 20.12). Real children convert; no TypeScript loader is loaded.
//
// usage: node memory-server.mjs '<settings env as JSON>'
// prints: {"port":<n>,"pid":<n>} once listening
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../dist',
);
const load = (relative) =>
  import(pathToFileURL(path.join(DIST, relative)).href);

const [{ loadSettings }, runner, http] = await Promise.all([
  load('config/load-settings.js'),
  load('runner/index.js'),
  load('http/index.js'),
]);

const settings = loadSettings(JSON.parse(process.argv[2] ?? '{}'));
const app = http.createApp({
  settings,
  runner: runner.createConversionRunner(
    runner.runnerOptionsFromSettings(settings),
  ),
  writeLog: () => {},
});
const server = await http.startServer(app, { port: 0, hostname: '127.0.0.1' });
process.stdout.write(
  `${JSON.stringify({ port: server.port, pid: process.pid })}\n`,
);
process.once('SIGTERM', () => {
  server.close().finally(() => process.exit(0));
});
