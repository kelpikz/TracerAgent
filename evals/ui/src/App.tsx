import { Braces, ChartLine, CircleAlert, FileCode2, FlaskConical, Info, LayoutDashboard, ListChecks, Menu, MessagesSquare, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BenchmarkList } from '@/components/benchmark/BenchmarkList';
import { BenchmarkView } from '@/components/benchmark/BenchmarkView';
import { NewBenchmark } from '@/components/benchmark/NewBenchmark';
import { CaseHeader } from '@/components/CaseHeader';
import { CaseInput } from '@/components/CaseInput';
import { DashboardTab } from '@/components/DashboardTab';
import { EmptyState } from '@/components/EmptyState';
import { GraderFilesTab } from '@/components/GraderFilesTab';
import { InfoTab } from '@/components/InfoTab';
import { RawJsonTab } from '@/components/RawJsonTab';
import { ResultsTab } from '@/components/ResultsTab';
import { RunHistory } from '@/components/RunHistory';
import { Logo, SidebarContent, type Mode } from '@/components/Sidebar';
import { TranscriptTab } from '@/components/TranscriptTab';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DashboardLink } from '@/lib/types';
import { readRoute, writeRoute } from '@/lib/route';
import { cn } from '@/lib/utils';
import { useAgent } from '@/lib/useAgent';
import { useBenchmarks } from '@/lib/useBenchmarks';
import { useEvals } from '@/lib/useEvals';
import { useJudge } from '@/lib/useJudge';

const startRoute = readRoute();

