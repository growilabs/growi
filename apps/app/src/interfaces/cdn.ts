export type CdnManifestArgs = {
  integrity?: string;
  async?: boolean;
  defer?: boolean;
};

export type CdnManifest = {
  name: string;
  url: string;
  groups?: string[];
  args?: CdnManifestArgs;
};

export type CdnResource = {
  manifest: CdnManifest;
  outDir: string;
};
