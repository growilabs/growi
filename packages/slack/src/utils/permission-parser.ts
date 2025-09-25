import type { IChannelOptionalId } from '../interfaces/channel';

export const permissionParser = (
  permissionForCommand: boolean | string[],
  channel: IChannelOptionalId,
): boolean => {
  if (permissionForCommand == null) {
    return false;
  }

  if (permissionForCommand === true) {
    return true;
  }

  if (Array.isArray(permissionForCommand)) {
    if (permissionForCommand.includes(channel.name)) {
      return true;
    }

    if (channel.id == null) {
      return false;
    }

    if (permissionForCommand.includes(channel.id)) {
      return true;
    }
  }

  return false;
};
