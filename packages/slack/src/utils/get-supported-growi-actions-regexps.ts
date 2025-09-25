export const getSupportedGrowiActionsRegExps = (
  supportedGrowiCommands: string[],
): RegExp[] => {
  return supportedGrowiCommands.map(
    (command) => new RegExp(`^${command}:\\w+`),
  );
};

export const getSupportedGrowiActionsRegExp = (
  supportedGrowiCommand: string,
): RegExp => {
  return new RegExp(
    `(^${supportedGrowiCommand}$)|(^${supportedGrowiCommand}:\\w+)`,
  );
};
