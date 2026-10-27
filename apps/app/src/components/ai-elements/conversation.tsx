'use client';

import type React from 'react';
import type { ComponentProps } from 'react';
import { createContext, useCallback, useContext } from 'react';
import { ArrowDownIcon } from 'lucide-react';
import SimpleBar from 'simplebar-react';
import {
  type StickToBottomInstance,
  useStickToBottom,
} from 'use-stick-to-bottom';

import { Button } from '~/components/ui/button';
import { cn } from '~/utils/shadcn-ui';

// Carries the stick-to-bottom instance to ConversationContent (refs) and
// ConversationScrollButton (scroll state). We can't reuse use-stick-to-bottom's
// own <StickToBottom> context because SimpleBar must own the scroll element, so
// we drive the library through its hook and provide the instance ourselves.
const ConversationContext = createContext<StickToBottomInstance | null>(null);

const useConversationContext = (): StickToBottomInstance => {
  const instance = useContext(ConversationContext);
  if (instance == null) {
    throw new Error('Conversation.* must be used within <Conversation>');
  }
  return instance;
};

export type ConversationProps = ComponentProps<'div'> & {
  children: React.ReactNode;
};

export const Conversation = ({
  className,
  children,
  ...props
}: ConversationProps): React.ReactElement => {
  const instance = useStickToBottom({ initial: 'smooth', resize: 'smooth' });

  return (
    <ConversationContext.Provider value={instance}>
      {/* Non-scrolling relative wrapper: scrolling happens inside SimpleBar, so
          the absolutely-positioned scroll button anchors here and stays put. */}
      <div
        className={cn('tw:relative tw:flex-1 tw:overflow-hidden', className)}
        role="log"
        {...props}
      >
        {children}
      </div>
    </ConversationContext.Provider>
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
  const { scrollRef, contentRef } = useConversationContext();

  return (
    // SimpleBar owns the scroll element; its scrollable node is handed to
    // use-stick-to-bottom via scrollableNodeProps.ref so auto-stick-to-bottom
    // drives SimpleBar's custom scrollbar instead of the native one.
    <SimpleBar className="tw:h-full" scrollableNodeProps={{ ref: scrollRef }}>
      <div
        ref={contentRef}
        className={cn('tw:px-6 tw:py-4', className)}
        {...props}
      >
        {children}
      </div>
    </SimpleBar>
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
  const { isAtBottom, scrollToBottom } = useConversationContext();

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
