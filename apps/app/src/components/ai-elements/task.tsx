"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { cn } from "~/lib/utils";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import type { ComponentProps } from "react";

export type TaskItemFileProps = ComponentProps<"div">;

export const TaskItemFile = ({
  children,
  className,
  ...props
}: TaskItemFileProps) => (
  <div
    className={cn(
      "tw:inline-flex tw:items-center tw:gap-1 tw:rounded-md tw:border tw:bg-secondary tw:px-1.5 tw:py-0.5 tw:text-foreground tw:text-xs",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type TaskItemProps = ComponentProps<"div">;

export const TaskItem = ({ children, className, ...props }: TaskItemProps) => (
  <div className={cn("tw:text-muted-foreground tw:text-sm", className)} {...props}>
    {children}
  </div>
);

export type TaskProps = ComponentProps<typeof Collapsible>;

export const Task = ({
  defaultOpen = true,
  className,
  ...props
}: TaskProps) => (
  <Collapsible className={cn(className)} defaultOpen={defaultOpen} {...props} />
);

export type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
};

export const TaskTrigger = ({
  children,
  className,
  title,
  ...props
}: TaskTriggerProps) => (
  <CollapsibleTrigger asChild className={cn("tw:group", className)} {...props}>
    {children ?? (
      <div className="tw:flex tw:w-full tw:cursor-pointer tw:items-center tw:gap-2 tw:text-muted-foreground tw:text-sm tw:transition-colors tw:hover:text-foreground">
        <SearchIcon className="tw:size-4" />
        <p className="tw:text-sm">{title}</p>
        <ChevronDownIcon className="tw:size-4 tw:transition-transform tw:group-data-[state=open]:rotate-180" />
      </div>
    )}
  </CollapsibleTrigger>
);

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export const TaskContent = ({
  children,
  className,
  ...props
}: TaskContentProps) => (
  <CollapsibleContent
    className={cn(
      "tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:slide-out-to-top-2 tw:data-[state=open]:slide-in-from-top-2 tw:text-popover-foreground tw:outline-none tw:data-[state=closed]:animate-out tw:data-[state=open]:animate-in",
      className
    )}
    {...props}
  >
    <div className="tw:mt-4 tw:space-y-2 tw:border-muted tw:border-l-2 tw:pl-4">
      {children}
    </div>
  </CollapsibleContent>
);
