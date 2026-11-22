import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AgentChoice, Architecture, RoleChoice } from '@/lib/types';

/** The select value for "use the run setting". Radix Select does not allow an empty value. */
const RUN = '__run__';

interface AgentModelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  architecture: Architecture;
  choice: AgentChoice;
  models: string[];
  efforts: string[];
  onSave: (agents: Record<string, RoleChoice>) => void;
}

function shortModel(model: string) {
  return model.split('/').pop() ?? model;
}

interface RoleSelectProps {
  id: string;
  label: string;
  value: string | undefined;
  runValue: string;
  values: string[];
  format?: (value: string) => string;
  onChange: (value: string | undefined) => void;
}

function RoleSelect({ id, label, value, runValue, values, format = v => v, onChange }: RoleSelectProps) {
  const shown = value ?? RUN;
  return (
    <Select value={shown} onValueChange={next => onChange(next === RUN ? undefined : next)}>
      <SelectTrigger id={id} aria-label={label} title={value ?? `Same as run: ${runValue}`} className="w-full font-mono text-[13px]">
        <SelectValue asChild>
          <span className={value ? 'min-w-0 truncate' : 'min-w-0 truncate text-muted-foreground'}>
            {value ? format(value) : `Run · ${format(runValue)}`}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-w-[var(--radix-select-content-available-width)]">
        <SelectItem value={RUN} className="text-[13px]">
          Same as run <span className="font-mono text-muted-foreground">({format(runValue)})</span>
        </SelectItem>
        {values.map(option => (
          <SelectItem key={option} value={option} className="font-mono text-[13px] whitespace-normal [overflow-wrap:anywhere]">
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Editor({ architecture, choice, models, efforts, onSave, onClose }: Omit<AgentModelsDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [draft, setDraft] = useState<Record<string, RoleChoice>>(() =>
    Object.fromEntries(architecture.roles.map(role => [role.name, { ...choice.agents?.[role.name] }])));
  const set = (role: string, patch: RoleChoice) =>
    setDraft(current => ({ ...current, [role]: { ...current[role], ...patch } }));
  const changed = Object.values(draft).filter(c => c.model || c.effort).length;

  return (
    <>
      <div className="border-b px-5 py-4 pr-12">
        <DialogTitle className="text-base font-semibold">Agent models</DialogTitle>
        <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
          Select the model and effort for each agent of the <span className="font-mono">{architecture.name}</span> architecture.
          "Same as run" uses the run setting: <span className="font-mono">{shortModel(choice.model)}</span> · {choice.effort}.
        </DialogDescription>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5">
        <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,14rem)_minmax(0,8.5rem)] gap-3 pt-3 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase sm:grid">
          <span>Agent</span><span>Model</span><span>Effort</span>
        </div>
        <ul className="divide-y">
          {architecture.roles.map(role => (
            <li key={role.name} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_minmax(0,8.5rem)] sm:items-center sm:gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium capitalize">{role.name}</p>
                <p className="text-[13px] text-muted-foreground">{role.description}</p>
              </div>
              <RoleSelect
                id={`role-${role.name}-model`}
                label={`${role.name} model`}
                value={draft[role.name]?.model}
                runValue={choice.model}
                values={models}
                format={shortModel}
                onChange={model => set(role.name, { model })}
              />
              <RoleSelect
                id={`role-${role.name}-effort`}
                label={`${role.name} effort`}
                value={draft[role.name]?.effort}
                runValue={choice.effort}
                values={efforts}
                onChange={effort => set(role.name, { effort })}
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
        <Button
          variant="ghost"
          disabled={changed === 0}
          onClick={() => setDraft(Object.fromEntries(architecture.roles.map(role => [role.name, {}])))}
        >
          Use run settings for all
        </Button>
        <span className="ml-auto" />
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => { onSave(draft); onClose(); }}>Save</Button>
      </div>
    </>
  );
}

export function AgentModelsDialog({ open, onOpenChange, ...props }: AgentModelsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so each open starts from the saved choice. */}
        {open && <Editor {...props} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
