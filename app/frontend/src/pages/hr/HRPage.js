import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, Card, CardHeader, Button, Input, Textarea,
  Badge, Table, Th, Td, EmptyState, LoadingState,
  StatCard, Modal
} from '../../components/ui/UI';
import { formatDate, formatHours } from '../../utils/format';
import toast from 'react-hot-toast';
import './HRPage.css';

const LEAVE_TYPES = ['vacation','sick','personal','bereavement','medical','unpaid'];
const LEAVE_COLORS = {
  vacation:    'accent',
  sick:        'danger',
  personal:    'info',
  bereavement: 'warning',
  medical:     'warning',
  unpaid:      'muted',
};
const STATUS_COLORS = {
  in_office: { label: 'In office', color: 'var(--success)',  bg: 'rgba(0,229,160,0.1)' },
  remote:    { label: 'Remote',    color: 'var(--info)',     bg: 'rgba(74,158,255,0.1)' },
  off:       { label: 'Off',       color: 'var(--text-muted)', bg: 'var(--bg-raised)' },
  sick:      { label: 'Sick',      color: 'var(--danger)',   bg: 'rgba(232,89,74,0.1)' },
};
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function initials(name) {
  return (name||'??').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
}

function LeaveTypeBadge({ type }) {
  return <Badge variant={LEAVE_COLORS[type] || 'muted'}>{type}</Badge>;
}

function LeaveStatusBadge({ status }) {
  const map = { pending:'warning', approved:'success', denied:'danger', cancelled:'muted' };
  return <Badge variant={map[status]||'muted'}>{status}</Badge>;
}

/* ============================================================
   HR Portal — tabbed layout
   ============================================================ */
