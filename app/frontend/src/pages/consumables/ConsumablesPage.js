import React, { useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader, Card, CardHeader, Button, Input, Textarea,
  Badge, Table, Th, Td, EmptyState, LoadingState,
  Modal, StatCard, ProgressBar
} from '../../components/ui/UI';
import { formatDate, formatCurrency } from '../../utils/format';
import toast from 'react-hot-toast';
import './ConsumablesPage.css';

const CATEGORIES = ['reagent','antibody','buffer','antigen','conjugate','nanoparticle','membrane','packaging','equipment','general'];
const UNITS = ['each','box','case','pack','liter','milliliter','gram','kilogram','meter','roll','pair','set'];

function CategoryBadge({ category }) {
  const map = {
    reagent: 'accent', antibody: 'info', buffer: 'muted',
    antigen: 'warning', conjugate: 'success', nanoparticle: 'info',
    membrane: 'muted', packaging: 'muted', equipment: 'muted', general: 'muted',
  };
  return <Badge variant={map[category] || 'muted'}>{category}</Badge>;
}

function StockStatus({ current, threshold }) {
  if (current <= 0)         return <Badge variant="danger">Out of stock</Badge>;
  if (current <= threshold) return <Badge variant="warning">Low stock</Badge>;
  return <Badge variant="success">OK</Badge>;
}

/* ============================================================
   Consumables List
   ============================================================ */
function ConsumablesList() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch]           = useState('');
  const [catFilter, setCatFilter]     = useState('');
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [showCreate, setShowCreate]   = useState(false);

  const { data: consumables, isLoading } = useQuery({
    queryKey: ['consumables'],
    queryFn: () => api.get('/consumables').then(r => r.data),
  });

  const { data: restockFlags } = useQuery({
    queryKey: ['restock-flags'],
    queryFn: () => api.get('/consumables/restock-flags').then(r => r.data),
  });

  const filtered = (consumables || []).filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !search ||
      c.name?.toLowerCase().includes(q) ||
      c.sku?.toLowerCase().includes(q) ||
      c.preferred_supplier?.toLowerCase().includes(q);
    const matchCat  = !catFilter || c.category === catFilter;
    const matchLow  = !showLowOnly || c.current_stock <= c.reorder_threshold;
    return matchSearch && matchCat && matchLow;
  });

  const stats = {
    total:    consumables?.length ?? 0,
    low:      restockFlags?.length ?? 0,
    shared:   consumables?.filter(c => c.is_shared).length ?? 0,
    outOf:    consumables?.filter(c => c.current_stock <= 0).length ?? 0,
  };

  return (
    <div>
      <PageHeader
        title="Consumables"
        subtitle="Inventory, stock levels, and reorder tracking"
        action={
          <Button variant="primary" onClick={() => setShowCreate(true)}>+ Add item</Button>
        }
      />

      <div className="stats-row">
        <StatCard label="Total items"  value={stats.total} />
        <StatCard label="Low stock"    value={stats.low}   warning={stats.low > 0} sub="need reorder" />
        <StatCard label="Out of stock" value={stats.outOf} danger={stats.outOf > 0} />
        <StatCard label="Shared items" value={stats.shared} accent />
      </div>

      {/* Restock alert banner */}
      {restockFlags?.length > 0 && (
        <div className="restock-banner">
          <span className="restock-banner-icon" aria-hidden="true">⚠</span>
          <span>
            <strong>{restockFlags.length} item{restockFlags.length > 1 ? 's' : ''}</strong> at or below reorder threshold.
            {hasRole('ops_manager') && ' Draft POs have been auto-generated in the purchase orders queue.'}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setShowLowOnly(true)}>
            Show only
          </Button>
        </div>
      )}

      {/* Filters */}
      <Card className="consumable-filters">
        <div className="filter-row">
          <input
            className="field-input filter-search"
            placeholder="Search name, SKU, supplier…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="field">
            <select className="field-input" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>
          <label className="low-stock-toggle">
            <input type="checkbox" checked={showLowOnly} onChange={e => setShowLowOnly(e.target.checked)} />
            <span>Low stock only</span>
          </label>
          {(search || catFilter || showLowOnly) && (
            <Button variant="ghost" size="sm"
              onClick={() => { setSearch(''); setCatFilter(''); setShowLowOnly(false); }}>
              Clear
            </Button>
          )}
        </div>
      </Card>

      {isLoading ? <LoadingState /> : !filtered.length ? (
        <EmptyState
          title="No consumables found"
          description={search ? `No results for "${search}".` : 'No consumables in inventory.'}
          action={<Button variant="primary" onClick={() => setShowCreate(true)}>Add item</Button>}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>SKU</Th>
              <Th>Category</Th>
              <Th>Stock</Th>
              <Th>Threshold</Th>
              <Th>Stock level</Th>
              <Th>Status</Th>
              <Th>Location</Th>
              <Th>Supplier</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id}
                onClick={() => navigate(`/consumables/${c.id}`)}
                style={{ cursor: 'pointer' }}
                className={c.current_stock <= c.reorder_threshold ? 'row-warning' : ''}
              >
                <Td>
                  <div className="consumable-name-cell">
                    <span className="consumable-name">{c.name}</span>
                    {c.is_shared && <Badge variant="muted">Shared</Badge>}
                  </div>
                </Td>
                <Td><span className="sku-code">{c.sku || '—'}</span></Td>
                <Td><CategoryBadge category={c.category} /></Td>
                <Td>
                  <span className={c.current_stock <= 0 ? 'stock-zero' : c.current_stock <= c.reorder_threshold ? 'stock-low' : 'stock-ok'}>
                    {c.current_stock} {c.unit}
                  </span>
                </Td>
                <Td>{c.reorder_threshold} {c.unit}</Td>
                <Td style={{ minWidth: '100px' }}>
                  <ProgressBar
                    value={c.current_stock}
                    max={Math.max(c.reorder_threshold * 3, c.current_stock, 1)}
                    warning={c.reorder_threshold * 2}
                    danger={c.reorder_threshold}
                  />
                </Td>
                <Td><StockStatus current={c.current_stock} threshold={c.reorder_threshold} /></Td>
                <Td>{c.location || '—'}</Td>
                <Td>{c.preferred_supplier || '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <CreateConsumableModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => { setShowCreate(false); qc.invalidateQueries(['consumables']); }}
      />
    </div>
  );
}

