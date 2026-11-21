import { Braces } from 'lucide-react';
import { useMemo } from 'react';
import { CodeBlock } from '@/components/CodeBlock';
import { CopyButton } from '@/components/CopyButton';
import { EmptyState } from '@/components/EmptyState';
import { Card } from '@/components/ui/card';
import type { Run } from '@/lib/types';

export function RawJsonTab({ run }: { run: Run | null }) {
  const text = useMemo(() => (run ? JSON.stringify(run, null, 2) : ''), [run]);
  if (!run) {
    return (
      <EmptyState icon={Braces} title="No data yet">
        Run the case to see the result file.
      </EmptyState>
    );
  }
  return (
    <Card className="gap-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Braces className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-[13px] font-medium">{run.run_id}.json</span>
        </div>
        <CopyButton text={text} label="Copy JSON" />
      </div>
      <CodeBlock code={text} lang="json" bare maxHeight="70vh" />
    </Card>
  );
}
