import React, { type JSX } from 'react';

import type { IUserHasId } from '@growi/core';
import { isPopulated, type IUser, type Ref } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import { UserPicture } from '@growi/ui/dist/components';
import { format } from 'date-fns/format';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';


import styles from './AuthorInfo.module.scss';

const UserLabel = ({ user }: { user: IUserHasId | Ref<IUser> }): JSX.Element => {
  if (isPopulated(user)) {
    return (
      <Link href={pagePathUtils.userHomepagePath(user)} prefetch={false}>
        {user.name}
      </Link>
    );
  }

  return <i>(anyone)</i>;
};


type AuthorInfoProps = {
  date: Date,
  user?: IUserHasId | Ref<IUser>,
  mode: 'create' | 'update',
  locate: 'pageSide' | 'footer',
}

export const AuthorInfo = (props: AuthorInfoProps): JSX.Element => {
  const { t } = useTranslation();
  const {
    date, user, mode = 'create', locate = 'pageSide',
  } = props;

  const formatType = 'yyyy/MM/dd HH:mm';

  const infoLabelForPageSide = mode === 'create'
    ? t('author_info.created_by')
    : t('author_info.updated_by');
  const nullinfoLabelForFooter = mode === 'create'
    ? 'Created by'
    : 'Updated by';
  const infoLabelForFooter = mode === 'create'
    ? t('author_info.created_at')
    : t('author_info.last_revision_posted_at');
  const userLabel = user != null
    ? (
      <UserLabel user={user} />
    )
    : <i>Unknown</i>;

  if (locate === 'footer') {
    try {
      return <p>{infoLabelForFooter} {format(new Date(date), formatType)} by <UserPicture user={user} size="sm" /> {userLabel}</p>;
    }
    catch (err) {
      if (err instanceof RangeError) {
        return <p>{nullinfoLabelForFooter} <UserPicture user={user} size="sm" /> {userLabel}</p>;
      }
      return <></>;
    }
  }

  const renderParsedDate = () => {
    try {
      return format(new Date(date), formatType);
    }
    catch (err) {
      return '';
    }
  };

  return (
    <div className={`grw-author-info ${styles['grw-author-info']} d-flex align-items-center mb-2`}>
      <div className="me-2 d-none d-lg-block">
        <UserPicture user={user} size="sm" />
      </div>
      <div>
        <div className="text-secondary mb-1">{infoLabelForPageSide} <br className="d-lg-none" />{userLabel}</div>
        <div className="text-secondary text-date" data-vrt-blackout-datetime>
          {renderParsedDate()}
        </div>
      </div>
    </div>
  );
};
