import React, { useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, Card, CardHeader, Button, Input, Textarea,
  Badge, Table, Th, Td, EmptyState, LoadingState, Modal, StatCard
} from '../../components/ui/UI';
import { formatDate } from '../../utils/format';
import toast from 'react-hot-toast';
import './SuppliersPage.css';

/* ---- Status badge ---- */
function OnboardingBadge({ status }) {
  const map = {
    'Verified':            'success',
    'Ready for Approval':  'accent',
    'Email/inquiry sent':  'info',
    'To do':               'muted',
  };
  return <Badge variant={map[status] || 'muted'}>{status || 'To do'}</Badge>;
}

function TypeBadge({ type }) {
  const map = {
    'Manufacturer':                  'blue',
    'Good Provider/Trading Company': 'teal',
    'Services':                      'purple',
  };
  const variant = map[type] ? 'accent' : 'muted';
  return <Badge variant={variant}>{type || '—'}</Badge>;
}

/* ============================================================
   Supplier List
   ============================================================ */
function SupplierList() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const qc = useQueryClient();

  const { data: suppliers, isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers').then(r => r.data),
  });

  const filtered = (suppliers || []).filter(s => {
    const q = search.toLowerCase();
    const matchSearch = !search ||
      s.name?.toLowerCase().includes(q) ||
      s.code?.toLowerCase().includes(q) ||
      s.categories?.toLowerCase().includes(q);
    const matchType   = !typeFilter   || s.supplier_type === typeFilter;
    const matchStatus = !statusFilter || s.onboarding_status === statusFilter;
    return matchSearch && matchType && matchStatus;
  });

  const types    = [...new Set((suppliers || []).map(s => s.supplier_type).filter(Boolean))];
  const statuses = ['Verified', 'Ready for Approval', 'Email/inquiry sent', 'To do'];

  const stats = {
    total:    suppliers?.length ?? 0,
    verified: suppliers?.filter(s => s.onboarding_status === 'Verified').length ?? 0,
    pending:  suppliers?.filter(s => s.onboarding_status === 'Ready for Approval').length ?? 0,
    todo:     suppliers?.filter(s => s.onboarding_status === 'To do').length ?? 0,
  };

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle={`${stats.total} suppliers across all categories`}
        action={
          hasRole('ops_manager', 'qm_director') && (
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              + Add supplier
            </Button>
          )
        }
      />

      <div className="stats-row">
        <StatCard label="Total suppliers" value={stats.total} />
        <StatCard label="Verified"         value={stats.verified} accent />
        <StatCard label="Ready to approve" value={stats.pending} warning={stats.pending > 0} />
        <StatCard label="To do"            value={stats.todo} />
      </div>

      {/* Filters */}
      <Card className="supplier-filters">
        <div className="filter-row">
          <input
            className="field-input filter-search"
            placeholder="Search name, code, category…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="field">
            <select className="field-input" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <select className="field-input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {statuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {(search || typeFilter || statusFilter) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setTypeFilter(''); setStatusFilter(''); }}>
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      {isLoading ? <LoadingState /> : !filtered.length ? (
        <EmptyState
          title="No suppliers found"
          description={search ? `No results for "${search}".` : 'No suppliers yet.'}
          action={hasRole('ops_manager') && <Button variant="primary" onClick={() => setShowCreate(true)}>Add supplier</Button>}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Code</Th>
              <Th>Type</Th>
              <Th>Categories</Th>
              <Th>Onboarding</Th>
              <Th>Website</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} onClick={() => navigate(`/suppliers/${s.id}`)} style={{ cursor: 'pointer' }}>
                <Td>
                  <div className="supplier-name-cell">
                    <span className="supplier-name">{s.name}</span>
                    {!s.is_active && <Badge variant="muted">Inactive</Badge>}
                  </div>
                </Td>
                <Td><span className="supplier-code">{s.code || '—'}</span></Td>
                <Td><TypeBadge type={s.supplier_type} /></Td>
                <Td>
                  <span className="supplier-categories">{s.categories || '—'}</span>
                </Td>
                <Td><OnboardingBadge status={s.onboarding_status} /></Td>
                <Td>
                  {s.website
                    ? <a href={s.website} target="_blank" rel="noreferrer" className="supplier-link"
                        onClick={e => e.stopPropagation()}>Visit ↗</a>
                    : '—'
                  }
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <CreateSupplierModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => { setShowCreate(false); qc.invalidateQueries(['suppliers']); }}
      />
    </div>
  );
}

