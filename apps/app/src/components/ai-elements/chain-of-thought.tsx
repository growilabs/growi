'use client';

import type { ComponentProps } from 'react';
import {
  createContext, memo, useContext, useMemo,
} from 'react';

import { useControllableState } from '@radix-ui/react-use-controllable-state';
import {
  BrainIcon,
  ChevronDownIcon,
  DotIcon,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '~/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible';
import { cn } from '~/lib/utils';

type ChainOfThoughtContextValue = {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
};

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(
  null,
);

const useChainOfThought = () => {
  const context = useContext(ChainOfThoughtContext);
  if (!context) {
    throw new Error(
      'ChainOfThought components must be used within ChainOfThought',
    );
  }
  return context;
};

export type ChainOfThoughtProps = ComponentProps<'div'> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const ChainOfThought = memo(
  ({
    className,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
    ...props
  }: ChainOfThoughtProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    });

    const chainOfThoughtContext = useMemo(
      () => ({ isOpen, setIsOpen }),
      [isOpen, setIsOpen],
    );

    return (
      <ChainOfThoughtContext.Provider value={chainOfThoughtContext}>
        <div
          className={cn('tw:not-prose tw:max-w-prose tw:space-y-4', className)}
          {...props}
        >
          {children}
        </div>
      </ChainOfThoughtContext.Provider>
    );
  },
);

export type ChainOfThoughtHeaderProps = ComponentProps<
  typeof CollapsibleTrigger
>;

export const ChainOfThoughtHeader = memo(
  ({ className, children, ...props }: ChainOfThoughtHeaderProps) => {
    const { isOpen, setIsOpen } = useChainOfThought();

    return (
      <Collapsible onOpenChange={setIsOpen} open={isOpen}>
        <CollapsibleTrigger
          className={cn(
            'tw:flex tw:w-full tw:items-center tw:gap-2 tw:text-muted-foreground tw:text-sm tw:transition-colors tw:hover:text-foreground',
            className,
          )}
          {...props}
        >
          <BrainIcon className="tw:size-4" />
          <span className="tw:flex-1 tw:text-left">
            {children ?? 'Chain of Thought'}
          </span>
          <ChevronDownIcon
            className={cn(
              'tw:size-4 tw:transition-transform',
              isOpen ? 'tw:rotate-180' : 'tw:rotate-0',
            )}
          />
        </CollapsibleTrigger>
      </Collapsible>
    );
  },
);

export type ChainOfThoughtStepProps = ComponentProps<'div'> & {
  icon?: LucideIcon;
  label: string;
  description?: string;
  status?: 'complete' | 'active' | 'pending';
};

export const ChainOfThoughtStep = memo(
  ({
    className,
    icon: Icon = DotIcon,
    label,
    description,
    status = 'complete',
    children,
    ...props
  }: ChainOfThoughtStepProps) => {
    const statusStyles = {
      complete: 'text-muted-foreground',
      active: 'text-foreground',
      pending: 'text-muted-foreground/50',
    };

    return (
      <div
        className={cn(
          'tw:flex tw:gap-2 tw:text-sm',
          statusStyles[status],
          'tw:fade-in-0 tw:slide-in-from-top-2 tw:animate-in',
          className,
        )}
        {...props}
      >
        <div className="tw:relative tw:mt-0.5">
          <Icon className="tw:size-4" />
          <div className="tw:-mx-px tw:absolute tw:top-7 tw:bottom-0 tw:left-1/2 tw:w-px tw:bg-border" />
        </div>
        <div className="tw:flex-1 tw:space-y-2">
          <div>{label}</div>
          {description && (
            <div className="tw:text-muted-foreground tw:text-xs">{description}</div>
          )}
          {children}
        </div>
      </div>
    );
  },
);

export type ChainOfThoughtSearchResultsProps = ComponentProps<'div'>;

export const ChainOfThoughtSearchResults = memo(
  ({ className, ...props }: ChainOfThoughtSearchResultsProps) => (
    <div className={cn('tw:flex tw:items-center tw:gap-2', className)} {...props} />
  ),
);

export type ChainOfThoughtSearchResultProps = ComponentProps<typeof Badge>;

export const ChainOfThoughtSearchResult = memo(
  ({ className, children, ...props }: ChainOfThoughtSearchResultProps) => (
    <Badge
      className={cn('tw:gap-1 tw:px-2 tw:py-0.5 tw:font-normal tw:text-xs', className)}
      variant="secondary"
      {...props}
    >
      {children}
    </Badge>
  ),
);

export type ChainOfThoughtContentProps = ComponentProps<
  typeof CollapsibleContent
>;

export const ChainOfThoughtContent = memo(
  ({ className, children, ...props }: ChainOfThoughtContentProps) => {
    const { isOpen } = useChainOfThought();

    return (
      <Collapsible open={isOpen}>
        <CollapsibleContent
          className={cn(
            'tw:mt-2 tw:space-y-3',
            'tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:slide-out-to-top-2 tw:data-[state=open]:slide-in-from-top-2 tw:text-popover-foreground tw:outline-none tw:data-[state=closed]:animate-out tw:data-[state=open]:animate-in',
            className,
          )}
          {...props}
        >
          {children}
        </CollapsibleContent>
      </Collapsible>
    );
  },
);

export type ChainOfThoughtImageProps = ComponentProps<'div'> & {
  caption?: string;
};

export const ChainOfThoughtImage = memo(
  ({
    className, children, caption, ...props
  }: ChainOfThoughtImageProps) => (
    <div className={cn('tw:mt-2 tw:space-y-2', className)} {...props}>
      <div className="tw:relative tw:flex tw:max-h-[22rem] tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-lg tw:bg-muted tw:p-3">
        {children}
      </div>
      {caption && <p className="tw:text-muted-foreground tw:text-xs">{caption}</p>}
    </div>
  ),
);

ChainOfThought.displayName = 'ChainOfThought';
ChainOfThoughtHeader.displayName = 'ChainOfThoughtHeader';
ChainOfThoughtStep.displayName = 'ChainOfThoughtStep';
ChainOfThoughtSearchResults.displayName = 'ChainOfThoughtSearchResults';
ChainOfThoughtSearchResult.displayName = 'ChainOfThoughtSearchResult';
ChainOfThoughtContent.displayName = 'ChainOfThoughtContent';
ChainOfThoughtImage.displayName = 'ChainOfThoughtImage';
