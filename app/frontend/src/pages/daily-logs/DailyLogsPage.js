import React, { useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { CreateConsumableInline } from '../consumables/ConsumablesPage';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, Card, CardHeader, Button, Input, Textarea,
  Badge, Table, Th, Td, EmptyState, LoadingState, StatCard, Modal
} from '../../components/ui/UI';
import { formatDate, formatHours } from '../../utils/format';
import toast from 'react-hot-toast';
import './DailyLogsPage.css';

function LogStatusBadge({ status }) {
  if (status === 'needs_revision') return <Badge variant="danger">Needs revision</Badge>;
  if (status === 'submitted')      return <Badge variant="success">Submitted</Badge>;
  return <Badge variant="warning">Draft</Badge>;
}

function createBlankEntry() {
  return {
    _id: Math.random(),
    project_id: '',
    hours_spent: '',
    work_completed: '',
    issues_blockers: '',
    next_steps: '',
    additional_notes: '',
    tasks: [],
    consumables: [],
  };
}

/* ---- List view ---- */
function DailyLogsList() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = new Date().toISOString().split('T')[0];
  const [dateFilter,    setDateFilter]    = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [userFilter,    setUserFilter]    = useState('');
  const [weekStart,     setWeekStart]     = useState('');
  const [weekEnd,       setWeekEnd]       = useState('');

  const { data: projects } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects?active=true').then(r => r.data),
  });
  const { data: users } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => api.get('/auth/users/all').then(r => r.data),
  });

  const { data: logs, isLoading } = useQuery({
    queryKey: ['daily-logs', dateFilter, projectFilter, userFilter, weekStart, weekEnd],
    queryFn: () => api.get('/daily-logs', { params: {
      log_date:   dateFilter   || undefined,
      project_id: projectFilter || undefined,
      user_id:    userFilter   || undefined,
      week_start: weekStart    || undefined,
      week_end:   weekEnd      || undefined,
    }}).then(r => r.data),
  });

  const { data: todayLog } = useQuery({
    queryKey: ['my-log-today'],
    queryFn: () => api.get('/daily-logs/today').then(r => r.data),
    enabled: hasRole('lab_tech', 'qm_director', 'ceo'),
  });

  const { data: missing } = useQuery({
    queryKey: ['missing-logs'],
    queryFn: () => api.get('/daily-logs/missing').then(r => r.data),
    enabled: hasRole('ops_manager'),
  });

  const { data: needsRevision } = useQuery({
    queryKey: ['my-logs-needing-revision', user?.id],
    queryFn: () => api.get('/daily-logs', { params: { status: 'needs_revision', user_id: user.id } }).then(r => r.data),
    enabled: !!user?.id && hasRole('lab_tech', 'qm_director', 'ceo'),
  });

  const invalidateMissing = () => {
    qc.invalidateQueries(['missing-logs']);
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
    if (window.confirm(`Permanently delete all ${missing?.length ?? 0} unresolved missing-log flags? This cannot be undone.`)) {
      clearBacklogMutation.mutate();
    }
  };

  return (
    <div>
      <PageHeader
        title="Daily logs"
        subtitle="Track daily progress, hours, and consumable usage per project"
        action={
          hasRole('lab_tech', 'qm_director', 'ceo') && (
            <Button variant="primary" onClick={() => navigate('/daily-logs/today')}>
              {todayLog?.submitted_at ? "View today's log" : '+ Log today'}
            </Button>
          )
        }
      />

      <div className="stats-row">
        {hasRole('ops_manager') && (
          <StatCard label="Missing logs" value={missing?.length ?? '—'} sub="unresolved" danger={missing?.length > 0} />
        )}
        <StatCard
          label="Logs today"
          value={logs?.filter(l => l.log_date === today && l.submitted_at).length ?? '—'}
          sub="submitted" accent
        />
      </div>

      <Card className="log-filter-bar">
        <div className="log-filter-row">
          <Input label="Filter by date" type="date" value={dateFilter}
            onChange={e => setDateFilter(e.target.value)} style={{ width: '200px' }} />
          {dateFilter && <Button variant="ghost" size="sm" onClick={() => setDateFilter('')}>Clear</Button>}
        </div>
      </Card>

      {hasRole('ops_manager') && missing?.length > 0 && (
        <Card className="missing-alert">
          <CardHeader
            title="Missing logs"
            action={
              <Button variant="ghost" size="sm" loading={clearBacklogMutation.isPending} onClick={handleClearBacklog}>
                Clear all
              </Button>
            }
          />
          <div className="missing-list">
            {missing.map(m => (
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
        </Card>
      )}

      {needsRevision?.length > 0 && (
        <Card className="missing-alert">
          <CardHeader title="Needs your revision" subtitle="Sent back by a reviewer — open to see why and resubmit" />
          <div className="missing-list">
            {needsRevision.map(log => (
              <div key={log.id} className="missing-row">
                <span className="missing-name">{formatDate(log.log_date)}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Badge variant="danger">Needs revision</Badge>
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/daily-logs/${log.id}`)}>
                    Review &amp; revise
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Filter bar */}
      <div style={{ display:'flex', gap:'0.75rem', marginBottom:'1rem', flexWrap:'wrap', alignItems:'flex-end' }}>
        <div className="field" style={{ margin:0, minWidth:'160px' }}>
          <label className="field-label">Project</label>
          <select className="field-input" value={projectFilter}
            onChange={e => setProjectFilter(e.target.value)}>
            <option value="">All projects</option>
            {(projects||[]).map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin:0, minWidth:'160px' }}>
          <label className="field-label">Staff member</label>
          <select className="field-input" value={userFilter}
            onChange={e => setUserFilter(e.target.value)}>
            <option value="">All staff</option>
            {(users||[]).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin:0 }}>
          <label className="field-label">Week start</label>
          <input type="date" className="field-input" value={weekStart}
            onChange={e => setWeekStart(e.target.value)} />
        </div>
        <div className="field" style={{ margin:0 }}>
          <label className="field-label">Week end</label>
          <input type="date" className="field-input" value={weekEnd}
            onChange={e => setWeekEnd(e.target.value)} />
        </div>
        <div className="field" style={{ margin:0 }}>
          <label className="field-label">Specific date</label>
          <input type="date" className="field-input" value={dateFilter}
            onChange={e => setDateFilter(e.target.value)} />
        </div>
        {(projectFilter||userFilter||weekStart||weekEnd||dateFilter) && (
          <Button variant="ghost" size="sm"
            onClick={() => { setProjectFilter(''); setUserFilter(''); setWeekStart(''); setWeekEnd(''); setDateFilter(''); }}>
            Clear filters
          </Button>
        )}
      </div>

      {isLoading ? <LoadingState /> : !logs?.length ? (
        <EmptyState
          title="No logs found"
          description={dateFilter ? `No logs for ${formatDate(dateFilter)}.` : 'No logs yet.'}
          action={hasRole('lab_tech') && <Button variant="primary" onClick={() => navigate('/daily-logs/today')}>Log today</Button>}
        />
      ) : (
        <Table>
          <thead>
            <tr><Th>Date</Th><Th>Employee</Th><Th>Projects</Th><Th>Total hours</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id} onClick={() => navigate(`/daily-logs/${log.id}`)} style={{ cursor: 'pointer' }}>
                <Td>{formatDate(log.log_date)}</Td>
                <Td>{log.employee}</Td>
                <Td>
                  <div className="project-code-list">
                    {log.project_codes?.map(code => <Badge key={code} variant="muted">{code}</Badge>)}
                  </div>
                </Td>
                <Td>{formatHours(log.total_hours)}</Td>
                <Td><LogStatusBadge status={log.status} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

/* ---- Project entry card ---- */
function ProjectEntry({ entry, idx, projects, consumables, onUpdate, onRemove, onSave, canRemove, saving,
  onAddTask, onUpdateTask, onRemoveTask, onAddConsumable, onUpdateConsumable, onRemoveConsumable, onConsumableAdded }) {
  const [section, setSection] = useState('progress');
  const [showNewConsumable, setShowNewConsumable] = useState(false);

  const { data: projectTasks } = useQuery({
    queryKey: ['project-tasks', entry.project_id],
    queryFn: () => api.get('/tasks', { params: { project_id: entry.project_id } }).then(r => r.data),
    enabled: !!entry.project_id,
  });

  const consumablesByCategory = (consumables || []).reduce((acc, c) => {
    const cat = c.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(c);
    return acc;
  }, {});

  const selectedConsumable = (id) => consumables.find(c => c.id === parseInt(id));

  return (
    <Card className="entry-card">
      <div className="entry-header">
        <div className="entry-header-left">
          <span className="entry-number">Entry {idx + 1}</span>
          <div className="field" style={{ minWidth: '240px' }}>
            <select className="field-input" value={entry.project_id} onChange={e => onUpdate('project_id', e.target.value)}>
              <option value="">Select project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ width: '120px' }}>
            <input className="field-input" type="number" min="0.25" max="24" step="0.25"
              placeholder="Hours" value={entry.hours_spent} onChange={e => onUpdate('hours_spent', e.target.value)} />
          </div>
          {entry.hours_spent && (
            <span className="hours-display">{formatHours(parseFloat(entry.hours_spent))}</span>
          )}
        </div>
        <div className="entry-header-right">
          <Button variant="ghost" size="sm" onClick={onSave} loading={saving}>Save</Button>
          {canRemove && (
            <Button variant="ghost" size="sm" onClick={onRemove} style={{ color: 'var(--danger)' }}>Remove</Button>
          )}
        </div>
      </div>

      <div className="entry-tabs">
        {[
          { id: 'progress', label: 'Progress notes' },
          { id: 'tasks', label: `Tasks${entry.tasks.length ? ` (${entry.tasks.length})` : ''}` },
          { id: 'consumables', label: `Consumables${entry.consumables.length ? ` (${entry.consumables.length})` : ''}` },
        ].map(tab => (
          <button key={tab.id}
            className={`entry-tab ${section === tab.id ? 'entry-tab--active' : ''}`}
            onClick={() => setSection(tab.id)}
          >{tab.label}</button>
        ))}
      </div>

      {section === 'progress' && (
        <div className="entry-section">
          <div className="notes-grid">
            <Textarea label="What I did" value={entry.work_completed}
              onChange={e => onUpdate('work_completed', e.target.value)}
              placeholder="Describe work completed today on this project…" rows={3} />
            <Textarea label="Issues / blockers" value={entry.issues_blockers}
              onChange={e => onUpdate('issues_blockers', e.target.value)}
              placeholder="Any blockers, problems, or items needing attention…" rows={3} />
            <Textarea label="Next steps" value={entry.next_steps}
              onChange={e => onUpdate('next_steps', e.target.value)}
              placeholder="What's planned for next session on this project…" rows={3} />
            <Textarea label="Additional notes" value={entry.additional_notes}
              onChange={e => onUpdate('additional_notes', e.target.value)}
              placeholder="Any other notes…" rows={2} />
          </div>
        </div>
      )}

      {section === 'tasks' && (
        <div className="entry-section">
          {!entry.project_id ? (
            <p className="entry-hint">Select a project first to see its tasks.</p>
          ) : (
            <>
              {entry.tasks.length === 0 && <p className="entry-hint">No tasks linked yet.</p>}
              {entry.tasks.map((task, ti) => (
                <div key={ti} className="task-row">
                  <div className="field" style={{ flex: 2 }}>
                    {ti === 0 && <label className="field-label">Task</label>}
                    <select className="field-input" value={task.task_id}
                      onChange={e => onUpdateTask(ti, 'task_id', e.target.value)}>
                      <option value="">Select task…</option>
                      {projectTasks?.map(t => (
                        <option key={t.id} value={t.id}>{t.title}{t.is_milestone ? ' ★' : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    {ti === 0 && <label className="field-label">Update status</label>}
                    <select className="field-input" value={task.status_update}
                      onChange={e => onUpdateTask(ti, 'status_update', e.target.value)}>
                      <option value="">No change</option>
                      <option value="in_progress">Mark in progress</option>
                      <option value="complete">Mark complete</option>
                      <option value="blocked">Mark blocked</option>
                    </select>
                  </div>
                  <div className="field" style={{ flex: 2 }}>
                    {ti === 0 && <label className="field-label">Task notes</label>}
                    <input className="field-input" placeholder="Progress on this task…"
                      value={task.notes} onChange={e => onUpdateTask(ti, 'notes', e.target.value)} />
                  </div>
                  <button className="remove-row-btn"
                    onClick={() => onRemoveTask(ti)} title="Remove"
                    style={{ marginTop: ti === 0 ? '1.25rem' : 0 }}>×</button>
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={onAddTask}>+ Link a task</Button>
            </>
          )}
        </div>
      )}

      {section === 'consumables' && (
        <div className="entry-section">
          {entry.consumables.length === 0 && <p className="entry-hint">No consumables logged yet.</p>}
          {entry.consumables.map((c, ci) => (
            <div key={ci} className="consumable-row">
              <div className="field" style={{ flex: 3 }}>
                {ci === 0 && <label className="field-label">Consumable</label>}
                <select className="field-input" value={c.consumable_id}
                  onChange={e => onUpdateConsumable(ci, 'consumable_id', e.target.value)}>
                  <option value="">Select item…</option>
                  {Object.entries(consumablesByCategory).map(([cat, items]) => (
                    <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                      {items.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.name}{item.sku ? ` (${item.sku})` : ''} — {item.current_stock} {item.unit} in stock
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="field" style={{ width: '100px' }}>
                {ci === 0 && <label className="field-label">Quantity</label>}
                <input className="field-input" type="number" min="0.001" step="any"
                  placeholder="Qty" value={c.quantity_used}
                  onChange={e => onUpdateConsumable(ci, 'quantity_used', e.target.value)} />
              </div>
              {c.consumable_id && selectedConsumable(c.consumable_id) && (
                <span className="consumable-unit" style={{ marginTop: ci === 0 ? '1.35rem' : '0.35rem' }}>
                  {selectedConsumable(c.consumable_id)?.unit}
                </span>
              )}
              <div className="field" style={{ flex: 2 }}>
                {ci === 0 && <label className="field-label">Notes</label>}
                <input className="field-input" placeholder="Optional note…"
                  value={c.notes} onChange={e => onUpdateConsumable(ci, 'notes', e.target.value)} />
              </div>
              <button className="remove-row-btn" onClick={() => onRemoveConsumable(ci)}
                title="Remove" style={{ marginTop: ci === 0 ? '1.25rem' : 0 }}>×</button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={onAddConsumable}>+ Add consumable</Button>
          <Button variant="secondary" size="sm"
            onClick={() => setShowNewConsumable(v => !v)}>
            {showNewConsumable ? 'Cancel' : '+ New item to inventory'}
          </Button>

        {showNewConsumable && (
          <div style={{
            marginTop: '1rem',
            padding: '1rem',
            background: 'var(--bg-raised)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.875rem', color: 'var(--text-primary)' }}>
              Add new consumable to inventory
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              This adds the item to the master inventory immediately. You can then select it above to log usage in today's entry.
            </p>
            <CreateConsumableInline
              compact={true}
              onSuccess={() => {
                setShowNewConsumable(false);
                // Refresh consumables dropdown
                if (onConsumableAdded) onConsumableAdded();
              }}
            />
          </div>
        )}
        </div>
      )}
    </Card>
  );
}

/* ---- Today's log form ---- */
function TodayLog() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [entries, setEntries] = useState([createBlankEntry()]);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  const { data: existingLog, isLoading: logLoading } = useQuery({
    queryKey: ['my-log-today'],
    queryFn: () => api.get('/daily-logs/today').then(r => r.data),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects?active=true').then(r => r.data),
  });

  const { data: consumables } = useQuery({
    queryKey: ['consumables-dropdown'],
    queryFn: () => api.get('/consumables/dropdown').then(r => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: entry => api.post('/daily-logs/today/entries', entry),
    onSuccess: () => qc.invalidateQueries(['my-log-today']),
    onError: err => toast.error(err.response?.data?.detail || 'Failed to save entry.'),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      await api.post('/daily-logs/today/submit');
      // Fire delay analysis for each entry that has blockers + linked tasks
      const entriesWithBlockers = entries.filter(
        e => e.issues_blockers && e.tasks?.some(t => t.task_id)
      );
      const proposals = [];
      for (const entry of entriesWithBlockers) {
        try {
          const res = await api.post('/daily-logs/today/entries/analyse-delays', {
            project_id:      parseInt(entry.project_id),
            hours_spent:     parseFloat(entry.hours_spent),
            issues_blockers: entry.issues_blockers,
            task_updates:    entry.tasks.filter(t => t.task_id).map(t => ({
              task_id:       parseInt(t.task_id),
              notes:         t.notes,
              status_update: t.status_update || null,
            })),
            consumables: [],
          });
          if (res.data.proposals?.length) proposals.push(...res.data.proposals);
        } catch {}
      }
      return proposals;
    },
    onSuccess: (proposals) => {
      if (proposals?.length > 0) {
        toast.success(
          `Log submitted. ${proposals.length} potential delay${proposals.length > 1 ? 's' : ''} flagged — review in Tasks.`,
          { duration: 6000 }
        );
      } else {
        toast.success('Daily log submitted!');
      }
      setShowSubmitConfirm(false);
      qc.invalidateQueries(['my-log-today']);
      navigate('/daily-logs');
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to submit log.'),
  });

  const addEntry = () => setEntries(e => [...e, createBlankEntry()]);
  const removeEntry = id => setEntries(e => e.filter(en => en._id !== id));
  const updateEntry = (id, field, value) => setEntries(e => e.map(en => en._id === id ? { ...en, [field]: value } : en));
  const addTaskToEntry = id => setEntries(e => e.map(en => en._id === id ? { ...en, tasks: [...en.tasks, { task_id: '', notes: '', status_update: '' }] } : en));
  const updateTask = (eid, ti, field, val) => setEntries(e => e.map(en => en._id === eid ? { ...en, tasks: en.tasks.map((t, i) => i === ti ? { ...t, [field]: val } : t) } : en));
  const removeTask = (eid, ti) => setEntries(e => e.map(en => en._id === eid ? { ...en, tasks: en.tasks.filter((_, i) => i !== ti) } : en));
  const addConsumableToEntry = id => setEntries(e => e.map(en => en._id === id ? { ...en, consumables: [...en.consumables, { consumable_id: '', quantity_used: '', notes: '' }] } : en));
  const updateConsumable = (eid, ci, field, val) => setEntries(e => e.map(en => en._id === eid ? { ...en, consumables: en.consumables.map((c, i) => i === ci ? { ...c, [field]: val } : c) } : en));
  const removeConsumable = (eid, ci) => setEntries(e => e.map(en => en._id === eid ? { ...en, consumables: en.consumables.filter((_, i) => i !== ci) } : en));

  const handleSaveEntry = async (entry) => {
    if (!entry.project_id) { toast.error('Select a project.'); return; }
    if (!entry.hours_spent || parseFloat(entry.hours_spent) <= 0) { toast.error('Enter hours spent.'); return; }
    try {
      await saveMutation.mutateAsync({
        project_id: parseInt(entry.project_id),
        hours_spent: parseFloat(entry.hours_spent),
        work_completed: entry.work_completed,
        issues_blockers: entry.issues_blockers,
        next_steps: entry.next_steps,
        additional_notes: entry.additional_notes,
        task_updates: entry.tasks.filter(t => t.task_id).map(t => ({ task_id: parseInt(t.task_id), notes: t.notes, status_update: t.status_update || null })),
        consumables: entry.consumables.filter(c => c.consumable_id && c.quantity_used).map(c => ({ consumable_id: parseInt(c.consumable_id), quantity_used: parseFloat(c.quantity_used), notes: c.notes })),
      });
      toast.success('Entry saved.');
    } catch {}
  };

  const totalHours = entries.reduce((sum, e) => sum + (parseFloat(e.hours_spent) || 0), 0);

  if (logLoading) return <LoadingState />;
  if (existingLog?.submitted_at) {
    return (
      <div>
        <PageHeader title="Today's log" subtitle={formatDate(new Date())}
          action={<Button variant="secondary" onClick={() => navigate('/daily-logs')}>← Back</Button>} />
        <Card><EmptyState title="Log already submitted"
          description={`Submitted at ${formatDate(existingLog.submitted_at, 'h:mm a')}.`}
          action={<Button variant="secondary" onClick={() => navigate('/daily-logs')}>View all logs</Button>} /></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Today's log"
        subtitle={formatDate(new Date(), 'EEEE, MMMM d, yyyy')}
        action={
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            {totalHours > 0 && <span className="total-hours-badge">Total: {formatHours(totalHours)}</span>}
            <Button variant="secondary" onClick={() => navigate('/daily-logs')}>Cancel</Button>
            <Button variant="primary" onClick={() => setShowSubmitConfirm(true)}
              disabled={entries.every(e => !e.project_id)}>Submit log</Button>
          </div>
        }
      />

      <div className="log-entries">
        {entries.map((entry, idx) => (
          <ProjectEntry key={entry._id} entry={entry} idx={idx}
            projects={projects || []} consumables={consumables || []}
            onUpdate={(f, v) => updateEntry(entry._id, f, v)}
            onRemove={() => removeEntry(entry._id)}
            onSave={() => handleSaveEntry(entry)}
            onAddTask={() => addTaskToEntry(entry._id)}
            onUpdateTask={(ti, f, v) => updateTask(entry._id, ti, f, v)}
            onRemoveTask={ti => removeTask(entry._id, ti)}
            onAddConsumable={() => addConsumableToEntry(entry._id)}
            onUpdateConsumable={(ci, f, v) => updateConsumable(entry._id, ci, f, v)}
            onRemoveConsumable={ci => removeConsumable(entry._id, ci)}
            onConsumableAdded={() => qc.invalidateQueries(['consumables-dropdown'])}
            canRemove={entries.length > 1}
            saving={saveMutation.isPending}
          />
        ))}
      </div>

      <div className="add-project-bar">
        <Button variant="secondary" onClick={addEntry}>+ Add project</Button>
        <p className="add-project-hint">Worked on multiple projects today? Add a separate entry for each.</p>
      </div>

      <Modal open={showSubmitConfirm} onClose={() => setShowSubmitConfirm(false)} title="Submit today's log?" size="sm">
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Once submitted your log is locked for the day. Total hours:
          <strong style={{ color: 'var(--text-primary)' }}> {formatHours(totalHours)}</strong>
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setShowSubmitConfirm(false)}>Go back</Button>
          <Button variant="primary" loading={submitMutation.isPending} onClick={() => submitMutation.mutate()}>Submit</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ---- Log detail (read-only) ---- */
const REVISION_FIELD_LABELS = {
  work_completed:    'Work completed',
  issues_blockers:   'Issues / blockers',
  next_steps:        'Next steps',
  additional_notes:  'Additional notes',
};

function RevisionHistory({ revisions }) {
  if (!revisions?.length) return null;
  return (
    <Card style={{ marginTop: '1.5rem' }}>
      <CardHeader title="Revision history" subtitle="Who sent this back, what changed, and when" />
      <div className="revision-timeline">
        {revisions.map(r => (
          <div key={r.id} className="revision-entry" style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong style={{ fontSize: '0.875rem' }}>
                {r.action === 'sent_back' && `${r.actor_name} sent this back for revision`}
                {r.action === 'field_edit' && `${r.actor_name} edited ${REVISION_FIELD_LABELS[Object.keys(r.field_changes || {})[0]] || 'an entry'}`}
                {r.action === 'resubmitted' && `${r.actor_name} resubmitted`}
              </strong>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {formatDate(r.created_at, 'MMM d, yyyy h:mm a')}
              </span>
            </div>
            {r.reason && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '4px' }}>"{r.reason}"</p>
            )}
            {r.field_changes && Object.entries(r.field_changes).map(([field, diff]) => (
              <div key={field} style={{ fontSize: '0.8125rem', marginTop: '6px', background: 'var(--bg-raised)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.75rem' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '2px' }}>{REVISION_FIELD_LABELS[field] || field}</div>
                <div style={{ color: 'var(--danger)', textDecoration: 'line-through' }}>{diff.old || '(empty)'}</div>
                <div style={{ color: 'var(--success)' }}>{diff.new || '(empty)'}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function RevisableEntry({ entry, logId, editable, onSaved }) {
  const [form, setForm] = useState({
    work_completed:   entry.work_completed || '',
    issues_blockers:  entry.issues_blockers || '',
    next_steps:       entry.next_steps || '',
    additional_notes: entry.additional_notes || '',
  });

  const mutation = useMutation({
    mutationFn: () => api.patch(`/daily-logs/${logId}/entries/${entry.id}/revise`, form),
    onSuccess: () => { toast.success('Entry updated.'); onSaved(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to save changes.'),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Card className={`entry-card ${editable ? '' : 'entry-card--readonly'}`}>
      <div className="entry-header">
        <div className="entry-header-left">
          <Badge variant="muted">{entry.project_code}</Badge>
          <span className="entry-project-name">{entry.project_name}</span>
          <span className="hours-display">{formatHours(entry.hours_spent)}</span>
        </div>
        {editable && (
          <Button variant="primary" size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Save changes
          </Button>
        )}
      </div>

      {editable ? (
        <div className="notes-grid">
          <Textarea label="Work completed" value={form.work_completed} onChange={e => set('work_completed', e.target.value)} rows={3} />
          <Textarea label="Issues / blockers" value={form.issues_blockers} onChange={e => set('issues_blockers', e.target.value)} rows={3} />
          <Textarea label="Next steps" value={form.next_steps} onChange={e => set('next_steps', e.target.value)} rows={3} />
          <Textarea label="Additional notes" value={form.additional_notes} onChange={e => set('additional_notes', e.target.value)} rows={2} />
        </div>
      ) : (
        <div className="readonly-notes">
          {entry.work_completed && <div className="note-section"><span className="note-label">Work completed</span><p>{entry.work_completed}</p></div>}
          {entry.issues_blockers && <div className="note-section"><span className="note-label">Issues / blockers</span><p>{entry.issues_blockers}</p></div>}
          {entry.next_steps && <div className="note-section"><span className="note-label">Next steps</span><p>{entry.next_steps}</p></div>}
          {entry.additional_notes && <div className="note-section"><span className="note-label">Additional notes</span><p>{entry.additional_notes}</p></div>}
        </div>
      )}

      {entry.tasks?.length > 0 && (
        <div className="entry-sub-section">
          <h4 className="sub-section-title">Tasks</h4>
          <Table>
            <thead><tr><Th>Task</Th><Th>Status update</Th><Th>Notes</Th></tr></thead>
            <tbody>
              {entry.tasks.map(t => (
                <tr key={t.task_id}>
                  <Td>{t.task_title}</Td>
                  <Td>{t.status_update ? <Badge variant={t.status_update === 'complete' ? 'success' : t.status_update === 'blocked' ? 'danger' : 'accent'}>{t.status_update.replace(/_/g, ' ')}</Badge> : <span style={{ color: 'var(--text-muted)' }}>No change</span>}</Td>
                  <Td>{t.notes || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {entry.consumables?.length > 0 && (
        <div className="entry-sub-section">
          <h4 className="sub-section-title">Consumables used</h4>
          <Table>
            <thead><tr><Th>Item</Th><Th>Category</Th><Th>Quantity</Th><Th>Notes</Th></tr></thead>
            <tbody>
              {entry.consumables.map((c, ci) => (
                <tr key={ci}>
                  <Td>{c.name}</Td>
                  <Td><Badge variant="muted">{c.category}</Badge></Td>
                  <Td>{c.quantity_used} {c.unit}</Td>
                  <Td>{c.notes || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function LogDetail() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, hasRole } = useAuth();
  const id = window.location.pathname.split('/').pop();
  const { data: log, isLoading } = useQuery({
    queryKey: ['daily-log', id],
    queryFn: () => api.get(`/daily-logs/${id}`).then(r => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries(['daily-log', id]);
    qc.invalidateQueries(['daily-logs']);
    qc.invalidateQueries(['my-logs-needing-revision']);
  };

  const requestRevisionMutation = useMutation({
    mutationFn: reason => api.post(`/daily-logs/${id}/request-revision`, { reason }),
    onSuccess: () => { toast.success('Sent back for revision.'); invalidate(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to send back.'),
  });

  const resubmitMutation = useMutation({
    mutationFn: () => api.post(`/daily-logs/${id}/resubmit`),
    onSuccess: () => { toast.success('Resubmitted.'); invalidate(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to resubmit.'),
  });

  const handleRequestRevision = () => {
    const reason = window.prompt('Reason for sending this log back for revision:');
    if (!reason) return;
    requestRevisionMutation.mutate(reason);
  };

  if (isLoading) return <LoadingState />;
  if (!log) return <EmptyState title="Log not found" action={<Button onClick={() => navigate('/daily-logs')}>Back</Button>} />;

  const isOwnLog   = user?.id === log.user_id;
  const canReview  = hasRole('ops_manager', 'ceo');
  const isEditable = isOwnLog && log.status === 'needs_revision';

  return (
    <div>
      <PageHeader
        title={`${log.employee}'s log`}
        subtitle={formatDate(log.log_date, 'EEEE, MMMM d, yyyy')}
        action={
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <LogStatusBadge status={log.status} />
            {canReview && log.status === 'submitted' && (
              <Button variant="danger" loading={requestRevisionMutation.isPending} onClick={handleRequestRevision}>
                Send back for revision
              </Button>
            )}
            {isEditable && (
              <Button variant="primary" loading={resubmitMutation.isPending} onClick={() => resubmitMutation.mutate()}>
                Resubmit
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/daily-logs')}>← Back</Button>
          </div>
        }
      />

      {log.status === 'needs_revision' && (
        <Card style={{ marginBottom: '1.25rem', borderColor: 'var(--danger)' }}>
          <p style={{ fontSize: '0.875rem' }}>
            <strong>{log.revision_requested_by_name}</strong> sent this back for revision
            {log.revision_requested_at && <> on {formatDate(log.revision_requested_at, 'MMM d, yyyy h:mm a')}</>}:
          </p>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.375rem' }}>"{log.revision_reason}"</p>
          {isEditable && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Edit the entries below, then click Resubmit.
            </p>
          )}
        </Card>
      )}

      <div className="log-detail-summary stats-row">
        <StatCard label="Total hours" value={formatHours(log.total_hours)} accent />
        <StatCard label="Projects" value={log.projects_worked} />
      </div>

      {log.entries?.map(entry => (
        <RevisableEntry
          key={entry.id}
          entry={entry}
          logId={log.log_id}
          editable={isEditable}
          onSaved={invalidate}
        />
      ))}

      <RevisionHistory revisions={log.revisions} />
    </div>
  );
}

export default function DailyLogsPage() {
  return (
    <Routes>
      <Route index element={<DailyLogsList />} />
      <Route path="today" element={<TodayLog />} />
      <Route path=":id" element={<LogDetail />} />
    </Routes>
  );
}