/* ============================================================
   Supplier Detail
   ============================================================ */
function SupplierDetail() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const id = window.location.pathname.split('/').pop();

  const [showEdit, setShowEdit] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [credVisible, setCredVisible] = useState(false);

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => api.get(`/suppliers/${id}`).then(r => r.data),
  });

  const { data: credentials, refetch: refetchCreds } = useQuery({
    queryKey: ['supplier-credentials', id],
    queryFn: () => api.get(`/suppliers/${id}/credentials`).then(r => r.data),
    enabled: false, // only fetched on demand
  });

  const handleShowCreds = async () => {
    await refetchCreds();
    setShowCredentials(true);
  };

  if (isLoading) return <LoadingState />;
  if (!supplier) return (
    <EmptyState title="Supplier not found"
      action={<Button onClick={() => navigate('/suppliers')}>Back</Button>} />
  );

  return (
    <div>
      <PageHeader
        title={supplier.name}
        subtitle={supplier.supplier_type || 'Supplier'}
        action={
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <Button variant="secondary" onClick={() => navigate('/suppliers')}>← Back</Button>
            {hasRole('ops_manager', 'qm_director') && (
              <>
                <Button variant="secondary" onClick={() => setShowEdit(true)}>Edit</Button>
                <Button variant="secondary" onClick={handleShowCreds}>
                  View credentials
                </Button>
              </>
            )}
            {hasRole('qm_director') && (
              <Button variant="secondary" onClick={handleShowCreds}>
                View credentials
              </Button>
            )}
          </div>
        }
      />

      <div className="supplier-detail-grid">
        {/* Main info */}
        <Card>
          <CardHeader title="Supplier information" />
          <div className="detail-meta-grid">
            <div className="meta-item">
              <span className="meta-label">Code</span>
              <span className="supplier-code-large">{supplier.code || '—'}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Type</span>
              <TypeBadge type={supplier.supplier_type} />
            </div>
            <div className="meta-item">
              <span className="meta-label">Onboarding status</span>
              <OnboardingBadge status={supplier.onboarding_status} />
            </div>
            <div className="meta-item">
              <span className="meta-label">Active</span>
              <Badge variant={supplier.is_active ? 'success' : 'muted'}>
                {supplier.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            {supplier.contact_name && (
              <div className="meta-item">
                <span className="meta-label">Contact</span>
                <span>{supplier.contact_name}</span>
              </div>
            )}
            {supplier.phone && (
              <div className="meta-item">
                <span className="meta-label">Phone</span>
                <span>{supplier.phone}</span>
              </div>
            )}
            {supplier.email && (
              <div className="meta-item">
                <span className="meta-label">Email</span>
                <a href={`mailto:${supplier.email}`} className="supplier-link">{supplier.email}</a>
              </div>
            )}
            {supplier.website && (
              <div className="meta-item">
                <span className="meta-label">Website</span>
                <a href={supplier.website} target="_blank" rel="noreferrer" className="supplier-link">
                  {supplier.website} ↗
                </a>
              </div>
            )}
            {supplier.address && (
              <div className="meta-item meta-item--full">
                <span className="meta-label">Address</span>
                <span>{supplier.address}</span>
              </div>
            )}
            {supplier.categories && (
              <div className="meta-item meta-item--full">
                <span className="meta-label">Categories</span>
                <div className="category-tags">
                  {supplier.categories.split(', ').map(cat => (
                    <Badge key={cat} variant="muted">{cat}</Badge>
                  ))}
                </div>
              </div>
            )}
            {supplier.notes && (
              <div className="meta-item meta-item--full">
                <span className="meta-label">Notes</span>
                <p style={{ margin: 0 }}>{supplier.notes}</p>
              </div>
            )}
          </div>
        </Card>

        {/* Credentials card — visible to ops_manager and qm_director only */}
        {hasRole('ops_manager', 'ceo', 'qm_director') && (
          <Card className="credentials-card">  
            <CardHeader
              title="Portal credentials"
              subtitle="Visible to ops manager and QM director only"
            />
            <div className="credentials-locked">
              <span className="lock-icon" aria-hidden="true">🔒</span>
              <p>Credentials are stored encrypted. Click to reveal.</p>
              <Button variant="secondary" size="sm" onClick={handleShowCreds}>
                Reveal credentials
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* Edit modal */}
      {hasRole('ops_manager') && (
        <EditSupplierModal
          open={showEdit}
          supplier={supplier}
          onClose={() => setShowEdit(false)}
          onSuccess={() => { setShowEdit(false); qc.invalidateQueries(['supplier', id]); qc.invalidateQueries(['suppliers']); }}
        />
      )}

      {/* Credentials modal */}
      <CredentialsModal
        open={showCredentials}
        supplierId={id}
        supplierName={supplier.name}
        credentials={credentials}
        onClose={() => { setShowCredentials(false); setCredVisible(false); }}
        onSuccess={() => qc.invalidateQueries(['supplier-credentials', id])}
        credVisible={credVisible}
        setCredVisible={setCredVisible}
      />
    </div>
  );
}

/* ============================================================
   Create Supplier Modal
   ============================================================ */
function CreateSupplierModal({ open, onClose, onSuccess }) {
  const [form, setForm] = useState({
    name: '', code: '', supplier_type: 'Manufacturer', contact_name: '',
    phone: '', email: '', address: '', website: '', notes: '',
    onboarding_status: 'To do',
  });

  const mutation = useMutation({
    mutationFn: data => api.post('/suppliers', data),
    onSuccess: () => { toast.success('Supplier added.'); onSuccess(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to add supplier.'),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.name) { toast.error('Supplier name is required.'); return; }
    mutation.mutate(form);
  };

  return (
    <Modal open={open} onClose={onClose} title="Add supplier" size="lg">
      <form onSubmit={handleSubmit} className="supplier-form">
        <div className="grid-2">
          <Input label="Supplier name *" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Sigma Aldrich" />
          <Input label="Short code" value={form.code} onChange={e => set('code', e.target.value)} placeholder="e.g. SGA" />
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="field-label">Type</label>
            <select className="field-input" value={form.supplier_type} onChange={e => set('supplier_type', e.target.value)}>
              <option>Manufacturer</option>
              <option>Good Provider/Trading Company</option>
              <option>Services</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Onboarding status</label>
            <select className="field-input" value={form.onboarding_status} onChange={e => set('onboarding_status', e.target.value)}>
              <option>To do</option>
              <option>Email/inquiry sent</option>
              <option>Ready for Approval</option>
              <option>Verified</option>
            </select>
          </div>
        </div>
        <div className="grid-2">
          <Input label="Contact name" value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
          <Input label="Phone" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </div>
        <div className="grid-2">
          <Input label="Email" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
          <Input label="Website" value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://…" />
        </div>
        <Textarea label="Address" value={form.address} onChange={e => set('address', e.target.value)} rows={2} />
        <Textarea label="Notes" value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} />
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>Add supplier</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ============================================================
   Edit Supplier Modal
   ============================================================ */
function EditSupplierModal({ open, supplier, onClose, onSuccess }) {
  const [form, setForm] = useState({ ...supplier });

  const mutation = useMutation({
    mutationFn: data => api.patch(`/suppliers/${supplier.id}`, data),
    onSuccess: () => { toast.success('Supplier updated.'); onSuccess(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to update.'),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={`Edit — ${supplier.name}`} size="lg">
      <form onSubmit={e => { e.preventDefault(); mutation.mutate(form); }} className="supplier-form">
        <div className="grid-2">
          <Input label="Supplier name *" value={form.name || ''} onChange={e => set('name', e.target.value)} />
          <Input label="Short code" value={form.code || ''} onChange={e => set('code', e.target.value)} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="field-label">Type</label>
            <select className="field-input" value={form.supplier_type || ''} onChange={e => set('supplier_type', e.target.value)}>
              <option>Manufacturer</option>
              <option>Good Provider/Trading Company</option>
              <option>Services</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Onboarding status</label>
            <select className="field-input" value={form.onboarding_status || ''} onChange={e => set('onboarding_status', e.target.value)}>
              <option>To do</option>
              <option>Email/inquiry sent</option>
              <option>Ready for Approval</option>
              <option>Verified</option>
            </select>
          </div>
        </div>
        <div className="grid-2">
          <Input label="Contact name" value={form.contact_name || ''} onChange={e => set('contact_name', e.target.value)} />
          <Input label="Phone" value={form.phone || ''} onChange={e => set('phone', e.target.value)} />
        </div>
        <div className="grid-2">
          <Input label="Email" type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} />
          <Input label="Website" value={form.website || ''} onChange={e => set('website', e.target.value)} />
        </div>
        <Textarea label="Address" value={form.address || ''} onChange={e => set('address', e.target.value)} rows={2} />
        <Textarea label="Notes" value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2} />
        <div className="field">
          <label className="field-label">Active</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Supplier is active</span>
          </label>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>Save changes</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ============================================================
   Credentials Modal — ops_manager + qm_director only
   ============================================================ */
function CredentialsModal({ open, supplierId, supplierName, credentials, onClose, onSuccess, credVisible, setCredVisible }) {
  const { hasRole } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ portal_url: '', username: '', password: '', portal_email: '', account_number: '', notes: '' });

  const mutation = useMutation({
    mutationFn: data => api.put(`/suppliers/${supplierId}/credentials`, data),
    onSuccess: () => { toast.success('Credentials updated.'); setEditing(false); onSuccess(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to update credentials.'),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  React.useEffect(() => {
    if (credentials && !credentials.message) {
      setForm({
        portal_url:     credentials.portal_url || '',
        username:       credentials.username || '',
        password:       '',
        portal_email:   credentials.portal_email || '',
        account_number: credentials.account_number || '',
        notes:          credentials.notes || '',
      });
    }
  }, [credentials]);

  const hasCreds = credentials && !credentials.message;

  return (
    <Modal open={open} onClose={onClose} title={`Credentials — ${supplierName}`} size="md">
      {!hasCreds ? (
        <div className="no-creds">
          <p>No credentials on file yet.</p>
          {hasRole('ops_manager') && (
            <Button variant="primary" size="sm" onClick={() => setEditing(true)}>Add credentials</Button>
          )}
        </div>
      ) : editing ? (
        <form onSubmit={e => { e.preventDefault(); mutation.mutate(form); }} className="supplier-form">
          <Input label="Portal URL" value={form.portal_url} onChange={e => set('portal_url', e.target.value)} placeholder="https://…" />
          <div className="grid-2">
            <Input label="Username" value={form.username} onChange={e => set('username', e.target.value)} />
            <Input label="New password" type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Leave blank to keep current" />
          </div>
          <div className="grid-2">
            <Input label="Portal email" type="email" value={form.portal_email} onChange={e => set('portal_email', e.target.value)} />
            <Input label="Account number" value={form.account_number} onChange={e => set('account_number', e.target.value)} />
          </div>
          <Textarea label="Notes" value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} />
          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={mutation.isPending}>Save credentials</Button>
          </div>
        </form>
      ) : (
        <div className="creds-view">
          <div className="creds-warning">
            <span aria-hidden="true">⚠</span>
            These credentials are confidential. Do not share outside authorised personnel.
          </div>
          <div className="creds-grid">
            <CredField label="Portal URL" value={credentials.portal_url}
              isLink visible={credVisible} />
            <CredField label="Username" value={credentials.username} visible={credVisible} />
            <CredField label="Password" value="••••••••" visible={false} masked />
            <CredField label="Portal email" value={credentials.portal_email} visible={credVisible} />
            <CredField label="Account number" value={credentials.account_number} visible={credVisible} />
            {credentials.notes && (
              <div className="cred-item cred-item--full">
                <span className="meta-label">Notes</span>
                <p>{credentials.notes}</p>
              </div>
            )}
          </div>
          <div className="creds-actions">
            <Button variant="ghost" size="sm" onClick={() => setCredVisible(v => !v)}>
              {credVisible ? 'Hide details' : 'Show details'}
            </Button>
            {hasRole('ops_manager') && (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                Edit credentials
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function CredField({ label, value, isLink, visible, masked }) {
  const display = masked ? '••••••••' : (visible ? value : '••••••');
  return (
    <div className="cred-item">
      <span className="meta-label">{label}</span>
      {isLink && value && visible
        ? <a href={value} target="_blank" rel="noreferrer" className="supplier-link">{value} ↗</a>
        : <span className={masked || !visible ? 'cred-masked' : ''}>{display || '—'}</span>
      }
    </div>
  );
}

/* ============================================================
   Router + backend additions
   ============================================================ */
export default function SuppliersPage() {
  return (
    <Routes>
      <Route index    element={<SupplierList />} />
      <Route path=":id" element={<SupplierDetail />} />
    </Routes>
  );
}
