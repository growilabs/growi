export const getInteractionIdRegexpFromCommandName = (
  commandname: string,
): RegExp => {
  return new RegExp(`^${commandname}:\\w+`);
};
