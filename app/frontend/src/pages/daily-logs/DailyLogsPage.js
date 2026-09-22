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
  const { hasRole } = useAuth();
  const navigate = useNavigate();
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
    enabled: hasRole('lab_tech'),
  });

  const { data: missing } = useQuery({
    queryKey: ['missing-logs'],
    queryFn: () => api.get('/daily-logs/missing').then(r => r.data),
    enabled: hasRole('ops_manager'),
  });

  return (
    <div>
      <PageHeader
        title="Daily logs"
        subtitle="Track daily progress, hours, and consumable usage per project"
        action={
          hasRole('lab_tech') && (
            <Button variant="primary" onClick={() => navigate('/daily-logs/today')}>
              {todayLog?.submitted_at ? "View today's log" : '+ Log today'}
            </Button>
          )
        }
      />

      <div className="stats-row">
        {hasRole('ops_manager') && (
          <StatCard label="Missing logs" value={missing?.length ?? '—'} sub="from yesterday" danger={missing?.length > 0} />
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
          <CardHeader title="Missing logs — yesterday" />
          <div className="missing-list">
            {missing.map(m => (
              <div key={m.id} className="missing-row">
                <span className="missing-name">{m.full_name}</span>
                <Badge variant="danger">Not submitted</Badge>
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
              <tr key={log.log_id} onClick={() => navigate(`/daily-logs/${log.log_id}`)} style={{ cursor: 'pointer' }}>
                <Td>{formatDate(log.log_date)}</Td>
                <Td>{log.employee}</Td>
                <Td>
                  <div className="project-code-list">
                    {log.project_codes?.map(code => <Badge key={code} variant="muted">{code}</Badge>)}
                  </div>
                </Td>
                <Td>{formatHours(log.total_hours)}</Td>
                <Td>{log.submitted_at ? <Badge variant="success">Submitted</Badge> : <Badge variant="warning">Draft</Badge>}</Td>
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
function LogDetail() {
  const navigate = useNavigate();
  const id = window.location.pathname.split('/').pop();
  const { data: log, isLoading } = useQuery({
    queryKey: ['daily-log', id],
    queryFn: () => api.get(`/daily-logs/${id}`).then(r => r.data),
  });

  if (isLoading) return <LoadingState />;
  if (!log) return <EmptyState title="Log not found" action={<Button onClick={() => navigate('/daily-logs')}>Back</Button>} />;

  return (
    <div>
      <PageHeader
        title={`${log.employee}'s log`}
        subtitle={formatDate(log.log_date, 'EEEE, MMMM d, yyyy')}
        action={
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <Badge variant={log.submitted_at ? 'success' : 'warning'}>{log.submitted_at ? 'Submitted' : 'Draft'}</Badge>
            <Button variant="secondary" onClick={() => navigate('/daily-logs')}>← Back</Button>
          </div>
        }
      />

      <div className="log-detail-summary stats-row">
        <StatCard label="Total hours" value={formatHours(log.total_hours)} accent />
        <StatCard label="Projects" value={log.projects_worked} />
      </div>

      {log.entries?.map(entry => (
        <Card key={entry.id} className="entry-card entry-card--readonly">
          <div className="entry-header">
            <div className="entry-header-left">
              <Badge variant="muted">{entry.project_code}</Badge>
              <span className="entry-project-name">{entry.project_name}</span>
              <span className="hours-display">{formatHours(entry.hours_spent)}</span>
            </div>
          </div>
          <div className="readonly-notes">
            {entry.work_completed && <div className="note-section"><span className="note-label">Work completed</span><p>{entry.work_completed}</p></div>}
            {entry.issues_blockers && <div className="note-section"><span className="note-label">Issues / blockers</span><p>{entry.issues_blockers}</p></div>}
            {entry.next_steps && <div className="note-section"><span className="note-label">Next steps</span><p>{entry.next_steps}</p></div>}
            {entry.additional_notes && <div className="note-section"><span className="note-label">Additional notes</span><p>{entry.additional_notes}</p></div>}
          </div>
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
      ))}
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
