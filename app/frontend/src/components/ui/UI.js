import React from 'react';
import clsx from 'clsx';
import './UI.css';

/* ---- Card ---- */
export function Card({ children, className, padding = true }) {
  return (
    <div className={clsx('card', padding && 'card--padded', className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="card-header">
      <div className="card-header-text">
        <h3 className="card-title">{title}</h3>
        {subtitle && <p className="card-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="card-header-action">{action}</div>}
    </div>
  );
}

/* ---- Badge ---- */
const BADGE_VARIANTS = {
  default:  'badge--default',
  accent:   'badge--accent',
  success:  'badge--success',
  warning:  'badge--warning',
  danger:   'badge--danger',
  info:     'badge--info',
  muted:    'badge--muted',
};

export function Badge({ children, variant = 'default', className }) {
  return (
    <span className={clsx('badge', BADGE_VARIANTS[variant], className)}>
      {children}
    </span>
  );
}

/* PO status → badge variant mapping */
export function POStatusBadge({ status }) {
  const map = {
    pending:    { variant: 'muted',   label: 'Pending' },
    rejected:   { variant: 'danger',  label: 'Rejected' },
    new_order:  { variant: 'info',    label: 'New order' },
    emailed:    { variant: 'info',    label: 'Emailed' },
    in_progress:{ variant: 'accent',  label: 'In progress' },
    stuck:      { variant: 'warning', label: 'Stuck' },
    received:   { variant: 'success', label: 'Received' },
    invoiced:   { variant: 'warning', label: 'Invoiced' },
    closed:     { variant: 'muted',   label: 'Closed' },
  };
  const { variant, label } = map[status] || { variant: 'default', label: status };
  return <Badge variant={variant}>{label}</Badge>;
}

export function RiskBadge({ level }) {
  const map = {
    low:      'success',
    medium:   'warning',
    high:     'danger',
    critical: 'danger',
  };
  return <Badge variant={map[level] || 'default'}>{level}</Badge>;
}

export function PriorityBadge({ priority }) {
  const map = {
    low:      'muted',
    normal:   'info',
    high:     'warning',
    critical: 'danger',
  };
  return <Badge variant={map[priority] || 'default'}>{priority}</Badge>;
}

/* ---- Button ---- */
export function Button({
  children, onClick, type = 'button', variant = 'primary',
  size = 'md', disabled, loading, className, ...props
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={clsx('btn', `btn--${variant}`, `btn--${size}`, loading && 'btn--loading', className)}
      {...props}
    >
      {loading && <span className="btn-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

/* ---- Input ---- */
export function Input({ label, error, hint, className, ...props }) {
  return (
    <div className={clsx('field', className)}>
      {label && <label className="field-label">{label}</label>}
      <input className={clsx('field-input', error && 'field-input--error')} {...props} />
      {error && <span className="field-error">{error}</span>}
      {hint && !error && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Textarea({ label, error, hint, className, ...props }) {
  return (
    <div className={clsx('field', className)}>
      {label && <label className="field-label">{label}</label>}
      <textarea className={clsx('field-input field-textarea', error && 'field-input--error')} {...props} />
      {error && <span className="field-error">{error}</span>}
      {hint && !error && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/* ---- Page header ---- */
export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </div>
  );
}

/* ---- Stat card ---- */
export function StatCard({ label, value, sub, accent, warning, danger }) {
  return (
    <div className={clsx('stat-card',
      accent  && 'stat-card--accent',
      warning && 'stat-card--warning',
      danger  && 'stat-card--danger',
    )}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/* ---- Empty state ---- */
export function EmptyState({ title, description, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">◎</div>
      <h3 className="empty-title">{title}</h3>
      {description && <p className="empty-desc">{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/* ---- Loading state ---- */
export function LoadingState({ message = 'Loading…' }) {
  return (
    <div className="loading-state">
      <span className="spinner" aria-hidden="true" />
      <span className="loading-msg">{message}</span>
    </div>
  );
}

/* ---- Table ---- */
export function Table({ children, className }) {
  return (
    <div className="table-wrap">
      <table className={clsx('table', className)}>{children}</table>
    </div>
  );
}

export function Th({ children, className }) {
  return <th className={clsx('table-th', className)}>{children}</th>;
}

export function Td({ children, className }) {
  return <td className={clsx('table-td', className)}>{children}</td>;
}

/* ---- Progress bar ---- */
export function ProgressBar({ value, max = 100, warning = 80, danger = 100 }) {
  const pct = Math.min((value / max) * 100, 100);
  const variant = pct >= danger ? 'danger' : pct >= warning ? 'warning' : 'accent';
  return (
    <div className="progress-track" title={`${pct.toFixed(1)}%`}>
      <div className={`progress-fill progress-fill--${variant}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ---- Modal ---- */
export function Modal({ open, onClose, title, children, size = 'md' }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={clsx('modal', `modal--${size}`)}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <h2 id="modal-title" className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
