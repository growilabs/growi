import { getSupportedGrowiActionsRegExp, IChannelOptionalId } from '@growi/slack';

type CommandPermission = { [key:string]: string[] | boolean }

export const checkPermission = (
    commandPermission: CommandPermission, commandOrActionIdOrCallbackId: string, fromChannel: IChannelOptionalId,
):boolean => {
  let isPermitted = false;

  // help
  if (commandOrActionIdOrCallbackId === 'help') {
    return true;
  }

  Object.entries(commandPermission).forEach((entry) => {
    const [command, value] = entry;
    const permission = value;
    const commandRegExp = getSupportedGrowiActionsRegExp(command);
    if (!commandRegExp.test(commandOrActionIdOrCallbackId)) return;

    // permission check
    if (permission === true) {
      isPermitted = true;
      return;
    }

    if (Array.isArray(permission)) {
      if (permission.includes(fromChannel.name)) {
        isPermitted = true;
        return;
      }

      if (fromChannel.id == null) return;

      if (permission.includes(fromChannel.id)) {
        isPermitted = true;
        return;
      }
    }
  });

  return isPermitted;
};
