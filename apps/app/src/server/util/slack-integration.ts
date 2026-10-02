import type { IChannelOptionalId } from '@growi/slack';
import { getSupportedGrowiActionsRegExp } from '@growi/slack/dist/utils/get-supported-growi-actions-regexps';
import { permissionParser } from '@growi/slack/dist/utils/permission-parser';

type CommandPermission = { [key: string]: string[] | boolean };

export const checkPermission = (
  commandPermission: CommandPermission,
  commandOrActionIdOrCallbackId: string,
  fromChannel: IChannelOptionalId,
): boolean => {
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

    isPermitted = permissionParser(permission, fromChannel);
  });

  return isPermitted;
};
