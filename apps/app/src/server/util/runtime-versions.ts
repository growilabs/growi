import { execSync } from 'node:child_process';

type RuntimeVersions = {
  node: string | undefined;
  npm: string | undefined;
  pnpm: string | undefined;
};

function getCommandVersion(command: string): string | undefined {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

export function getRuntimeVersions(): RuntimeVersions {
  return {
    node: process.versions.node,
    npm: getCommandVersion('npm --version'),
    pnpm: getCommandVersion('pnpm --version'),
  };
}
