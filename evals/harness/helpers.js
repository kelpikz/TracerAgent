function matches(call, name, argsMatcher) {
  if (call?.type !== 'tool_call' || (name !== undefined && call.tool !== name)) return false;
  if (typeof argsMatcher === 'function') return argsMatcher(call.args ?? {}, call);
  return Object.entries(argsMatcher ?? {}).every(([key, value]) => call.args?.[key] === value);
}

export function toolCalls(transcript, name) {
  return transcript.steps.filter(call => matches(call, name));
}

export function indexOfTool(transcript, name, argsMatcher) {
  return transcript.steps.findIndex(call => matches(call, name, argsMatcher));
}

export function calledTool(transcript, name, argsMatcher) {
  return indexOfTool(transcript, name, argsMatcher) !== -1;
}

export function calledBefore(transcript, a, b) {
  const first = indexOfTool(transcript, a);
  return first !== -1 && transcript.steps.slice(first + 1).some(call => matches(call, b));
}

export function servicesTouched(transcript) {
  const services = toolCalls(transcript)
    .map(call => call.args?.service ?? call.args?.labels?.service)
    .filter(service => typeof service === 'string');
  return [...new Set(services)];
}

export function finalText(transcript) {
  return transcript.final_output;
}

export function mentions(text, ...patterns) {
  return patterns.every(pattern => {
    if (pattern instanceof RegExp) {
      const flags = pattern.flags.replace(/[gy]/g, '');
      return new RegExp(pattern.source, flags.includes('i') ? flags : `${flags}i`).test(text);
    }
    return text.toLowerCase().includes(pattern.toLowerCase());
  });
}
