import {
  forwardRef,
  type JSX,
  memo,
  type ReactNode,
  useCallback,
  useRef,
} from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import type { IUser, Ref } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import type { UncontrolledTooltipProps } from 'reactstrap';

import styles from './UserPicture.module.scss';

const moduleClass = styles['user-picture'];
const moduleTooltipClass = styles['user-picture-tooltip'];

const UncontrolledTooltip = dynamic<UncontrolledTooltipProps>(
  () => import('reactstrap').then((mod) => mod.UncontrolledTooltip),
  { ssr: false },
);

const DEFAULT_IMAGE = '/images/icons/user.svg';

type UserPictureSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

type BaseUserPictureRootProps = {
  displayName: string;
  children: ReactNode;
  size?: UserPictureSize;
  className?: string;
};

type UserPictureRootWithoutLinkProps = BaseUserPictureRootProps;

type UserPictureRootWithLinkProps = BaseUserPictureRootProps & {
  username: string;
};

const UserPictureRootWithoutLink = forwardRef<
  HTMLSpanElement,
  UserPictureRootWithoutLinkProps
>((props, ref) => {
  return (
    <span ref={ref} className={props.className}>
      {props.children}
    </span>
  );
});

const UserPictureRootWithLink = forwardRef<
  HTMLSpanElement,
  UserPictureRootWithLinkProps
>((props, ref) => {
  const router = useRouter();

  const { username } = props;

  const clickHandler = useCallback(() => {
    const href = pagePathUtils.userHomepagePath({ username });
    router.push(href);
  }, [router, username]);

  // Using <span> tag here instead of <a> tag because UserPicture is used in SearchResultList which is essentially a anchor tag.
  // Nested anchor tags causes a warning.
  // https://stackoverflow.com/questions/13052598/creating-anchor-tag-inside-anchor-taga
  return (
    // biome-ignore lint/a11y/useSemanticElements: ignore
    <span
      ref={ref}
      className={props.className}
      onClick={clickHandler}
      onKeyDown={clickHandler}
      style={{ cursor: 'pointer' }}
      role="link"
      tabIndex={0}
    >
      {props.children}
    </span>
  );
});

// wrapper with Tooltip
const withTooltip =
  <P extends BaseUserPictureRootProps>(
    UserPictureSpanElm: React.ForwardRefExoticComponent<
      P & React.RefAttributes<HTMLSpanElement>
    >,
  ) =>
  (props: P): JSX.Element => {
    const { displayName, size } = props;
    const username = 'username' in props ? props.username : undefined;

    const tooltipClassName = `${moduleTooltipClass} user-picture-tooltip-${size ?? 'md'}`;
    const userPictureRef = useRef<HTMLSpanElement>(null);

    return (
      <>
        <UserPictureSpanElm ref={userPictureRef} {...props} />
        <UncontrolledTooltip
          placement="bottom"
          target={userPictureRef}
          popperClassName={tooltipClassName}
          delay={0}
          fade={false}
        >
          {username ? (
            <>
              {`@${username}`}
              <br />
            </>
          ) : null}
          {displayName}
        </UncontrolledTooltip>
      </>
    );
  };

/**
 * type guard to determine whether the specified object is IUser
 */
const hasUsername = (
  obj: Partial<IUser> | Ref<IUser> | null | undefined,
): obj is { username: string } => {
  return obj != null && typeof obj !== 'string' && 'username' in obj;
};

/**
 * Type guard to determine whether tooltip should be shown
 */
const hasName = (
  obj: Partial<IUser> | Ref<IUser> | null | undefined,
): obj is { name: string } => {
  return obj != null && typeof obj === 'object' && 'name' in obj;
};

/**
 * type guard to determine whether the specified object is IUser
 */
const hasProfileImage = (
  obj: Partial<IUser> | Ref<IUser> | null | undefined,
): obj is { imageUrlCached: string } => {
  return obj != null && typeof obj === 'object' && 'imageUrlCached' in obj;
};

type Props = {
  user?: Partial<IUser> | Ref<IUser> | null;
  size?: UserPictureSize;
  noLink?: boolean;
  noTooltip?: boolean;
  className?: string;
};

export const UserPicture = memo((userProps: Props): JSX.Element => {
  const {
    user,
    size,
    noLink,
    noTooltip,
    className: additionalClassName,
  } = userProps;

  // Extract user information
  const username = hasUsername(user) ? user.username : undefined;
  const displayName = hasName(user) ? user.name : 'someone';
  const src = hasProfileImage(user)
    ? (user.imageUrlCached ?? DEFAULT_IMAGE)
    : DEFAULT_IMAGE;
  const showTooltip = !noTooltip && hasName(user);

  // Build className
  const className = [
    moduleClass,
    'user-picture',
    'rounded-circle',
    size && `user-picture-${size}`,
    additionalClassName,
  ]
    .filter(Boolean)
    .join(' ');

  // biome-ignore lint/performance/noImgElement: ignore
  const imgElement = <img src={src} alt={displayName} className={className} />;
  const baseProps = { displayName, size, children: imgElement };

  if (username == null || noLink) {
    const Component = showTooltip
      ? withTooltip(UserPictureRootWithoutLink)
      : UserPictureRootWithoutLink;
    return <Component {...baseProps} />;
  }

  const Component = showTooltip
    ? withTooltip(UserPictureRootWithLink)
    : UserPictureRootWithLink;
  return <Component {...baseProps} username={username} />;
});
UserPicture.displayName = 'UserPicture';
