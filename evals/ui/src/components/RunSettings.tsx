import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { useAgent } from '@/lib/useAgent';
import { judgeLabel, type useJudge } from '@/lib/useJudge';

export interface RunSettingsProps {
  agent: ReturnType<typeof useAgent>;
  judge: ReturnType<typeof useJudge>;
  disabled?: boolean;
}

interface SettingSelectProps {
  id: string;
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}

function SettingSelect({ id, label, value, values, onChange }: SettingSelectProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} title={value} className="w-full font-mono text-[13px]">
          <SelectValue asChild>
            <span className="min-w-0 truncate">{value}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-w-[var(--radix-select-content-available-width)]">
          {values.map(option => (
            <SelectItem key={option} value={option} className="font-mono text-[13px] whitespace-normal [overflow-wrap:anywhere]">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function RunSettings({ agent, judge, disabled }: RunSettingsProps) {
  const { options, error } = judge;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled} className="h-auto min-h-9 max-w-full py-1.5 text-left">
          <Settings2 className="text-muted-foreground" />
          <span className="min-w-0">
            <span className="block">Run settings</span>
            {agent.choice && (
              <span className="block truncate text-xs text-muted-foreground">
                Agent {agent.choice.model.split('/').pop()} · {agent.choice.effort}
              </span>
            )}
            {judge.choice && (
              <span className="block truncate text-xs text-muted-foreground">Judge {judgeLabel(judge.choice)}</span>
            )}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Run settings" collisionPadding={12} className="max-h-[var(--radix-popover-content-available-height)] space-y-4 overflow-y-auto">
        <fieldset className="min-w-0 space-y-3">
          <legend className="text-sm font-semibold">Agent</legend>
          <p className="text-[13px] text-muted-foreground">The model that investigates the case.</p>
          {options && agent.choice ? (
            <>
              <SettingSelect id="agent-model" label="Model" value={agent.choice.model} values={agent.models} onChange={model => agent.change({ model })} />
              <SettingSelect id="agent-effort" label="Effort" value={agent.choice.effort} values={options.thinking} onChange={effort => agent.change({ effort })} />
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">The run uses the default agent settings.</p>
          )}
        </fieldset>

        <div className="border-t pt-4">
          <fieldset className="min-w-0 space-y-3">
            <legend className="text-sm font-semibold">Judge</legend>
            <p className="text-[13px] text-muted-foreground">The model that scores the run.</p>
            {options && judge.choice ? (
              <>
                <SettingSelect id="judge-model" label="Model" value={judge.choice.model} values={options.models} onChange={model => judge.change({ model })} />
                <SettingSelect id="judge-effort" label="Effort" value={judge.choice.thinking} values={options.thinking} onChange={thinking => judge.change({ thinking })} />
              </>
            ) : (
              <p className="rounded-md border border-dashed bg-muted/40 p-3 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
                {error ?? (options ? 'No models found.' : 'Loading the options…')}{' '}
                {(error || options) && 'The run uses the default judge.'}
              </p>
            )}
          </fieldset>
        </div>
      </PopoverContent>
    </Popover>
  );
}
