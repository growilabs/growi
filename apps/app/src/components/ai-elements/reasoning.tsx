'use client';

import type React from 'react';
import type { ComponentProps } from 'react';
import { createContext, memo, useContext, useEffect, useState } from 'react';
import { useControllableState } from '@radix-ui/react-use-controllable-state';
import { BrainIcon, ChevronDownIcon } from 'lucide-react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible';
import { cn } from '~/utils/shadcn-ui';

import { Response } from './response';
import { Shimmer } from './shimmer';

type ReasoningContextValue = {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error('Reasoning components must be used within Reasoning');
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
};

const AUTO_CLOSE_DELAY = 1000;
const MS_IN_S = 1000;

export const Reasoning: React.NamedExoticComponent<ReasoningProps> = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen = true,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps): JSX.Element => {
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    });
    const [duration, setDuration] = useControllableState({
      prop: durationProp,
      defaultProp: 0,
    });

    const [hasAutoClosed, setHasAutoClosed] = useState(false);
    const [startTime, setStartTime] = useState<number | null>(null);

    // Track duration when streaming starts and ends
    useEffect(() => {
      if (isStreaming) {
        if (startTime === null) {
          setStartTime(Date.now());
        }
      } else if (startTime !== null) {
        setDuration(Math.ceil((Date.now() - startTime) / MS_IN_S));
        setStartTime(null);
      }
    }, [isStreaming, startTime, setDuration]);

    // Auto-open when streaming starts, auto-close when streaming ends (once only)
    useEffect(() => {
      if (defaultOpen && !isStreaming && isOpen && !hasAutoClosed) {
        // Add a small delay before closing to allow user to see the content
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY);

        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, defaultOpen, setIsOpen, hasAutoClosed]);

    const handleOpenChange = (newOpen: boolean) => {
      setIsOpen(newOpen);
    };

    return (
      <ReasoningContext.Provider
        value={{
          isStreaming,
          isOpen,
          setIsOpen,
          duration,
        }}
      >
        <Collapsible
          className={cn('tw:not-prose tw:mb-4', className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  },
);

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger>;

const getThinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming || duration === 0) {
    return <Shimmer duration={1}>Thinking...</Shimmer>;
  }
  if (duration === undefined) {
    return <p>Thought for a few seconds</p>;
  }
  return <p>Thought for {duration} seconds</p>;
};

export const ReasoningTrigger: React.NamedExoticComponent<ReasoningTriggerProps> =
  memo(
    ({ className, children, ...props }: ReasoningTriggerProps): JSX.Element => {
      const { isStreaming, isOpen, duration } = useReasoning();

      return (
        <CollapsibleTrigger
          className={cn(
            'tw:flex tw:w-full tw:items-center tw:gap-2 tw:text-muted-foreground tw:text-sm tw:transition-colors tw:hover:text-foreground',
            className,
          )}
          {...props}
        >
          {children ?? (
            <>
              <BrainIcon className="tw:size-4" />
              {getThinkingMessage(isStreaming, duration)}
              <ChevronDownIcon
                className={cn(
                  'tw:size-4 tw:transition-transform',
                  isOpen ? 'tw:rotate-180' : 'tw:rotate-0',
                )}
              />
            </>
          )}
        </CollapsibleTrigger>
      );
    },
  );

export type ReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  children: string;
};

export const ReasoningContent: React.NamedExoticComponent<ReasoningContentProps> =
  memo(
    ({ className, children, ...props }: ReasoningContentProps): JSX.Element => (
      <CollapsibleContent
        className={cn(
          'tw:mt-4 tw:text-sm',
          // eslint-disable-next-line max-len
          'tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:slide-out-to-top-2 tw:data-[state=open]:slide-in-from-top-2 tw:text-muted-foreground tw:outline-none tw:data-[state=closed]:animate-out tw:data-[state=open]:animate-in',
          className,
        )}
        {...props}
      >
        <Response className="tw:grid tw:gap-2">{children}</Response>
      </CollapsibleContent>
    ),
  );

Reasoning.displayName = 'Reasoning';
ReasoningTrigger.displayName = 'ReasoningTrigger';
ReasoningContent.displayName = 'ReasoningContent';
