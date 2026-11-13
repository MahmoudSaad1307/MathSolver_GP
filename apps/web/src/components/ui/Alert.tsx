import * as React from 'react';
import { cn } from '@/lib/utils';

type AlertTone = 'info' | 'warning' | 'danger' | 'success';

const alertTones: Record<AlertTone, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
};

export function Alert({
  tone = 'info',
  className,
  role = 'alert',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: AlertTone }) {
  return (
    <div
      role={role}
      className={cn('rounded-lg border p-3.5 text-sm leading-relaxed', alertTones[tone], className)}
      {...props}
    />
  );
}
