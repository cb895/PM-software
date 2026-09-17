import React, { useState, useMemo, useRef } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, Card, Button, Badge, Table, Th, Td,
  EmptyState, LoadingState, Modal, Input, Textarea,
  StatCard, PriorityBadge
} from '../../components/ui/UI';
import { formatDate } from '../../utils/format';
import toast from 'react-hot-toast';
import './TasksPage.css';

/* ---- Status helpers ---- */
function StatusBadge({ status }) {
  const map = {
    not_started: 'muted',
    in_progress: 'accent',
    blocked:     'danger',
    complete:    'success',
  };
  return <Badge variant={map[status] || 'muted'}>{status?.replace(/_/g, ' ')}</Badge>;
}

const STATUS_COLORS = {
  not_started: 'var(--text-muted)',
  in_progress: 'var(--accent)',
  blocked:     'var(--danger)',
  complete:    'var(--accent-dim)',
};

/* ============================================================
   Tasks Page — list + gantt toggle
   ============================================================ */
function TasksMain() {
  const { hasRole } = useAuth();
  const [view, setView]               = useState('list');
  const [projectFilter, setProject]   = useState('');
  const [statusFilter, setStatus]     = useState('');
  const [showCreate, setShowCreate]   = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const qc = useQueryClient();

  const { data: projects } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects?active=true').then(r => r.data),
  });

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks', projectFilter, statusFilter],
    queryFn: () => api.get('/tasks', {
      params: {
        project_id: projectFilter || undefined,
        status:     statusFilter  || undefined,
      }
    }).then(r => r.data),
  });

  const stats = useMemo(() => ({
    total:       tasks?.length ?? 0,
    complete:    tasks?.filter(t => t.status === 'complete').length    ?? 0,
    in_progress: tasks?.filter(t => t.status === 'in_progress').length ?? 0,
    blocked:     tasks?.filter(t => t.status === 'blocked').length     ?? 0,
    milestones:  tasks?.filter(t => t.is_milestone).length             ?? 0,
  }), [tasks]);

  // Only parent tasks for Gantt (exclude subtasks)
  const parentTasks = useMemo(() =>
    (tasks || []).filter(t => !t.parent_task_id), [tasks]);

  return (
    <div>
      <PageHeader
        title="Tasks & Gantt chart"
        subtitle="Project task tracking and timeline view"
        action={
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div className="view-toggle">
              <button className={`view-pill ${view === 'list'  ? 'view-pill--active' : ''}`} onClick={() => setView('list')}>List</button>
              <button className={`view-pill ${view === 'gantt' ? 'view-pill--active' : ''}`} onClick={() => setView('gantt')}>Gantt</button>
            </div>
            {hasRole('ops_manager') && (
              <Button variant="secondary" onClick={() => setShowTemplates(v => !v)}>Templates</Button>
            <Button variant="primary" onClick={() => setShowCreate(true)}>+ New task</Button>
            )}
          </div>
        }
      />

      <div className="stats-row">
        <StatCard label="Total tasks"  value={stats.total} />
        <StatCard label="In progress"  value={stats.in_progress} accent />
        <StatCard label="Complete"     value={stats.complete} />
        <StatCard label="Blocked"      value={stats.blocked} danger={stats.blocked > 0} />
        <StatCard label="Milestones"   value={stats.milestones} />
      </div>

      {/* Filters */}
      <Card className="task-filters">
        <div className="filter-row">
          <div className="field">
            <select className="field-input" value={projectFilter}
              onChange={e => setProject(e.target.value)}>
              <option value="">All projects</option>
              {projects?.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>
          <div className="field">
            <select className="field-input" value={statusFilter}
              onChange={e => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="blocked">Blocked</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          {(projectFilter || statusFilter) && (
            <Button variant="ghost" size="sm"
              onClick={() => { setProject(''); setStatus(''); }}>Clear</Button>
          )}
        </div>
      </Card>

      {showTemplates && <TemplatesPanel onClose={() => setShowTemplates(false)} />}
      <DelayProposalPanel />
      {isLoading ? <LoadingState /> : !tasks?.length ? (
        <EmptyState title="No tasks found"
          action={hasRole('ops_manager') && (
            <Button variant="primary" onClick={() => setShowCreate(true)}>Create task</Button>
          )}
        />
      ) : view === 'list' ? (
        <TaskList tasks={tasks} onRefresh={() => qc.invalidateQueries(['tasks'])} />
      ) : (
        <GanttChart tasks={parentTasks} />
      )}

      {hasRole('ops_manager', 'ceo') && (
        <CreateTaskModal
          open={showCreate}
          projects={projects || []}
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); qc.invalidateQueries(['tasks']); }}
        />
      )}
    </div>
  );
}