export default function HRPage() {
  const [tab, setTab] = useState('board');
  const { user, hasRole } = useAuth();
  const canSeePwSchedule = hasRole('ops_manager') || user?.email === 'pw@metabolictrack.com';

  const tabs = [
    { id: 'board',    label: 'In / Out board' },
    { id: 'calendar', label: 'Team calendar' },
    { id: 'leave',    label: 'Time off requests' },
    { id: 'balances', label: 'Leave balances' },
    ...(canSeePwSchedule ? [{ id: 'schedule', label: "Patricia's schedule" }] : []),
  ];

  return (
    <div>
      <PageHeader title="HR portal" subtitle="Staff status, time off, and team calendar" />

      <div className="hr-tabs">
        {tabs.map(t => (
          <button key={t.id}
            className={`hr-tab ${tab === t.id ? 'hr-tab--active' : ''}`}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'board'    && <InOutBoard />}
      {tab === 'calendar' && <TeamCalendar />}
      {tab === 'leave'    && <LeaveRequests />}
      {tab === 'balances' && <LeaveBalances />}
      {tab === 'schedule' && canSeePwSchedule && <PatriciaSchedule />}
    </div>
  );
}

/* ============================================================
   In / Out Board
   ============================================================ */
function InOutBoard() {
  const { user: me, hasRole } = useAuth();
  const qc = useQueryClient();
  const [editingStatus, setEditingStatus] = useState(null);
  const [myStatus, setMyStatus] = useState('');
  const [myNote, setMyNote]     = useState('');

  const { data: staff, isLoading } = useQuery({
    queryKey: ['staff-status'],
    queryFn: () => api.get('/hr/status').then(r => r.data),
    refetchInterval: 60000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, status, note }) => {
      const endpoint = userId === me.id ? '/hr/status/me' : `/hr/status/${userId}`;
      return api.patch(endpoint, { status, status_note: note });
    },
    onSuccess: () => {
      toast.success('Status updated.');
      setEditingStatus(null);
      qc.invalidateQueries(['staff-status']);
    },
    onError: () => toast.error('Failed to update status.'),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.post('/hr/status/sync'),
    onSuccess: () => { toast.success('Statuses synced from leave data.'); qc.invalidateQueries(['staff-status']); },
  });

  const counts = useMemo(() => {
    const c = { in_office:0, remote:0, off:0, sick:0 };
    (staff||[]).forEach(s => { c[s.status] = (c[s.status]||0)+1; });
    return c;
  }, [staff]);

  if (isLoading) return <LoadingState />;

  return (
    <div>
      <div className="stats-row" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <StatCard label="In office" value={counts.in_office} accent />
        <StatCard label="Remote"    value={counts.remote} />
        <StatCard label="Off"       value={counts.off} />
        <StatCard label="Sick"      value={counts.sick} danger={counts.sick>0} />
      </div>

      {hasRole('ops_manager') && (
        <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'1rem' }}>
          <Button variant="secondary" size="sm" onClick={() => syncMutation.mutate()}
            loading={syncMutation.isPending}>
            Sync from leave data
          </Button>
        </div>
      )}

      <div className="status-board">
        {(staff||[]).map(person => {
          const sc = STATUS_COLORS[person.status] || STATUS_COLORS.in_office;
          const canEdit = me.id === person.user_id || hasRole('ops_manager');
          return (
            <div key={person.user_id} className="status-card"
              style={{ borderColor: sc.color, background: sc.bg }}>
              <div className="status-card-top">
                <div className="status-avatar">{initials(person.full_name)}</div>
                <div className="status-info">
                  <div className="status-name">{person.full_name}</div>
                  <div className="status-role">{person.role?.replace(/_/g,' ')}</div>
                </div>
                {canEdit && (
                  <button className="status-edit-btn"
                    onClick={() => { setEditingStatus(person); setMyStatus(person.status); setMyNote(person.status_note||''); }}>
                    ✎
                  </button>
                )}
              </div>
              <div className="status-pill" style={{ color: sc.color }}>
                {sc.label}
                {person.leave_type_today && (
                  <span style={{ marginLeft:'6px', fontSize:'10px', opacity:0.8 }}>
                    ({person.leave_type_today})
                  </span>
                )}
              </div>
              {person.status_note && (
                <div className="status-note">{person.status_note}</div>
              )}
              {person.manual_override && (
                <div className="status-override-flag">Manual override</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit status modal */}
      <Modal open={!!editingStatus} onClose={() => setEditingStatus(null)}
        title={`Update status — ${editingStatus?.full_name}`} size="sm">
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
          <div className="field">
            <label className="field-label">Status</label>
            <div className="status-options">
              {Object.entries(STATUS_COLORS).map(([key, val]) => (
                <button key={key}
                  className={`status-option ${myStatus===key?'status-option--active':''}`}
                  style={{ borderColor: myStatus===key ? val.color : undefined,
                           color: myStatus===key ? val.color : undefined }}
                  onClick={() => setMyStatus(key)}>
                  {val.label}
                </button>
              ))}
            </div>
          </div>
          <Input label="Note (optional)" value={myNote}
            onChange={e => setMyNote(e.target.value)}
            placeholder="e.g. Back at 2pm, Working from home today…" />
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setEditingStatus(null)}>Cancel</Button>
            <Button variant="primary" loading={updateMutation.isPending}
              onClick={() => updateMutation.mutate({
                userId: editingStatus.user_id,
                status: myStatus, note: myNote
              })}>
              Update
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ============================================================
   Team Calendar
   ============================================================ */
function TeamCalendar() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [view, setView]           = useState('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);

  const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const monthEnd   = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 0);

  const { data: events, isLoading } = useQuery({
    queryKey: ['calendar-events', currentDate.getFullYear(), currentDate.getMonth()],
    queryFn: () => api.get('/hr/calendar', {
      params: {
        start: monthStart.toISOString().split('T')[0],
        end:   monthEnd.toISOString().split('T')[0],
      }
    }).then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: id => api.delete(`/hr/calendar/${id}`),
    onSuccess: () => {
      toast.success('Event deleted.');
      setSelectedEvent(null);
      qc.invalidateQueries(['calendar-events']);
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to delete.'),
  });

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const days = [];
    const start = new Date(monthStart);
    start.setDate(start.getDate() - start.getDay()); // back to Sunday
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const dayEvents = (events||[]).filter(e => {
        const es = e.start_time?.split('T')[0];
        const ee = e.end_time?.split('T')[0];
        return dateStr >= es && dateStr <= ee;
      });
      days.push({ date: d, dateStr, events: dayEvents, isCurrentMonth: d.getMonth() === currentDate.getMonth() });
    }
    return days;
  }, [events, currentDate]);

  const prevMonth = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1));
  const nextMonth = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1));

  const EVENT_TYPE_COLOR = { team:'var(--accent)', one_on_one:'var(--info)', private:'var(--text-muted)' };

  return (
    <div>
      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <Button variant="secondary" size="sm" onClick={prevMonth}>‹</Button>
          <h3 className="calendar-month-label">
            {currentDate.toLocaleDateString('en-US', { month:'long', year:'numeric' })}
          </h3>
          <Button variant="secondary" size="sm" onClick={nextMonth}>›</Button>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
          + Add event
        </Button>
      </div>

      {isLoading ? <LoadingState /> : (
        <Card padding={false}>
          <div className="calendar-grid-header">
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
              <div key={d} className="cal-day-header">{d}</div>
            ))}
          </div>
          <div className="calendar-grid">
            {calendarDays.map(({ date, dateStr, events: dayEvts, isCurrentMonth }) => {
              const isToday = dateStr === new Date().toISOString().split('T')[0];
              return (
                <div key={dateStr}
                  className={`cal-day ${!isCurrentMonth?'cal-day--other':''}${isToday?' cal-day--today':''}`}>
                  <span className="cal-date-num">{date.getDate()}</span>
                  <div className="cal-events">
                    {dayEvts.slice(0,3).map(ev => (
                      <div key={ev.id} className="cal-event"
                        style={{ background: EVENT_TYPE_COLOR[ev.event_type] || 'var(--accent)' }}
                        onClick={() => setSelectedEvent(ev)}
                        title={ev.title}>
                        {ev.title}
                      </div>
                    ))}
                    {dayEvts.length > 3 && (
                      <div className="cal-more">+{dayEvts.length-3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Create event modal */}
      <CreateEventModal open={showCreate} onClose={() => setShowCreate(false)}
        onSuccess={() => { setShowCreate(false); qc.invalidateQueries(['calendar-events']); }} />

      {/* Event detail modal */}
      <Modal open={!!selectedEvent} onClose={() => setSelectedEvent(null)}
        title={selectedEvent?.title} size="sm">
        {selectedEvent && (
          <div style={{ display:'flex', flexDirection:'column', gap:'0.875rem' }}>
            <div style={{ display:'flex', gap:'0.5rem' }}>
              <Badge variant={selectedEvent.event_type==='team'?'accent':selectedEvent.event_type==='one_on_one'?'info':'muted'}>
                {selectedEvent.event_type?.replace(/_/g,' ')}
              </Badge>
              {selectedEvent.all_day && <Badge variant="muted">All day</Badge>}
            </div>
            {!selectedEvent.all_day && (
              <div className="text2">
                {formatDate(selectedEvent.start_time, 'MMM d, yyyy h:mm a')} —{' '}
                {formatDate(selectedEvent.end_time, 'h:mm a')}
              </div>
            )}
            {selectedEvent.location && (
              <div className="text2">📍 {selectedEvent.location}</div>
            )}
            {selectedEvent.description && (
              <p style={{ color:'var(--text-secondary)', fontSize:'0.875rem' }}>
                {selectedEvent.description}
              </p>
            )}
            {selectedEvent.participants?.length > 0 && (
              <div>
                <div className="meta-label" style={{ marginBottom:'4px' }}>Participants</div>
                <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
                  {selectedEvent.participants.map(p => (
                    <span key={p} className="participant-chip">{p}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="text2" style={{ fontSize:'11px' }}>
              Created by {selectedEvent.created_by_name}
            </div>
            {(selectedEvent.created_by_name === me.full_name || me.role === 'ops_manager') && !selectedEvent.related_leave_id && (
              <div className="modal-footer">
                <Button variant="danger" size="sm"
                  onClick={() => deleteMutation.mutate(selectedEvent.id)}
                  loading={deleteMutation.isPending}>
                  Delete event
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function CreateEventModal({ open, onClose, onSuccess }) {
  const { data: users } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => api.get('/auth/users/all').then(r => r.data),
    enabled: open,
  });

  const [form, setForm] = useState({
    title:'', description:'', event_type:'team',
    start_time:'', end_time:'', all_day:false,
    location:'', participant_ids:[],
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const mutation = useMutation({
    mutationFn: data => api.post('/hr/calendar', data),
    onSuccess: () => { toast.success('Event created.'); onSuccess(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to create event.'),
  });

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.title)      { toast.error('Enter a title.'); return; }
    if (!form.start_time) { toast.error('Enter a start time.'); return; }
    if (!form.end_time)   { toast.error('Enter an end time.'); return; }
    mutation.mutate({
      ...form,
      participant_ids: form.participant_ids.map(Number),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Add calendar event" size="md">
      <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
        <Input label="Title *" value={form.title} onChange={e=>set('title',e.target.value)} />
        <div className="grid-2">
          <div className="field">
            <label className="field-label">Event type</label>
            <select className="field-input" value={form.event_type} onChange={e=>set('event_type',e.target.value)}>
              <option value="team">Team (visible to all)</option>
              <option value="one_on_one">1-on-1 (participants only)</option>
              <option value="private">Private (me + ops manager)</option>
            </select>
          </div>
          <Input label="Location" value={form.location} onChange={e=>set('location',e.target.value)}
            placeholder="Room, Zoom link…" />
        </div>
        <div className="grid-2">
          <Input label="Start *" type="datetime-local" value={form.start_time}
            onChange={e=>set('start_time',e.target.value)} />
          <Input label="End *" type="datetime-local" value={form.end_time}
            onChange={e=>set('end_time',e.target.value)} />
        </div>
        <label className="checkbox-label">
          <input type="checkbox" checked={form.all_day} onChange={e=>set('all_day',e.target.checked)} />
          <span>All day</span>
        </label>
        {form.event_type !== 'team' && (
          <div className="field">
            <label className="field-label">Participants</label>
            <select className="field-input" multiple value={form.participant_ids}
              onChange={e=>set('participant_ids', Array.from(e.target.selectedOptions, o=>o.value))}
              style={{ height:'90px' }}>
              {(users||[]).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
            <span className="field-hint">Hold Ctrl/Cmd to select multiple</span>
          </div>
        )}
        <Textarea label="Description" value={form.description}
          onChange={e=>set('description',e.target.value)} rows={2} />
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>Create event</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ============================================================
   Leave Requests
   ============================================================ */
function LeaveRequests() {
  const { user: me, hasRole } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter]         = useState('pending');
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewNotes, setReviewNotes]   = useState('');

  const { data: requests, isLoading } = useQuery({
    queryKey: ['leave-requests', filter],
    queryFn: () => api.get('/hr/leave', { params: { status: filter||undefined } }).then(r => r.data),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, action, notes }) => api.post(`/hr/leave/${id}/review`, { action, review_notes: notes }),
    onSuccess: (_, vars) => {
      toast.success(`Request ${vars.action}.`);
      setReviewTarget(null);
      qc.invalidateQueries(['leave-requests']);
      qc.invalidateQueries(['staff-status']);
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to review.'),
  });

  const cancelMutation = useMutation({
    mutationFn: id => api.post(`/hr/leave/${id}/cancel`),
    onSuccess: () => { toast.success('Request cancelled.'); qc.invalidateQueries(['leave-requests']); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to cancel.'),
  });

  const pending = requests?.filter(r=>r.status==='pending').length || 0;

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'1rem', flexWrap:'wrap', gap:'0.75rem' }}>
        <div className="filter-row">
          {['','pending','approved','denied','cancelled'].map(s => (
            <button key={s}
              className={`status-pill ${filter===s?'status-pill--active':''}`}
              onClick={() => setFilter(s)}>
              {s||'All'}{s==='pending'&&pending>0?` (${pending})`:''}
            </button>
          ))}
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>+ Request time off</Button>
      </div>

      {isLoading ? <LoadingState /> : !requests?.length ? (
        <EmptyState title="No requests found"
          action={<Button variant="primary" onClick={() => setShowCreate(true)}>Request time off</Button>} />
      ) : (
        <Table>
          <thead>
            <tr>
              {hasRole('ops_manager') && <Th>Employee</Th>}
              <Th>Type</Th>
              <Th>Dates</Th>
              <Th>Days</Th>
              <Th>Status</Th>
              <Th>HR meeting</Th>
              <Th>Notes</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {requests.map(r => (
              <tr key={r.id}>
                {hasRole('ops_manager') && <Td><strong>{r.employee}</strong></Td>}
                <Td><LeaveTypeBadge type={r.leave_type} /></Td>
                <Td>
                  <div style={{ fontSize:'0.8125rem' }}>
                    {formatDate(r.start_date)} — {formatDate(r.end_date)}
                  </div>
                </Td>
                <Td>{r.days_requested}d{r.approx_days ? ` (approx. ${r.approx_days}d)` : ''}</Td>
                <Td><LeaveStatusBadge status={r.status} /></Td>
                <Td>
                  {r.hr_meeting_required
                    ? <Badge variant="danger">Required</Badge>
                    : <span style={{ color:'var(--text-muted)', fontSize:'12px' }}>—</span>
                  }
                </Td>
                <Td>
                  <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>
                    {r.notes || r.review_notes || '—'}
                  </span>
                </Td>
                <Td>
                  <div style={{ display:'flex', gap:'0.375rem' }}>
                    {hasRole('ops_manager') && r.status === 'pending' && (
                      <Button variant="primary" size="sm"
                        onClick={() => { setReviewTarget(r); setReviewNotes(''); }}>
                        Review
                      </Button>
                    )}
                    {r.user_id === me.id && ['pending','approved'].includes(r.status) && (
                      <Button variant="ghost" size="sm"
                        onClick={() => cancelMutation.mutate(r.id)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <SubmitLeaveModal open={showCreate} onClose={() => setShowCreate(false)}
        onSuccess={() => { setShowCreate(false); qc.invalidateQueries(['leave-requests']); qc.invalidateQueries(['balances']); }} />

      <Modal open={!!reviewTarget} onClose={() => setReviewTarget(null)}
        title={`Review — ${reviewTarget?.employee}`} size="sm">
        {reviewTarget && (
          <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
            <div style={{ background:'var(--bg-raised)', borderRadius:'var(--radius-md)', padding:'0.875rem' }}>
              <div style={{ display:'flex', gap:'0.75rem', marginBottom:'0.5rem' }}>
                <LeaveTypeBadge type={reviewTarget.leave_type} />
                <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>
                  {formatDate(reviewTarget.start_date)} — {formatDate(reviewTarget.end_date)}
                </span>
                <span style={{ fontSize:'0.8125rem', fontWeight:600 }}>{reviewTarget.days_requested} days</span>
              </div>
              {reviewTarget.notes && <p style={{ fontSize:'0.875rem', color:'var(--text-secondary)', margin:0 }}>{reviewTarget.notes}</p>}
            </div>
            {reviewTarget.leave_type === 'sick' && reviewTarget.days_requested >= 5 && (
              <div style={{ background:'var(--danger-bg)', border:'1px solid var(--danger)', borderRadius:'var(--radius-sm)', padding:'0.625rem 0.875rem', fontSize:'0.8125rem', color:'var(--danger)' }}>
                ⚠ 5+ day sick leave — approving this will flag an HR meeting requirement.
              </div>
            )}
            {['personal','bereavement','medical','unpaid'].includes(reviewTarget.leave_type) && (
              <div style={{ background:'var(--info-bg)', border:'1px solid var(--info)', borderRadius:'var(--radius-sm)', padding:'0.625rem 0.875rem', fontSize:'0.8125rem', color:'var(--info)' }}>
                ℹ This leave type is at HR discretion. Approve to confirm the agreed duration.
              </div>
            )}
            <Textarea label="Review notes (optional)" value={reviewNotes}
              onChange={e => setReviewNotes(e.target.value)} rows={2}
              placeholder="Reason for approval or denial…" />
            <div className="modal-footer">
              <Button variant="secondary" onClick={() => setReviewTarget(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => reviewMutation.mutate({ id:reviewTarget.id, action:'denied', notes:reviewNotes })}>
                Deny
              </Button>
              <Button variant="primary" loading={reviewMutation.isPending}
                onClick={() => reviewMutation.mutate({ id:reviewTarget.id, action:'approved', notes:reviewNotes })}>
                Approve
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function SubmitLeaveModal({ open, onClose, onSuccess }) {
  const { data: myBalance } = useQuery({
    queryKey: ['my-balance'],
    queryFn: () => api.get('/hr/balances').then(r => r.data[0]),
    enabled: open,
  });

  const [form, setForm] = useState({
    leave_type:'vacation', start_date:'', end_date:'', notes:'', approx_days:'',
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const openEnded = ['personal','bereavement','medical','unpaid'].includes(form.leave_type);

  const mutation = useMutation({
    mutationFn: data => api.post('/hr/leave', data),
    onSuccess: () => { toast.success('Leave request submitted.'); onSuccess(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to submit.'),
  });

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.leave_type || !form.start_date || !form.end_date) {
      toast.error('Fill in all required fields.'); return;
    }
    mutation.mutate({
      ...form,
      approx_days: form.approx_days ? parseInt(form.approx_days) : undefined,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Request time off" size="md">
      <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
        {myBalance && (
          <div className="balance-summary">
            <span>PTO available:</span>
            <strong style={{ color:'var(--acc)' }}>
              {Math.max(myBalance.pto_total - myBalance.pto_used - myBalance.pto_pending, 0).toFixed(1)} days
            </strong>
            <span style={{ color:'var(--text-muted)', fontSize:'11px' }}>
              ({myBalance.pto_used} used + {myBalance.pto_pending} pending of {myBalance.pto_total})
            </span>
          </div>
        )}
        <div className="field">
          <label className="field-label">Leave type *</label>
          <select className="field-input" value={form.leave_type} onChange={e=>set('leave_type',e.target.value)}>
            {LEAVE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
          </select>
        </div>
        {form.leave_type === 'sick' && (
          <div style={{ background:'var(--warning-bg)', border:'1px solid var(--warning)', borderRadius:'var(--radius-sm)', padding:'0.625rem 0.875rem', fontSize:'0.8125rem', color:'var(--warning)' }}>
            ⚠ Sick leave over 5 consecutive business days will require an HR meeting to evaluate next steps.
          </div>
        )}
        {openEnded && (
          <div style={{ background:'var(--info-bg)', border:'1px solid var(--info)', borderRadius:'var(--radius-sm)', padding:'0.625rem 0.875rem', fontSize:'0.8125rem', color:'var(--info)' }}>
            ℹ This leave type is subject to HR discretion. Enter your best estimate of days needed — the final timeline will be agreed with HR.
          </div>
        )}
        <div className="grid-2">
          <Input label="Start date *" type="date" value={form.start_date} onChange={e=>set('start_date',e.target.value)} />
          <Input label="End date *" type="date" value={form.end_date} onChange={e=>set('end_date',e.target.value)} />
        </div>
        {openEnded && (
          <Input label="Approximate days needed" type="number" min="1"
            value={form.approx_days} onChange={e=>set('approx_days',e.target.value)}
            hint="Estimate — actual timeline subject to HR approval" />
        )}
        <Textarea label="Notes" value={form.notes} onChange={e=>set('notes',e.target.value)}
          rows={2} placeholder="Reason or additional context…" />
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>Submit request</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ============================================================
   Leave Balances
   ============================================================ */
function LeaveBalances() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const [editTarget, setEditTarget] = useState(null);
  const [newTotal, setNewTotal]     = useState('');

  const { data: balances, isLoading } = useQuery({
    queryKey: ['leave-balances'],
    queryFn: () => api.get('/hr/balances?year=2026').then(r => r.data),
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, pto_total }) => api.patch(`/hr/balances/${userId}?year=2026`, { pto_total }),
    onSuccess: () => { toast.success('Balance updated.'); setEditTarget(null); qc.invalidateQueries(['leave-balances']); },
    onError: () => toast.error('Failed to update balance.'),
  });

  if (isLoading) return <LoadingState />;

  return (
    <div>
      <Card padding={false}>
        <Table>
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th>PTO total</Th>
              <Th>Used</Th>
              <Th>Pending</Th>
              <Th>Available</Th>
              <Th>Balance bar</Th>
              {hasRole('ops_manager') && <Th></Th>}
            </tr>
          </thead>
          <tbody>
            {(balances||[]).map(b => {
              const available = Math.max(b.pto_total - b.pto_used - b.pto_pending, 0);
              const pctUsed   = b.pto_total > 0 ? ((b.pto_used/b.pto_total)*100) : 0;
              const pctPending= b.pto_total > 0 ? ((b.pto_pending/b.pto_total)*100) : 0;
              return (
                <tr key={b.user_id}>
                  <Td><strong>{b.full_name}</strong></Td>
                  <Td>{b.pto_total}d</Td>
                  <Td>{b.pto_used}d</Td>
                  <Td>{b.pto_pending > 0 ? <Badge variant="warning">{b.pto_pending}d</Badge> : '—'}</Td>
                  <Td>
                    <strong style={{ color: available < 3 ? 'var(--danger)' : 'var(--accent)' }}>
                      {available.toFixed(1)}d
                    </strong>
                  </Td>
                  <Td style={{ minWidth:'140px' }}>
                    <div className="balance-bar-track">
                      <div className="balance-bar-used"   style={{ width:`${pctUsed}%` }} />
                      <div className="balance-bar-pending" style={{ width:`${pctPending}%` }} />
                    </div>
                    <div style={{ fontSize:'10px', color:'var(--text-muted)', marginTop:'2px', display:'flex', gap:'8px' }}>
                      <span style={{ color:'var(--accent)' }}>■ used</span>
                      <span style={{ color:'var(--warning)' }}>■ pending</span>
                    </div>
                  </Td>
                  {hasRole('ops_manager') && (
                    <Td>
                      <Button variant="ghost" size="sm"
                        onClick={() => { setEditTarget(b); setNewTotal(b.pto_total); }}>
                        Edit
                      </Button>
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)}
        title={`Edit PTO — ${editTarget?.full_name}`} size="sm">
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
          <Input label="Annual PTO total (days)" type="number" min="0" step="0.5"
            value={newTotal} onChange={e => setNewTotal(e.target.value)} />
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button variant="primary" loading={updateMutation.isPending}
              onClick={() => updateMutation.mutate({ userId: editTarget.user_id, pto_total: parseFloat(newTotal) })}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ============================================================
   Patricia's Schedule — ops manager only
   ============================================================ */
function PatriciaSchedule() {
  const qc = useQueryClient();
  const [editWeek, setEditWeek] = useState(null);
  const [overrideDay, setOverrideDay] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const { data: schedule, isLoading } = useQuery({
    queryKey: ['pw-schedule'],
    queryFn: () => api.get('/hr/schedule/pw').then(r => r.data),
  });

  const updateMutation = useMutation({
    mutationFn: data => api.patch('/hr/schedule/pw', data),
    onSuccess: () => {
      toast.success('Schedule updated.');
      setEditWeek(null);
      qc.invalidateQueries(['pw-schedule']);
    },
    onError: () => toast.error('Failed to update schedule.'),
  });

  if (isLoading) return <LoadingState />;

  return (
    <div>
      <div style={{ background:'var(--bg-raised)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', padding:'0.875rem 1rem', marginBottom:'1.25rem', fontSize:'0.875rem', color:'var(--text-secondary)' }}>
        Patricia works a 4-day week. Her day off defaults to <strong style={{ color:'var(--text-primary)' }}>Tuesday</strong> each week.
        Either Patricia or Chris can override this to a different day for any given week.
      </div>

      <Card padding={false}>
        <Table>
          <thead>
            <tr>
              <Th>Week of</Th>
              <Th>Day off</Th>
              <Th>Override</Th>
              <Th>Set by</Th>
              <Th>Reason</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {(schedule||[]).map(w => {
              const effectiveDay = w.override_day_off !== null ? w.override_day_off : w.regular_day_off;
              const isOverridden = w.override_day_off !== null;
              return (
                <tr key={w.id}>
                  <Td>{formatDate(w.week_start, 'MMM d, yyyy')}</Td>
                  <Td>
                    <strong>{DAY_NAMES[w.regular_day_off]}</strong>
                    <span style={{ color:'var(--text-muted)', fontSize:'11px' }}> (default)</span>
                  </Td>
                  <Td>
                    {isOverridden
                      ? <Badge variant="warning">→ {DAY_NAMES[effectiveDay]}</Badge>
                      : <span style={{ color:'var(--text-muted)', fontSize:'12px' }}>No override</span>
                    }
                  </Td>
                  <Td>{w.set_by_name || '—'}</Td>
                  <Td><span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>{w.override_reason || '—'}</span></Td>
                  <Td>
                    <Button variant="ghost" size="sm"
                      onClick={() => { setEditWeek(w); setOverrideDay(w.override_day_off ?? ''); setOverrideReason(w.override_reason||''); }}>
                      Override
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Modal open={!!editWeek} onClose={() => setEditWeek(null)}
        title={`Override schedule — week of ${editWeek ? formatDate(editWeek.week_start) : ''}`}
        size="sm">
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
          <div className="field">
            <label className="field-label">Day off this week</label>
            <select className="field-input" value={overrideDay}
              onChange={e => setOverrideDay(e.target.value)}>
              <option value="">Default — Tuesday</option>
              <option value="1">Monday</option>
              <option value="3">Wednesday</option>
              <option value="4">Thursday</option>
              <option value="5">Friday</option>
            </select>
          </div>
          <Input label="Reason (optional)" value={overrideReason}
            onChange={e => setOverrideReason(e.target.value)}
            placeholder="e.g. Client meeting Tuesday, swapping to Friday" />
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setEditWeek(null)}>Cancel</Button>
            <Button variant="primary" loading={updateMutation.isPending}
              onClick={() => updateMutation.mutate({
                week_start:       editWeek.week_start,
                override_day_off: overrideDay !== '' ? parseInt(overrideDay) : null,
                override_reason:  overrideReason || null,
              })}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
