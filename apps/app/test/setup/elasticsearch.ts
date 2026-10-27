// Vitest injects VITE_- and VITE_-prefixed .env.test vars into process.env for Node environments.
// Map VITE_-prefixed vars to the names that the app's configManager expects.
const VITE_ENV_MAP: Record<string, string> = {
  VITE_ELASTICSEARCH_URI: 'ELASTICSEARCH_URI',
  VITE_ELASTICSEARCH_VERSION: 'ELASTICSEARCH_VERSION',
  VITE_ELASTICSEARCH_REINDEX_ON_BOOT: 'ELASTICSEARCH_REINDEX_ON_BOOT',
};

for (const [vitestKey, appKey] of Object.entries(VITE_ENV_MAP)) {
  const value = process.env[vitestKey];
  if (value != null) {
    process.env[appKey] = value;
  }
}
