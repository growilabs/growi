'use client';

import type { ComponentProps } from 'react';

import { Button } from '~/components/ui/button';
import { ScrollArea, ScrollBar } from '~/components/ui/scroll-area';
import { cn } from '~/lib/utils';

export type SuggestionsProps = ComponentProps<typeof ScrollArea>;

export const Suggestions = ({
  className,
  children,
  ...props
}: SuggestionsProps) => (
  <ScrollArea
    className="tw:w-full tw:overflow-x-auto tw:whitespace-nowrap"
    {...props}
  >
    <div
      className={cn(
        'tw:flex tw:w-max tw:flex-nowrap tw:items-center tw:gap-2',
        className,
      )}
    >
      {children}
    </div>
    <ScrollBar className="tw:hidden" orientation="horizontal" />
  </ScrollArea>
);

export type SuggestionProps = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  variant = 'outline',
  size = 'sm',
  children,
  ...props
}: SuggestionProps) => {
  const handleClick = () => {
    onClick?.(suggestion);
  };

  return (
    <Button
      className={cn('tw:cursor-pointer tw:rounded-full tw:px-4', className)}
      onClick={handleClick}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children || suggestion}
    </Button>
  );
};
