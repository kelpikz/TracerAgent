import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  dashed = true,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  dashed?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-xl border bg-card/50 px-6 py-12 text-center',
        dashed && 'border-dashed',
        className,
      )}
    >
      <div className="mb-2 grid size-10 place-items-center rounded-full border bg-card text-muted-foreground shadow-xs">
        <Icon className="size-[18px]" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="max-w-sm text-[13px] text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
