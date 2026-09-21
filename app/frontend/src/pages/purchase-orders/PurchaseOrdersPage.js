import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, Button, Card, CardHeader, Table, Th, Td,
  POStatusBadge, RiskBadge, PriorityBadge,
  Badge, Modal, Input, Textarea, EmptyState,
  LoadingState, StatCard
} from '../../components/ui/UI';
import { formatDate, formatCurrency } from '../../utils/format';
import toast from 'react-hot-toast';
import './PurchaseOrdersPage.css';

const STATUSES = ['pending','rejected','new_order','emailed','in_progress','stuck','received','invoiced','closed'];

/* ---- List view ---- */
function POList() {
  const { hasRole } = useAuth();
  const navigate    = useNavigate();
  const qc          = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch]             = useState('');
  const [showCreate, setShowCreate]     = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: () => api.get('/purchase-orders', {
      params: { status: statusFilter || undefined, limit: 100 }
    }).then(r => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['po-stats'],
    queryFn: () => api.get('/purchase-orders/stats').then(r => r.data),
  });

  const filtered = (data?.items || []).filter(po => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      po.po_number?.toLowerCase().includes(q) ||
      po.supplier_name?.toLowerCase().includes(q) ||
      po.project_code?.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        subtitle="Track requests, approvals, and payments"
        action={
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            + New request
          </Button>
        }
      />

      {/* Stats */}
      <div className="stats-row">
        <StatCard label="Pending approval" value={stats?.pending ?? '—'} warning={stats?.pending > 0} />
        <StatCard label="In progress"      value={stats?.in_progress ?? '—'} />
        <StatCard label="Stuck"            value={stats?.stuck ?? '—'} danger={stats?.stuck > 0} />
        <StatCard label="Awaiting payment" value={stats?.invoiced ?? '—'} warning={stats?.invoiced > 0} />
      </div>

      {/* Filters */}
      <Card className="po-filters">
        <div className="filter-row">
          <input
            className="field-input filter-search"
            placeholder="Search PO #, supplier, project…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="status-filters">
            <button
              className={`status-pill ${!statusFilter ? 'status-pill--active' : ''}`}
              onClick={() => setStatusFilter('')}
            >All</button>
            {STATUSES.map(s => (
              <button
                key={s}
                className={`status-pill ${statusFilter === s ? 'status-pill--active' : ''}`}
                onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              >
                {s.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Table */}
      {isLoading ? <LoadingState /> : !filtered.length ? (
        <EmptyState
          title="No purchase orders"
          description="Submit a new request to get started."
          action={<Button variant="primary" onClick={() => setShowCreate(true)}>New request</Button>}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>PO #</Th>
              <Th>Supplier</Th>
              <Th>Project</Th>
              <Th>Status</Th>
              <Th>Priority</Th>
              <Th>Risk</Th>
              <Th>Est. total</Th>
              <Th>Date</Th>
              <Th>Requested by</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(po => (
              <tr key={po.id} onClick={() => navigate(`/purchase-orders/${po.id}`)}>
                <Td><span className="po-num">{po.po_number || `REQ-${po.id}`}</span></Td>
                <Td>{po.supplier_name || po.supplier_name_free || '—'}</Td>
                <Td><Badge variant="muted">{po.project_code}</Badge></Td>
                <Td><POStatusBadge status={po.status} /></Td>
                <Td><PriorityBadge priority={po.priority} /></Td>
                <Td>{po.risk_level ? <RiskBadge level={po.risk_level} /> : '—'}</Td>
                <Td>{formatCurrency(po.estimated_total)}</Td>
                <Td>{formatDate(po.created_at)}</Td>
                <Td>{po.requested_by}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <CreatePOModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => { setShowCreate(false); qc.invalidateQueries(['purchase-orders']); }}
      />
    </div>
  );
}

/* ---- Create PO modal ---- */
function CreatePOModal({ open, onClose, onSuccess }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    project_id: '', is_overhead: false, supplier_id: '', supplier_name_free: '',
    priority: 'normal', risk_level: '', urgency: 'normal', notes: '',
    items: [{ description: '', product_id: '', product_url: '', quantity_ordered: 1, unit: 'each', unit_cost_estimate: '', consumable_id: '' }],
  });

  const { data: projects } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects?active=true').then(r => r.data),
    enabled: open,
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers?active=true').then(r => r.data),
    enabled: open,
  });

  const { data: consumables } = useQuery({
    queryKey: ['consumables-dropdown'],
    queryFn: () => api.get('/consumables/dropdown').then(r => r.data),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: data => api.post('/purchase-orders', data),
    onSuccess: () => { toast.success('Purchase request submitted.'); onSuccess(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to submit request.'),
  });

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const setItem = (i, k, v) => setForm(f => ({
    ...f,
    items: f.items.map((item, idx) => idx === i ? { ...item, [k]: v } : item),
  }));

  const addItem = () => setForm(f => ({
    ...f,
    items: [...f.items, { description: '', product_id: '', product_url: '', quantity_ordered: 1, unit: 'each', unit_cost_estimate: '', consumable_id: '' }],
  }));

  const removeItem = i => setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const estimatedTotal = form.items.reduce((sum, it) => {
    return sum + (parseFloat(it.quantity_ordered) || 0) * (parseFloat(it.unit_cost_estimate) || 0);
  }, 0);

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.is_overhead && !form.project_id) { toast.error('Select a project or choose Overhead.'); return; }
    if (!form.supplier_id && !form.supplier_name_free) { toast.error('Select or enter a supplier.'); return; }
    if (!form.items[0].description) { toast.error('Add at least one item.'); return; }
    mutation.mutate({
      project_id:         form.is_overhead ? null : (form.project_id ? parseInt(form.project_id) : null),
      supplier_id:        form.supplier_id ? parseInt(form.supplier_id) : null,
      supplier_name_free: form.supplier_name_free || null,
      is_overhead:        form.is_overhead,
      priority:           form.priority || 'normal',
      urgency:            form.urgency  || 'normal',
      notes:              form.notes    || null,
      expected_delivery:  form.expected_delivery || null,
      items: form.items.map(it => ({
        description:        it.description,
        product_id:         it.product_id        || null,
        product_url:        it.product_url        || null,
        quantity_ordered:   parseFloat(it.quantity_ordered) || 1,
        unit:               it.unit              || 'each',
        unit_cost_estimate: it.unit_cost_estimate ? parseFloat(it.unit_cost_estimate) : null,
        consumable_id:      it.consumable_id ? parseInt(it.consumable_id) : null,
        notes:              it.notes             || null,
      })),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="New purchase request" size="lg">
      <form onSubmit={handleSubmit} className="create-po-form">
        <div className="grid-2">
          <div className="field">
            <label className="field-label">Project *</label>
            <select className="field-input"
              value={form.is_overhead ? '__overhead__' : (form.project_id || '')}
              onChange={e => {
                if (e.target.value === '__overhead__') {
                  setField('is_overhead', true); setField('project_id', '');
                } else {
                  setField('is_overhead', false); setField('project_id', e.target.value);
                }
              }}>
              <option value="">Select project…</option>
              <option value="__overhead__">⬡ Overhead / Non-project expense</option>
              {projects?.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Supplier</label>
            <select className="field-input" value={form.supplier_id} onChange={e => setField('supplier_id', e.target.value)}>
              <option value="">Select supplier…</option>
              {suppliers?.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </select>
          </div>
        </div>

        <Input
          label="Or enter supplier name (if not in list)"
          value={form.supplier_name_free}
          onChange={e => setField('supplier_name_free', e.target.value)}
          placeholder="One-off supplier name"
        />

        <div className="grid-2">
          <div className="field">
            <label className="field-label">Priority</label>
            <select className="field-input" value={form.priority} onChange={e => setField('priority', e.target.value)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Risk level</label>
            <select className="field-input" value={form.risk_level} onChange={e => setField('risk_level', e.target.value)}>
              <option value="">Not set</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        {/* Line items */}
        <div className="line-items-section">
          <div className="line-items-header">
            <h4>Items</h4>
            {estimatedTotal > 0 && (
              <span className="line-items-total">Est. total: {formatCurrency(estimatedTotal)}</span>
            )}
          </div>

          {form.items.map((item, i) => (
            <div key={i} className="line-item-row">
              <div className="line-item-main">
                <Input
                  label={i === 0 ? 'Description *' : undefined}
                  value={item.description}
                  onChange={e => setItem(i, 'description', e.target.value)}
                  placeholder="Item description"
                />
                <Input
                  label={i === 0 ? 'Product ID' : undefined}
                  value={item.product_id}
                  onChange={e => setItem(i, 'product_id', e.target.value)}
                  placeholder="e.g. EM.GC40"
                />
                <Input
                  label={i === 0 ? 'Product URL' : undefined}
                  value={item.product_url}
                  onChange={e => setItem(i, 'product_url', e.target.value)}
                  placeholder="https://…"
                />
                <div className="field">
                  {i === 0 && <label className="field-label">Restocks inventory item</label>}
                  <select className="field-input" value={item.consumable_id}
                    onChange={e => setItem(i, 'consumable_id', e.target.value)}>
                    <option value="">Not tracked as inventory</option>
                    {consumables?.map(c => (
                      <option key={c.id} value={c.id}>{c.name}{c.sku ? ` (${c.sku})` : ''} — {c.current_stock} {c.unit}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="line-item-nums">
                <Input
                  label={i === 0 ? 'Qty' : undefined}
                  type="number" min="0.001" step="any"
                  value={item.quantity_ordered}
                  onChange={e => setItem(i, 'quantity_ordered', e.target.value)}
                  style={{ width: '80px' }}
                />
                <div className="field">
                  {i === 0 && <label className="field-label">Unit</label>}
                  <select className="field-input" style={{ width: '90px' }} value={item.unit} onChange={e => setItem(i, 'unit', e.target.value)}>
                    {['each','box','case','pack','liter','milliliter','gram','kilogram','roll','pair','set'].map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <Input
                  label={i === 0 ? 'Unit cost ($)' : undefined}
                  type="number" min="0" step="0.01"
                  value={item.unit_cost_estimate}
                  onChange={e => setItem(i, 'unit_cost_estimate', e.target.value)}
                  placeholder="0.00"
                  style={{ width: '100px' }}
                />
                {form.items.length > 1 && (
                  <button type="button" className="remove-item-btn" onClick={() => removeItem(i)} title="Remove item">×</button>
                )}
              </div>
            </div>
          ))}

          <Button type="button" variant="ghost" size="sm" onClick={addItem}>
            + Add item
          </Button>
        </div>

        <Textarea
          label="Notes"
          value={form.notes}
          onChange={e => setField('notes', e.target.value)}
          placeholder="Reason for purchase, special instructions…"
          rows={3}
        />

        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Submit request
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- Detail view ---- */
function PODetail() {
  const { id } = { id: window.location.pathname.split('/').pop() };
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => api.get(`/purchase-orders/${id}`).then(r => r.data),
  });

  const approveMutation = useMutation({
    mutationFn: () => api.post(`/purchase-orders/${id}/approve`),
    onSuccess: () => { toast.success('Purchase order approved.'); qc.invalidateQueries(['purchase-order', id]); },
    onError: () => toast.error('Failed to approve.'),
  });

  const rejectMutation = useMutation({
    mutationFn: reason => api.post(`/purchase-orders/${id}/reject`, { reason }),
    onSuccess: () => { toast.success('Request rejected.'); qc.invalidateQueries(['purchase-order', id]); },
  });

  const [showReceive, setShowReceive] = useState(false);

  if (isLoading) return <LoadingState />;
  if (!po) return <EmptyState title="PO not found" action={<Button onClick={() => navigate('/purchase-orders')}>Back</Button>} />;

  const canReceive = !['pending', 'rejected', 'closed'].includes(po.status);
  const hasRemaining = po.line_items?.some(it => (it.quantity_received || 0) < it.quantity_ordered - 0.001);

  return (
    <div>
      <PageHeader
        title={po.po_number || `Request #${po.id}`}
        subtitle={`${po.project_name} — ${po.supplier_name || po.supplier_name_free}`}
        action={
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <Button variant="secondary" onClick={() => navigate('/purchase-orders')}>← Back</Button>
            {hasRole('ops_manager', 'ceo', 'qm_director') && po.status === 'pending' && (
              <>
                <Button variant="primary" onClick={() => approveMutation.mutate()} loading={approveMutation.isPending}>
                  Approve
                </Button>
                <Button variant="danger" onClick={() => {
                  const reason = prompt('Reason for rejection:');
                  if (reason) rejectMutation.mutate(reason);
                }}>
                  Reject
                </Button>
              </>
            )}
            {hasRole('ops_manager', 'ceo', 'qm_director') && canReceive && hasRemaining && (
              <Button variant="primary" onClick={() => setShowReceive(true)}>
                Receive delivery
              </Button>
            )}
          </div>
        }
      />

      <div className="po-detail-grid">
        <Card className="po-detail-meta">
          <CardHeader title="Order details" />
          <div className="meta-grid">
            <div className="meta-item"><span className="meta-label">Status</span><POStatusBadge status={po.status} /></div>
            <div className="meta-item"><span className="meta-label">Priority</span><PriorityBadge priority={po.priority} /></div>
            <div className="meta-item"><span className="meta-label">Risk</span>{po.risk_level ? <RiskBadge level={po.risk_level} /> : '—'}</div>
            <div className="meta-item"><span className="meta-label">Requested by</span><span>{po.requested_by}</span></div>
            <div className="meta-item"><span className="meta-label">Approved by</span><span>{po.approved_by || '—'}</span></div>
            <div className="meta-item"><span className="meta-label">Receiver</span><span>{po.receiver || '—'}</span></div>
            <div className="meta-item"><span className="meta-label">Order date</span><span>{formatDate(po.placed_date)}</span></div>
            <div className="meta-item"><span className="meta-label">Expected</span><span>{formatDate(po.expected_delivery)}</span></div>
            <div className="meta-item"><span className="meta-label">Received</span><span>{formatDate(po.received_date)}</span></div>
          </div>
          {po.notes && (
            <div className="po-notes"><p>{po.notes}</p></div>
          )}
        </Card>

        <Card className="po-detail-items">
          <CardHeader title="Line items" />
          <Table>
            <thead>
              <tr>
                <Th>Description</Th>
                <Th>Product ID</Th>
                <Th>Qty</Th>
                <Th>Unit</Th>
                <Th>Unit cost</Th>
                <Th>Total</Th>
                <Th>Received</Th>
              </tr>
            </thead>
            <tbody>
              {po.line_items?.map(item => (
                <tr key={item.id}>
                  <Td>
                    <div>
                      <div>{item.description}</div>
                      {item.product_url && (
                        <a href={item.product_url} target="_blank" rel="noreferrer" className="item-link">
                          View product ↗
                        </a>
                      )}
                    </div>
                  </Td>
                  <Td><span className="text-mono">{item.product_id || '—'}</span></Td>
                  <Td>{item.quantity_ordered}</Td>
                  <Td>{item.unit}</Td>
                  <Td>{formatCurrency(item.unit_cost_estimate)}</Td>
                  <Td>{formatCurrency((item.quantity_ordered || 0) * (item.unit_cost_estimate || 0))}</Td>
                  <Td>
                    <span className={(item.quantity_received || 0) >= item.quantity_ordered - 0.001 ? 'text-success' : ''}>
                      {item.quantity_received || 0} / {item.quantity_ordered}
                    </span>
                    {item.consumable_id && <span className="item-link" style={{ display: 'block', fontSize: '0.75rem' }}>restocks inventory</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        {po.receipts?.length > 0 && (
          <Card className="po-detail-receipts">
            <CardHeader title="Receiving history" />
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Quantity</Th>
                  <Th>Received by</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {po.receipts.map(r => (
                  <tr key={r.id}>
                    <Td>{formatDate(r.received_date)}</Td>
                    <Td>{r.quantity_received}</Td>
                    <Td>{r.received_by}</Td>
                    <Td>{r.notes || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
      </div>

      <ReceiveModal
        open={showReceive}
        po={po}
        onClose={() => setShowReceive(false)}
        onSuccess={() => { setShowReceive(false); qc.invalidateQueries(['purchase-order', id]); qc.invalidateQueries(['consumables']); }}
      />
    </div>
  );
}

/* ---- Receive delivery modal ---- */
function ReceiveModal({ open, po, onClose, onSuccess }) {
  const remainingItems = (po?.line_items || []).filter(it => (it.quantity_received || 0) < it.quantity_ordered - 0.001);
  const [quantities, setQuantities] = useState({});

  useEffect(() => {
    if (open) {
      const initial = {};
      remainingItems.forEach(it => {
        initial[it.id] = (it.quantity_ordered - (it.quantity_received || 0)).toString();
      });
      setQuantities(initial);
    }
  }, [open, po?.id]);

  const mutation = useMutation({
    mutationFn: () => api.post(`/purchase-orders/${po.id}/receive`, {
      items: remainingItems
        .map(it => ({ line_item_id: it.id, quantity_received: parseFloat(quantities[it.id]) || 0 }))
        .filter(it => it.quantity_received > 0),
    }),
    onSuccess: (res) => {
      toast.success(res.data.fully_received ? 'Delivery received — PO marked received.' : 'Partial delivery recorded.');
      onSuccess();
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to record receipt.'),
  });

  const handleSubmit = e => {
    e.preventDefault();
    const anyPositive = Object.values(quantities).some(v => parseFloat(v) > 0);
    if (!anyPositive) { toast.error('Enter a quantity for at least one item.'); return; }
    mutation.mutate();
  };

  return (
    <Modal open={open} onClose={onClose} title="Receive delivery" size="md">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          Enter how much of each item actually arrived. Leave at 0 to skip an
          item this delivery — partial shipments are fine, you can receive
          the rest later.
        </p>
        {remainingItems.map(it => {
          const remaining = it.quantity_ordered - (it.quantity_received || 0);
          return (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.875rem' }}>{it.description}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {remaining} {it.unit} remaining
                  {it.consumable_id && ' · restocks inventory'}
                </div>
              </div>
              <Input
                type="number" min="0" max={remaining} step="any"
                value={quantities[it.id] ?? ''}
                onChange={e => setQuantities(q => ({ ...q, [it.id]: e.target.value }))}
                style={{ width: '100px' }}
              />
            </div>
          );
        })}
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>Record receipt</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- Router ---- */
export default function PurchaseOrdersPage() {
  return (
    <Routes>
      <Route index element={<POList />} />
      <Route path=":id" element={<PODetail />} />
    </Routes>
  );
}
