export const RoomPrefix = {
  USER: 'user',
  PAGE: 'page',
};

export const getRoomNameWithId = (
  roomPrefix: string,
  roomId: string,
): string => {
  return `${roomPrefix}:${roomId}`;
};
