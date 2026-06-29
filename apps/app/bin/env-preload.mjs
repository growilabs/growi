/**
 * ESM preload hook: load dotenv-flow before the application starts.
 * Use via: node --import ./bin/load-dotenv.mjs <entry>
 *
 * This avoids depending on dotenv-flow's sub-path export (./config.js),
 * which differs across versions and is not guaranteed by its exports map.
 */
import dotenvFlow from 'dotenv-flow';

dotenvFlow.config();
