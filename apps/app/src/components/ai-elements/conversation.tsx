'use client';

import type React from 'react';
import type { ComponentProps } from 'react';
import { useCallback } from 'react';
import { ArrowDownIcon } from 'lucide-react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';

import { Button } from '~/components/ui/button';
import { cn } from '~/utils/shadcn-ui';

export type ConversationProps = ComponentProps<'div'> & {
  children: React.ReactNode;
};

export const Conversation = ({
  className,
  children,
  ...props
}: ConversationProps): React.ReactElement => {
  const Component = StickToBottom as unknown as React.FC<{
    className?: string;
    initial?: string;
    resize?: string;
    role?: string;
    children: React.ReactNode;
  }>;

  return (
    <Component
      className={cn('tw:relative tw:flex-1 tw:overflow-y-auto', className)}
      initial="smooth"
      resize="smooth"
      role="log"
      {...props}
    >
      {children}
    </Component>
  );
};

export type ConversationContentProps = ComponentProps<'div'> & {
  children: React.ReactNode;
};

export const ConversationContent = ({
  className,
  children,
  ...props
}: ConversationContentProps): React.ReactElement => {
  const Component = StickToBottom.Content as unknown as React.FC<{
    className?: string;
    children: React.ReactNode;
  }>;

  return (
    <Component className={cn('tw:p-4', className)} {...props}>
      {children}
    </Component>
  );
};

export type ConversationEmptyStateProps = ComponentProps<'div'> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = 'No messages yet',
  description = 'Start a conversation to see messages here',
  icon,
  children,
  ...props
}: ConversationEmptyStateProps): React.ReactElement => (
  <div
    className={cn(
      'tw:flex tw:size-full tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:p-8 tw:text-center',
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="tw:text-muted-foreground">{icon}</div>}
        <div className="tw:space-y-1">
          <h3 className="tw:font-medium tw:text-sm">{title}</h3>
          {description && (
            <p className="tw:text-muted-foreground tw:text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps): React.ReactElement | null => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  if (isAtBottom) {
    return null;
  }

  return (
    <Button
      className={cn(
        'tw:absolute tw:bottom-4 tw:left-[50%] tw:translate-x-[-50%] tw:rounded-full',
        className,
      )}
      onClick={handleScrollToBottom}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      <ArrowDownIcon className="tw:size-4" />
    </Button>
  );
};
