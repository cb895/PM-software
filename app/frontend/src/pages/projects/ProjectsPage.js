import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, Card, CardHeader, Button, Input, Textarea,
  Badge, Table, Th, Td, EmptyState, LoadingState,
  StatCard, Modal
} from '../../components/ui/UI';
import { formatDate } from '../../utils/format';
import toast from 'react-hot-toast';
import './ProjectsPage.css';

/* ============================================================
   Projects Page
   ============================================================ */
export default function ProjectsPage() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected]     = useState(null);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get('/projects').then(r => r.data),
  });

  const active   = projects?.filter(p => p.is_active)  || [];
  const inactive = projects?.filter(p => !p.is_active) || [];

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Active research and development projects"
        action={hasRole('ops_manager') && (
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            + New project
          </Button>
        )}
      />

      <div className="stats-row">
        <StatCard label="Active projects"   value={active.length}   accent />
        <StatCard label="Inactive projects" value={inactive.length} />
        <StatCard label="Total tasks"
          value={projects?.reduce((s,p) => s + (p.total_tasks||0), 0) || 0} />
        <StatCard label="Total budget"
          value={'$' + ((projects?.reduce((s,p) => s + (p.budget_allocated||0), 0) || 0) / 1000).toFixed(0) + 'k'} />
      </div>

      {isLoading ? <LoadingState /> : !projects?.length ? (
        <EmptyState
          title="No projects yet"
          subtitle="Create your first project to get started."
          action={hasRole('ops_manager') && (
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              + New project
            </Button>
          )}
        />
      ) : (
        <>
          {/* Active projects */}
          <div className="project-grid">
            {active.map(p => (
              <ProjectCard key={p.id} project={p}
                onSelect={() => setSelected(p)}
                onEdit={() => setSelected(p)} />
            ))}
          </div>

          {/* Inactive */}
          {inactive.length > 0 && (
            <>
              <h3 className="section-divider">Inactive projects</h3>
              <div className="project-grid">
                {inactive.map(p => (
                  <ProjectCard key={p.id} project={p}
                    onSelect={() => setSelected(p)}
                    onEdit={() => setSelected(p)} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Create modal */}
      <CreateProjectModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => { setShowCreate(false); qc.invalidateQueries(['projects']); }}
      />

      {/* Detail / edit panel */}
      {selected && (
        <ProjectDetailModal
          project={selected}
          onClose={() => setSelected(null)}
          onUpdate={() => { qc.invalidateQueries(['projects']); }}
        />
      )}
    </div>
  );
}

/* ---- Project card ---- */
function ProjectCard({ project: p, onSelect }) {
  const pct = p.pct_spent || 0;
  const barColor = pct >= 90 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--accent)';

  return (
    <div className={`project-card ${!p.is_active ? 'project-card--inactive' : ''}`}
      onClick={onSelect}>
      <div className="project-card-head">
        <div>
          <div className="project-code">{p.code}</div>
          <div className="project-name">{p.name}</div>
        </div>
        <Badge variant={p.is_active ? 'success' : 'muted'}>
          {p.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      {p.client && (
        <div className="project-client">Client: {p.client}</div>
      )}

      <div className="project-stats">
        <div className="project-stat">
          <span className="project-stat-val">{p.tasks_complete || 0}/{p.total_tasks || 0}</span>
          <span className="project-stat-label">Tasks done</span>
        </div>
        <div className="project-stat">
          <span className="project-stat-val">{p.tasks_in_progress || 0}</span>
          <span className="project-stat-label">In progress</span>
        </div>
        <div className="project-stat">
          <span className="project-stat-val" style={{ color: p.tasks_blocked > 0 ? 'var(--danger)' : undefined }}>
            {p.tasks_blocked || 0}
          </span>
          <span className="project-stat-label">Blocked</span>
        </div>
        <div className="project-stat">
          <span className="project-stat-val">{p.phase_count || 0}</span>
          <span className="project-stat-label">Phases</span>
        </div>
      </div>

      {p.budget_allocated > 0 && (
        <div className="project-budget">
          <div className="project-budget-row">
            <span className="project-budget-label">Budget</span>
            <span style={{ fontSize: '0.75rem', color: pct >= 80 ? 'var(--warning)' : 'var(--text-muted)' }}>
              {pct}% used
            </span>
          </div>
          <div className="budget-bar-track">
            <div className="budget-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
          </div>
          <div className="project-budget-amounts">
            <span>${(p.total_spent || 0).toLocaleString()} spent</span>
            <span>of ${(p.budget_allocated || 0).toLocaleString()}</span>
          </div>
        </div>
      )}

      {p.start_date && (
        <div className="project-dates">
          {formatDate(p.start_date)}
          {p.end_date && <> — {formatDate(p.end_date)}</>}
        </div>
      )}
    </div>
  );
}

/* ---- Create project modal ---- */
function CreateProjectModal({ open, onClose, onSuccess }) {
  const [form, setForm] = useState({
    code: '', name: '', description: '', client: '',
    start_date: '', end_date: '',
    budget_allocated: '', budget_alert_threshold: 80,
    hourly_rate: '', is_active: true,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: data => api.post('/projects', data),
    onSuccess: (_, vars) => {
      toast.success(`Project ${vars.code} created.`);
      setForm({
        code:'', name:'', description:'', client:'',
        start_date:'', end_date:'',
        budget_allocated:'', budget_alert_threshold:80,
        hourly_rate:'', is_active:true,
      });
      onSuccess();
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to create project.'),
  });

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.code) { toast.error('Enter a project code.'); return; }
    if (!form.name) { toast.error('Enter a project name.'); return; }
    mutation.mutate({
      ...form,
      code:                   form.code.toUpperCase(),
      budget_allocated:       parseFloat(form.budget_allocated) || 0,
      budget_alert_threshold: parseFloat(form.budget_alert_threshold) || 80,
      hourly_rate:            parseFloat(form.hourly_rate) || 0,
      start_date:             form.start_date || null,
      end_date:               form.end_date   || null,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Create new project" size="lg">
      <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>

        <div className="form-grid-2">
          <Input label="Project code *" value={form.code}
            onChange={e => set('code', e.target.value.toUpperCase())}
            placeholder="e.g. CORT-P2" hint="Short unique identifier — auto-uppercased" />
          <Input label="Project name *" value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. Cortisol Phase 2 — Validation" />
        </div>

        <Input label="Client / sponsor" value={form.client}
          onChange={e => set('client', e.target.value)}
          placeholder="e.g. Internal, client name…" />

        <Textarea label="Description" value={form.description}
          onChange={e => set('description', e.target.value)} rows={2}
          placeholder="Brief description of the project scope…" />

        <div className="form-grid-2">
          <Input label="Start date" type="date" value={form.start_date}
            onChange={e => set('start_date', e.target.value)} />
          <Input label="End date (target)" type="date" value={form.end_date}
            onChange={e => set('end_date', e.target.value)} />
        </div>

        <div className="form-section-divider">Budget & rates</div>

        <div className="form-grid-3">
          <Input label="Budget allocated ($)" type="number" min="0" step="100"
            value={form.budget_allocated}
            onChange={e => set('budget_allocated', e.target.value)}
            placeholder="0" hint="Total project budget" />
          <Input label="Alert threshold (%)" type="number" min="1" max="100"
            value={form.budget_alert_threshold}
            onChange={e => set('budget_alert_threshold', e.target.value)}
            hint="Notify when % spent reaches this" />
          <Input label="Hourly rate ($/hr)" type="number" min="0" step="0.50"
            value={form.hourly_rate}
            onChange={e => set('hourly_rate', e.target.value)}
            placeholder="0" hint="Used to auto-post labour costs" />
        </div>

        <label className="checkbox-label">
          <input type="checkbox" checked={form.is_active}
            onChange={e => set('is_active', e.target.checked)} />
          <span>Active project (visible in all dropdowns)</span>
        </label>

        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Create project
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- Project detail / edit modal ---- */
function ProjectDetailModal({ project, onClose, onUpdate }) {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [showPhase, setShowPhase] = useState(false);
  const [form, setForm] = useState({
    name:                   project.name,
    description:            project.description || '',
    client:                 project.client || '',
    start_date:             project.start_date || '',
    end_date:               project.end_date   || '',
    budget_allocated:       project.budget_allocated || 0,
    budget_alert_threshold: project.budget_alert_threshold || 80,
    hourly_rate:            project.hourly_rate || 0,
    is_active:              project.is_active,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const { data: detail } = useQuery({
    queryKey: ['project-detail', project.id],
    queryFn: () => api.get(`/projects/${project.id}`).then(r => r.data),
  });

  const updateMutation = useMutation({
    mutationFn: data => api.patch(`/projects/${project.id}`, data),
    onSuccess: () => {
      toast.success('Project updated.');
      setEditing(false);
      qc.invalidateQueries(['projects']);
      qc.invalidateQueries(['project-detail', project.id]);
      onUpdate();
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to update.'),
  });

  const deactivateMutation = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/deactivate`),
    onSuccess: (res) => {
      toast.success(res.data.message);
      qc.invalidateQueries(['projects']);
      onClose();
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to deactivate.'),
  });

  const reactivateMutation = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/reactivate`),
    onSuccess: (res) => {
      toast.success(res.data.message);
      qc.invalidateQueries(['projects']);
      onClose();
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to reactivate.'),
  });

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/projects/${project.id}?confirm=DELETE`),
    onSuccess: (res) => {
      toast.success(res.data.message);
      qc.invalidateQueries(['projects']);
      onClose();
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to delete project.'),
  });

  const [phaseForm, setPhaseForm] = useState({
    phase_name:'', phase_number:'', budget_allocated:'',
    hourly_rate:'', start_date:'', end_date:'',
  });

  const phaseMutation = useMutation({
    mutationFn: data => api.post(`/projects/${project.id}/phases`, data),
    onSuccess: () => {
      toast.success('Phase added.');
      setShowPhase(false);
      qc.invalidateQueries(['project-detail', project.id]);
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to add phase.'),
  });

  const pct = project.pct_spent || 0;
  const barColor = pct >= 90 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--accent)';

  return (
    <Modal open={true} onClose={onClose} title={`${project.code} — ${project.name}`} size="lg">
      <div style={{ display:'flex', flexDirection:'column', gap:'1.25rem' }}>

        {/* Status + actions */}
        <div style={{ display:'flex', gap:'0.625rem', alignItems:'center' }}>
          <Badge variant={project.is_active ? 'success' : 'muted'}>
            {project.is_active ? 'Active' : 'Inactive'}
          </Badge>
          {project.client && <span style={{ fontSize:'0.8125rem', color:'var(--text-muted)' }}>Client: {project.client}</span>}
          <div style={{ marginLeft:'auto', display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
            {hasRole('ops_manager') && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setEditing(!editing)}>
                  {editing ? 'Cancel edit' : 'Edit'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowPhase(!showPhase)}>
                  + Add phase
                </Button>
              </>
            )}
            {hasRole('ops_manager') && project.is_active && (
              <Button variant="secondary" size="sm"
                loading={deactivateMutation.isPending}
                onClick={() => deactivateMutation.mutate()}>
                Deactivate
              </Button>
            )}
            {hasRole('ops_manager') && !project.is_active && (
              <Button variant="primary" size="sm"
                loading={reactivateMutation.isPending}
                onClick={() => reactivateMutation.mutate()}>
                Reactivate
              </Button>
            )}
            {hasRole('ops_manager') && (
              <Button variant="danger" size="sm"
                onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </div>
        </div>

        {/* Edit form */}
        {editing && hasRole('ops_manager') ? (
          <div style={{ display:'flex', flexDirection:'column', gap:'1rem', background:'var(--bg-raised)', borderRadius:'var(--radius-md)', padding:'1rem' }}>
            <div className="form-grid-2">
              <Input label="Name" value={form.name} onChange={e => set('name', e.target.value)} />
              <Input label="Client" value={form.client} onChange={e => set('client', e.target.value)} />
            </div>
            <Textarea label="Description" value={form.description}
              onChange={e => set('description', e.target.value)} rows={2} />
            <div className="form-grid-2">
              <Input label="Start date" type="date" value={form.start_date}
                onChange={e => set('start_date', e.target.value)} />
              <Input label="End date" type="date" value={form.end_date}
                onChange={e => set('end_date', e.target.value)} />
            </div>
            <div className="form-grid-3">
              <Input label="Budget ($)" type="number" value={form.budget_allocated}
                onChange={e => set('budget_allocated', parseFloat(e.target.value))} />
              <Input label="Alert (%)" type="number" value={form.budget_alert_threshold}
                onChange={e => set('budget_alert_threshold', parseFloat(e.target.value))} />
              <Input label="Hourly rate ($)" type="number" value={form.hourly_rate}
                onChange={e => set('hourly_rate', parseFloat(e.target.value))} />
            </div>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.is_active}
                onChange={e => set('is_active', e.target.checked)} />
              <span>Active</span>
            </label>
            <Button variant="primary" size="sm" loading={updateMutation.isPending}
              onClick={() => updateMutation.mutate(form)}>
              Save changes
            </Button>
          </div>
        ) : (
          /* Read-only summary */
          <div className="detail-meta-grid">
            <div className="meta-item"><span className="meta-label">Dates</span>
              <span className="meta-value">{formatDate(project.start_date)}{project.end_date ? ` — ${formatDate(project.end_date)}` : ''}</span>
            </div>
            <div className="meta-item"><span className="meta-label">Hourly rate</span>
              <span className="meta-value">${project.hourly_rate}/hr</span>
            </div>
            <div className="meta-item"><span className="meta-label">Tasks</span>
              <span className="meta-value">{project.tasks_complete}/{project.total_tasks} complete</span>
            </div>
            <div className="meta-item"><span className="meta-label">Phases</span>
              <span className="meta-value">{project.phase_count}</span>
            </div>
          </div>
        )}

        {/* Budget bar */}
        {project.budget_allocated > 0 && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.8125rem', marginBottom:'4px' }}>
              <span style={{ color:'var(--text-muted)' }}>Budget usage</span>
              <span style={{ color: pct >= 80 ? 'var(--warning)' : 'var(--text-secondary)' }}>{pct}%</span>
            </div>
            <div className="budget-bar-track">
              <div className="budget-bar-fill" style={{ width:`${Math.min(pct,100)}%`, background:barColor }} />
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.75rem', color:'var(--text-muted)', marginTop:'3px' }}>
              <span>${(project.total_spent||0).toLocaleString()} spent</span>
              <span>of ${(project.budget_allocated||0).toLocaleString()}</span>
            </div>
          </div>
        )}

        {/* Phases */}
        {detail?.phases?.length > 0 && (
          <div>
            <div className="sub-section-title">Phases</div>
            <Table>
              <thead>
                <tr>
                  <Th>#</Th><Th>Phase</Th><Th>Budget</Th><Th>Start</Th><Th>End</Th>
                </tr>
              </thead>
              <tbody>
                {detail.phases.map(ph => (
                  <tr key={ph.id}>
                    <Td>{ph.phase_number}</Td>
                    <Td><strong>{ph.phase_name}</strong></Td>
                    <Td>${(ph.budget_allocated||0).toLocaleString()}</Td>
                    <Td>{formatDate(ph.start_date) || '—'}</Td>
                    <Td>{formatDate(ph.end_date)   || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        {/* Add phase inline */}
        {showPhase && hasRole('ops_manager') && (
          <div style={{ background:'var(--bg-raised)', borderRadius:'var(--radius-md)', padding:'1rem', display:'flex', flexDirection:'column', gap:'0.875rem' }}>
            <div style={{ fontSize:'0.875rem', fontWeight:600 }}>Add phase</div>
            <div className="form-grid-2">
              <Input label="Phase name *" value={phaseForm.phase_name}
                onChange={e => setPhaseForm(f=>({...f, phase_name:e.target.value}))}
                placeholder="e.g. Phase 2 — Validation" />
              <Input label="Phase number *" type="number" min="1"
                value={phaseForm.phase_number}
                onChange={e => setPhaseForm(f=>({...f, phase_number:e.target.value}))} />
            </div>
            <div className="form-grid-3">
              <Input label="Budget ($)" type="number" value={phaseForm.budget_allocated}
                onChange={e => setPhaseForm(f=>({...f, budget_allocated:e.target.value}))} />
              <Input label="Start date" type="date" value={phaseForm.start_date}
                onChange={e => setPhaseForm(f=>({...f, start_date:e.target.value}))} />
              <Input label="End date" type="date" value={phaseForm.end_date}
                onChange={e => setPhaseForm(f=>({...f, end_date:e.target.value}))} />
            </div>
            <div style={{ display:'flex', gap:'0.5rem' }}>
              <Button variant="primary" size="sm" loading={phaseMutation.isPending}
                onClick={() => phaseMutation.mutate({
                  phase_name:       phaseForm.phase_name,
                  phase_number:     parseInt(phaseForm.phase_number),
                  budget_allocated: parseFloat(phaseForm.budget_allocated) || 0,
                  start_date:       phaseForm.start_date || null,
                  end_date:         phaseForm.end_date   || null,
                })}>
                Add phase
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowPhase(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {detail?.description && !editing && (
          <div style={{ fontSize:'0.875rem', color:'var(--text-secondary)', lineHeight:1.6 }}>
            {detail.description}
          </div>
        )}

        {/* Hard delete confirmation */}
        {confirmDelete && (
          <div style={{
            background: 'var(--danger-bg)', border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-md)', padding: '1rem', marginTop: '0.5rem',
          }}>
            <div style={{ fontWeight:600, color:'var(--danger)', marginBottom:'0.5rem' }}>
              Permanently delete "{project.name}"?
            </div>
            <p style={{ fontSize:'0.875rem', color:'var(--text-secondary)', marginBottom:'0.875rem', lineHeight:1.6 }}>
              This will permanently remove the project and <strong>all associated data</strong> —
              tasks, daily log entries, budget entries, purchase orders, KPI records, and phases.
              <br /><strong>This cannot be undone.</strong>
            </p>
            <p style={{ fontSize:'0.8125rem', color:'var(--text-muted)', marginBottom:'0.5rem' }}>
              Type <strong>DELETE</strong> to confirm:
            </p>
            <div style={{ display:'flex', gap:'0.625rem', alignItems:'center', flexWrap:'wrap' }}>
              <input
                type="text"
                className="field-input"
                style={{ width:'140px' }}
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="Type DELETE"
              />
              <Button
                variant="danger"
                size="sm"
                disabled={deleteConfirmText !== 'DELETE'}
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}>
                Permanently delete
              </Button>
              <Button variant="secondary" size="sm"
                onClick={() => { setConfirmDelete(false); setDeleteConfirmText(''); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
