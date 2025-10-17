export type ViteManifestValue = {
  file: string;
  src: string;
  isEntry?: boolean;
  css?: string[];
};

export type ViteManifest = {
  [key: string]: ViteManifestValue;
};
