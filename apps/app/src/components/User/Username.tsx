import type React from 'react';
import type { JSX } from 'react';
import Link from 'next/link';
import type { IUserHasId } from '@growi/core';
import { type IUser, isPopulated, type Ref } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';

export const Username: React.FC<{ user?: IUserHasId | Ref<IUser> }> = ({
  user,
}): JSX.Element => {
  if (user == null || !isPopulated(user)) {
    return <i>(anyone)</i>;
  }

  const name = user.name || '(no name)';
  const username = user.username;
  const href = pagePathUtils.userHomepagePath(user);

  return (
    <Link href={href} prefetch={false}>
      {name}(@{username})
    </Link>
  );
};
