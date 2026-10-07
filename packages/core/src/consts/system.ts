export const GrowiServiceType = {
  cloud: 'cloud',
  privateCloud: 'private-cloud',
  onPremise: 'on-premise',
  dev: 'dev',
  others: 'others',
} as const;

export const GrowiDeploymentType = {
  officialHelmChart: 'official-helm-chart',
  growiDockerCompose: 'growi-docker-compose',
  node: 'node',
  others: 'others',
} as const;

export type GrowiServiceType =
  (typeof GrowiServiceType)[keyof typeof GrowiServiceType];

export type GrowiDeploymentType =
  (typeof GrowiDeploymentType)[keyof typeof GrowiDeploymentType];
