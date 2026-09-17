import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, Card, CardHeader, Button, Input, Badge
} from '../../components/ui/UI';
import toast from 'react-hot-toast';
import './AdminPage.css';

const ROLE_LABELS = {
  lab_tech:    'Lab technician',
  ops_manager: 'Operations manager',
  qm_director: 'QM director',
  ceo:         'CEO',
};

export default function ProfilePage() {
  const { user } = useAuth();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [done, setDone]           = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.post('/auth/change-password', {
      current_password: currentPw,
      new_password:     newPw,
    }),
    onSuccess: () => {
      toast.success('Password updated.');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setDone(true);
      setTimeout(() => setDone(false), 5000);
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to update password.'),
  });

  const handleSubmit = e => {
    e.preventDefault();
    if (!currentPw) { toast.error('Enter your current password.'); return; }
    if (newPw.length < 8) { toast.error('New password must be at least 8 characters.'); return; }
    if (newPw !== confirmPw) { toast.error('Passwords do not match.'); return; }
    if (newPw === currentPw) { toast.error('New password must be different from current.'); return; }
    mutation.mutate();
  };

  const pwStrength = pw => {
    if (!pw) return null;
    if (pw.length < 8)  return { label: 'Too short', color: 'var(--danger)' };
    if (pw.length < 12) return { label: 'Fair', color: 'var(--warning)' };
    return { label: 'Strong', color: 'var(--success)' };
  };
  const strength = pwStrength(newPw);

  return (
    <div>
      <PageHeader
        title="My profile"
        subtitle="Your account details and password"
      />

      <div className="profile-card">
        {/* Account info */}
        <Card style={{ marginBottom: '1.25rem' }}>
          <CardHeader title="Account details" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'var(--bg-raised)', border: '1px solid var(--border-raised)',
                color: 'var(--accent)', fontSize: '1rem', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, letterSpacing: '0.04em',
              }}>
                {user?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {user?.full_name}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {user?.email}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Role</span>
              <Badge variant={
                user?.role === 'ops_manager' ? 'accent' :
                user?.role === 'ceo'         ? 'warning' :
                user?.role === 'qm_director' ? 'info' : 'muted'
              }>
                {ROLE_LABELS[user?.role]}
              </Badge>
            </div>
          </div>
        </Card>

        {/* Change password */}
        <Card>
          <CardHeader
            title="Change password"
            subtitle="Use a strong password of at least 8 characters"
          />
          {done && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.625rem',
              background: 'var(--success-bg)', border: '1px solid var(--success)',
              borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem',
              marginBottom: '1rem', fontSize: '0.875rem', color: 'var(--success)',
            }}>
              ✓ Password updated successfully.
            </div>
          )}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Input
              label="Current password"
              type="password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              placeholder="Your current password"
              autoComplete="current-password"
            />
            <div>
              <Input
                label="New password"
                type="password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
              />
              {strength && (
                <span style={{ fontSize: '0.75rem', color: strength.color, marginTop: '4px', display: 'block' }}>
                  {strength.label}
                </span>
              )}
            </div>
            <Input
              label="Confirm new password"
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              placeholder="Re-enter new password"
              autoComplete="new-password"
              error={confirmPw && newPw !== confirmPw ? 'Passwords do not match' : undefined}
            />
            <div style={{ paddingTop: '0.5rem' }}>
              <Button
                type="submit"
                variant="primary"
                loading={mutation.isPending}
                disabled={!currentPw || !newPw || !confirmPw}
              >
                Update password
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
