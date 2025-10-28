'use client';

import type * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';

import { cn } from '~/utils/shadcn-ui';

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: 'sm' | 'default';
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        // eslint-disable-next-line max-len
        'tw:border-input tw:data-[placeholder]:text-muted-foreground tw:[&_svg:not([class*=text-])]:text-muted-foreground tw:focus-visible:border-ring tw:focus-visible:ring-ring/50 tw:aria-invalid:ring-destructive/20 tw:dark:aria-invalid:ring-destructive/40 tw:aria-invalid:border-destructive tw:dark:bg-input/30 tw:dark:hover:bg-input/50 tw:flex tw:w-fit tw:items-center tw:justify-between tw:gap-2 tw:rounded-md tw:border tw:bg-transparent tw:px-3 tw:py-2 tw:text-sm tw:whitespace-nowrap tw:shadow-xs tw:transition-[color,box-shadow] tw:outline-none tw:focus-visible:ring-[3px] tw:disabled:cursor-not-allowed tw:disabled:opacity-50 tw:data-[size=default]:h-9 tw:data-[size=sm]:h-8 tw:*:data-[slot=select-value]:line-clamp-1 tw:*:data-[slot=select-value]:flex tw:*:data-[slot=select-value]:items-center tw:*:data-[slot=select-value]:gap-2 tw:[&_svg]:pointer-events-none tw:[&_svg]:shrink-0 tw:[&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="tw:size-4 tw:opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  align = 'center',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          // eslint-disable-next-line max-len
          'tw:bg-popover tw:text-popover-foreground tw:data-[state=open]:animate-in tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0 tw:data-[state=open]:fade-in-0 tw:data-[state=closed]:zoom-out-95 tw:data-[state=open]:zoom-in-95 tw:data-[side=bottom]:slide-in-from-top-2 tw:data-[side=left]:slide-in-from-right-2 tw:data-[side=right]:slide-in-from-left-2 tw:data-[side=top]:slide-in-from-bottom-2 tw:relative tw:z-50 tw:max-h-(--radix-select-content-available-height) tw:min-w-[8rem] tw:origin-(--radix-select-content-transform-origin) tw:overflow-x-hidden tw:overflow-y-auto tw:rounded-md tw:border tw:shadow-md',
          position === 'popper' &&
            'tw:data-[side=bottom]:translate-y-1 tw:data-[side=left]:-translate-x-1 tw:data-[side=right]:translate-x-1 tw:data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'tw:p-1',
            position === 'popper' &&
              'tw:h-[var(--radix-select-trigger-height)] tw:w-full tw:min-w-[var(--radix-select-trigger-width)] tw:scroll-my-1',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn(
        'tw:text-muted-foreground tw:px-2 tw:py-1.5 tw:text-xs',
        className,
      )}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // eslint-disable-next-line max-len
        'tw:focus:bg-accent tw:focus:text-accent-foreground tw:[&_svg:not([class*=text-])]:text-muted-foreground tw:relative tw:flex tw:w-full tw:cursor-default tw:items-center tw:gap-2 tw:rounded-sm tw:py-1.5 tw:pr-8 tw:pl-2 tw:text-sm tw:outline-hidden tw:select-none tw:data-[disabled]:pointer-events-none tw:data-[disabled]:opacity-50 tw:[&_svg]:pointer-events-none tw:[&_svg]:shrink-0 tw:[&_svg:not([class*=size-])]:size-4 tw:*:[span]:last:flex tw:*:[span]:last:items-center tw:*:[span]:last:gap-2',
        className,
      )}
      {...props}
    >
      <span className="tw:absolute tw:right-2 tw:flex tw:size-3.5 tw:items-center tw:justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="tw:size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        'tw:bg-border tw:pointer-events-none tw:-mx-1 tw:my-1 tw:h-px',
        className,
      )}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        'tw:flex tw:cursor-default tw:items-center tw:justify-center tw:py-1',
        className,
      )}
      {...props}
    >
      <ChevronUpIcon className="tw:size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        'tw:flex tw:cursor-default tw:items-center tw:justify-center tw:py-1',
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className="tw:size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
