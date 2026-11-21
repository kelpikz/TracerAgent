import { MessageSquareText } from 'lucide-react';
import { CopyButton } from '@/components/CopyButton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function CaseInput({ input }: { input: string }) {
  return (
    <Card className="gap-3 pb-0">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-lg bg-warning/10 text-warning">
            <MessageSquareText className="size-4" />
          </div>
          <div className="flex flex-col gap-1">
            <CardTitle>Agent input</CardTitle>
            <CardDescription>The agent gets this text. It is the alert to investigate.</CardDescription>
          </div>
        </div>
        <CopyButton text={input} />
      </CardHeader>
      <CardContent>
        <pre className="rounded-lg border border-l-[3px] border-l-warning bg-code px-4 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {input}
        </pre>
      </CardContent>
    </Card>
  );
}