export default function App() {
  const evals = useEvals();
  const { cases, casesError, caseId, detail, runId, run, runLoading, notice, running } = evals;
  const [mode, setMode] = useState<Mode>(startRoute.mode);
  // A benchmark ID, "new" for the setup page, or null before the list loads.
  const [benchmarkId, setBenchmarkId] = useState<string | null>(startRoute.mode === 'benchmarks' ? startRoute.benchmarkId : null);
  const benchmarks = useBenchmarks(mode === 'benchmarks', benchmarkId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [chosenTab, setTab] = useState<string | null>(null);
  const [dashLink, setDashLink] = useState<DashboardLink | null>(null);
  const dashboardPanel = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(false);
  const judge = useJudge();
  const agent = useAgent(judge.options);
  const startRun = () => void evals.startRun(judge.choice, agent.choice);

  // Each case starts on its default tab, with the dashboard on its own page.
  useEffect(() => {
    setTab(null);
    setDashLink(null);
  }, [caseId]);

  // The URL shows the open page, so a reload opens it again.
  useEffect(() => {
    if (mode === 'benchmarks') writeRoute({ mode, benchmarkId });
    else if (caseId) writeRoute({ mode, caseId, runId });
  }, [mode, benchmarkId, caseId, runId]);

  // The first visit to a mode opens its newest item.
  const firstCase = cases?.[0]?.id;
  const firstBenchmark = benchmarks.list ? benchmarks.list[0]?.id ?? '' : null;
  useEffect(() => {
    if (mode === 'cases' && !caseId && firstCase) evals.openCase(firstCase);
    if (mode === 'benchmarks' && benchmarkId === null && firstBenchmark) setBenchmarkId(firstBenchmark);
  }, [mode, caseId, firstCase, benchmarkId, firstBenchmark, evals]);

  const openRun = (forCase: string, forRun: string) => {
    setMode('cases');
    evals.openRun(forCase, forRun);
  };

  useEffect(() => {
    if (dashLink) {
      dashboardPanel.current?.focus({ preventScroll: true });
      dashboardPanel.current?.scrollIntoView({ block: 'start' });
    }
  }, [dashLink]);

  const hasRuns = (detail?.runs.length ?? 0) > 0;
  const defaultTab = detail && !hasRuns ? (detail.info ? 'info' : 'dashboard') : 'results';
  const tab = chosenTab ?? defaultTab;
  const showSplit = split && tab === 'dashboard';
  const openDashboard = (hash: string) => {
    setDashLink(link => ({ hash, nonce: (link?.nonce ?? 0) + 1 }));
    setTab('dashboard');
  };

  const sidebar = (afterSelect?: () => void) => (
    <SidebarContent
      cases={cases}
      error={casesError}
      selectedId={caseId}
      onSelect={id => {
        evals.openCase(id);
        afterSelect?.();
      }}
      mode={mode}
      onModeChange={setMode}
      benchmarks={(
        <BenchmarkList
          list={benchmarks.list}
          error={benchmarks.listError}
          selectedId={benchmarkId}
          onSelect={id => {
            setBenchmarkId(id);
            afterSelect?.();
          }}
        />
      )}
    />
  );

  const runHistory = (afterSelect?: () => void) => (
    <RunHistory
      runs={detail?.runs ?? null}
      runId={runId}
      onSelect={id => {
        evals.selectRun(id);
        afterSelect?.();
      }}
    />
  );

  const steps = run?.transcript?.steps.length;

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 border-r bg-sidebar lg:block">{sidebar()}</aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Choose a test case or a benchmark.</SheetDescription>
          {sidebar(() => setMenuOpen(false))}
        </SheetContent>
      </Sheet>

      <Sheet open={runsOpen} onOpenChange={setRunsOpen}>
        <SheetContent side="right">
          <SheetTitle className="sr-only">Runs</SheetTitle>
          <SheetDescription className="sr-only">Choose a run.</SheetDescription>
          {runHistory(() => setRunsOpen(false))}
        </SheetContent>
      </Sheet>

      <div className="relative min-w-0 flex-1">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-72 [background:radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklab,var(--brand)_9%,transparent),transparent)]"
        />

        <div className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/80 px-4 py-2.5 backdrop-blur lg:hidden">
          <Button variant="ghost" size="icon-sm" onClick={() => setMenuOpen(true)} aria-label="Open the menu">
            <Menu />
          </Button>
          <Logo className="size-6 rounded-md" />
          <span className="truncate text-sm font-semibold tracking-tight">TracerAgent Evals</span>
        </div>

        <main className={cn("relative mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-10", showSplit && "min-[1400px]:max-w-none")}>
          {notice && (
            <Alert variant="destructive" className="fade-up">
              <CircleAlert />
              <AlertDescription className="flex items-start justify-between gap-3">
                <span>{notice}</span>
                <button type="button" onClick={evals.dismissNotice} aria-label="Dismiss" className="-mt-0.5 rounded p-0.5 opacity-70 hover:opacity-100">
                  <X className="size-4" />
                </button>
              </AlertDescription>
            </Alert>
          )}

          {mode === 'benchmarks' ? (
            benchmarkId === 'new' ? (
              <NewBenchmark
                options={judge.options}
                models={agent.models}
                judge={judge.choice}
                cases={cases}
                onCancel={() => setBenchmarkId(benchmarks.list?.[0]?.id ?? null)}
                onCreate={async config => setBenchmarkId(await benchmarks.create(config))}
              />
            ) : benchmarks.detail ? (
              <BenchmarkView
                benchmark={benchmarks.detail}
                onAction={action => benchmarks.act(benchmarks.detail!.id, action)}
                onOpenRun={openRun}
              />
            ) : benchmarks.detailError ? (
              <EmptyState icon={CircleAlert} title="Cannot load the benchmark">{benchmarks.detailError}</EmptyState>
            ) : benchmarks.list?.length === 0 && !benchmarkId ? (
              <EmptyState
                icon={ChartLine}
                title="No benchmarks yet"
                action={<Button onClick={() => setBenchmarkId('new')}><Plus /> New benchmark</Button>}
              >
                A benchmark runs each model, architecture and effort on the cases, and compares the scores.
              </EmptyState>
            ) : (
              <Skeleton className="h-96 w-full rounded-xl" />
            )
          ) : (
          <>
          {cases && cases.length === 0 && (
            <EmptyState icon={FlaskConical} title="No test cases">
              Add a folder with a case.json file in evals/cases.
            </EmptyState>
          )}

          {casesError && !cases && (
            <EmptyState icon={CircleAlert} title="Cannot load the cases">
              {casesError}
            </EmptyState>
          )}

          {(caseId || (!cases && !casesError)) && (
            <div className="space-y-6">
              <CaseHeader detail={detail} running={running} settings={{ agent, judge }} onRun={startRun} onOpenRuns={() => setRunsOpen(true)} />
              {detail ? <CaseInput input={detail.input} /> : <Skeleton className="h-36 w-full rounded-xl" />}

              <Tabs value={tab} onValueChange={setTab} className="gap-6">
                <TabsList>
                  <TabsTrigger value="info">
                    <Info /> Info
                  </TabsTrigger>
                  <TabsTrigger value="dashboard">
                    <LayoutDashboard /> Dashboard
                  </TabsTrigger>
                  <TabsTrigger value="results">
                    <ListChecks /> Results
                  </TabsTrigger>
                  <TabsTrigger value="transcript">
                    <MessagesSquare /> Transcript
                    {steps ? <span className="rounded-full bg-muted px-1.5 text-[11px] leading-5 tabular-nums">{steps}</span> : null}
                  </TabsTrigger>
                  <TabsTrigger value="files">
                    <FileCode2 /> Grader files
                  </TabsTrigger>
                  <TabsTrigger value="json">
                    <Braces /> Raw JSON
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="info">
                  {detail ? <InfoTab info={detail.info} labels={detail.labels} onOpenDashboard={openDashboard} /> : <Skeleton className="h-80 w-full rounded-xl" />}
                </TabsContent>
                {/* The dashboard stays mounted, so it does not load again when you change tabs. */}
                <TabsContent value="dashboard" forceMount ref={dashboardPanel} className="scroll-mt-16 data-[state=inactive]:hidden lg:scroll-mt-6">
                  {detail ? (
                    <div className={cn('grid gap-6', showSplit && 'min-[1400px]:grid-cols-[minmax(0,1fr)_26rem]')}>
                      <DashboardTab scenario={detail.scenario} noise={detail.noise} link={dashLink} split={split} onSplit={setSplit} />
                      {showSplit && (
                        <aside className="hidden min-w-0 min-[1400px]:block">
                          <div className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto pr-1">
                            <ResultsTab run={run} loading={runLoading} hasRuns={hasRuns} onRun={startRun} running={running} />
                          </div>
                        </aside>
                      )}
                    </div>
                  ) : (
                    <Skeleton className="h-96 w-full rounded-xl" />
                  )}
                </TabsContent>
                <TabsContent value="results">
                  <ResultsTab run={run} loading={runLoading || !detail} hasRuns={hasRuns} onRun={startRun} running={running} />
                </TabsContent>
                <TabsContent value="transcript">
                  <TranscriptTab run={run} onOpenDashboard={openDashboard} />
                </TabsContent>
                <TabsContent value="files">
                  {detail ? <GraderFilesTab graders={detail.graders} /> : <Skeleton className="h-80 w-full rounded-xl" />}
                </TabsContent>
                <TabsContent value="json">
                  <RawJsonTab run={run} />
                </TabsContent>
              </Tabs>
            </div>
          )}
          </>
          )}
        </main>
      </div>

      {mode === 'cases' && caseId && <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 border-l bg-sidebar xl:block">{runHistory()}</aside>}
    </div>
  );
}
