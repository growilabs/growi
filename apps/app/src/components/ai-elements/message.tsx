import type { ComponentProps, HTMLAttributes } from 'react';
import type { UIMessage } from 'ai';
import { cva, type VariantProps } from 'class-variance-authority';

import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import { cn } from '~/utils/shadcn-ui';

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage['role'];
};

export const Message = ({
  className,
  from,
  ...props
}: MessageProps): JSX.Element => (
  <div
    className={cn(
      'tw:group tw:flex tw:w-full tw:items-end tw:justify-end tw:gap-2 tw:py-4',
      from === 'user'
        ? 'tw:is-user'
        : 'tw:is-assistant tw:flex-row-reverse tw:justify-end',
      className,
    )}
    {...props}
  />
);

const messageContentVariants = cva(
  'tw:is-user:dark tw:flex tw:flex-col tw:gap-2 tw:overflow-hidden tw:rounded-lg tw:text-sm',
  {
    variants: {
      variant: {
        contained: [
          'max-w-[80%] px-4 py-3',
          'group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground',
          'group-[.is-assistant]:bg-secondary group-[.is-assistant]:text-foreground',
        ],
        flat: [
          'group-[.is-user]:max-w-[80%] group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground',
          'group-[.is-assistant]:text-foreground',
        ],
      },
    },
    defaultVariants: {
      variant: 'contained',
    },
  },
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof messageContentVariants>;

export const MessageContent = ({
  children,
  className,
  variant,
  ...props
}: MessageContentProps): JSX.Element => (
  <div
    className={cn(messageContentVariants({ variant, className }))}
    {...props}
  >
    {children}
  </div>
);

export type MessageAvatarProps = ComponentProps<typeof Avatar> & {
  src: string;
  name?: string;
};

export const MessageAvatar = ({
  src,
  name,
  className,
  ...props
}: MessageAvatarProps): JSX.Element => (
  <Avatar
    className={cn('tw:size-8 tw:ring-1 tw:ring-border', className)}
    {...props}
  >
    <AvatarImage alt="" className="tw:mt-0 tw:mb-0" src={src} />
    <AvatarFallback>{name?.slice(0, 2) || 'ME'}</AvatarFallback>
  </Avatar>
);
