import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Routes, Route, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, Card, CardHeader, Button, Input,
  Badge, Table, Th, Td, EmptyState, LoadingState,
  StatCard, ProgressBar, Modal, Textarea
} from '../../components/ui/UI';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell
} from 'recharts';
import { formatDate, formatCurrency } from '../../utils/format';
import toast from 'react-hot-toast';
import './BudgetPage.css';

const ENTRY_COLORS = {
  labour:         'var(--accent)',
  consumable:     'var(--info)',
  purchase_order: 'var(--warning)',
};
const PIE_COLORS = ['#00e5a0', '#4a9eff', '#f5a623'];
const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'];
const CATEGORIES  = ['utilities', 'software', 'equipment', 'admin', 'facilities', 'insurance', 'other'];

function AlertBadge({ triggered }) {
  return triggered
    ? <Badge variant="warning">⚠ Alert</Badge>
    : <Badge variant="success">On track</Badge>;
}

/* ============================================================
   Budget Overview
   ============================================================ */
function BudgetOverview() {
  const { hasRole } = useAuth();
  const navigate    = useNavigate();
  const qc          = useQueryClient();

  const [activeTab,      setActiveTab]      = useState('projects');
  const [showSetBudget,  setShowSetBudget]  = useState(null);
  const [showAddEntry,   setShowAddEntry]   = useState(false);

  /* ── Queries ── */
  const { data: projects, isLoading: projLoading } = useQuery({
    queryKey: ['budget-summary'],
    queryFn:  () => api.get('/budget/summary').then(r => r.data),
  });

  const { data: phases } = useQuery({
    queryKey: ['phase-summary'],
    queryFn:  () => api.get('/budget/phases').then(r => r.data),
  });

  const { data: entries } = useQuery({
    queryKey: ['budget-entries'],
    queryFn:  () => api.get('/budget/entries?limit=200').then(r => r.data),
  });

  const { data: overhead, isLoading: overheadLoading } = useQuery({
    queryKey: ['overhead-expenses'],
    queryFn:  () => api.get('/budget/overhead').then(r => r.data),
    enabled:  hasRole('ops_manager', 'ceo'),
  });

  const { data: overheadEntries } = useQuery({
    queryKey: ['overhead-entries'],
    queryFn:  () => api.get('/budget/overhead/entries').then(r => r.data),
    enabled:  hasRole('ops_manager', 'ceo') && activeTab === 'overhead',
  });

  /* ── Mutations ── */
  const deleteOverheadMutation = useMutation({
    mutationFn: id => api.delete(`/budget/overhead/${id}`),
    onSuccess:  ()  => { toast.success('Expense removed.'); qc.invalidateQueries(['overhead-expenses']); },
    onError:    ()  => toast.error('Failed to remove expense.'),
  });

  /* ── Derived data ── */
  const totals = useMemo(() => {
    if (!projects?.length) return {};
    return {
      allocated:  projects.reduce((s, p) => s + (p.budget_allocated || 0), 0),
      spent:      projects.reduce((s, p) => s + (p.total_spent      || 0), 0),
      labour:     projects.reduce((s, p) => s + (p.labour_cost      || 0), 0),
      consumable: projects.reduce((s, p) => s + (p.consumable_cost  || 0), 0),
      po:         projects.reduce((s, p) => s + (p.po_cost          || 0), 0),
      remaining:  projects.reduce((s, p) => s + (p.budget_remaining || 0), 0),
      alerts:     projects.filter(p => p.alert_triggered).length,
    };
  }, [projects]);

  const barData = useMemo(() =>
    (projects || []).map(p => ({
      name:              p.project_code,
      Labour:            parseFloat(p.labour_cost      || 0),
      Consumables:       parseFloat(p.consumable_cost  || 0),
      'Purchase orders': parseFloat(p.po_cost          || 0),
    })), [projects]);

  const pieData = [
    { name: 'Labour',          value: totals.labour      || 0 },
    { name: 'Consumables',     value: totals.consumable  || 0 },
    { name: 'Purchase orders', value: totals.po          || 0 },
  ].filter(d => d.value > 0);

  const lineData = useMemo(() => {
    const byDate = {};
    (entries || []).forEach(e => {
      const d = formatDate(e.entry_date, 'MMM d');
      if (!byDate[d]) byDate[d] = { date: d, Labour: 0, Consumables: 0, 'Purchase orders': 0 };
      if (e.entry_type === 'labour')         byDate[d].Labour            += parseFloat(e.amount || 0);
      if (e.entry_type === 'consumable')     byDate[d].Consumables       += parseFloat(e.amount || 0);
      if (e.entry_type === 'purchase_order') byDate[d]['Purchase orders'] += parseFloat(e.amount || 0);
    });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  }, [entries]);

  const TOOLTIP_STYLE = {
    contentStyle: { background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' },
    labelStyle:   { color: 'var(--text-secondary)' },
  };

  /* ── Tab nav ── */
  const tabs = [
    { id: 'projects', label: 'Projects' },
    { id: 'overhead', label: 'Overhead' },
    { id: 'expense',  label: '+ Add expense' },
  ];

  /* ── Render ── */
  return (
    <div>
      <PageHeader
        title="Budget tracker"
        subtitle="Project spend, overhead, and expense tracking"
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {tabs.map(t => (
              <Button key={t.id}
                variant={activeTab === t.id ? 'primary' : 'secondary'}
                onClick={() => setActiveTab(t.id)}>
                {t.label}
              </Button>
            ))}
          </div>
        }
      />

      {/* ── PROJECTS TAB ── */}
      {activeTab === 'projects' && (
        <>
          <div className="stats-row">
            <StatCard label="Total allocated" value={formatCurrency(totals.allocated)} />
            <StatCard label="Total spent"     value={formatCurrency(totals.spent)}
              warning={totals.allocated > 0 && totals.spent / totals.allocated > 0.8} />
            <StatCard label="Remaining"       value={formatCurrency(totals.remaining)}
              accent={totals.remaining > 0} danger={totals.remaining < 0} />
            <StatCard label="Budget alerts"   value={totals.alerts || 0}
              danger={totals.alerts > 0} sub="projects at threshold" />
          </div>

          {projLoading ? <LoadingState /> : (
            <>
              {/* Charts */}
              {barData.length > 0 && (
                <div className="charts-row">
                  <Card className="chart-card">
                    <CardHeader title="Spend by project" subtitle="Labour · Consumables · Purchase orders" />
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={barData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" opacity={0.4} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                          tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip {...TOOLTIP_STYLE} formatter={v => formatCurrency(v)} />
                        <Legend wrapperStyle={{ fontSize: '11px', color: 'var(--text-muted)' }} />
                        <Bar dataKey="Labour"          fill="#00e5a0" radius={[3,3,0,0]} />
                        <Bar dataKey="Consumables"     fill="#4a9eff" radius={[3,3,0,0]} />
                        <Bar dataKey="Purchase orders" fill="#f5a623" radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>

                  {pieData.length > 0 && (
                    <Card className="chart-card chart-card--sm">
                      <CardHeader title="Overall breakdown" />
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85}
                            paddingAngle={3} dataKey="value">
                            {pieData.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} opacity={0.85} />
                            ))}
                          </Pie>
                          <Tooltip {...TOOLTIP_STYLE} formatter={v => formatCurrency(v)} />
                          <Legend wrapperStyle={{ fontSize: '11px', color: 'var(--text-muted)' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </Card>
                  )}
                </div>
              )}

              {lineData.length > 1 && (
                <Card className="chart-card chart-card--full" style={{ marginBottom: '1.25rem' }}>
                  <CardHeader title="Daily spend — last 14 days" />
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={lineData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" opacity={0.4} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                        tickFormatter={v => `$${v.toFixed(0)}`} />
                      <Tooltip {...TOOLTIP_STYLE} formatter={v => formatCurrency(v)} />
                      <Line type="monotone" dataKey="Labour"          stroke="#00e5a0" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="Consumables"     stroke="#4a9eff" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="Purchase orders" stroke="#f5a623" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              )}

              {/* Project cards */}
              <h3 className="section-title">Projects</h3>
              {!projects?.length ? (
                <EmptyState title="No budget data yet"
                  description="Budget entries are auto-posted from daily logs, invoices, and consumable usage." />
              ) : (
                <div className="project-budget-grid">
                  {projects.map(p => (
                    <Card key={p.project_id} className={`project-budget-card ${p.alert_triggered ? 'budget-alert' : ''}`}>
                      <div className="pbcard-header">
                        <div>
                          <div className="pbcard-code">{p.project_code}</div>
                          <div className="pbcard-name">{p.project_name}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column', alignItems: 'flex-end' }}>
                          <AlertBadge triggered={p.alert_triggered} />
                          {hasRole('ops_manager', 'ceo') && (
                            <Button variant="ghost" size="sm"
                              onClick={() => navigate(`/budget/${p.project_id}`)}>
                              Details →
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="pbcard-progress">
                        <div className="pbcard-pct">{parseFloat(p.pct_spent || 0).toFixed(1)}% used</div>
                        <ProgressBar value={p.pct_spent || 0} warning={p.budget_alert_threshold || 80} danger={100} />
                        <div className="pbcard-amounts">
                          <span>{formatCurrency(p.total_spent)} spent</span>
                          <span style={{ color: 'var(--text-muted)' }}>of {formatCurrency(p.budget_allocated)}</span>
                        </div>
                      </div>

                      <div className="pbcard-breakdown">
                        <div className="breakdown-item">
                          <span className="breakdown-dot" style={{ background: 'var(--accent)' }} />
                          <span className="breakdown-label">Labour</span>
                          <span className="breakdown-val">{formatCurrency(p.labour_cost)}</span>
                        </div>
                        <div className="breakdown-item">
                          <span className="breakdown-dot" style={{ background: 'var(--info)' }} />
                          <span className="breakdown-label">Consumables</span>
                          <span className="breakdown-val">{formatCurrency(p.consumable_cost)}</span>
                        </div>
                        <div className="breakdown-item">
                          <span className="breakdown-dot" style={{ background: 'var(--warning)' }} />
                          <span className="breakdown-label">POs</span>
                          <span className="breakdown-val">{formatCurrency(p.po_cost)}</span>
                        </div>
                      </div>

                      {phases?.filter(ph => ph.project_code === p.project_code).map(ph => (
                        <div key={ph.phase_id} className="phase-row">
                          <div className="phase-name">
                            <span>{ph.phase_name}</span>
                            <span className="phase-pct">{parseFloat(ph.pct_spent || 0).toFixed(0)}%</span>
                          </div>
                          <ProgressBar value={ph.pct_spent || 0}
                            warning={ph.budget_alert_threshold || 80} danger={100} />
                          <div className="phase-amounts">
                            <span>{formatCurrency(ph.total_spent)}</span>
                            <span style={{ color: 'var(--text-muted)' }}>/ {formatCurrency(ph.budget_allocated)}</span>
                          </div>
                        </div>
                      ))}

                      {hasRole('ops_manager', 'ceo') && p.budget_allocated === 0 && (
                        <Button variant="secondary" size="sm"
                          style={{ marginTop: '0.75rem', width: '100%' }}
                          onClick={() => setShowSetBudget(p)}>
                          Set budget
                        </Button>
                      )}
                    </Card>
                  ))}
                </div>
              )}

              {/* Recent entries */}
              <Card style={{ marginTop: '1.5rem' }}>
                <CardHeader title="Recent budget entries"
                  subtitle="Auto-posted from daily logs, invoices, and consumable usage" />
                {!entries?.length ? (
                  <EmptyState title="No entries yet" />
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Date</Th>
                        <Th>Project</Th>
                        <Th>Type</Th>
                        <Th>Description</Th>
                        <Th>Amount</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.slice(0, 50).map(e => (
                        <tr key={e.id}>
                          <Td>{formatDate(e.entry_date)}</Td>
                          <Td><Badge variant="muted">{e.project_code}</Badge></Td>
                          <Td>
                            <span className="entry-type-dot"
                              style={{ background: ENTRY_COLORS[e.entry_type] || 'var(--text-muted)' }} />
                            <span style={{ fontSize: '0.8125rem', textTransform: 'capitalize' }}>
                              {e.entry_type?.replace(/_/g, ' ')}
                            </span>
                          </Td>
                          <Td style={{ maxWidth: '280px' }}>
                            <span className="entry-desc">{e.description || '—'}</span>
                          </Td>
                          <Td>
                            <span className="entry-amount">{formatCurrency(e.amount)}</span>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
            </>
          )}

          {showSetBudget && (
            <SetBudgetModal
              project={showSetBudget}
              onClose={() => setShowSetBudget(null)}
              onSuccess={() => { setShowSetBudget(null); qc.invalidateQueries(['budget-summary']); }}
            />
          )}
        </>
      )}

      {/* ── OVERHEAD TAB ── */}
      {activeTab === 'overhead' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Overhead expenses</h3>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Running costs not tied to a specific project
              </p>
            </div>
            <Button variant="primary" onClick={() => setActiveTab('expense')}>
              + Add expense
            </Button>
          </div>

          {overheadLoading ? <LoadingState /> : !overhead?.length ? (
            <EmptyState
              title="No overhead expenses yet"
              description="Add recurring costs like lab lease, utilities, software subscriptions, and equipment."
              action={<Button variant="primary" onClick={() => setActiveTab('expense')}>+ Add expense</Button>}
            />
          ) : (
            <Card padding={false}>
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Category</Th>
                    <Th>Amount</Th>
                    <Th>Type</Th>
                    <Th>Frequency</Th>
                    <Th>Start date</Th>
                    <Th>End date</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {overhead.map(e => (
                    <tr key={e.id}>
                      <Td>
                        <strong>{e.name}</strong>
                        {e.description && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {e.description}
                          </div>
                        )}
                      </Td>
                      <Td>{e.category ? <Badge variant="muted">{e.category}</Badge> : '—'}</Td>
                      <Td><strong>${Number(e.amount).toLocaleString()}</strong></Td>
                      <Td>
                        <Badge variant={e.is_recurring ? 'accent' : 'muted'}>
                          {e.is_recurring ? 'Recurring' : 'One-off'}
                        </Badge>
                      </Td>
                      <Td>{e.frequency ? e.frequency.charAt(0).toUpperCase() + e.frequency.slice(1) : '—'}</Td>
                      <Td>{formatDate(e.start_date) || '—'}</Td>
                      <Td>{formatDate(e.end_date)   || '—'}</Td>
                      <Td>
                        {hasRole('ops_manager', 'ceo') && (
                          <Button variant="ghost" size="sm"
                            loading={deleteOverheadMutation.isPending}
                            onClick={() => {
                              if (window.confirm(`Remove "${e.name}"?`))
                                deleteOverheadMutation.mutate(e.id);
                            }}>
                            Remove
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          {/* Overhead PO payments */}
          {overheadEntries?.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
                Overhead PO payments
              </h3>
              <Card padding={false}>
                <Table>
                  <thead>
                    <tr>
                      <Th>Date</Th>
                      <Th>PO number</Th>
                      <Th>Supplier</Th>
                      <Th>Description</Th>
                      <Th>Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {overheadEntries.map(e => (
                      <tr key={e.id}>
                        <Td>{formatDate(e.entry_date)}</Td>
                        <Td><span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--accent)' }}>{e.po_number || '—'}</span></Td>
                        <Td>{e.supplier || '—'}</Td>
                        <Td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>{e.description}</Td>
                        <Td><strong>{formatCurrency(e.amount)}</strong></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* ── ADD EXPENSE TAB ── */}
      {activeTab === 'expense' && (
        <div style={{ maxWidth: '640px' }}>
          <div style={{ marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Add overhead expense</h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              For expenses not tied to a specific project — lab running costs, subscriptions, facilities, etc.
            </p>
          </div>
          <Card>
            <AddExpenseForm
              onSuccess={() => {
                setActiveTab('overhead');
                qc.invalidateQueries(['overhead-expenses']);
              }}
              onCancel={() => setActiveTab('projects')}
            />
          </Card>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Set Budget Modal
   ============================================================ */
function SetBudgetModal({ project, onClose, onSuccess }) {
  const [budget,    setBudget]    = useState('');
  const [rate,      setRate]      = useState('');
  const [threshold, setThreshold] = useState('80');

  const mutation = useMutation({
    mutationFn: data => api.patch(`/budget/projects/${project.project_id}`, data),
    onSuccess:  ()   => { toast.success('Budget updated.'); onSuccess(); },
    onError:    err  => toast.error(err.response?.data?.detail || 'Failed to update budget.'),
  });

  const handleSubmit = e => {
    e.preventDefault();
    if (!budget) { toast.error('Enter a budget amount.'); return; }
    mutation.mutate({
      budget_allocated:       parseFloat(budget),
      hourly_rate:            rate ? parseFloat(rate) : undefined,
      budget_alert_threshold: parseFloat(threshold) || 80,
    });
  };

  return (
    <Modal open={true} onClose={onClose} title={`Set budget — ${project?.project_code}`} size="sm">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <Input label="Total budget ($) *" type="number" min="0" step="0.01"
          value={budget} onChange={e => setBudget(e.target.value)}
          placeholder="e.g. 150000" />
        <Input label="Hourly labour rate ($/hr)" type="number" min="0" step="0.01"
          value={rate} onChange={e => setRate(e.target.value)}
          placeholder="e.g. 85.00"
          hint="Used to calculate labour cost from daily log hours" />
        <Input label="Alert threshold (%)" type="number" min="1" max="100"
          value={threshold} onChange={e => setThreshold(e.target.value)}
          hint="Send alert when spend reaches this % of budget" />
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>Save budget</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ============================================================
   Add Expense Form
   ============================================================ */
function AddExpenseForm({ onSuccess, onCancel }) {
  const [form, setForm] = useState({
    name: '', description: '', amount: '', is_recurring: false,
    frequency: 'monthly', start_date: '', end_date: '', category: '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: data => api.post('/budget/overhead', data),
    onSuccess:  ()   => { toast.success('Expense added.'); onSuccess(); },
    onError:    err  => toast.error(err.response?.data?.detail || 'Failed to add expense.'),
  });

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.name)   { toast.error('Expense name is required.'); return; }
    if (!form.amount) { toast.error('Amount is required.'); return; }
    mutation.mutate({
      ...form,
      amount:     parseFloat(form.amount),
      frequency:  form.is_recurring ? form.frequency : null,
      start_date: form.start_date || null,
      end_date:   form.end_date   || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.25rem' }}>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
        <Input label="Expense name *"
          value={form.name} onChange={e => set('name', e.target.value)}
          placeholder="e.g. Lab lease, Software subscription…" autoFocus />
        <div className="field">
          <label className="field-label">Category</label>
          <select className="field-input" value={form.category}
            onChange={e => set('category', e.target.value)}>
            <option value="">Uncategorised</option>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.875rem' }}>
        <Input label="Amount ($) *" type="number" min="0" step="0.01"
          value={form.amount} onChange={e => set('amount', e.target.value)}
          placeholder="0.00" />
        <Input label="Start date" type="date"
          value={form.start_date} onChange={e => set('start_date', e.target.value)} />
        <Input label="End date" type="date"
          value={form.end_date} onChange={e => set('end_date', e.target.value)}
          hint="Leave blank if ongoing" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
        <label className="checkbox-label">
          <input type="checkbox" checked={form.is_recurring}
            onChange={e => set('is_recurring', e.target.checked)} />
          <span>Recurring expense</span>
        </label>
        {form.is_recurring && (
          <div className="field" style={{ margin: 0, minWidth: '160px' }}>
            <label className="field-label">Frequency</label>
            <select className="field-input" value={form.frequency}
              onChange={e => set('frequency', e.target.value)}>
              {FREQUENCIES.map(f => (
                <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <Input label="Description"
        value={form.description} onChange={e => set('description', e.target.value)}
        placeholder="Optional notes about this expense…" />

      <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
        <Button type="submit" variant="primary" loading={mutation.isPending}>
          Add expense
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ============================================================
   Page export
   ============================================================ */
export default function BudgetPage() {
  return (
    <Routes>
      <Route index element={<BudgetOverview />} />
    </Routes>
  );
}
