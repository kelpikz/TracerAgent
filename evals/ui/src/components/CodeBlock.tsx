import { useEffect, useMemo, useState } from 'react';
import { highlight, type Lang } from '@/lib/highlight';
import { cn } from '@/lib/utils';

interface CodeBlockProps {
  code: string;
  lang?: Lang;
  numbers?: boolean;
  wrap?: boolean;
  /** No border, background or radius. Use inside a card. */
  bare?: boolean;
  maxHeight?: string;
  className?: string;
}

export function CodeBlock({ code, lang = 'text', numbers = true, wrap = false, bare = false, maxHeight = '28rem', className }: CodeBlockProps) {
  const [html, setHtml] = useState<{ code: string; lang: Lang; html: string } | null>(null);

  useEffect(() => {
    let live = true;
    highlight(code, lang)
      .then(result => {
        if (live && result) setHtml({ code, lang, html: result });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [code, lang]);

  const ready = html && html.code === code && html.lang === lang ? html.html : null;
  const lines = useMemo(() => (ready ? [] : code.split('\n')), [ready, code]);

  return (
    <div
      className={cn('code-block min-w-0 overflow-auto', !bare && 'rounded-lg border bg-code', className)}
      data-wrap={wrap}
      data-numbers={numbers}
      style={{ maxHeight }}
    >
      {ready ? (
        <div dangerouslySetInnerHTML={{ __html: ready }} />
      ) : (
        <pre className="plain text-foreground/90">
          <code>
            {lines.map((line, index) => (
              <span key={index}>
                <span className="line">{line}</span>
                {'\n'}
              </span>
            ))}
          </code>
        </pre>
      )}
    </div>
  );
}
