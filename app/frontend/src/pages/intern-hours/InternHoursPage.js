import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, Card, CardHeader, Button, Input, Textarea,
  Table, Th, Td, EmptyState, LoadingState
} from '../../components/ui/UI';
import { formatDate, formatHours } from '../../utils/format';
import toast from 'react-hot-toast';

/* ---- Intern's own view: log hours + see their own history ---- */
function MyHours() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [hours, setHours]   = useState('');
  const [summary, setSummary] = useState('');

  const { data: myLogs, isLoading } = useQuery({
    queryKey: ['my-intern-logs'],
    queryFn: () => api.get('/intern-logs/me').then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: () => api.post('/intern-logs', { hours: parseFloat(hours), summary: summary || null }),
    onSuccess: () => {
      toast.success('Hours logged.');
      setHours(''); setSummary('');
      qc.invalidateQueries(['my-intern-logs']);
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to log hours.'),
  });

  const handleSubmit = e => {
    e.preventDefault();
    if (!hours || parseFloat(hours) <= 0) { toast.error('Enter your hours for today.'); return; }
    mutation.mutate();
  };

  return (
    <div>
      <PageHeader title="Intern hours" subtitle="Log today's time in the lab" />

      <Card style={{ maxWidth: '520px', marginBottom: '1.5rem' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Input label="Name" value={user?.full_name || ''} disabled readOnly />
          <Input label="Hrs" type="number" min="0.25" max="24" step="0.25"
            value={hours} onChange={e => setHours(e.target.value)}
            placeholder="e.g. 4" />
          <Textarea label="Summary" value={summary} onChange={e => setSummary(e.target.value)}
            placeholder="Brief note on what you worked on today…" rows={3} />
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Log today's hours
          </Button>
        </form>
      </Card>

      <h3 className="section-title">Your recent entries</h3>
      {isLoading ? <LoadingState /> : !myLogs?.length ? (
        <EmptyState title="No hours logged yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Hrs</Th>
              <Th>Summary</Th>
            </tr>
          </thead>
          <tbody>
            {myLogs.map(l => (
              <tr key={l.id}>
                <Td>{formatDate(l.log_date)}</Td>
                <Td>{formatHours(l.hours)}</Td>
                <Td>{l.summary || '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

/* ---- ops_manager / ceo view: everyone's intern hours, read-only + delete ---- */
function AllInternHours() {
  const qc = useQueryClient();

  const { data: logs, isLoading } = useQuery({
    queryKey: ['all-intern-logs'],
    queryFn: () => api.get('/intern-logs').then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: id => api.delete(`/intern-logs/${id}`),
    onSuccess: () => { toast.success('Entry deleted.'); qc.invalidateQueries(['all-intern-logs']); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to delete.'),
  });

  return (
    <div>
      <PageHeader title="Intern hours" subtitle="Presence log for student interns — not part of weekly reports, budget, or consumable usage" />

      <Card>
        <CardHeader title="All entries" />
        {isLoading ? <LoadingState /> : !logs?.length ? (
          <EmptyState title="No intern hours logged yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Date</Th>
                <Th>Hrs</Th>
                <Th>Summary</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id}>
                  <Td>{l.full_name}</Td>
                  <Td>{formatDate(l.log_date)}</Td>
                  <Td>{formatHours(l.hours)}</Td>
                  <Td>{l.summary || '—'}</Td>
                  <Td>
                    <Button variant="ghost" size="sm"
                      loading={deleteMutation.isPending && deleteMutation.variables === l.id}
                      onClick={() => {
                        if (window.confirm(`Delete ${l.full_name}'s entry for ${formatDate(l.log_date)}?`)) {
                          deleteMutation.mutate(l.id);
                        }
                      }}>
                      Delete
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

export default function InternHoursPage() {
  const { hasRole } = useAuth();
  return hasRole('intern') ? <MyHours /> : <AllInternHours />;
}
