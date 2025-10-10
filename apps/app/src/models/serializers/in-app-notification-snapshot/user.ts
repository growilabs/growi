import type { IUser } from '@growi/core';

export interface IUserSnapshot {
  username: string;
}

export const stringifySnapshot = (user: IUser): string => {
  return JSON.stringify({
    username: user.username,
  });
};

export const parseSnapshot = (snapshot: string): IUserSnapshot => {
  return JSON.parse(snapshot);
};
