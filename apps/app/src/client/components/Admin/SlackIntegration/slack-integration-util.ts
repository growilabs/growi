export const addLogs = (
  log: string,
  newLogMessage: string,
  newLogCode?: string,
): string => {
  const newLog = `${new Date()} - ${newLogCode ? `${newLogCode}, ` : ''}${newLogMessage}\n\n`;
  return `${newLog}${log ?? ''}`;
};
