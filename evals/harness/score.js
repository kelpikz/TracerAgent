import { graderKinds } from './storage.js';

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function partAverage(grade) {
  if (grade?.status !== 'done') return null;
  return average((grade.items ?? []).map(item => item.score).filter(Number.isFinite));
}

function round(value) {
  return value === null ? null : Math.round((value + Number.EPSILON) * 100) / 100;
}

function scoreGrader(grader) {
  const deterministic = partAverage(grader?.deterministic);
  const llm = partAverage(grader?.llm);
  const avg = average([deterministic, llm].filter(value => value !== null));
  return {
    score: avg === null ? null : round(5 * avg),
    max: 5,
    deterministic: round(deterministic),
    llm: round(llm),
  };
}

export function scoreRun(run) {
  const graders = Object.fromEntries(graderKinds.map(kind => [kind, scoreGrader(run.graders?.[kind])]));
  const { trajectory, outcome } = graders;
  const total = trajectory.score === null || outcome.score === null
    ? null : round(trajectory.score + outcome.score);
  return { total, max: 10, ...graders };
}
