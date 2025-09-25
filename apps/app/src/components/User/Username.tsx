import React, { type JSX } from 'react';

import type { IUserHasId } from '@growi/core';
import { isPopulated, type IUser, type Ref } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import Link from 'next/link';

export const Username: React.FC<{ user?: IUserHasId | Ref<IUser> }> = ({ user }): JSX.Element => {

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
