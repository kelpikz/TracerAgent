import { ChevronRight, CircleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CodeBlock } from '@/components/CodeBlock';
import { errorMessage } from '@/lib/format';
import type { ErrorInfo } from '@/lib/types';
import { cn } from '@/lib/utils';

export function ErrorAlert({ error, title = 'Error', className }: { error: ErrorInfo | string; title?: string; className?: string }) {
  const info = typeof error === 'string' ? { message: error } : error;
  return (
    <Alert variant="destructive" className={className}>
      <CircleAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="w-full min-w-0">
        <p className="[overflow-wrap:anywhere]">{errorMessage(error)}</p>
        {info.stop_details !== undefined && info.stop_details !== null && (
          <CodeBlock
            code={JSON.stringify(info.stop_details, null, 2)}
            lang="json"
            numbers={false}
            wrap
            maxHeight="12rem"
            className="mt-2 w-full border-destructive/20 bg-background/60 text-foreground"
          />
        )}
        {info.stack && (
          <Collapsible className="mt-1 w-full">
            <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium opacity-80 outline-none hover:opacity-100 focus-visible:underline">
              <ChevronRight className={cn('size-3.5 transition-transform group-data-[state=open]:rotate-90')} />
              Stack trace
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CodeBlock
                code={info.stack}
                numbers={false}
                maxHeight="16rem"
                className="mt-2 w-full border-destructive/20 bg-background/60 text-foreground"
              />
            </CollapsibleContent>
          </Collapsible>
        )}
      </AlertDescription>
    </Alert>
  );
}
