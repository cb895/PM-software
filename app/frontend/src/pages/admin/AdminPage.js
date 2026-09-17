import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, Card, CardHeader, Button, Input,
  Badge, Table, Th, Td, EmptyState, LoadingState,
  Modal, StatCard
} from '../../components/ui/UI';
import { formatDate } from '../../utils/format';
import toast from 'react-hot-toast';
import './AdminPage.css';

const ROLE_LABELS = {
  lab_tech:    'Lab technician',
  ops_manager: 'Operations manager',
  qm_director: 'QM director',
  ceo:         'CEO',
};

const ROLE_BADGE = {
  lab_tech:    'muted',
  ops_manager: 'accent',
  qm_director: 'info',
  ceo:         'warning',
};

function initials(name) {
  return (name || '??').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

/* ============================================================
   Admin — User Management (ops manager only)
   ============================================================ */
export default function AdminPage() {
  const { user: currentUser } = useAuth();
  const qc = useQueryClient();

  const [showCreate, setShowCreate]       = useState(false);
  const [resetTarget, setResetTarget]     = useState(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);
  const [confirmReactivate, setConfirmReactivate] = useState(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => api.get('/auth/users/all').then(r => r.data),
  });

  const deactivateMutation = useMutation({
    mutationFn: id => api.post(`/auth/users/${id}/deactivate`),
    onSuccess: (_, id) => {
      const u = users?.find(u => u.id === id);
      toast.success(`${u?.full_name}'s account deactivated. All data preserved.`);
      setConfirmDeactivate(null);
      qc.invalidateQueries(['all-users']);
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to deactivate.'),
  });

  const reactivateMutation = useMutation({
    mutationFn: id => api.post(`/auth/users/${id}/reactivate`),
    onSuccess: (_, id) => {
      const u = users?.find(u => u.id === id);
      toast.success(`${u?.full_name}'s account reactivated.`);
      setConfirmReactivate(null);
      qc.invalidateQueries(['all-users']);
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to reactivate.'),
  });

  const active   = users?.filter(u => u.is_active)  || [];
  const inactive = users?.filter(u => !u.is_active) || [];

  return (
    <div>
      <PageHeader
        title="User management"
        subtitle="Manage accounts, passwords, and access — ops manager only"
        action={
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            + New account
          </Button>
        }
      />

      <div className="stats-row">
        <StatCard label="Total accounts" value={users?.length ?? '—'} />
        <StatCard label="Active"         value={active.length}   accent />
        <StatCard label="Inactive"       value={inactive.length} warning={inactive.length > 0} sub="data preserved" />
      </div>

      {isLoading ? <LoadingState /> : (
        <>
          {/* Active accounts */}
          <h3 className="section-label">Active accounts</h3>
          <Card className="user-table-card" padding={false}>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Account created</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {active.map(u => (
                  <tr key={u.id}>
                    <Td>
                      <div className="user-name-cell">
                        <div className="user-avatar-sm">{initials(u.full_name)}</div>
                        <div>
                          <div className="user-full-name">{u.full_name}</div>
                          {u.id === currentUser.id && (
                            <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>You</span>
                          )}
                        </div>
                      </div>
                    </Td>
                    <Td><span className="email-cell">{u.email}</span></Td>
                    <Td><Badge variant={ROLE_BADGE[u.role]}>{ROLE_LABELS[u.role]}</Badge></Td>
                    <Td>{formatDate(u.created_at)}</Td>
                    <Td>
                      <div className="action-buttons">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setResetTarget(u)}
                        >
                          Reset password
                        </Button>
                        {u.id !== currentUser.id && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setConfirmDeactivate(u)}
                          >
                            Deactivate
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {/* Inactive accounts */}
          {inactive.length > 0 && (
            <>
              <h3 className="section-label section-label--inactive">
                Inactive accounts
                <span className="section-label-note">
                  These accounts cannot log in. All data they contributed is preserved.
                </span>
              </h3>
              <Card className="user-table-card" padding={false}>
                <Table>
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Email</Th>
                      <Th>Role</Th>
                      <Th>Deactivated</Th>
                      <Th>Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {inactive.map(u => (
                      <tr key={u.id} className="inactive-row">
                        <Td>
                          <div className="user-name-cell">
                            <div className="user-avatar-sm user-avatar-sm--inactive">{initials(u.full_name)}</div>
                            <span className="user-full-name user-full-name--inactive">{u.full_name}</span>
                          </div>
                        </Td>
                        <Td><span className="email-cell email-cell--inactive">{u.email}</span></Td>
                        <Td><Badge variant="muted">{ROLE_LABELS[u.role]}</Badge></Td>
                        <Td>{formatDate(u.updated_at)}</Td>
                        <Td>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setConfirmReactivate(u)}
                          >
                            Reactivate
                          </Button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </>
          )}
        </>
      )}

      {/* Create account modal */}
      <CreateAccountModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => { setShowCreate(false); qc.invalidateQueries(['all-users']); }}
      />

      {/* Reset password modal */}
      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onSuccess={() => setResetTarget(null)}
        />
      )}

      {/* Deactivate confirmation */}
      <Modal
        open={!!confirmDeactivate}
        onClose={() => setConfirmDeactivate(null)}
        title={`Deactivate ${confirmDeactivate?.full_name}?`}
        size="sm"
      >
        <div className="deactivate-warning">
          <p>
            <strong>{confirmDeactivate?.full_name}</strong> will no longer be able to log in.
            Their email address <strong>{confirmDeactivate?.email}</strong> will be locked.
          </p>
          <div className="preserve-note">
            <span className="preserve-icon">✓</span>
            <div>
              <strong>All data is preserved.</strong> Their daily logs, PO submissions, task updates,
              consumable usage, and any other contributions remain fully intact and attributed to them.
              This cannot corrupt or remove any project history.
            </div>
          </div>
          <p>You can reactivate this account at any time.</p>
        </div>
        <div className="modal-footer">
          <Button variant="secondary" onClick={() => setConfirmDeactivate(null)}>Cancel</Button>
          <Button
            variant="danger"
            loading={deactivateMutation.isPending}
            onClick={() => deactivateMutation.mutate(confirmDeactivate.id)}
          >
            Deactivate account
          </Button>
        </div>
      </Modal>

      {/* Reactivate confirmation */}
      <Modal
        open={!!confirmReactivate}
        onClose={() => setConfirmReactivate(null)}
        title={`Reactivate ${confirmReactivate?.full_name}?`}
        size="sm"
      >
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          <strong>{confirmReactivate?.full_name}</strong> will be able to log in again
          using their existing email and password. Their previous work history and data
          will be immediately accessible.
        </p>
        <div className="modal-footer">
          <Button variant="secondary" onClick={() => setConfirmReactivate(null)}>Cancel</Button>
          <Button
            variant="primary"
            loading={reactivateMutation.isPending}
            onClick={() => reactivateMutation.mutate(confirmReactivate.id)}
          >
            Reactivate account
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* ============================================================
   Create Account Modal
   ============================================================ */
function CreateAccountModal({ open, onClose, onSuccess }) {
  const [form, setForm] = useState({
    full_name: '', email: '', password: '', role: 'lab_tech',
  });
  const [confirmPw, setConfirmPw] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: data => api.post('/auth/users/create', data),
    onSuccess: (_, vars) => {
      toast.success(`Account created for ${vars.full_name}.`);
      setForm({ full_name: '', email: '', password: '', role: 'lab_tech' });
      setConfirmPw('');
      onSuccess();
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to create account.'),
  });

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.full_name) { toast.error('Enter the person\'s full name.'); return; }
    if (!form.email.includes('@')) { toast.error('Enter a valid email address.'); return; }
    if (form.password.length < 8) { toast.error('Password must be at least 8 characters.'); return; }
    if (form.password !== confirmPw) { toast.error('Passwords do not match.'); return; }
    mutation.mutate(form);
  };

  const pwStrength = pw => {
    if (!pw) return null;
    if (pw.length < 8) return { label: 'Too short', color: 'var(--danger)' };
    if (pw.length < 12) return { label: 'Fair', color: 'var(--warning)' };
    return { label: 'Strong', color: 'var(--success)' };
  };

  const strength = pwStrength(form.password);

  return (
    <Modal open={open} onClose={onClose} title="Create new account" size="md">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <Input
          label="Full name *"
          value={form.full_name}
          onChange={e => set('full_name', e.target.value)}
          placeholder="e.g. Jane Smith"
          autoFocus
        />
        <Input
          label="Email address *"
          type="email"
          value={form.email}
          onChange={e => set('email', e.target.value)}
          placeholder="jane@metabolictrack.com"
        />
        <div className="field">
          <label className="field-label">Role *</label>
          <select className="field-input" value={form.role} onChange={e => set('role', e.target.value)}>
            <option value="lab_tech">Lab technician</option>
            <option value="qm_director">QM director</option>
            <option value="ceo">CEO</option>
            <option value="ops_manager">Operations manager</option>
          </select>
        </div>
        <div>
          <Input
            label="Temporary password *"
            type="password"
            value={form.password}
            onChange={e => set('password', e.target.value)}
            placeholder="Min. 8 characters"
          />
          {strength && (
            <span style={{ fontSize: '0.75rem', color: strength.color, marginTop: '4px', display: 'block' }}>
              {strength.label}
            </span>
          )}
        </div>
        <Input
          label="Confirm password *"
          type="password"
          value={confirmPw}
          onChange={e => setConfirmPw(e.target.value)}
          placeholder="Re-enter password"
          error={confirmPw && form.password !== confirmPw ? 'Passwords do not match' : undefined}
        />
        <div className="create-note">
          The person will be able to log in immediately with this password.
          Ask them to change it on first login.
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>Create account</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ============================================================
   Reset Password Modal
   ============================================================ */
function ResetPasswordModal({ user, onClose, onSuccess }) {
  const [newPw, setNewPw]       = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [done, setDone]         = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.post(`/auth/users/${user.id}/reset-password`, { new_password: newPw }),
    onSuccess: () => {
      setDone(true);
      toast.success(`Password reset for ${user.full_name}.`);
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to reset password.'),
  });

  const handleSubmit = e => {
    e.preventDefault();
    if (newPw.length < 8) { toast.error('Password must be at least 8 characters.'); return; }
    if (newPw !== confirmPw) { toast.error('Passwords do not match.'); return; }
    mutation.mutate();
  };

  return (
    <Modal open={true} onClose={onClose} title={`Reset password — ${user.full_name}`} size="sm">
      {done ? (
        <div>
          <div className="reset-success">
            <span className="reset-success-icon">✓</span>
            <div>
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>Password reset</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                {user.full_name} can now log in with the new password you set.
                Make sure to share it with them securely.
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="reset-info">
            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Account</span>
            <strong>{user.email}</strong>
          </div>
          <Input
            label="New password *"
            type="password"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            placeholder="Min. 8 characters"
            autoFocus
          />
          <Input
            label="Confirm password *"
            type="password"
            value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            placeholder="Re-enter password"
            error={confirmPw && newPw !== confirmPw ? 'Passwords do not match' : undefined}
          />
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            The user will be logged out of any active sessions and will need to log in again with this new password.
          </p>
          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={mutation.isPending}>Reset password</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
