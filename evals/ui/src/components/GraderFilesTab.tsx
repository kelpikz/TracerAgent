import { FileCode2, FileQuestion, FileText } from 'lucide-react';
import { CodeBlock } from '@/components/CodeBlock';
import { CopyButton } from '@/components/CopyButton';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { GraderFiles, GraderKind } from '@/lib/types';

function FileCard({ name, content, lang, wrap }: { name: string; content: string | null; lang: 'javascript' | 'markdown'; wrap: boolean }) {
  const Icon = lang === 'javascript' ? FileCode2 : FileText;
  const lines = content === null ? 0 : content.replace(/\n$/, '').split('\n').length;
  return (
    <Card className="min-w-0 gap-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-mono text-[13px] font-medium">{name}</span>
          {content !== null && <span className="text-xs text-muted-foreground tabular-nums">{lines} {lines === 1 ? 'line' : 'lines'}</span>}
        </div>
        {content !== null && <CopyButton text={content} />}
      </div>
      {content === null ? (
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <div className="grid size-10 place-items-center rounded-full border border-dashed text-muted-foreground">
            <FileQuestion className="size-[18px]" />
          </div>
          <p className="text-sm font-medium">File missing</p>
          <p className="text-[13px] text-muted-foreground">This case has no <span className="font-mono">{name}</span> for this grader.</p>
        </div>
      ) : (
        <CodeBlock code={content.replace(/\n$/, '')} lang={lang} wrap={wrap} bare maxHeight="34rem" />
      )}
    </Card>
  );
}

const kinds: { value: GraderKind; label: string }[] = [
  { value: 'trajectory', label: 'Trajectory' },
  { value: 'outcome', label: 'Outcome' },
];

export function GraderFilesTab({ graders }: { graders: Record<GraderKind, GraderFiles> }) {
  return (
    <Tabs defaultValue="trajectory" className="gap-4">
      <TabsList variant="pill">
        {kinds.map(({ value, label }) => (
          <TabsTrigger key={value} value={value} variant="pill">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {kinds.map(({ value }) => (
        <TabsContent key={value} value={value} className="grid items-start gap-4 xl:grid-cols-2">
          <FileCard name="tests.js" content={graders[value].tests} lang="javascript" wrap={false} />
          <FileCard name="prompt.md" content={graders[value].prompt} lang="markdown" wrap />
        </TabsContent>
      ))}
    </Tabs>
  );
}
