import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Routes, Route, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, Card, CardHeader, Button, Textarea,
  Badge, Table, Th, Td, EmptyState, LoadingState,
  StatCard, Modal, ProgressBar
} from '../../components/ui/UI';
import { formatDate, formatCurrency, formatHours } from '../../utils/format';
import toast from 'react-hot-toast';
import './ReportsPage.css';

/* ---- Status badge ---- */
function ReportStatusBadge({ status }) {
  const map = { draft: 'warning', published: 'success', archived: 'muted' };
  return <Badge variant={map[status] || 'muted'}>{status}</Badge>;
}

/* ============================================================
   Reports List
   ============================================================ */
function ReportsList() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showGenerate, setShowGenerate] = useState(false);

  const { data: reports, isLoading } = useQuery({
    queryKey: ['weekly-reports'],
    queryFn: () => api.get('/reports').then(r => r.data),
  });

  const generateMutation = useMutation({
    mutationFn: () => api.post('/reports/generate'),
    onSuccess: (data) => {
      toast.success('Weekly report draft generated.');
      setShowGenerate(false);
      qc.invalidateQueries(['weekly-reports']);
      navigate(`/reports/${data.data.report_id}`);
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to generate report.'),
  });

  const drafts    = reports?.filter(r => r.status === 'draft').length    ?? 0;
  const published = reports?.filter(r => r.status === 'published').length ?? 0;

  return (
    <div>
      <PageHeader
        title="Weekly reports"
        subtitle="Auto-generated summaries of all project activity"
        action={
          hasRole('ops_manager', 'ceo') && (
            <Button variant="primary" onClick={() => setShowGenerate(true)}>
              Generate report
            </Button>
          )
        }
      />

      <div className="stats-row">
        <StatCard label="Total reports" value={reports?.length ?? '—'} />
        <StatCard label="Drafts awaiting review" value={drafts} warning={drafts > 0} />
        <StatCard label="Published" value={published} accent />
      </div>

      {isLoading ? <LoadingState /> : !reports?.length ? (
        <Card>
          <EmptyState
            title="No reports yet"
            description="Generate your first weekly report to get started."
            action={
              hasRole('ops_manager') && (
                <Button variant="primary" onClick={() => setShowGenerate(true)}>
                  Generate report
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Week</Th>
              <Th>Status</Th>
              <Th>Generated</Th>
              <Th>Published</Th>
              <Th>Executive summary</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {reports.map(r => (
              <tr key={r.id} onClick={() => navigate(`/reports/${r.id}`)}
                style={{ cursor: 'pointer' }}
                className={r.status === 'draft' ? 'row-draft' : ''}>
                <Td>
                  <div className="report-week">
                    <span className="week-label">
                      {formatDate(r.week_start, 'MMM d')} – {formatDate(r.week_end, 'MMM d, yyyy')}
                    </span>
                  </div>
                </Td>
                <Td><ReportStatusBadge status={r.status} /></Td>
                <Td>{formatDate(r.generated_at)}</Td>
                <Td>{r.published_at ? formatDate(r.published_at) : '—'}</Td>
                <Td>
                  <span className="summary-preview">
                    {r.executive_summary
                      ? r.executive_summary.slice(0, 60) + (r.executive_summary.length > 60 ? '…' : '')
                      : <span style={{ color: 'var(--text-muted)' }}>Not yet written</span>
                    }
                  </span>
                </Td>
                <Td onClick={e => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/reports/${r.id}`)}>
                    {r.status === 'draft' && hasRole('ops_manager') ? 'Review →' : 'View →'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* Generate confirmation */}
      <Modal open={showGenerate} onClose={() => setShowGenerate(false)}
        title="Generate weekly report?" size="sm">
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          This will generate a draft report for the previous week, pulling data from all
          active projects — employee logs, consumables, PO activity, budget, and task progress.
          You can review and add your executive summary before publishing.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setShowGenerate(false)}>Cancel</Button>
          <Button variant="primary" loading={generateMutation.isPending}
            onClick={() => generateMutation.mutate()}>
            Generate
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* ============================================================
   Report Detail — draft review + publish workflow
   ============================================================ */
function ReportDetail() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const id = window.location.pathname.split('/').pop();

  const [execSummary, setExecSummary] = useState('');
  const [opsNotes, setOpsNotes]       = useState({});
  const [showPublish, setShowPublish] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);

  const { data: report, isLoading } = useQuery({
    queryKey: ['report', id],
    queryFn: () => api.get(`/reports/${id}`).then(r => {
      return r.data;
    }),
    onSuccess: (data) => {
      setExecSummary(data.executive_summary || '');
      const notes = {};
      data.sections?.forEach(s => { notes[s.project_id] = s.ops_notes || ''; });
      setOpsNotes(notes);
    },
  });

  const saveSummaryMutation = useMutation({
    mutationFn: () => api.patch(`/reports/${id}`, { executive_summary: execSummary }),
    onSuccess: () => { toast.success('Executive summary saved.'); setEditingSummary(false); qc.invalidateQueries(['report', id]); },
    onError: () => toast.error('Failed to save summary.'),
  });

  const saveNotesMutation = useMutation({
    mutationFn: ({ sectionId, notes }) => api.patch(`/reports/${id}/sections/${sectionId}`, { ops_notes: notes }),
    onSuccess: () => toast.success('Notes saved.'),
    onError: () => toast.error('Failed to save notes.'),
  });

  const publishMutation = useMutation({
    mutationFn: () => api.post(`/reports/${id}/publish`),
    onSuccess: () => {
      toast.success('Report published and sent to CEO.');
      setShowPublish(false);
      qc.invalidateQueries(['report', id]);
      qc.invalidateQueries(['weekly-reports']);
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to publish.'),
  });

  if (isLoading) return <LoadingState />;
  if (!report)   return <EmptyState title="Report not found"
    action={<Button onClick={() => navigate('/reports')}>Back</Button>} />;

  const isDraft   = report.status === 'draft';
  const canEdit   = hasRole('ops_manager', 'ceo') && isDraft;

  return (
    <div className="report-detail">
      <PageHeader
        title={`Weekly report — ${formatDate(report.week_start, 'MMM d')} to ${formatDate(report.week_end, 'MMM d, yyyy')}`}
        subtitle={`Generated ${formatDate(report.generated_at)}`}
        action={
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <ReportStatusBadge status={report.status} />
            <Button variant="secondary" onClick={() => navigate('/reports')}>← Back</Button>
            {canEdit && (
              <Button variant="primary" onClick={() => setShowPublish(true)}>
                Publish report
              </Button>
            )}
          </div>
        }
      />

      {/* Draft notice */}
      {isDraft && hasRole('ops_manager') && (
        <div className="draft-notice">
          <span>📋</span>
          <div>
            <strong>Draft report</strong> — Review the sections below, add your executive summary,
            and optionally add per-project notes before publishing. Once published, the CEO will be notified.
          </div>
        </div>
      )}

      {/* Executive summary */}
      <Card className="exec-summary-card">
        <CardHeader
          title="Executive summary"
          subtitle={canEdit ? 'Written by ops manager — required before publishing' : undefined}
          action={
            canEdit && !editingSummary && (
              <Button variant="ghost" size="sm" onClick={() => setEditingSummary(true)}>
                {execSummary ? 'Edit' : 'Write summary'}
              </Button>
            )
          }
        />
        {editingSummary ? (
          <div className="summary-edit">
            <Textarea
              value={execSummary}
              onChange={e => setExecSummary(e.target.value)}
              rows={6}
              placeholder="Write a high-level summary of this week's progress, highlights, and any concerns…"
            />
            <div className="summary-actions">
              <Button variant="secondary" size="sm" onClick={() => setEditingSummary(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={saveSummaryMutation.isPending}
                onClick={() => saveSummaryMutation.mutate()}>Save summary</Button>
            </div>
          </div>
        ) : (
          <div className="summary-text">
            {execSummary
              ? <p>{execSummary}</p>
              : <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  {canEdit ? 'No executive summary yet. Click "Write summary" to add one.' : 'No executive summary provided.'}
                </p>
            }
          </div>
        )}
      </Card>

      {/* Per-project sections */}
      {report.sections?.map(section => (
        <ProjectSection
          key={section.project_id}
          section={section}
          opsNote={opsNotes[section.project_id] || ''}
          onOpsNoteChange={(v) => setOpsNotes(n => ({ ...n, [section.project_id]: v }))}
          onSaveNote={() => saveNotesMutation.mutate({ sectionId: section.id, notes: opsNotes[section.project_id] })}
          canEdit={canEdit}
        />
      ))}

      {/* Publish confirmation */}
      <Modal open={showPublish} onClose={() => setShowPublish(false)}
        title="Publish this report?" size="sm">
        {!execSummary && (
          <div className="publish-warning">
            ⚠ You haven't written an executive summary yet. You can still publish, but it's recommended.
          </div>
        )}
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem', marginTop: '0.5rem' }}>
          Once published, this report will be visible to the CEO and marked as final.
          A notification will be sent to the CEO.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setShowPublish(false)}>Go back</Button>
          <Button variant="primary" loading={publishMutation.isPending}
            onClick={() => publishMutation.mutate()}>
            Publish
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* ============================================================
   Per-project section card
   ============================================================ */
function ProjectSection({ section, opsNote, onOpsNoteChange, onSaveNote, canEdit }) {
  const [expanded, setExpanded] = useState(true);
  const [editNote, setEditNote] = useState(false);

  const budgetPct = section.budget_allocated > 0
    ? (section.budget_spent_total / section.budget_allocated) * 100
    : 0;

  return (
    <Card className="project-section-card">
      {/* Section header */}
      <div className="section-header" onClick={() => setExpanded(e => !e)}>
        <div className="section-header-left">
          <span className="section-toggle">{expanded ? '▾' : '▸'}</span>
          <Badge variant="muted">{section.project_code}</Badge>
          <span className="section-project-name">{section.project_name}</span>
        </div>
        <div className="section-header-right">
          <span className="section-stat">{formatHours(section.total_hours)} logged</span>
          <span className="section-divider">·</span>
          <span className="section-stat">
            {section.tasks_completed}/{section.tasks_completed + section.tasks_in_progress + section.tasks_not_started + section.tasks_blocked} tasks done
          </span>
          {section.missing_logs && (
            <Badge variant="danger">Missing logs</Badge>
          )}
        </div>
      </div>

      {expanded && (
        <div className="section-body">
          {/* Four metric cards */}
          <div className="section-metrics">
            {/* Hours */}
            <div className="metric-block">
              <span className="metric-label">Hours this week</span>
              <span className="metric-value">{formatHours(section.total_hours)}</span>
            </div>

            {/* Task progress */}
            <div className="metric-block">
              <span className="metric-label">Task progress</span>
              <div className="task-progress-bar">
                <div className="tp-segment tp-complete"
                  style={{ width: `${pct(section.tasks_completed, totalTasks(section))}%` }}
                  title={`Complete: ${section.tasks_completed}`} />
                <div className="tp-segment tp-progress"
                  style={{ width: `${pct(section.tasks_in_progress, totalTasks(section))}%` }}
                  title={`In progress: ${section.tasks_in_progress}`} />
                <div className="tp-segment tp-blocked"
                  style={{ width: `${pct(section.tasks_blocked, totalTasks(section))}%` }}
                  title={`Blocked: ${section.tasks_blocked}`} />
              </div>
              <div className="tp-legend">
                <span className="tp-dot tp-complete" />{section.tasks_completed} complete
                <span className="tp-dot tp-progress" />{section.tasks_in_progress} in progress
                <span className="tp-dot tp-blocked" />{section.tasks_blocked} blocked
                <span className="tp-dot tp-not-started" />{section.tasks_not_started} not started
              </div>
            </div>

            {/* Budget */}
            <div className="metric-block">
              <span className="metric-label">Budget</span>
              <ProgressBar value={budgetPct} warning={80} danger={100} />
              <div className="budget-detail">
                <span>{formatCurrency(section.budget_spent_total)} spent</span>
                <span style={{ color: 'var(--text-muted)' }}>of {formatCurrency(section.budget_allocated)}</span>
                <span style={{ color: budgetPct > 100 ? 'var(--danger)' : 'var(--text-muted)' }}>
                  ({budgetPct.toFixed(0)}%)
                </span>
              </div>
              {section.budget_spent_week > 0 && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
                  {formatCurrency(section.budget_spent_week)} this week
                </p>
              )}
            </div>

            {/* PO activity */}
            {section.po_summary && (
              <div className="metric-block">
                <span className="metric-label">PO activity this week</span>
                <PoSummary raw={section.po_summary} />
              </div>
            )}
          </div>

          {/* Missing logs */}
          {section.missing_logs && (
            <div className="section-alert">
              ⚠ Missing logs: {section.missing_logs}
            </div>
          )}

          {/* Restock flags */}
          {section.restock_flags && (
            <div className="section-alert section-alert--warning">
              📦 Restock flags: {section.restock_flags}
            </div>
          )}

          {/* Ops notes */}
          <div className="ops-notes-section">
            <div className="ops-notes-header">
              <span className="meta-label">Ops manager notes</span>
              {canEdit && !editNote && (
                <Button variant="ghost" size="sm" onClick={() => setEditNote(true)}>
                  {opsNote ? 'Edit' : 'Add note'}
                </Button>
              )}
            </div>
            {editNote ? (
              <div>
                <Textarea
                  value={opsNote}
                  onChange={e => onOpsNoteChange(e.target.value)}
                  rows={3}
                  placeholder="Add notes for this project section…"
                />
                <div className="summary-actions" style={{ marginTop: '0.5rem' }}>
                  <Button variant="secondary" size="sm" onClick={() => setEditNote(false)}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={() => { onSaveNote(); setEditNote(false); }}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <p className="ops-note-text">
                {opsNote || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No notes added.</span>}
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function totalTasks(s) {
  return (s.tasks_completed || 0) + (s.tasks_in_progress || 0) +
         (s.tasks_blocked || 0)   + (s.tasks_not_started || 0);
}

function pct(val, total) {
  if (!total) return 0;
  return Math.round((val / total) * 100);
}

function PoSummary({ raw }) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data?.length) return <span style={{ color: 'var(--text-muted)' }}>No PO activity</span>;
    return (
      <div className="po-summary-list">
        {data.slice(0, 4).map((po, i) => (
          <div key={i} className="po-summary-row">
            <span className="po-summary-num">{po.po_number || `#${po.id}`}</span>
            <Badge variant="muted">{po.status?.replace(/_/g, ' ')}</Badge>
          </div>
        ))}
      </div>
    );
  } catch {
    return <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{raw}</span>;
  }
}

export default function ReportsPage() {
  return (
    <Routes>
      <Route index    element={<ReportsList />} />
      <Route path=":id" element={<ReportDetail />} />
    </Routes>
  );
}
