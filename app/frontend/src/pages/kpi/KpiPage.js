import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Routes, Route } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, Card, CardHeader, Button, Input, Badge,
  Table, Th, Td, EmptyState, LoadingState, StatCard, Modal
} from '../../components/ui/UI';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine
} from 'recharts';
import { formatDate } from '../../utils/format';
import toast from 'react-hot-toast';
import './KpiPage.css';

/* ---- Helpers ---- */
function MetBadge({ met }) {
  return met
    ? <Badge variant="success">Target met</Badge>
    : <Badge variant="danger">Below target</Badge>;
}

function VarianceBadge({ variance }) {
  if (variance == null) return null;
  const v = parseFloat(variance);
  return (
    <span className={`variance ${v >= 0 ? 'variance--pos' : 'variance--neg'}`}>
      {v >= 0 ? '+' : ''}{v.toFixed(1)}
    </span>
  );
}

const METRIC_LABELS = {
  task_completion_rate:   'Task completion rate',
  hours_logged:           'Hours logged',
  log_submission_rate:    'Log submission rate',
  on_time_task_completion:'On-time completion',
  custom:                 'Custom',
};

/* ============================================================
   KPI Main Page — ops manager only
   ============================================================ */
function KpiMain() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const [period, setPeriod]       = useState('weekly');
  const [empFilter, setEmpFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showCompute, setShowCompute] = useState(false);

  const { data: kpiData, isLoading } = useQuery({
    queryKey: ['kpi-summary', period],
    queryFn: () => api.get('/kpi', { params: { period } }).then(r => r.data),
  });

  const { data: targets } = useQuery({
    queryKey: ['kpi-targets'],
    queryFn: () => api.get('/kpi/targets').then(r => r.data),
  });

  const { data: users } = useQuery({
    queryKey: ['lab-techs'],
    queryFn: () => api.get('/auth/users/all').then(r => r.data.filter(u => u.role === 'lab_tech' && u.is_active)),
  });

  const computeMutation = useMutation({
    mutationFn: () => api.post(`/kpi/compute?period=${period}`),
    onSuccess: (data) => {
      toast.success(`Computed ${data.data.period} KPIs — ${data.data.message}`);
      setShowCompute(false);
      qc.invalidateQueries(['kpi-summary']);
    },
    onError: () => toast.error('Failed to compute KPIs.'),
  });

  // Derive unique periods from data for the trend selector
  const latestPeriod = useMemo(() => {
    if (!kpiData?.length) return null;
    const dates = kpiData.map(k => k.period_start).filter(Boolean).sort().reverse();
    return dates[0];
  }, [kpiData]);

  // Filter to latest period for summary cards
  const latestData = useMemo(() =>
    (kpiData || []).filter(k => k.period_start === latestPeriod),
    [kpiData, latestPeriod]
  );

  // Filter by employee
  const filtered = useMemo(() => {
    if (!empFilter) return latestData;
    return latestData.filter(k => k.employee === empFilter);
  }, [latestData, empFilter]);

  // Summary stats
  const stats = useMemo(() => {
    const met   = latestData.filter(k => k.met_target).length;
    const total = latestData.length;
    return { met, total, missed: total - met, rate: total ? Math.round((met / total) * 100) : 0 };
  }, [latestData]);

  // Per-employee radar data — aggregate latest period
  const radarData = useMemo(() => {
    const empMap = {};
    latestData.forEach(k => {
      const emp = k.employee || 'Unknown';
      if (!empMap[emp]) empMap[emp] = {};
      const label = METRIC_LABELS[k.metric_type] || k.metric_name;
      const pct = k.target_value > 0
        ? Math.min(Math.round((k.actual_value / k.target_value) * 100), 150)
        : 0;
      empMap[emp][label] = pct;
    });

    // Build recharts format
    const metrics = [...new Set(latestData.map(k => METRIC_LABELS[k.metric_type] || k.metric_name))];
    return { empMap, metrics };
  }, [latestData]);

  // Trend data per metric — all periods
  const trendData = useMemo(() => {
    const map = {};
    (kpiData || []).forEach(k => {
      const key = k.metric_type;
      if (!map[key]) map[key] = {};
      const period = formatDate(k.period_start, 'MMM d');
      if (!map[key][period]) map[key][period] = { period };
      map[key][period][k.employee] = parseFloat(k.actual_value);
    });
    return map;
  }, [kpiData]);

  const employees = useMemo(() =>
    [...new Set((kpiData || []).map(k => k.employee).filter(Boolean))],
    [kpiData]
  );

  const COLORS = ['var(--accent)', 'var(--info)', 'var(--warning)', '#c084fc'];

  return (
    <div>
      <PageHeader
        title="KPI tracking"
        subtitle="Operations manager view — employee performance against targets"
        action={
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div className="period-toggle">
              <button className={`view-pill ${period === 'weekly'  ? 'view-pill--active' : ''}`}
                onClick={() => setPeriod('weekly')}>Weekly</button>
              <button className={`view-pill ${period === 'monthly' ? 'view-pill--active' : ''}`}
                onClick={() => setPeriod('monthly')}>Monthly</button>
            </div>
            {hasRole('ops_manager', 'ceo') && <Button variant="secondary" onClick={() => setShowCompute(true)}>Compute KPIs</Button>}
            {hasRole('ops_manager', 'ceo') && <Button variant="primary" onClick={() => setShowCreate(true)}>+ Add KPI target</Button>}
          </div>
        }
      />

      {/* Summary stats */}
      <div className="stats-row">
        <StatCard label="Targets tracked" value={stats.total} />
        <StatCard label="Targets met"     value={stats.met}    accent />
        <StatCard label="Below target"    value={stats.missed} danger={stats.missed > 0} />
        <StatCard label="Overall rate"    value={`${stats.rate}%`}
          accent={stats.rate >= 80} warning={stats.rate >= 60 && stats.rate < 80}
          danger={stats.rate < 60} />
      </div>

      {isLoading ? <LoadingState /> : !latestData.length ? (
        <Card>
          <EmptyState
            title="No KPI data yet"
            description='Click "Compute KPIs" to calculate this period\'s results.'
            action={<Button variant="primary" onClick={() => setShowCompute(true)}>Compute KPIs</Button>}
          />
        </Card>
      ) : (
        <>
          {/* Radar charts — one per employee */}
          {radarData.metrics.length > 0 && (
            <div className="radar-row">
              {Object.entries(radarData.empMap).map(([emp, metrics], i) => {
                const chartData = radarData.metrics.map(m => ({
                  metric: m.replace(' rate', '').replace(' completion', ''),
                  value:  metrics[m] ?? 0,
                  full:   100,
                }));
                const allMet = chartData.every(d => d.value >= 100);
                return (
                  <Card key={emp} className="radar-card">
                    <div className="radar-header">
                      <div className="radar-avatar">{emp.split(' ').map(n => n[0]).join('').slice(0,2)}</div>
                      <div>
                        <div className="radar-name">{emp}</div>
                        <Badge variant={allMet ? 'success' : 'warning'}>
                          {allMet ? 'All targets met' : 'Some targets missed'}
                        </Badge>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <RadarChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
                        <PolarGrid stroke="var(--border)" />
                        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                        <Radar name={emp} dataKey="value" stroke={COLORS[i % COLORS.length]}
                          fill={COLORS[i % COLORS.length]} fillOpacity={0.15}
                          strokeWidth={1.5} />
                        <ReferenceLine y={100} stroke="var(--border)" strokeDasharray="3 3" />
                      </RadarChart>
                    </ResponsiveContainer>
                    <p className="radar-note">100 = target. Values above 100 exceed target.</p>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Trend charts — one per metric */}
          <div className="trend-section">
            <h3 className="section-title">Trends over time</h3>
            <div className="trend-grid">
              {Object.entries(trendData).map(([metricType, periodMap]) => {
                const chartData = Object.values(periodMap).sort((a, b) =>
                  a.period.localeCompare(b.period)
                );
                const target = targets?.find(t => t.metric_type === metricType && t.period === period);
                return (
                  <Card key={metricType} className="trend-card">
                    <CardHeader title={METRIC_LABELS[metricType] || metricType} />
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" opacity={0.4} />
                        <XAxis dataKey="period" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                        <Tooltip
                          contentStyle={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }}
                          labelStyle={{ color: 'var(--text-secondary)' }}
                        />
                        {target && (
                          <ReferenceLine y={target.target_value} stroke="var(--warning)"
                            strokeDasharray="4 3" label={{ value: 'Target', fill: 'var(--warning)', fontSize: 10 }} />
                        )}
                        {employees.map((emp, i) => (
                          <Line key={emp} type="monotone" dataKey={emp}
                            stroke={COLORS[i % COLORS.length]} strokeWidth={2}
                            dot={{ r: 3, fill: COLORS[i % COLORS.length] }}
                            activeDot={{ r: 5 }} name={emp} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Detail table */}
          <Card style={{ marginTop: '1.5rem' }}>
            <CardHeader
              title="Detail view"
              action={
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <select className="field-input" style={{ width: '160px', fontSize: '0.8125rem' }}
                    value={empFilter} onChange={e => setEmpFilter(e.target.value)}>
                    <option value="">All employees</option>
                    {employees.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
              }
            />
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>KPI</Th>
                  <Th>Period</Th>
                  <Th>Target</Th>
                  <Th>Actual</Th>
                  <Th>Variance</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><Td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No data</Td></tr>
                ) : filtered.map(k => (
                  <tr key={k.kpi_target_id + '_' + k.employee + '_' + k.period_start}>
                    <Td>
                      <div className="emp-cell">
                        <span className="emp-avatar">
                          {(k.employee || '?').split(' ').map(n => n[0]).join('').slice(0,2)}
                        </span>
                        <span>{k.employee || '—'}</span>
                      </div>
                    </Td>
                    <Td>{METRIC_LABELS[k.metric_type] || k.metric_name}</Td>
                    <Td>
                      <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                        {formatDate(k.period_start)} – {formatDate(k.period_end)}
                      </span>
                    </Td>
                    <Td>{k.target_value} {k.unit}</Td>
                    <Td>
                      <strong style={{ color: k.met_target ? 'var(--success)' : 'var(--danger)' }}>
                        {parseFloat(k.actual_value).toFixed(1)} {k.unit}
                      </strong>
                    </Td>
                    <Td><VarianceBadge variance={k.variance} /></Td>
                    <Td><MetBadge met={k.met_target} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {/* KPI targets management */}
          <Card style={{ marginTop: '1.5rem' }}>
            <CardHeader
              title="KPI targets"
              subtitle="Active targets used for computation"
            />
            <Table>
              <thead>
                <tr>
                  <Th>Metric</Th>
                  <Th>Period</Th>
                  <Th>Target</Th>
                  <Th>Applies to</Th>
                  <Th>Type</Th>
                </tr>
              </thead>
              <tbody>
                {(targets || []).filter(t => t.is_active).map(t => (
                  <tr key={t.id}>
                    <Td>{t.metric_name}</Td>
                    <Td><Badge variant="muted">{t.period}</Badge></Td>
                    <Td>{t.target_value} {t.unit}</Td>
                    <Td>{t.employee || 'All lab techs'}</Td>
                    <Td>
                      <Badge variant={t.is_system ? 'accent' : 'muted'}>
                        {t.is_system ? 'Auto-computed' : 'Manual'}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {/* Compute confirmation modal */}
      <Modal open={showCompute} onClose={() => setShowCompute(false)}
        title={`Compute ${period} KPIs?`} size="sm">
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          This will calculate all system KPIs for the previous {period === 'weekly' ? 'week' : 'month'}
          and store the results. Any existing results for that period will be overwritten.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setShowCompute(false)}>Cancel</Button>
          <Button variant="primary" loading={computeMutation.isPending}
            onClick={() => computeMutation.mutate()}>
            Compute now
          </Button>
        </div>
      </Modal>

      {/* Create KPI target modal */}
      <CreateKpiTargetModal
        open={showCreate}
        users={users || []}
        onClose={() => setShowCreate(false)}
        onSuccess={() => { setShowCreate(false); qc.invalidateQueries(['kpi-targets']); }}
      />
    </div>
  );
}

/* ============================================================
   Create KPI Target Modal
   ============================================================ */
function CreateKpiTargetModal({ open, users, onClose, onSuccess }) {
  const [form, setForm] = useState({
    metric_type:    'custom',
    metric_name:    '',
    description:    '',
    target_value:   '',
    unit:           '%',
    period:         'weekly',
    user_id:        '',
    project_id:     '',
    effective_from: new Date().toISOString().split('T')[0],
    effective_to:   '',
    is_system:      false,
  });

  const { data: projects } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects?active=true').then(r => r.data),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: data => api.post('/kpi/targets', data),
    onSuccess: () => { toast.success('KPI target added.'); onSuccess(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to add target.'),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.metric_name)  { toast.error('Enter a metric name.'); return; }
    if (!form.target_value) { toast.error('Enter a target value.'); return; }
    mutation.mutate({
      ...form,
      target_value: parseFloat(form.target_value),
      user_id:      form.user_id    ? parseInt(form.user_id)    : null,
      project_id:   form.project_id ? parseInt(form.project_id) : null,
      effective_to: form.effective_to || null,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Add KPI target" size="md">
      <form onSubmit={handleSubmit} className="kpi-form">
        <div className="grid-2">
          <div className="field">
            <label className="field-label">Metric type</label>
            <select className="field-input" value={form.metric_type}
              onChange={e => set('metric_type', e.target.value)}>
              <option value="task_completion_rate">Task completion rate</option>
              <option value="hours_logged">Hours logged</option>
              <option value="log_submission_rate">Log submission rate</option>
              <option value="on_time_task_completion">On-time task completion</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Period</label>
            <select className="field-input" value={form.period}
              onChange={e => set('period', e.target.value)}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>

        <Input label="Metric name *" value={form.metric_name}
          onChange={e => set('metric_name', e.target.value)}
          placeholder="e.g. Weekly task completion rate" />

        <Input label="Description" value={form.description}
          onChange={e => set('description', e.target.value)}
          placeholder="What this KPI measures…" />

        <div className="grid-2">
          <Input label="Target value *" type="number" min="0" step="any"
            value={form.target_value} onChange={e => set('target_value', e.target.value)} />
          <Input label="Unit" value={form.unit} onChange={e => set('unit', e.target.value)}
            placeholder="%, hours, tasks…" />
        </div>

        <div className="grid-2">
          <div className="field">
            <label className="field-label">Apply to employee (blank = all lab techs)</label>
            <select className="field-input" value={form.user_id}
              onChange={e => set('user_id', e.target.value)}>
              <option value="">All lab techs</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Apply to project (blank = all projects)</label>
            <select className="field-input" value={form.project_id}
              onChange={e => set('project_id', e.target.value)}>
              <option value="">All projects</option>
              {projects?.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid-2">
          <Input label="Effective from" type="date" value={form.effective_from}
            onChange={e => set('effective_from', e.target.value)} />
          <Input label="Effective to (blank = ongoing)" type="date" value={form.effective_to}
            onChange={e => set('effective_to', e.target.value)} />
        </div>

        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>Add target</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function KpiPage() {
  return (
    <Routes>
      <Route index element={<KpiMain />} />
    </Routes>
  );
}
