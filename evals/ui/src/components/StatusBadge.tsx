import { CircleAlert, CircleCheck, CircleDashed, CircleSlash, Clock, LoaderCircle, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { statusLabels } from '@/lib/format';
import type { Status } from '@/lib/types';
import { cn } from '@/lib/utils';

type Variant = 'success' | 'info' | 'destructive' | 'muted' | 'warning';

const config: Record<Status | 'none', { variant: Variant; icon: LucideIcon; spin?: boolean; dashed?: boolean }> = {
  done: { variant: 'success', icon: CircleCheck },
  running: { variant: 'info', icon: LoaderCircle, spin: true },
  error: { variant: 'destructive', icon: CircleAlert },
  interrupted: { variant: 'warning', icon: CircleAlert },
  skipped: { variant: 'muted', icon: CircleSlash },
  missing: { variant: 'muted', icon: CircleDashed, dashed: true },
  pending: { variant: 'muted', icon: Clock },
  none: { variant: 'muted', icon: CircleDashed, dashed: true },
};

export function StatusBadge({ status, label, className }: { status: Status | 'none'; label?: string; className?: string }) {
  const { variant, icon: Icon, spin, dashed } = config[status] ?? config.none;
  return (
    <Badge
      variant={variant}
      className={cn(dashed && 'border-dashed border-border bg-transparent', className)}
    >
      <Icon className={cn(spin && 'animate-spin')} />
      {label ?? statusLabels[status] ?? status}
    </Badge>
  );
}
