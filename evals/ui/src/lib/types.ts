export type Status = 'done' | 'running' | 'error' | 'skipped' | 'missing' | 'pending';
export type GraderKind = 'trajectory' | 'outcome';

export interface AgentInfo {
  name?: string | null;
  model?: string | null;
}

export interface RunSummary {
  run_id: string;
  status: Status;
  started_at: string | null;
  ended_at: string | null;
  agent: AgentInfo | null;
  score_total?: number | null;
}

export interface CaseSummary {
  id: string;
  title: string;
  tags: string[];
  last_run: RunSummary | null;
}

export interface GraderFiles {
  tests: string | null;
  prompt: string | null;
}

export interface AffectedSystem {
  name: string;
  kind: 'service' | 'database' | 'job' | 'provider';
  impact: string;
}

export interface TelemetrySignal {
  source: 'metric' | 'log' | 'trace' | 'event' | 'alert' | 'order' | 'business';
  where: string;
  what: string;
  when: string;
  dashboard?: string;
}

export interface CaseInfo {
  failure: string;
  trigger: string;
  affected: AffectedSystem[];
  signals: TelemetrySignal[];
  expected: { root_cause: string; impact: string; next_steps: string };
}

export interface NoiseLabel {
  id: string;
  title: string;
  when: string;
  looks_like: string;
  example: string;
  truth: string;
  alerts: Array<{
    name: string;
    severity: string;
    fired_at: string;
    resolved_at: string | null;
    summary: string;
  }>;
}

export interface CaseDetail {
  id: string;
  title: string;
  description: string;
  scenario: string;
  noise: string[];
  input: string;
  tags: string[];
  timeout_s: number;
  info?: CaseInfo;
  labels: NoiseLabel[];
  graders: Record<GraderKind, GraderFiles>;
  runs: RunSummary[];
}

export interface ErrorInfo {
  message?: string;
  stack?: string;
  stop_details?: unknown;
}

export interface GradeItem {
  name: string;
  score?: number | null;
  reason?: string | null;
  error?: string | null;
}

export interface Grade {
  status: Status;
  items: GradeItem[];
  summary?: string | null;
  reason?: string | null;
  model?: string | null;
  thinking?: string | null;
  raw_output?: string | null;
  error: ErrorInfo | null;
}

/** A deep link in the dashboard, such as `#traces/<id>`. The nonce makes the frame load again. */
export interface DashboardLink {
  hash: string;
  nonce: number;
}

export interface ToolArgs {
  service?: string;
  db?: string;
  labels?: { service?: string; db?: string };
  [key: string]: unknown;
}

export interface Step {
  type?: string;
  role?: string;
  text?: string;
  id?: string;
  tool?: string;
  args?: ToolArgs;
  result?: unknown;
  error?: ErrorInfo | string | null;
  duration_ms?: number;
}

export interface Transcript {
  steps: Step[];
  final_output: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface JudgeChoice {
  model: string;
  thinking: string;
}

export interface AgentChoice {
  model: string;
  effort: string;
}

export interface JudgeOptions {
  default: JudgeChoice;
  agent_default: AgentChoice;
  models: string[];
  thinking: string[];
  error: string | null;
}

export interface ScorePart {
  score: number | null;
  max: number;
  deterministic: number | null;
  llm: number | null;
}

export interface Score {
  total: number | null;
  max: number;
  trajectory: ScorePart;
  outcome: ScorePart;
}

export interface Run extends RunSummary {
  case_id?: string;
  agent_settings?: AgentChoice;
  judge?: JudgeChoice;
  score?: Score;
  transcript: Transcript | null;
  graders?: Record<GraderKind, { deterministic: Grade; llm: Grade }>;
  error: ErrorInfo | null;
}
