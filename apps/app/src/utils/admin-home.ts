type SystemInfo = {
  growiVersion?: string;
  nodeVersion?: string;
  npmVersion?: string;
  pnpmVersion?: string;
};

/**
 * Generates prefilled host information as markdown for bug reports
 * @param systemInfo System version information
 * @returns Markdown formatted string with system information
 */
export const generatePrefilledHostInformationMarkdown = (
  systemInfo: SystemInfo,
): string => {
  const { growiVersion, nodeVersion, npmVersion, pnpmVersion } = systemInfo;

  return `| item     | version |
| ---      | --- |
|OS        ||
|GROWI     |${growiVersion ?? ''}|
|node.js   |${nodeVersion ?? ''}|
|npm       |${npmVersion ?? ''}|
|pnpm      |${pnpmVersion ?? ''}|
|Using Docker|yes/no|
|Using [growi-docker-compose][growi-docker-compose]|yes/no|

[growi-docker-compose]: https://github.com/growilabs/growi-docker-compose

*(Accessing https://{GROWI_HOST}/admin helps you to fill in above versions)*`;
};
