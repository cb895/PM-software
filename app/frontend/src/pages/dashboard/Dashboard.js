import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, StatCard, Card, CardHeader, Button,
  POStatusBadge, Badge, LoadingState, EmptyState, ProgressBar
} from '../../components/ui/UI';
import { formatDate, formatCurrency } from '../../utils/format';
import toast from 'react-hot-toast';
import './Dashboard.css';

export default function Dashboard() {
  const { user, hasRole } = useAuth();
  const qc = useQueryClient();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/dashboard/stats').then(r => r.data),
  });

  const { data: recentPOs } = useQuery({
    queryKey: ['dashboard-recent-pos'],
    queryFn: () => api.get('/purchase-orders?limit=5&sort=created_at').then(r => r.data),
  });

  const { data: restockFlags } = useQuery({
    queryKey: ['dashboard-restock'],
    queryFn: () => api.get('/consumables/restock-flags').then(r => r.data),
  });

  const { data: missingLogs } = useQuery({
    queryKey: ['dashboard-missing-logs'],
    queryFn: () => api.get('/daily-logs/missing').then(r => r.data),
    enabled: hasRole('ops_manager'),
  });

  const invalidateMissing = () => {
    qc.invalidateQueries(['dashboard-missing-logs']);
    qc.invalidateQueries(['dashboard-stats']);
  };

  const excuseMutation = useMutation({
    mutationFn: ({ flagId, reason }) => api.post(`/daily-logs/missing/${flagId}/excuse`, { reason }),
    onSuccess: () => { toast.success('Missing log excused.'); invalidateMissing(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to excuse.'),
  });

  const deleteFlagMutation = useMutation({
    mutationFn: flagId => api.delete(`/daily-logs/missing/${flagId}`),
    onSuccess: () => { toast.success('Flag deleted.'); invalidateMissing(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to delete.'),
  });

  const clearBacklogMutation = useMutation({
    mutationFn: () => api.delete('/daily-logs/missing'),
    onSuccess: (res) => { toast.success(res.data.message); invalidateMissing(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to clear backlog.'),
  });

  const handleExcuse = flagId => {
    const reason = window.prompt('Reason for excusing this missed log (e.g. sick day, emergency leave):');
    if (reason === null) return; // cancelled
    excuseMutation.mutate({ flagId, reason: reason || null });
  };

  const handleClearBacklog = () => {
    if (window.confirm(`Permanently delete all ${missingLogs?.length ?? 0} unresolved missing-log flags? This cannot be undone.`)) {
      clearBacklogMutation.mutate();
    }
  };

  const { data: budgetSummary } = useQuery({
    queryKey: ['dashboard-budget'],
    queryFn: () => api.get('/budget/summary').then(r => r.data),
    enabled: hasRole('ops_manager', 'ceo'),
  });

  const { data: teamStatus } = useQuery({
    queryKey: ['team-status'],
    queryFn: () => api.get('/hr/status').then(r => r.data),
  });

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="dashboard">
      <PageHeader
        title={`${greeting()}, ${user?.full_name?.split(' ')[0]}`}
        subtitle={formatDate(new Date(), 'EEEE, MMMM d')}
      />

      {/* Stats row */}
      {statsLoading ? <LoadingState /> : (
        <div className="stats-row">
          <StatCard
            label="Open POs"
            value={stats?.open_pos ?? '—'}
            sub="awaiting action"
          />
          <StatCard
            label="Pending approval"
            value={stats?.pending_approval ?? '—'}
            sub="purchase requests"
            warning={stats?.pending_approval > 0}
          />
          <StatCard
            label="Restock flags"
            value={stats?.restock_flags ?? '—'}
            sub="items low on stock"
            warning={stats?.restock_flags > 0}
          />
          {hasRole('ops_manager', 'ceo') && (
            <StatCard
              label="Active projects"
              value={stats?.active_projects ?? '—'}
              sub="in progress"
              accent
            />
          )}
          {hasRole('ops_manager', 'ceo') && (
            <StatCard
              label="Missing logs"
              value={stats?.missing_logs ?? '—'}
              sub="from yesterday"
              danger={stats?.missing_logs > 0}
            />
          )}
        </div>
      )}

      <div className="dashboard-grid">
        {/* Recent purchase orders */}
        <Card className="dashboard-card">
          <CardHeader
            title="Recent purchase orders"
            action={<Link to="/purchase-orders" className="card-link">View all →</Link>}
          />
          {!recentPOs?.items?.length ? (
            <EmptyState title="No purchase orders yet" />
          ) : (
            <div className="po-list">
              {recentPOs.items.map(po => (
                <Link key={po.id} to={`/purchase-orders/${po.id}`} className="po-row">
                  <div className="po-row-left">
                    <span className="po-number">{po.po_number || `REQ-${po.id}`}</span>
                    <span className="po-supplier">{po.supplier_name}</span>
                  </div>
                  <div className="po-row-right">
                    <POStatusBadge status={po.status} />
                    <span className="po-date">{formatDate(po.created_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Restock flags */}
        <Card className="dashboard-card">
          <CardHeader
            title="Restock flags"
            action={<Link to="/consumables" className="card-link">Manage →</Link>}
          />
          {!restockFlags?.length ? (
            <EmptyState title="All stock levels OK" />
          ) : (
            <div className="restock-list">
              {restockFlags.slice(0, 6).map(item => (
                <div key={item.id} className="restock-row">
                  <div className="restock-info">
                    <span className="restock-name">{item.name}</span>
                    <span className="restock-supplier">{item.preferred_supplier || 'No supplier set'}</span>
                  </div>
                  <div className="restock-stock">
                    <span className="restock-qty">{item.current_stock} {item.unit}</span>
                    <Badge variant="warning">Low stock</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Budget overview — ops + CEO only */}
        {hasRole('ops_manager', 'ceo') && budgetSummary && (
          <Card className="dashboard-card dashboard-card--wide">
            <CardHeader
              title="Budget overview"
              action={<Link to="/budget" className="card-link">Full report →</Link>}
            />
            <div className="budget-list">
              {budgetSummary.slice(0, 4).map(p => (
                <div key={p.project_id} className="budget-row">
                  <div className="budget-project">
                    <span className="budget-code">{p.project_code}</span>
                    <span className="budget-name">{p.project_name}</span>
                  </div>
                  <div className="budget-bar">
                    <ProgressBar value={p.pct_spent} warning={p.budget_alert_threshold} />
                    <div className="budget-amounts">
                      <span>{formatCurrency(p.total_spent)}</span>
                      <span className="text-muted">of {formatCurrency(p.budget_allocated)} target</span>
                    </div>
                  </div>
                  {p.alert_triggered && <Badge variant="warning">{p.pct_spent}%</Badge>}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Team status */}
      <Card>
        <CardHeader title="Team status today" />
        <div style={{ padding: '0 0 4px', display: 'flex', flexWrap: 'wrap', gap: '0' }}>
          {(teamStatus || []).map(m => (
            <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid var(--border)', width: '50%', minWidth: '200px' }}>
              <div style={{
                width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                background: m.status === 'in_office' ? 'var(--accent)' : m.status === 'remote' ? 'var(--info)' : m.status === 'sick' ? 'var(--danger)' : 'var(--text-muted)',
              }} />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500 }}>{m.full_name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{m.status?.replace(/_/g, ' ') || 'Unknown'}</div>
              </div>
            </div>
          ))}
          {!teamStatus?.length && (
            <div style={{ padding: '14px 16px', fontSize: '12px', color: 'var(--text-muted)' }}>No status data available</div>
          )}
        </div>
      </Card>

      {/* Missing logs — ops only */}
        {hasRole('ops_manager') && (
          <Card className="dashboard-card">
            <CardHeader
              title="Missing logs"
              action={missingLogs?.length > 0 && (
                <Button variant="ghost" size="sm" loading={clearBacklogMutation.isPending} onClick={handleClearBacklog}>
                  Clear all
                </Button>
              )}
            />
            {!missingLogs?.length ? (
              <EmptyState title="All logs submitted" />
            ) : (
              <div className="missing-list">
                {missingLogs.map(m => (
                  <div key={m.flag_id} className="missing-row">
                    <span className="missing-name">{m.full_name} — {formatDate(m.missing_date)}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Badge variant="danger">Not submitted</Badge>
                      <Button
                        variant="ghost" size="sm"
                        loading={excuseMutation.isPending && excuseMutation.variables?.flagId === m.flag_id}
                        onClick={() => handleExcuse(m.flag_id)}
                      >
                        Excuse
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        loading={deleteFlagMutation.isPending && deleteFlagMutation.variables === m.flag_id}
                        onClick={() => deleteFlagMutation.mutate(m.flag_id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
