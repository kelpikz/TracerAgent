import { Tabs as TabsPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props} />;
}

/** `line` is an underline bar. `pill` is a segmented control. */
function TabsList({
  className,
  variant = 'line',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: 'line' | 'pill' }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        variant === 'line'
          ? 'flex w-full items-center gap-1 overflow-x-auto overflow-y-hidden border-b'
          : 'inline-flex w-fit items-center gap-0.5 rounded-lg bg-muted p-[3px]',
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  variant = 'line',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & { variant?: 'line' | 'pill' }) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
        variant === 'line'
          ? "relative -mb-px rounded-t-md px-3 py-2.5 after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100"
          : 'rounded-md px-3 py-1 text-[13px] data-[state=active]:bg-card data-[state=active]:shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('fade-up flex-1 outline-none', className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
