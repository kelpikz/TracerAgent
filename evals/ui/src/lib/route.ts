/** The page in the URL hash: `#/<case>/<run>`, `#/benchmarks`, `#/benchmarks/new` or `#/benchmarks/<id>`. */
export type Route =
  | { mode: 'cases'; caseId: string | null; runId: string | null }
  | { mode: 'benchmarks'; benchmarkId: string | null };

export function readRoute(): Route {
  const [first, second] = location.hash.replace(/^#\/?/, '').split('/').map(part => (part ? decodeURIComponent(part) : null));
  if (first === 'benchmarks') return { mode: 'benchmarks', benchmarkId: second ?? null };
  return { mode: 'cases', caseId: first ?? null, runId: second ?? null };
}

export function writeRoute(route: Route) {
  const parts = route.mode === 'benchmarks' ? ['benchmarks', route.benchmarkId] : [route.caseId, route.runId];
  const path = parts.filter((part): part is string => Boolean(part)).map(encodeURIComponent).join('/');
  try {
    history.replaceState(null, '', `${location.pathname}${path ? `#/${path}` : ''}`);
  } catch {
    // The URL cannot change. Do nothing.
  }
}