/* ============================================================
   Task List — grouped by task_group
   ============================================================ */
function TaskList({ tasks, onRefresh }) {
  const { hasRole } = useAuth();
  const [editTask, setEditTask] = useState(null);
  const qc = useQueryClient();

  // Group by task_group
  const grouped = useMemo(() => {
    const map = {};
    tasks.forEach(t => {
      const g = t.task_group || 'Ungrouped';
      if (!map[g]) map[g] = [];
      map[g].push(t);
    });
    return map;
  }, [tasks]);

  const updateStatus = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/tasks/${id}/status`, { status }),
    onSuccess: () => { toast.success('Status updated.'); qc.invalidateQueries(['tasks']); },
    onError: () => toast.error('Failed to update status.'),
  });

  return (
    <div className="task-list-groups">
      {Object.entries(grouped).map(([group, groupTasks]) => (
        <div key={group} className="task-group">
          <div className="task-group-header">
            <h3 className="task-group-title">{group}</h3>
            <span className="task-group-count">{groupTasks.length} tasks</span>
          </div>

          <Table>
            <thead>
              <tr>
                <Th>Task</Th>
                <Th>Assignees</Th>
                <Th>Status</Th>
                <Th>Priority</Th>
                <Th>Planned start</Th>
                <Th>Planned end</Th>
                <Th>Progress</Th>
              </tr>
            </thead>
            <tbody>
              {groupTasks.map(task => (
                <React.Fragment key={task.id}>
                  <tr className={task.is_milestone ? 'milestone-row' : ''}>
                    <Td>
                      <div className="task-title-cell">
                        {task.is_milestone && <span className="milestone-star" title="Milestone">★</span>}
                        <span className="task-title"
                          style={{ paddingLeft: task.parent_task_id ? '1.25rem' : 0 }}>
                          {task.title}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <div className="assignee-list">
                        {task.assignees?.map(a => (
                          <span key={a} className="assignee-chip" title={a}>
                            {a.split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </span>
                        ))}
                      </div>
                    </Td>
                    <Td>
                      {hasRole('ops_manager') ? (
                        <select
                          className="field-input status-select"
                          value={task.status}
                          onChange={e => updateStatus.mutate({ id: task.id, status: e.target.value })}
                        >
                          <option value="not_started">Not started</option>
                          <option value="in_progress">In progress</option>
                          <option value="blocked">Blocked</option>
                          <option value="complete">Complete</option>
                        </select>
                      ) : <StatusBadge status={task.status} />}
                    </Td>
                    <Td><PriorityBadge priority={task.priority} /></Td>
                    <Td>{formatDate(task.planned_start)}</Td>
                    <Td>
                      <span className={isOverdue(task) ? 'overdue-date' : ''}>
                        {formatDate(task.planned_end)}
                      </span>
                    </Td>
                    <Td>
                      {hasRole('ops_manager', 'ceo') && (
                        <Button variant="ghost" size="sm" onClick={() => setEditTask(task)}>Edit</Button>
                      )}
                    </Td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </Table>
        </div>
      ))}

      {editTask && hasRole('ops_manager', 'ceo') && (
        <EditTaskModal
          task={editTask}
          onClose={() => setEditTask(null)}
          onSuccess={() => { setEditTask(null); qc.invalidateQueries(['tasks']); }}
        />
      )}
    </div>
  );
}

function isOverdue(task) {
  if (task.status === 'complete') return false;
  if (!task.planned_end) return false;
  return new Date(task.planned_end) < new Date();
}

/* ============================================================
   Gantt Chart — custom SVG implementation
   ============================================================ */
function GanttChart({ tasks }) {
  const containerRef = useRef(null);

  const today = new Date();

  // Compute date range from all tasks
  const { minDate, maxDate, totalDays } = useMemo(() => {
    const dates = tasks.flatMap(t => [
      t.planned_start ? new Date(t.planned_start) : null,
      t.planned_end   ? new Date(t.planned_end)   : null,
    ]).filter(Boolean);

    if (!dates.length) {
      const min = new Date(); min.setMonth(min.getMonth() - 1);
      const max = new Date(); max.setMonth(max.getMonth() + 3);
      return { minDate: min, maxDate: max, totalDays: 120 };
    }

    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    // Pad by 2 weeks each side
    min.setDate(min.getDate() - 14);
    max.setDate(max.getDate() + 14);
    const totalDays = Math.ceil((max - min) / (1000 * 60 * 60 * 24));
    return { minDate: min, maxDate: max, totalDays };
  }, [tasks]);

  // Layout constants
  const LABEL_W   = 220;
  const ROW_H     = 36;
  const HEADER_H  = 48;
  const BAR_H     = 18;
  const BAR_Y_OFF = (ROW_H - BAR_H) / 2;

  // Group tasks
  const grouped = useMemo(() => {
    const map = {};
    tasks.forEach(t => {
      const g = t.task_group || 'Ungrouped';
      if (!map[g]) map[g] = [];
      map[g].push(t);
    });
    return Object.entries(map);
  }, [tasks]);

  // Build flat row list with group headers
  const rows = useMemo(() => {
    const result = [];
    grouped.forEach(([group, groupTasks]) => {
      result.push({ type: 'group', label: group });
      groupTasks.forEach(t => result.push({ type: 'task', task: t }));
    });
    return result;
  }, [grouped]);

  const svgHeight = HEADER_H + rows.length * ROW_H + 20;

  // Convert date to x position in the timeline area
  const dateToX = (date) => {
    if (!date) return null;
    const d = new Date(date);
    const days = (d - minDate) / (1000 * 60 * 60 * 24);
    return LABEL_W + (days / totalDays) * 100 + '%'; // returns percentage string
  };

  // We need pixel-based x — use fixed timeline width
  const TIMELINE_W = 900;
  const TOTAL_W = LABEL_W + TIMELINE_W;

  const daysToPx = (days) => (days / totalDays) * TIMELINE_W;

  const dateToPx = (date) => {
    if (!date) return null;
    const d = new Date(date);
    const days = (d - minDate) / (1000 * 60 * 60 * 24);
    return LABEL_W + daysToPx(days);
  };

  // Month labels
  const monthLabels = useMemo(() => {
    const labels = [];
    const cur = new Date(minDate);
    cur.setDate(1);
    while (cur <= maxDate) {
      const x = dateToPx(cur);
      if (x >= LABEL_W && x <= TOTAL_W) {
        labels.push({
          x,
          label: cur.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        });
      }
      cur.setMonth(cur.getMonth() + 1);
    }
    return labels;
  }, [minDate, maxDate, totalDays]);

  const todayX = dateToPx(today);

  return (
    <Card className="gantt-card" padding={false}>
      <div className="gantt-scroll-wrapper" ref={containerRef}>
        <svg
          width={TOTAL_W}
          height={svgHeight}
          className="gantt-svg"
          role="img"
          aria-label="Project Gantt chart"
        >
          {/* Background */}
          <rect x="0" y="0" width={TOTAL_W} height={svgHeight} fill="var(--bg-surface)" />

          {/* Label column background */}
          <rect x="0" y="0" width={LABEL_W} height={svgHeight} fill="var(--bg-raised)" />

          {/* Header row */}
          <rect x="0" y="0" width={TOTAL_W} height={HEADER_H} fill="var(--bg-raised)" />
          <line x1="0" y1={HEADER_H} x2={TOTAL_W} y2={HEADER_H} stroke="var(--border)" strokeWidth="1" />
          <text x="12" y={HEADER_H / 2} dominantBaseline="central"
            fontSize="12" fontWeight="500" fill="var(--text-muted)" fontFamily="var(--font-sans)">
            Task
          </text>

          {/* Month labels */}
          {monthLabels.map((m, i) => (
            <g key={i}>
              <line x1={m.x} y1={0} x2={m.x} y2={svgHeight}
                stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.5" />
              <text x={m.x + 6} y={HEADER_H / 2} dominantBaseline="central"
                fontSize="11" fill="var(--text-muted)" fontFamily="var(--font-sans)">
                {m.label}
              </text>
            </g>
          ))}

          {/* Today line */}
          {todayX > LABEL_W && todayX < TOTAL_W && (
            <g>
              <line x1={todayX} y1={0} x2={todayX} y2={svgHeight}
                stroke="var(--accent)" strokeWidth="1.5" opacity="0.6" />
              <text x={todayX + 4} y={14} fontSize="10" fill="var(--accent)"
                fontFamily="var(--font-sans)" fontWeight="500">
                Today
              </text>
            </g>
          )}

          {/* Rows */}
          {rows.map((row, i) => {
            const y = HEADER_H + i * ROW_H;

            if (row.type === 'group') {
              return (
                <g key={`group-${i}`}>
                  <rect x="0" y={y} width={TOTAL_W} height={ROW_H}
                    fill="var(--bg-raised)" opacity="0.7" />
                  <text x="12" y={y + ROW_H / 2} dominantBaseline="central"
                    fontSize="12" fontWeight="600" fill="var(--text-secondary)"
                    fontFamily="var(--font-sans)">
                    {row.label}
                  </text>
                  <line x1="0" y1={y + ROW_H} x2={TOTAL_W} y2={y + ROW_H}
                    stroke="var(--border)" strokeWidth="0.5" />
                </g>
              );
            }

            const task = row.task;
            const startX = task.planned_start ? dateToPx(task.planned_start) : null;
            const endX   = task.planned_end   ? dateToPx(task.planned_end)   : null;
            const barW   = (startX && endX) ? Math.max(endX - startX, 4) : 0;
            const barColor = task.is_milestone
              ? 'var(--warning)'
              : STATUS_COLORS[task.status] || 'var(--text-muted)';

            // Truncate label
            const maxChars = 28;
            const label = task.title.length > maxChars
              ? task.title.slice(0, maxChars) + '…'
              : task.title;

            return (
              <g key={`task-${task.id}`}>
                <rect x="0" y={y} width={TOTAL_W} height={ROW_H} fill="transparent" />
                <line x1="0" y1={y + ROW_H} x2={TOTAL_W} y2={y + ROW_H}
                  stroke="var(--border)" strokeWidth="0.5" opacity="0.4" />

                {/* Label */}
                {task.is_milestone && (
                  <text x="10" y={y + ROW_H / 2} dominantBaseline="central"
                    fontSize="11" fill="var(--warning)" fontFamily="var(--font-sans)">★</text>
                )}
                <text x={task.is_milestone ? 24 : 12} y={y + ROW_H / 2}
                  dominantBaseline="central" fontSize="12"
                  fill={task.status === 'complete' ? 'var(--text-muted)' : 'var(--text-primary)'}
                  fontFamily="var(--font-sans)"
                  textDecoration={task.status === 'complete' ? 'line-through' : 'none'}>
                  {label}
                </text>

                {/* Bar */}
                {startX && endX && !task.is_milestone && (
                  <g>
                    {/* Track */}
                    <rect x={LABEL_W} y={y + BAR_Y_OFF} width={TIMELINE_W} height={BAR_H}
                      fill="var(--bg-raised)" rx="3" />
                    {/* Bar */}
                    <rect x={startX} y={y + BAR_Y_OFF} width={barW} height={BAR_H}
                      fill={barColor} rx="3" opacity={task.status === 'complete' ? 0.5 : 0.85} />
                    {/* Actual progress overlay if in progress */}
                    {task.status === 'in_progress' && task.actual_start && (
                      <rect
                        x={Math.max(startX, dateToPx(task.actual_start))}
                        y={y + BAR_Y_OFF + 2}
                        width={Math.min(todayX, endX) - Math.max(startX, dateToPx(task.actual_start))}
                        height={BAR_H - 4}
                        fill="var(--accent)"
                        rx="2"
                        opacity="0.4"
                      />
                    )}
                  </g>
                )}

                {/* Milestone diamond */}
                {task.is_milestone && endX && (
                  <g transform={`translate(${endX}, ${y + ROW_H / 2})`}>
                    <polygon
                      points="0,-9 9,0 0,9 -9,0"
                      fill="var(--warning)"
                      opacity="0.9"
                    />
                  </g>
                )}

                {/* Overdue marker */}
                {isOverdue(task) && endX && (
                  <circle cx={endX} cy={y + ROW_H / 2} r="4"
                    fill="var(--danger)" opacity="0.8" />
                )}
              </g>
            );
          })}

          {/* Label column right border */}
          <line x1={LABEL_W} y1="0" x2={LABEL_W} y2={svgHeight}
            stroke="var(--border)" strokeWidth="1" />
        </svg>
      </div>

      {/* Legend */}
      <div className="gantt-legend">
        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--accent)' }} />In progress</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--accent-dim)' }} />Complete</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--danger)' }} />Blocked</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--text-muted)' }} />Not started</div>
        <div className="legend-item"><span className="legend-diamond" />Milestone</div>
        <div className="legend-item"><span className="legend-line" style={{ background: 'var(--accent)' }} />Today</div>
      </div>
    </Card>
  );
}

/* ============================================================
   Create Task Modal
   ============================================================ */
function CreateTaskModal({ open, projects, onClose, onSuccess }) {
  const [form, setForm] = useState({
    project_id: '', title: '', description: '', task_group: '',
    priority: 'normal', planned_start: '', planned_end: '',
    is_milestone: false, parent_task_id: '',
    assignee_ids: [],
  });

  const { data: users } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/tasks/users').then(r => r.data),
    enabled: open,
  });

  const { data: projectTasks } = useQuery({
    queryKey: ['project-tasks-for-parent', form.project_id],
    queryFn: () => api.get('/tasks', { params: { project_id: form.project_id } }).then(r => r.data),
    enabled: !!form.project_id,
  });

  const mutation = useMutation({
    mutationFn: data => api.post('/tasks', data),
    onSuccess: () => { toast.success('Task created.'); onSuccess(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to create task.'),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const GROUPS = ['Phase initiation', 'Material and antibody screening', 'Analytical validation', 'Documentation and report'];

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.project_id) { toast.error('Select a project.'); return; }
    if (!form.title)       { toast.error('Enter a task title.'); return; }
    mutation.mutate({
      ...form,
      project_id:     parseInt(form.project_id),
      parent_task_id: form.parent_task_id ? parseInt(form.parent_task_id) : null,
      assignee_ids:   form.assignee_ids.map(Number),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="New task" size="lg">
      <form onSubmit={handleSubmit} className="task-form">
        <div className="grid-2">
          <div className="field">
            <label className="field-label">Project *</label>
            <select className="field-input" value={form.project_id} onChange={e => set('project_id', e.target.value)}>
              <option value="">Select project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Task group</label>
            <select className="field-input" value={form.task_group} onChange={e => set('task_group', e.target.value)}>
              <option value="">No group</option>
              {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>

        <Input label="Task title *" value={form.title} onChange={e => set('title', e.target.value)}
          placeholder="e.g. Conjugation studies" />

        <Textarea label="Description" value={form.description}
          onChange={e => set('description', e.target.value)} rows={2} />

        <div className="grid-2">
          <div className="field">
            <label className="field-label">Priority</label>
            <select className="field-input" value={form.priority} onChange={e => set('priority', e.target.value)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Parent task (for subtasks)</label>
            <select className="field-input" value={form.parent_task_id}
              onChange={e => set('parent_task_id', e.target.value)}
              disabled={!form.project_id}>
              <option value="">No parent (top-level task)</option>
              {projectTasks?.filter(t => !t.parent_task_id).map(t => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid-2">
          <Input label="Planned start" type="date" value={form.planned_start}
            onChange={e => set('planned_start', e.target.value)} />
          <Input label="Planned end" type="date" value={form.planned_end}
            onChange={e => set('planned_end', e.target.value)} />
        </div>

        <div className="field">
          <label className="field-label">Assignees</label>
          <select className="field-input" multiple value={form.assignee_ids}
            onChange={e => set('assignee_ids', Array.from(e.target.selectedOptions, o => o.value))}
            style={{ height: '90px' }}>
            {users?.filter(u => u.role === 'lab_tech').map(u => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
          <span className="field-hint">Hold Ctrl / Cmd to select multiple</span>
        </div>

        <label className="checkbox-label">
          <input type="checkbox" checked={form.is_milestone}
            onChange={e => set('is_milestone', e.target.checked)} />
          <span>This is a milestone ★</span>
        </label>

        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>Create task</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ============================================================
   Edit Task Modal
   ============================================================ */
function EditTaskModal({ task, onClose, onSuccess }) {
  const [form, setForm] = useState({
    title:         task.title,
    description:   task.description || '',
    status:        task.status,
    priority:      task.priority,
    planned_start: task.planned_start?.split('T')[0] || '',
    planned_end:   task.planned_end?.split('T')[0]   || '',
    actual_start:  task.actual_start?.split('T')[0]  || '',
    actual_end:    task.actual_end?.split('T')[0]    || '',
    is_milestone:  task.is_milestone,
  });

  const mutation = useMutation({
    mutationFn: data => api.patch(`/tasks/${task.id}`, data),
    onSuccess: () => { toast.success('Task updated.'); onSuccess(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to update task.'),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal open={true} onClose={onClose} title={`Edit — ${task.title}`} size="lg">
      <form onSubmit={e => { e.preventDefault(); mutation.mutate(form); }} className="task-form">
        <Input label="Title" value={form.title} onChange={e => set('title', e.target.value)} />
        <Textarea label="Description" value={form.description}
          onChange={e => set('description', e.target.value)} rows={2} />

        <div className="grid-2">
          <div className="field">
            <label className="field-label">Status</label>
            <select className="field-input" value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="blocked">Blocked</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Priority</label>
            <select className="field-input" value={form.priority} onChange={e => set('priority', e.target.value)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        <div className="grid-2">
          <Input label="Planned start" type="date" value={form.planned_start}
            onChange={e => set('planned_start', e.target.value)} />
          <Input label="Planned end" type="date" value={form.planned_end}
            onChange={e => set('planned_end', e.target.value)} />
        </div>
        <div className="grid-2">
          <Input label="Actual start" type="date" value={form.actual_start}
            onChange={e => set('actual_start', e.target.value)} />
          <Input label="Actual end" type="date" value={form.actual_end}
            onChange={e => set('actual_end', e.target.value)} />
        </div>

        <label className="checkbox-label">
          <input type="checkbox" checked={form.is_milestone}
            onChange={e => set('is_milestone', e.target.checked)} />
          <span>Milestone ★</span>
        </label>

        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>Save changes</Button>
        </div>
      </form>
    </Modal>
  );
}


/* ============================================================
   Delay Proposal Panel — ops manager review queue
   ============================================================ */
function DelayProposalPanel() {
  const qc = useQueryClient();
  const [reviewNotes, setReviewNotes] = useState({});

  const { data: proposals } = useQuery({
    queryKey: ['delay-proposals'],
    queryFn: () => api.get('/tasks/delay-proposals?status=pending').then(r => r.data),
    refetchInterval: 60000,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, notes }) =>
      api.post(`/tasks/delay-proposals/${id}/approve`, null, { params: { review_notes: notes } }),
    onSuccess: () => {
      toast.success('Timeline updated on Gantt chart.');
      qc.invalidateQueries(['delay-proposals']);
      qc.invalidateQueries(['tasks']);
    },
    onError: () => toast.error('Failed to approve.'),
  });

  const dismissMutation = useMutation({
    mutationFn: ({ id, notes }) =>
      api.post(`/tasks/delay-proposals/${id}/dismiss`, null, { params: { review_notes: notes } }),
    onSuccess: () => {
      toast.success('Proposal dismissed.');
      qc.invalidateQueries(['delay-proposals']);
    },
    onError: () => toast.error('Failed to dismiss.'),
  });

  if (!proposals?.length) return null;

  return (
    <div className="delay-panel">
      <div className="delay-panel-title">
        <span style={{ color: 'var(--warning)' }}>⚠</span>
        Proposed timeline changes ({proposals.length})
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 400 }}>
          — detected from daily log blockers
        </span>
      </div>

      {proposals.map(p => (
        <div key={p.id} className="proposal-card">
          <div className="proposal-header">
            <div className="proposal-header-left">
              <div className="proposal-task">
                <Badge variant="muted">{p.project_code}</Badge>
                {' '}{p.task_title}
                {p.task_group && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                    — {p.task_group}
                  </span>
                )}
              </div>
              <div className="proposal-meta">
                <span className="proposal-delay">+{p.estimated_delay_days} day{p.estimated_delay_days !== 1 ? 's' : ''}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className={`confidence-dot confidence-${p.confidence}`} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {p.confidence} confidence
                  </span>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Reported by {p.proposed_by_name} · {formatDate(p.created_at)}
                </span>
              </div>
            </div>
          </div>

          <div className="proposal-body">
            <p className="proposal-reason">{p.reason}</p>

            <div className="proposal-dates">
              <span className="meta-label">Original end</span>
              <span className="date-from">{formatDate(p.original_end)}</span>
              <span className="date-arrow">→</span>
              <span className="meta-label">Proposed end</span>
              <span className="date-to">{formatDate(p.proposed_end)}</span>
            </div>

            <div className="proposal-blocker">{p.detected_from}</div>

            <Input
              placeholder="Add a note (optional)…"
              value={reviewNotes[p.id] || ''}
              onChange={e => setReviewNotes(n => ({ ...n, [p.id]: e.target.value }))}
              style={{ marginBottom: '0.75rem' }}
            />

            <div className="proposal-actions">
              <Button
                variant="primary"
                size="sm"
                onClick={() => approveMutation.mutate({ id: p.id, notes: reviewNotes[p.id] })}
                loading={approveMutation.isPending}
              >
                Approve — update Gantt
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => dismissMutation.mutate({ id: p.id, notes: reviewNotes[p.id] })}
                loading={dismissMutation.isPending}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}


/* ============================================================
   Project Templates Panel
   ============================================================ */
function TemplatesPanel({ onClose }) {
  const qc = useQueryClient();
  const [selected, setSelected]     = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [applyTarget, setApplyTarget] = useState(null);

  const { data: templates } = useQuery({
    queryKey: ['task-templates'],
    queryFn: () => api.get('/tasks/templates').then(r => r.data),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects?active=true').then(r => r.data),
  });

  const { data: detail } = useQuery({
    queryKey: ['template-detail', selected?.id],
    queryFn: () => api.get(`/tasks/templates/${selected.id}`).then(r => r.data),
    enabled: !!selected,
  });

  const deleteTmpl = useMutation({
    mutationFn: id => api.delete(`/tasks/templates/${id}`),
    onSuccess: () => { toast.success('Template deleted.'); qc.invalidateQueries(['task-templates']); setSelected(null); },
  });

  const applyMutation = useMutation({
    mutationFn: ({ templateId, projectId, startDate }) =>
      api.post(`/tasks/templates/${templateId}/apply`, { project_id: projectId, start_date: startDate }),
    onSuccess: (data) => {
      toast.success(data.data.message);
      qc.invalidateQueries(['tasks']);
      setApplyTarget(null);
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to apply template.'),
  });

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:200, display:'flex', alignItems:'flex-start', justifyContent:'flex-end', padding:'1rem' }}>
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', width:'480px', maxHeight:'90vh', overflow:'auto', display:'flex', flexDirection:'column' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'1rem 1.25rem', borderBottom:'1px solid var(--border)', background:'var(--bg-raised)' }}>
          <h3 style={{ fontSize:'1rem', fontWeight:600 }}>Project templates</h3>
          <div style={{ display:'flex', gap:'0.5rem' }}>
            <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>+ New template</Button>
            <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'1.25rem', padding:'0 4px' }}>×</button>
          </div>
        </div>

        <div style={{ padding:'1rem', display:'flex', flexDirection:'column', gap:'0.75rem' }}>
          {!templates?.length ? (
            <p style={{ color:'var(--text-muted)', fontSize:'0.875rem', textAlign:'center', padding:'1.5rem' }}>
              No templates yet. Create one to bulk-add tasks to future projects.
            </p>
          ) : templates.map(t => (
            <div key={t.id} style={{ background:'var(--bg-raised)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', padding:'0.875rem', cursor:'pointer', borderColor: selected?.id===t.id ? 'var(--accent)' : undefined }}
              onClick={() => setSelected(selected?.id===t.id ? null : t)}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:'0.9375rem' }}>{t.name}</div>
                  {t.description && <div style={{ fontSize:'0.8125rem', color:'var(--text-muted)', marginTop:'2px' }}>{t.description}</div>}
                  <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', marginTop:'4px' }}>{t.task_count} task{t.task_count!==1?'s':''}</div>
                </div>
                <div style={{ display:'flex', gap:'0.375rem' }}>
                  <Button variant="primary" size="sm" onClick={e => { e.stopPropagation(); setApplyTarget(t); }}>Apply to project</Button>
                  <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); deleteTmpl.mutate(t.id); }}>Delete</Button>
                </div>
              </div>

              {selected?.id === t.id && detail?.tasks?.length > 0 && (
                <div style={{ marginTop:'0.75rem', borderTop:'1px solid var(--border)', paddingTop:'0.75rem' }}>
                  {detail.tasks.map((tt, i) => (
                    <div key={tt.id} style={{ fontSize:'0.8125rem', color:'var(--text-secondary)', padding:'3px 0', display:'flex', gap:'0.5rem' }}>
                      <span style={{ color:'var(--text-muted)', minWidth:'20px' }}>{i+1}.</span>
                      <span>{tt.title}</span>
                      {tt.task_group && <Badge variant="muted">{tt.task_group}</Badge>}
                      {tt.offset_days > 0 && <span style={{ color:'var(--text-muted)' }}>+{tt.offset_days}d</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Create template modal */}
      {showCreate && <CreateTemplateModal onClose={() => setShowCreate(false)}
        onSuccess={() => { setShowCreate(false); qc.invalidateQueries(['task-templates']); }} />}

      {/* Apply template modal */}
      {applyTarget && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
          <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'1.5rem', width:'400px' }}>
            <h3 style={{ marginBottom:'1rem' }}>Apply "{applyTarget.name}"</h3>
            <ApplyTemplateForm
              template={applyTarget}
              projects={projects||[]}
              onApply={(projectId, startDate) => applyMutation.mutate({ templateId: applyTarget.id, projectId, startDate })}
              onCancel={() => setApplyTarget(null)}
              loading={applyMutation.isPending}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ApplyTemplateForm({ template, projects, onApply, onCancel, loading }) {
  const [projectId, setProjectId] = useState('');
  const [startDate, setStartDate] = useState('');
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
      <div className="field">
        <label className="field-label">Project *</label>
        <select className="field-input" value={projectId} onChange={e => setProjectId(e.target.value)}>
          <option value="">Select project…</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
        </select>
      </div>
      <Input label="Start date (optional)" type="date" value={startDate}
        onChange={e => setStartDate(e.target.value)}
        hint="Tasks offset from this date. Defaults to project start date." />
      <p style={{ fontSize:'0.8125rem', color:'var(--text-muted)' }}>
        {template.task_count} tasks will be created in "{projects.find(p=>p.id==projectId)?.name || 'the selected project'}".
      </p>
      <div style={{ display:'flex', gap:'0.5rem' }}>
        <Button variant="primary" loading={loading}
          disabled={!projectId}
          onClick={() => onApply(parseInt(projectId), startDate || null)}>
          Apply template
        </Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function CreateTemplateModal({ onClose, onSuccess }) {
  const qc = useQueryClient();
  const [name, setName]         = useState('');
  const [desc, setDesc]         = useState('');
  const [tasks, setTasks]       = useState([{ title:'', task_group:'', priority:'normal', offset_days:0, estimated_days:1 }]);

  const addTask    = () => setTasks(t => [...t, { title:'', task_group:'', priority:'normal', offset_days:0, estimated_days:1 }]);
  const removeTask = i => setTasks(t => t.filter((_,j) => j!==i));
  const setTask    = (i,k,v) => setTasks(t => t.map((tt,j) => j===i ? {...tt,[k]:v} : tt));

  const mutation = useMutation({
    mutationFn: async () => {
      const tmpl = await api.post('/tasks/templates', { name, description: desc });
      const tid  = tmpl.data.id;
      for (const [i, t] of tasks.entries()) {
        if (t.title) await api.post(`/tasks/templates/${tid}/tasks`, { ...t, sort_order: i });
      }
      return tid;
    },
    onSuccess: () => { toast.success('Template created.'); onSuccess(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to create template.'),
  });

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:400, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', width:'560px', maxHeight:'90vh', overflow:'auto', padding:'1.5rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'1.25rem' }}>
          <h3 style={{ fontSize:'1rem', fontWeight:600 }}>Create task template</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'1.25rem' }}>×</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
          <Input label="Template name *" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Cortisol Lateral Flow — Standard" />
          <Input label="Description" value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="When to use this template…" />
          <div style={{ fontSize:'0.875rem', fontWeight:600, color:'var(--text-secondary)', marginTop:'0.25rem' }}>Tasks</div>
          {tasks.map((t, i) => (
            <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr auto auto auto auto', gap:'0.5rem', alignItems:'flex-end', background:'var(--bg-raised)', padding:'0.75rem', borderRadius:'var(--radius-sm)' }}>
              <Input label={i===0?"Task title *":undefined} value={t.title}
                onChange={e => setTask(i,'title',e.target.value)}
                placeholder={`Task ${i+1}…`} />
              <div className="field" style={{ margin:0, minWidth:'100px' }}>
                {i===0 && <label className="field-label">Group</label>}
                <input className="field-input" value={t.task_group}
                  onChange={e => setTask(i,'task_group',e.target.value)}
                  placeholder="Phase…" />
              </div>
              <div className="field" style={{ margin:0, width:'70px' }}>
                {i===0 && <label className="field-label">+Days</label>}
                <input type="number" min="0" className="field-input" value={t.offset_days}
                  onChange={e => setTask(i,'offset_days',parseInt(e.target.value)||0)} />
              </div>
              <div className="field" style={{ margin:0, width:'70px' }}>
                {i===0 && <label className="field-label">Duration</label>}
                <input type="number" min="1" className="field-input" value={t.estimated_days}
                  onChange={e => setTask(i,'estimated_days',parseInt(e.target.value)||1)} />
              </div>
              <button onClick={() => removeTask(i)} style={{ background:'none', border:'none', color:'var(--danger)', cursor:'pointer', fontSize:'1.1rem', paddingBottom:'2px' }}>×</button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={addTask}>+ Add task</Button>
          <div style={{ display:'flex', gap:'0.75rem', paddingTop:'0.5rem', borderTop:'1px solid var(--border)' }}>
            <Button variant="primary" loading={mutation.isPending}
              onClick={() => { if(!name){toast.error('Name required');return;} mutation.mutate(); }}>
              Save template
            </Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
export default function TasksPage() {
  return (
    <Routes>
      <Route index element={<TasksMain />} />
    </Routes>
  );
}