/* ============================================================
   Consumable Detail
   ============================================================ */
function ConsumableDetail() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const id = window.location.pathname.split('/').pop();

  const [showEdit, setShowEdit]           = useState(false);
  const [showAdjust, setShowAdjust]       = useState(false);
  const [activeTab, setActiveTab]         = useState('details');

  const reorderMutation = useMutation({
    mutationFn: () => api.post(`/consumables/${id}/reorder`),
    onSuccess: (data) => {
      toast.success(`Reorder PO created — PO ID #${data.data.po_id}. Pending ops manager approval.`);
      qc.invalidateQueries(['consumable', id]);
      qc.invalidateQueries(['purchase-orders']);
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to create reorder PO.'),
  });

  const { data: consumable, isLoading } = useQuery({
    queryKey: ['consumable', id],
    queryFn: () => api.get(`/consumables/${id}`).then(r => r.data),
  });

  const { data: transactions } = useQuery({
    queryKey: ['consumable-transactions', id],
    queryFn: () => api.get(`/consumables/${id}/transactions`).then(r => r.data),
  });

  if (isLoading) return <LoadingState />;
  if (!consumable) return (
    <EmptyState title="Item not found"
      action={<Button onClick={() => navigate('/consumables')}>Back</Button>} />
  );

  const stockPct = consumable.reorder_threshold > 0
    ? Math.min((consumable.current_stock / (consumable.reorder_threshold * 3)) * 100, 100)
    : 100;

  return (
    <div>
      <PageHeader
        title={consumable.name}
        subtitle={`${consumable.category} · ${consumable.sku || 'No SKU'}`}
        action={
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <Button variant="secondary" onClick={() => navigate('/consumables')}>← Back</Button>
            {hasRole('ops_manager') && (
              <Button variant="secondary" onClick={() => setShowAdjust(true)}>Adjust stock</Button>
            )}
            <Button variant="secondary" onClick={() => setShowEdit(true)}>Edit</Button>
          </div>
        }
      />

      <div className="consumable-detail-grid">
        {/* Stock card */}
        <Card className="stock-card">
          <CardHeader title="Current stock" />
          <div className="stock-display">
            <span className={`stock-number ${consumable.current_stock <= consumable.reorder_threshold ? 'stock-number--low' : ''}`}>
              {consumable.current_stock}
            </span>
            <span className="stock-unit">{consumable.unit}</span>
          </div>
          <div className="stock-bar-section">
            <ProgressBar
              value={consumable.current_stock}
              max={Math.max(consumable.reorder_threshold * 3, consumable.current_stock, 1)}
              warning={consumable.reorder_threshold * 2}
              danger={consumable.reorder_threshold}
            />
            <div className="stock-bar-labels">
              <span>0</span>
              <span>Reorder at {consumable.reorder_threshold} {consumable.unit}</span>
            </div>
          </div>
          <div className="stock-status-row">
            <StockStatus current={consumable.current_stock} threshold={consumable.reorder_threshold} />
            {consumable.auto_reorder && (
              <Badge variant="accent">Auto-reorder on</Badge>
            )}
          </div>
          {consumable.last_restocked && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
              Last restocked {formatDate(consumable.last_restocked)}
            </p>
          )}
        </Card>

        {/* Info card */}
        <Card>
          <CardHeader title="Item details" />
          <div className="detail-meta-grid">
            <div className="meta-item">
              <span className="meta-label">Category</span>
              <CategoryBadge category={consumable.category} />
            </div>
            <div className="meta-item">
              <span className="meta-label">Unit</span>
              <span>{consumable.unit}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">SKU</span>
              <span className="sku-code">{consumable.sku || '—'}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Unit cost</span>
              <span>{consumable.unit_cost ? formatCurrency(consumable.unit_cost) : '—'}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Reorder qty</span>
              <span>{consumable.reorder_quantity ? `${consumable.reorder_quantity} ${consumable.unit}` : '—'}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Shared</span>
              <Badge variant={consumable.is_shared ? 'accent' : 'muted'}>
                {consumable.is_shared ? 'Shared across projects' : 'Project-specific'}
              </Badge>
            </div>
            {consumable.project_code && (
              <div className="meta-item">
                <span className="meta-label">Project</span>
                <Badge variant="muted">{consumable.project_code}</Badge>
              </div>
            )}
            <div className="meta-item">
              <span className="meta-label">Location</span>
              <span>{consumable.location || '—'}</span>
            </div>
            <div className="meta-item meta-item--full">
              <span className="meta-label">Preferred supplier</span>
              <span>{consumable.preferred_supplier || '—'}</span>
            </div>
            {consumable.description && (
              <div className="meta-item meta-item--full">
                <span className="meta-label">Description</span>
                <p style={{ margin: 0 }}>{consumable.description}</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Transaction history */}
      <Card style={{ marginTop: '1.25rem' }}>
        <CardHeader title="Transaction history" subtitle="All stock changes — usage, restocks, and adjustments" />
        {!transactions?.length ? (
          <EmptyState title="No transactions yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>Change</Th>
                <Th>Project</Th>
                <Th>User</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id}>
                  <Td>{formatDate(t.transaction_date)}</Td>
                  <Td>
                    <Badge variant={
                      t.transaction_type === 'restock'    ? 'success' :
                      t.transaction_type === 'usage'      ? 'warning' : 'muted'
                    }>{t.transaction_type}</Badge>
                  </Td>
                  <Td>
                    <span className={t.quantity_change > 0 ? 'change-positive' : 'change-negative'}>
                      {t.quantity_change > 0 ? '+' : ''}{t.quantity_change} {consumable.unit}
                    </span>
                  </Td>
                  <Td>{t.project_code || '—'}</Td>
                  <Td>{t.full_name}</Td>
                  <Td>{t.notes || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Modals */}
      <EditConsumableModal
        open={showEdit}
        consumable={consumable}
        onClose={() => setShowEdit(false)}
        onSuccess={() => { setShowEdit(false); qc.invalidateQueries(['consumable', id]); qc.invalidateQueries(['consumables']); }}
      />
      {hasRole('ops_manager') && (
        <StockAdjustModal
          open={showAdjust}
          consumable={consumable}
          onClose={() => setShowAdjust(false)}
          onSuccess={() => { setShowAdjust(false); qc.invalidateQueries(['consumable', id]); qc.invalidateQueries(['consumables']); qc.invalidateQueries(['restock-flags']); }}
        />
      )}
    </div>
  );
}

/* ============================================================
   Create Consumable Modal
   ============================================================ */

/* ============================================================
   Inline Add Consumable — used in Consumables tab + daily log
   ============================================================ */
export function CreateConsumableInline({ onSuccess, compact = false }) {
  const [form, setForm] = useState({
    name: '', category: 'reagent', sku: '', unit: 'each',
    current_stock: '', reorder_threshold: '', reorder_quantity: '',
    unit_cost: '', location: '', description: '',
    is_shared: false, project_id: '', preferred_supplier_id: '',
    auto_reorder: true,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const { data: projects } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects?active=true').then(r => r.data),
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers?active=true').then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: data => api.post('/consumables', data),
    onSuccess: () => {
      toast.success('Consumable added to inventory.');
      setForm({
        name:'', category:'reagent', sku:'', unit:'each',
        current_stock:'', reorder_threshold:'', reorder_quantity:'',
        unit_cost:'', location:'', description:'',
        is_shared:false, project_id:'', preferred_supplier_id:'',
        auto_reorder:true,
      });
      onSuccess?.();
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to add consumable.'),
  });

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.name)          { toast.error('Name is required.'); return; }
    if (!form.current_stock) { toast.error('Enter current stock level.'); return; }
    mutation.mutate({
      ...form,
      current_stock:         parseFloat(form.current_stock),
      reorder_threshold:     parseFloat(form.reorder_threshold) || 0,
      reorder_quantity:      form.reorder_quantity ? parseFloat(form.reorder_quantity) : null,
      unit_cost:             form.unit_cost ? parseFloat(form.unit_cost) : null,
      project_id:            form.project_id ? parseInt(form.project_id) : null,
      preferred_supplier_id: form.preferred_supplier_id ? parseInt(form.preferred_supplier_id) : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="consumable-inline-form">
      <div className="grid-2">
        <Input label="Name *" value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="e.g. Anti-Cortisol Ab" autoFocus />
        <Input label="SKU / catalog ID" value={form.sku}
          onChange={e => set('sku', e.target.value)}
          placeholder="e.g. AC-CAP-001" />
      </div>

      <div className={compact ? 'grid-2' : 'grid-3'}>
        <div className="field">
          <label className="field-label">Category</label>
          <select className="field-input" value={form.category}
            onChange={e => set('category', e.target.value)}>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label">Unit</label>
          <select className="field-input" value={form.unit}
            onChange={e => set('unit', e.target.value)}>
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        {!compact && (
          <Input label="Storage location" value={form.location}
            onChange={e => set('location', e.target.value)}
            placeholder="e.g. Freezer -20C, Shelf A1" />
        )}
      </div>

      <div className="grid-3">
        <Input label="Current stock *" type="number" min="0" step="any"
          value={form.current_stock}
          onChange={e => set('current_stock', e.target.value)} />
        <Input label="Reorder threshold" type="number" min="0" step="any"
          value={form.reorder_threshold}
          onChange={e => set('reorder_threshold', e.target.value)}
          hint="Flag when stock hits this" />
        <Input label="Unit cost ($)" type="number" min="0" step="0.01"
          value={form.unit_cost}
          onChange={e => set('unit_cost', e.target.value)} />
      </div>

      {compact && (
        <Input label="Storage location" value={form.location}
          onChange={e => set('location', e.target.value)}
          placeholder="e.g. Freezer -20C, Shelf A1" />
      )}

      <div className="grid-2">
        <div className="field">
          <label className="field-label">Project (leave blank if shared)</label>
          <select className="field-input" value={form.project_id}
            onChange={e => set('project_id', e.target.value)}>
            <option value="">Shared across all projects</option>
            {projects?.map(p => (
              <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label">Preferred supplier</label>
          <select className="field-input" value={form.preferred_supplier_id}
            onChange={e => set('preferred_supplier_id', e.target.value)}>
            <option value="">None</option>
            {suppliers?.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {!compact && (
        <Textarea label="Description" value={form.description}
          onChange={e => set('description', e.target.value)} rows={2} />
      )}

      <div className="checkbox-row">
        <label className="checkbox-label">
          <input type="checkbox" checked={form.is_shared}
            onChange={e => set('is_shared', e.target.checked)} />
          <span>Shared — appears in all project daily log dropdowns</span>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={form.auto_reorder}
            onChange={e => set('auto_reorder', e.target.checked)} />
          <span>Auto-generate reorder PO at threshold</span>
        </label>
      </div>

      <div style={{ paddingTop:'0.75rem' }}>
        <Button type="submit" variant="primary" loading={mutation.isPending}>
          Add to inventory
        </Button>
      </div>
    </form>
  );
}

function CreateConsumableModal({ open, onClose, onSuccess }) {
  const [form, setForm] = useState({
    name: '', category: 'reagent', sku: '', unit: 'each',
    current_stock: '', reorder_threshold: '', reorder_quantity: '',
    unit_cost: '', location: '', description: '',
    is_shared: false, project_id: '', preferred_supplier_id: '',
    auto_reorder: true,
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

  const mutation = useMutation({
    mutationFn: data => api.post('/consumables', data),
    onSuccess: () => { toast.success('Consumable added.'); onSuccess(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to add consumable.'),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.name) { toast.error('Name is required.'); return; }
    if (!form.current_stock) { toast.error('Enter current stock.'); return; }
    mutation.mutate({
      ...form,
      current_stock:        parseFloat(form.current_stock),
      reorder_threshold:    parseFloat(form.reorder_threshold) || 0,
      reorder_quantity:     form.reorder_quantity ? parseFloat(form.reorder_quantity) : null,
      unit_cost:            form.unit_cost ? parseFloat(form.unit_cost) : null,
      project_id:           form.project_id ? parseInt(form.project_id) : null,
      preferred_supplier_id:form.preferred_supplier_id ? parseInt(form.preferred_supplier_id) : null,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Add consumable" size="lg">
      <form onSubmit={handleSubmit} className="consumable-form">
        <div className="grid-2">
          <Input label="Name *" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Anti-Cortisol Ab" />
          <Input label="SKU / catalog ID" value={form.sku} onChange={e => set('sku', e.target.value)} placeholder="e.g. AC-CAP-001" />
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="field-label">Category</label>
            <select className="field-input" value={form.category} onChange={e => set('category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Unit</label>
            <select className="field-input" value={form.unit} onChange={e => set('unit', e.target.value)}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div className="grid-3">
          <Input label="Current stock *" type="number" min="0" step="any"
            value={form.current_stock} onChange={e => set('current_stock', e.target.value)} />
          <Input label="Reorder threshold" type="number" min="0" step="any"
            value={form.reorder_threshold} onChange={e => set('reorder_threshold', e.target.value)}
            hint="Flag when stock reaches this" />
          <Input label="Reorder quantity" type="number" min="0" step="any"
            value={form.reorder_quantity} onChange={e => set('reorder_quantity', e.target.value)}
            hint="Suggested qty to reorder" />
        </div>
        <div className="grid-2">
          <Input label="Unit cost ($)" type="number" min="0" step="0.01"
            value={form.unit_cost} onChange={e => set('unit_cost', e.target.value)} />
          <Input label="Storage location" value={form.location}
            onChange={e => set('location', e.target.value)} placeholder="e.g. Freezer -20C Box 1" />
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="field-label">Preferred supplier</label>
            <select className="field-input" value={form.preferred_supplier_id}
              onChange={e => set('preferred_supplier_id', e.target.value)}>
              <option value="">None</option>
              {suppliers?.map(s => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Project (leave blank if shared)</label>
            <select className="field-input" value={form.project_id}
              onChange={e => set('project_id', e.target.value)}>
              <option value="">Shared across all projects</option>
              {projects?.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>
        </div>
        <Textarea label="Description" value={form.description}
          onChange={e => set('description', e.target.value)} rows={2} />
        <div className="checkbox-row">
          <label className="checkbox-label">
            <input type="checkbox" checked={form.is_shared} onChange={e => set('is_shared', e.target.checked)} />
            <span>Shared across projects (appears in all daily log dropdowns)</span>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={form.auto_reorder} onChange={e => set('auto_reorder', e.target.checked)} />
            <span>Auto-generate reorder PO when stock hits threshold</span>
          </label>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>Add consumable</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ============================================================
   Edit Consumable Modal
   ============================================================ */
function EditConsumableModal({ open, consumable, onClose, onSuccess }) {
  const [form, setForm]           = useState({ ...consumable });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/consumables/${consumable.id}`),
    onSuccess: () => {
      toast.success(`${consumable.name} removed from inventory.`);
      onSuccess();
    },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to delete.'),
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers?active=true').then(r => r.data),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: data => api.patch(`/consumables/${consumable.id}`, data),
    onSuccess: () => { toast.success('Item updated.'); onSuccess(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to update.'),
  });

  return (
    <Modal open={open} onClose={onClose} title={`Edit — ${consumable.name}`} size="lg">
      <form onSubmit={e => { e.preventDefault(); mutation.mutate(form); }} className="consumable-form">
        <div className="grid-2">
          <Input label="Name" value={form.name || ''} onChange={e => set('name', e.target.value)} />
          <Input label="SKU" value={form.sku || ''} onChange={e => set('sku', e.target.value)} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="field-label">Category</label>
            <select className="field-input" value={form.category || 'reagent'} onChange={e => set('category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Unit</label>
            <select className="field-input" value={form.unit || 'each'} onChange={e => set('unit', e.target.value)}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <Input label="Reorder threshold" type="number" min="0" step="any"
            value={form.reorder_threshold || ''} onChange={e => set('reorder_threshold', e.target.value)} />
          <Input label="Reorder quantity" type="number" min="0" step="any"
            value={form.reorder_quantity || ''} onChange={e => set('reorder_quantity', e.target.value)} />
        </div>
        <div className="grid-2">
          <Input label="Unit cost ($)" type="number" min="0" step="0.01"
            value={form.unit_cost || ''} onChange={e => set('unit_cost', e.target.value)} />
          <Input label="Storage location" value={form.location || ''}
            onChange={e => set('location', e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label">Preferred supplier</label>
          <select className="field-input" value={form.preferred_supplier_id || ''}
            onChange={e => set('preferred_supplier_id', e.target.value)}>
            <option value="">None</option>
            {suppliers?.map(s => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>)}
          </select>
        </div>
        <Textarea label="Description" value={form.description || ''}
          onChange={e => set('description', e.target.value)} rows={2} />
        <div className="checkbox-row">
          <label className="checkbox-label">
            <input type="checkbox" checked={!!form.is_shared} onChange={e => set('is_shared', e.target.checked)} />
            <span>Shared across projects</span>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={!!form.auto_reorder} onChange={e => set('auto_reorder', e.target.checked)} />
            <span>Auto-generate reorder PO when stock hits threshold</span>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={!!form.is_active} onChange={e => set('is_active', e.target.checked)} />
            <span>Active</span>
          </label>
        </div>
        {confirmDelete ? (
          <div style={{ background:'var(--danger-bg)', border:'1px solid var(--danger)', borderRadius:'var(--radius-md)', padding:'0.875rem', marginTop:'0.5rem' }}>
            <p style={{ fontSize:'0.875rem', color:'var(--text-primary)', marginBottom:'0.75rem' }}>
              Remove <strong>{consumable.name}</strong> from inventory? Transaction history is preserved.
            </p>
            <div style={{ display:'flex', gap:'0.5rem' }}>
              <Button variant="danger" size="sm" loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}>
                Yes, remove it
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="modal-footer">
            <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={mutation.isPending}>Save changes</Button>
          </div>
        )}
      </form>
    </Modal>
  );
}

/* ============================================================
   Stock Adjustment Modal
   ============================================================ */
function StockAdjustModal({ open, consumable, onClose, onSuccess }) {
  const [type, setType]       = useState('restock');
  const [quantity, setQty]    = useState('');
  const [notes, setNotes]     = useState('');

  const { data: projects } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects?active=true').then(r => r.data),
    enabled: open,
  });
  const [projectId, setProjectId] = useState('');

  const mutation = useMutation({
    mutationFn: data => api.post(`/consumables/${consumable.id}/adjust`, data),
    onSuccess: () => { toast.success('Stock updated.'); onSuccess(); },
    onError: err => toast.error(err.response?.data?.detail || 'Failed to adjust stock.'),
  });

  const newStock = type === 'restock'
    ? consumable.current_stock + (parseFloat(quantity) || 0)
    : consumable.current_stock - (parseFloat(quantity) || 0);

  const handleSubmit = e => {
    e.preventDefault();
    if (!quantity || parseFloat(quantity) <= 0) { toast.error('Enter a quantity.'); return; }
    mutation.mutate({
      transaction_type: type,
      quantity:         parseFloat(quantity),
      project_id:       projectId ? parseInt(projectId) : null,
      notes,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={`Adjust stock — ${consumable.name}`} size="sm">
      <form onSubmit={handleSubmit} className="consumable-form">
        <div className="stock-current-row">
          <span className="meta-label">Current stock</span>
          <span className="stock-current-val">{consumable.current_stock} {consumable.unit}</span>
        </div>

        <div className="field">
          <label className="field-label">Adjustment type</label>
          <div className="type-toggle">
            {[
              { id: 'restock',    label: 'Restock (add)' },
              { id: 'usage',      label: 'Usage (remove)' },
              { id: 'adjustment', label: 'Manual adjustment' },
            ].map(t => (
              <button key={t.id} type="button"
                className={`type-pill ${type === t.id ? 'type-pill--active' : ''}`}
                onClick={() => setType(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <Input
          label={`Quantity to ${type === 'restock' ? 'add' : type === 'usage' ? 'remove' : 'adjust'}`}
          type="number" min="0.001" step="any"
          value={quantity}
          onChange={e => setQty(e.target.value)}
          hint={quantity ? `New stock: ${newStock.toFixed(2)} ${consumable.unit}` : undefined}
        />

        {type === 'usage' && (
          <div className="field">
            <label className="field-label">Project</label>
            <select className="field-input" value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">No specific project</option>
              {projects?.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>
        )}

        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Reason for adjustment…" />

        {newStock < 0 && (
          <div className="adjust-warning">Stock cannot go below zero. Reduce the quantity.</div>
        )}

        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}
            disabled={newStock < 0}>
            Confirm adjustment
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ConsumablesPage() {
  return (
    <Routes>
      <Route index    element={<ConsumablesList />} />
      <Route path=":id" element={<ConsumableDetail />} />
    </Routes>
  );
}
