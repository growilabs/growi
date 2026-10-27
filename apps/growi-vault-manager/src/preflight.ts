import mongoose from 'mongoose';

// ---------------------------------------------------------------------------
// Required environment variable names
// ---------------------------------------------------------------------------

const REQUIRED_ENV_VARS = [
  'VAULT_MANAGER_INTERNAL_SECRET',
  'MONGO_URI',
  'VAULT_REPO_PATH',
] as const;

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Validates that all required environment variables are present and non-empty.
 * Throws an error listing all missing variable names when any are absent.
 *
 * @param env - Environment variable map; defaults to process.env
 */
export function checkRequiredEnvVars(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const missing = REQUIRED_ENV_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
}

/**
 * Verifies MongoDB connectivity by issuing a ping command.
 * Throws if the connection cannot be established within timeoutMs milliseconds.
 *
 * The connection is NOT closed after the check — it is handed off to the
 * Ts.ED bootstrap process.
 *
 * @param uri - MongoDB connection URI
 * @param timeoutMs - Maximum wait time in milliseconds (default: 5000)
 */
export async function checkMongoConnection(
  uri: string,
  timeoutMs = 5000,
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      let host: string;
      try {
        host = new URL(uri).host;
      } catch {
        host = uri;
      }
      reject(
        new Error(
          `MongoDB connection timed out after ${timeoutMs}ms (host: ${host})`,
        ),
      );
    }, timeoutMs);
  });

  try {
    await Promise.race([
      mongoose
        .connect(uri)
        .then(() => mongoose.connection.db?.command({ ping: 1 })),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}
