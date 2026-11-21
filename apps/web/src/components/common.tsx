import type { ReactNode } from 'react';
import { LIFECYCLE, type LifecycleStage } from '@corridor/core';
import { CheckCircle2, Inbox, type LucideIcon } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { toast } from 'sonner';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <section className="page-intro reveal">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </section>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
  bodyClassName = 'panel-body',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel reveal ${className}`}>
      {(title || actions) && (
        <div className="panel-header panel-heading-row">
          <div>
            {title && <div className="panel-title">{title}</div>}
            {subtitle && <div className="panel-subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'amber',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: 'amber' | 'teal' | 'red' | 'blue';
}) {
  return (
    <div className={`panel metric-card tone-${tone}`}>
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        <Icon size={16} className="metric-icon" />
      </div>
      <div className="metric-value">{value}</div>
      {hint && <div className="metric-meta">{hint}</div>}
    </div>
  );
}

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function EmptyState({
  title,
  detail,
  icon: Icon = Inbox,
}: {
  title: string;
  detail?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty-state">
      <Icon size={26} />
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}

export function Lifecycle({ stage, compact }: { stage: LifecycleStage; compact?: boolean }) {
  const index = LIFECYCLE.findIndex((s) => s.id === stage);
  return (
    <ol className={`lifecycle ${compact ? 'compact' : ''}`} aria-label="Corridor lifecycle">
      {LIFECYCLE.map((step, i) => (
        <li key={step.id} className={i < index ? 'done' : i === index ? 'current' : ''} title={step.detail}>
          <span className="lifecycle-dot">{i < index ? <CheckCircle2 size={12} /> : i + 1}</span>
          {!compact && (
            <span className="lifecycle-text">
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  detail,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  detail?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="preference-row"
      onClick={() => onChange(!on)}
      disabled={disabled}
      role="switch"
      aria-checked={on}
    >
      <span className={`preference-toggle ${on ? 'on' : ''}`}>
        <span />
      </span>
      <span className="text-left">
        <span className="block text-xs font-bold text-slate-200">{label}</span>
        {detail && <span className="block text-[11px] muted mt-0.5">{detail}</span>}
      </span>
    </button>
  );
}

export function Meter({ value, tone = 'teal' }: { value: number; tone?: 'teal' | 'amber' | 'red' | 'blue' }) {
  return (
    <div className="progress-track">
      <div className={`progress-fill ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

/** Show a toast for a failed API call. */
export function reportError(err: unknown, fallback = 'Request failed') {
  if (err instanceof ApiError) toast.error(err.message || fallback);
  else toast.error(fallback);
}

export function Loading({ label = 'Connecting to command centre…' }: { label?: string }) {
  return (
    <div className="loading-state">
      <span className="spinner" />
      {label}
    </div>
  );
}
