import type { HighlighterCore } from 'shiki/core';

export type Lang = 'json' | 'javascript' | 'markdown' | 'text';

let promise: Promise<HighlighterCore> | undefined;

function load() {
  promise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
      langs: [import('shiki/langs/json.mjs'), import('shiki/langs/javascript.mjs'), import('shiki/langs/markdown.mjs')],
    });
  })();
  return promise;
}

const cache = new Map<string, string>();
export const MAX_HIGHLIGHT_CHARS = 250_000;

export async function highlight(code: string, lang: Lang): Promise<string | null> {
  if (lang === 'text' || code.length > MAX_HIGHLIGHT_CHARS) return null;
  const key = `${lang}:${code.length}:${code.slice(0, 200)}:${code.slice(-200)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const highlighter = await load();
  const html = highlighter.codeToHtml(code, {
    lang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });
  if (cache.size > 60) cache.clear();
  cache.set(key, html);
  return html;
}
