import type * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { SearchIcon } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { cn } from '~/utils/shadcn-ui';

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'tw:bg-popover tw:text-popover-foreground tw:flex tw:h-full tw:w-full tw:flex-col tw:overflow-hidden tw:rounded-md',
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="tw:sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn('tw:overflow-hidden tw:p-0', className)}
        showCloseButton={showCloseButton}
      >
        {/* eslint-disable-next-line max-len */}
        <Command className="tw:[&_[cmdk-group-heading]]:text-muted-foreground tw:**:data-[slot=command-input-wrapper]:h-12 tw:[&_[cmdk-group-heading]]:px-2 tw:[&_[cmdk-group-heading]]:font-medium tw:[&_[cmdk-group]]:px-2 tw:[&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 tw:[&_[cmdk-input-wrapper]_svg]:h-5 tw:[&_[cmdk-input-wrapper]_svg]:w-5 tw:[&_[cmdk-input]]:h-12 tw:[&_[cmdk-item]]:px-2 tw:[&_[cmdk-item]]:py-3 tw:[&_[cmdk-item]_svg]:h-5 tw:[&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="tw:flex tw:h-9 tw:items-center tw:gap-2 tw:border-b tw:px-3"
    >
      <SearchIcon className="tw:size-4 tw:shrink-0 tw:opacity-50" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          // eslint-disable-next-line max-len
          'tw:placeholder:text-muted-foreground tw:flex tw:h-10 tw:w-full tw:rounded-md tw:bg-transparent tw:py-3 tw:text-sm tw:outline-hidden tw:disabled:cursor-not-allowed tw:disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'tw:max-h-[300px] tw:scroll-py-1 tw:overflow-x-hidden tw:overflow-y-auto',
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="tw:py-6 tw:text-center tw:text-sm"
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        // eslint-disable-next-line max-len
        'tw:text-foreground tw:[&_[cmdk-group-heading]]:text-muted-foreground tw:overflow-hidden tw:p-1 tw:[&_[cmdk-group-heading]]:px-2 tw:[&_[cmdk-group-heading]]:py-1.5 tw:[&_[cmdk-group-heading]]:text-xs tw:[&_[cmdk-group-heading]]:font-medium',
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('tw:bg-border tw:-mx-1 tw:h-px', className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        // eslint-disable-next-line max-len
        'tw:data-[selected=true]:bg-accent tw:data-[selected=true]:text-accent-foreground tw:[&_svg:not([class*=text-])]:text-muted-foreground tw:relative tw:flex tw:cursor-default tw:items-center tw:gap-2 tw:rounded-sm tw:px-2 tw:py-1.5 tw:text-sm tw:outline-hidden tw:select-none tw:data-[disabled=true]:pointer-events-none tw:data-[disabled=true]:opacity-50 tw:[&_svg]:pointer-events-none tw:[&_svg]:shrink-0 tw:[&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    />
  );
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        'tw:text-muted-foreground tw:ml-auto tw:text-xs tw:tracking-widest',
        className,
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
