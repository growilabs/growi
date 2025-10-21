'use client';

import type { ComponentProps } from 'react';

import { ChevronDownIcon, PaperclipIcon } from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible';
import { ScrollArea } from '~/components/ui/scroll-area';
import { cn } from '~/lib/utils';

export type QueueMessagePart = {
  type: string;
  text?: string;
  url?: string;
  filename?: string;
  mediaType?: string;
};

export type QueueMessage = {
  id: string;
  parts: QueueMessagePart[];
};

export type QueueTodo = {
  id: string;
  title: string;
  description?: string;
  status?: 'pending' | 'completed';
};

export type QueueItemProps = ComponentProps<'li'>;

export const QueueItem = ({ className, ...props }: QueueItemProps) => (
  <li
    className={cn(
      'tw:group tw:flex tw:flex-col tw:gap-1 tw:rounded-md tw:px-3 tw:py-1 tw:text-sm tw:transition-colors tw:hover:bg-muted',
      className,
    )}
    {...props}
  />
);

export type QueueItemIndicatorProps = ComponentProps<'span'> & {
  completed?: boolean;
};

export const QueueItemIndicator = ({
  completed = false,
  className,
  ...props
}: QueueItemIndicatorProps) => (
  <span
    className={cn(
      'tw:mt-0.5 tw:inline-block tw:size-2.5 tw:rounded-full tw:border',
      completed
        ? 'tw:border-muted-foreground/20 tw:bg-muted-foreground/10'
        : 'tw:border-muted-foreground/50',
      className,
    )}
    {...props}
  />
);

export type QueueItemContentProps = ComponentProps<'span'> & {
  completed?: boolean;
};

export const QueueItemContent = ({
  completed = false,
  className,
  ...props
}: QueueItemContentProps) => (
  <span
    className={cn(
      'tw:line-clamp-1 tw:grow tw:break-words',
      completed
        ? 'tw:text-muted-foreground/50 tw:line-through'
        : 'tw:text-muted-foreground',
      className,
    )}
    {...props}
  />
);

export type QueueItemDescriptionProps = ComponentProps<'div'> & {
  completed?: boolean;
};

export const QueueItemDescription = ({
  completed = false,
  className,
  ...props
}: QueueItemDescriptionProps) => (
  <div
    className={cn(
      'tw:ml-6 tw:text-xs',
      completed
        ? 'tw:text-muted-foreground/40 tw:line-through'
        : 'tw:text-muted-foreground',
      className,
    )}
    {...props}
  />
);

export type QueueItemActionsProps = ComponentProps<'div'>;

export const QueueItemActions = ({
  className,
  ...props
}: QueueItemActionsProps) => (
  <div className={cn('tw:flex tw:gap-1', className)} {...props} />
);

export type QueueItemActionProps = Omit<
  ComponentProps<typeof Button>,
  'variant' | 'size'
>;

export const QueueItemAction = ({
  className,
  ...props
}: QueueItemActionProps) => (
  <Button
    className={cn(
      'tw:size-auto tw:rounded tw:p-1 tw:text-muted-foreground tw:opacity-0 tw:transition-opacity tw:hover:bg-muted-foreground/10 tw:hover:text-foreground tw:group-hover:opacity-100',
      className,
    )}
    size="icon"
    type="button"
    variant="ghost"
    {...props}
  />
);

export type QueueItemAttachmentProps = ComponentProps<'div'>;

export const QueueItemAttachment = ({
  className,
  ...props
}: QueueItemAttachmentProps) => (
  <div className={cn('tw:mt-1 tw:flex tw:flex-wrap tw:gap-2', className)} {...props} />
);

export type QueueItemImageProps = ComponentProps<'img'>;

export const QueueItemImage = ({
  className,
  ...props
}: QueueItemImageProps) => (
  <img
    alt=""
    className={cn('tw:h-8 tw:w-8 tw:rounded tw:border tw:object-cover', className)}
    height={32}
    width={32}
    {...props}
  />
);

export type QueueItemFileProps = ComponentProps<'span'>;

export const QueueItemFile = ({
  children,
  className,
  ...props
}: QueueItemFileProps) => (
  <span
    className={cn(
      'tw:flex tw:items-center tw:gap-1 tw:rounded tw:border tw:bg-muted tw:px-2 tw:py-1 tw:text-xs',
      className,
    )}
    {...props}
  >
    <PaperclipIcon size={12} />
    <span className="tw:max-w-[100px] tw:truncate">{children}</span>
  </span>
);

export type QueueListProps = ComponentProps<typeof ScrollArea>;

export const QueueList = ({
  children,
  className,
  ...props
}: QueueListProps) => (
  <ScrollArea className={cn('tw:-mb-1 tw:mt-2', className)} {...props}>
    <div className="tw:max-h-40 tw:pr-4">
      <ul>{children}</ul>
    </div>
  </ScrollArea>
);

// QueueSection - collapsible section container
export type QueueSectionProps = ComponentProps<typeof Collapsible>;

export const QueueSection = ({
  className,
  defaultOpen = true,
  ...props
}: QueueSectionProps) => (
  <Collapsible className={cn(className)} defaultOpen={defaultOpen} {...props} />
);

// QueueSectionTrigger - section header/trigger
export type QueueSectionTriggerProps = ComponentProps<'button'>;

export const QueueSectionTrigger = ({
  children,
  className,
  ...props
}: QueueSectionTriggerProps) => (
  <CollapsibleTrigger asChild>
    <button
      className={cn(
        'tw:group tw:flex tw:w-full tw:items-center tw:justify-between tw:rounded-md tw:bg-muted/40 tw:px-3 tw:py-2 tw:text-left tw:font-medium tw:text-muted-foreground tw:text-sm tw:transition-colors tw:hover:bg-muted',
        className,
      )}
      type="button"
      {...props}
    >
      {children}
    </button>
  </CollapsibleTrigger>
);

// QueueSectionLabel - label content with icon and count
export type QueueSectionLabelProps = ComponentProps<'span'> & {
  count?: number;
  label: string;
  icon?: React.ReactNode;
};

export const QueueSectionLabel = ({
  count,
  label,
  icon,
  className,
  ...props
}: QueueSectionLabelProps) => (
  <span className={cn('tw:flex tw:items-center tw:gap-2', className)} {...props}>
    <ChevronDownIcon className="tw:group-data-[state=closed]:-rotate-90 tw:size-4 tw:transition-transform" />
    {icon}
    <span>
      {count} {label}
    </span>
  </span>
);

// QueueSectionContent - collapsible content area
export type QueueSectionContentProps = ComponentProps<
  typeof CollapsibleContent
>;

export const QueueSectionContent = ({
  className,
  ...props
}: QueueSectionContentProps) => (
  <CollapsibleContent className={cn(className)} {...props} />
);

export type QueueProps = ComponentProps<'div'>;

export const Queue = ({ className, ...props }: QueueProps) => (
  <div
    className={cn(
      'tw:flex tw:flex-col tw:gap-2 tw:rounded-xl tw:border tw:border-border tw:bg-background tw:px-3 tw:pt-2 tw:pb-2 tw:shadow-xs',
      className,
    )}
    {...props}
  />
);
