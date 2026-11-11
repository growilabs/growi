import { createLeveledLog, writeToStderr } from './config/leveled-log';
import { loadSettings } from './config/load-settings';
import { createApp, startServer } from './http';
import { createConversionRunner, runnerOptionsFromSettings } from './runner';

export interface RunningService {
  /** The port listened on; the one the OS picked when 0 was asked for. */
  readonly port: number;
  /** Stops listening, then resolves once every request in flight is answered. */
  stop(): Promise<void>;
}

/**
 * The composition root (design.md judgement 5): settings -> runner -> app ->
 * listener. Reads only `env`; rejects before listening when it is invalid.
 */
export const startService = async (
  env: Readonly<Record<string, string | undefined>>,
  listen: { readonly port: number; readonly hostname: string },
  {
    writeLog = writeToStderr,
  }: { readonly writeLog?: (line: string) => void } = {},
): Promise<RunningService> => {
  const settings = loadSettings(env);
  // The runner's diagnostic lines and the request lines share one sink and level.
  const runner = createConversionRunner(
    runnerOptionsFromSettings(settings),
    createLeveledLog(settings.logLevel, writeLog),
  );
  const app = createApp({ settings, runner, writeLog });
  const server = await startServer(app, {
    ...listen,
    uploadTimeoutS: settings.uploadTimeoutS,
  });
  return { port: server.port, stop: () => server.drain() };
};
