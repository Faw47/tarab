import { AlertTriangle, CheckCircle2, Info, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export type StatePanelTone = 'info' | 'success' | 'warning' | 'error' | 'loading';

export interface StatePanelAction {
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
}

export interface StatePanelProps {
  tone?: StatePanelTone;
  title: string;
  description?: ReactNode;
  action?: StatePanelAction;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: 'alert' | 'status';
}

const toneIcons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertTriangle,
  loading: LoaderCircle,
} as const;

export function StatePanel({
  tone = 'info',
  title,
  description,
  action,
  actions,
  children,
  className,
  role,
}: StatePanelProps) {
  const Icon = toneIcons[tone];
  const resolvedRole = role ?? (tone === 'error' ? 'alert' : 'status');

  return (
    <section
      className={cn('state-panel', 'state-panel--' + tone, className)}
      role={resolvedRole}
      aria-live={resolvedRole === 'alert' ? 'assertive' : 'polite'}
    >
      <span className="state-panel__icon" aria-hidden="true">
        <Icon className={cn('h-5 w-5', tone === 'loading' && 'animate-spin')} />
      </span>
      <div className="state-panel__content">
        <h2 className="state-panel__title">{title}</h2>
        {description ? <p className="state-panel__description">{description}</p> : null}
        {children}
      </div>
      {action ? (
        <Button
          type="button"
          size="sm"
          variant={tone === 'error' ? 'danger' : 'secondary'}
          onClick={() => void action.onClick()}
          disabled={action.disabled}
          className="state-panel__action"
        >
          {action.label}
        </Button>
      ) : null}
      {actions ? <div className="state-panel__actions">{actions}</div> : null}
    </section>
  );
}

StatePanel.displayName = 'StatePanel';
