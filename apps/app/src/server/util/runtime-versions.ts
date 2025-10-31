import checkNodeVersion from 'check-node-version';

type RuntimeVersions = {
  node: string | undefined;
  npm: string | undefined;
  pnpm: string | undefined;
};

// define original types because the object returned is not according to the official type definition
type SatisfiedVersionInfo = {
  isSatisfied: true;
  version: {
    version: string;
  };
};

type NotfoundVersionInfo = {
  isSatisfied: true;
  notfound: true;
};

type VersionInfo = SatisfiedVersionInfo | NotfoundVersionInfo;

function isNotfoundVersionInfo(info: VersionInfo): info is NotfoundVersionInfo {
  return 'notfound' in info;
}

function isSatisfiedVersionInfo(
  info: VersionInfo,
): info is SatisfiedVersionInfo {
  return 'version' in info;
}

const getVersion = (versionInfo: VersionInfo): string | undefined => {
  if (isNotfoundVersionInfo(versionInfo)) {
    return undefined;
  }

  if (isSatisfiedVersionInfo(versionInfo)) {
    return versionInfo.version.version;
  }

  return undefined;
};

export function getRuntimeVersions(): Promise<RuntimeVersions> {
  return new Promise((resolve, reject) => {
    checkNodeVersion({}, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        node: getVersion(result.versions.node as unknown as VersionInfo),
        npm: getVersion(result.versions.npm as unknown as VersionInfo),
        pnpm: getVersion(result.versions.pnpm as unknown as VersionInfo),
      });
    });
  });
}
