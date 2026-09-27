import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Building2, Camera, Download, FileText, KeyRound, LogOut, Pencil, Plus, QrCode, RefreshCw, Trash2, UserRound, Zap } from 'lucide-react';
import { supabase } from './lib/supabase';
import { createBillPdf, downloadBlob } from './lib/billPdf';
import { downloadQR, downloadTenantSnapshotPdf, portalUrl } from './lib/meterDocs';
import {
  DEFAULT_RATE, activeAssignment, billNumber, byNewest, calcBill, cleanPhone, fmt, kwh, money, round2, round3, today,
} from './lib/format';
import { BrandMark, Info, Modal, StatusPill, ThemeToggle } from './ui';
import { PasswordInput, friendlyAuthError, validatePassword } from './OwnerLogin';

const OPEN = ['PENDING_APPROVAL', 'APPROVED'];
const BILL_SELECT = '*,meters(meter_code,meter_number,public_token,rooms(floor,room_number),properties(name,address)),tenants(name,phone,tenant_assignments(meter_id,move_in_date,move_out_date)),bill_payments(payment_date,amount,payment_mode,receipt_no)';
const PAYMENT_MODES = ['UPI', 'Cash', 'Bank transfer', 'Cheque'];

const fallbackSettings = propertyId => ({ property_id: propertyId, rate_per_unit: DEFAULT_RATE, fixed_charge: 0, tax_percent: 0, due_days: 7 });

function lastPaymentFor(meterId, bills) {
  return bills.filter(b => b.meter_id === meterId).flatMap(b => b.bill_payments || [])
    .sort((a, b) => String(b.payment_date).localeCompare(String(a.payment_date)))[0] || null;
}

/** Move-in date of the bill's tenant on the bill's meter, as saved on the tenant page. */
function billMoveIn(bill) {
  const stays = (bill.tenants?.tenant_assignments || []).filter(a => a.meter_id === bill.meter_id)
    .sort((a, b) => String(b.move_in_date).localeCompare(String(a.move_in_date)));
  return (stays.find(a => !a.move_out_date) || stays[0])?.move_in_date || null;
}

async function paidHistory(meterId) {
  const { data, error } = await supabase.from('electricity_bills').select('*').eq('meter_id', meterId).in('status', ['APPROVED', 'PAID'])
    .order('bill_date', { ascending: false }).order('created_at', { ascending: false }).limit(6);
  if (error) throw error;
  return data || [];
}

async function logEvent(billId, type, userId, values) {
  const { error } = await supabase.from('bill_events').insert({ bill_id: billId, event_type: type, actor_user_id: userId, new_values: values });
  if (error) console.warn('bill_events insert failed', error.message);
}

async function currentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw Error('Your session has expired. Sign in again.');
  return data.user;
}

export default function OwnerApp() {
  const [tab, setTab] = useState('meters');
  const [admin, setAdmin] = useState(null);
  const [properties, setProperties] = useState([]);
  const [meters, setMeters] = useState([]);
  const [bills, setBills] = useState([]);
  const [settingsList, setSettingsList] = useState([]);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState('');
  const [email, setEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { setEmail(data.user?.email || ''); setOwnerName(data.user?.user_metadata?.full_name || ''); });
  }, []);

  const load = useCallback(async () => {
    setBusy(true); setMsg('');
    const [p, m, b, s] = await Promise.all([
      supabase.from('properties').select('id,name,address').order('created_at'),
      supabase.from('meters').select('id,property_id,room_id,meter_code,meter_number,status,opening_reading,notes,public_token,rooms(floor,room_number),properties(name,address),tenant_assignments(id,tenant_id,move_in_date,move_out_date,tenants(id,name,phone,notes))').order('meter_code'),
      supabase.from('electricity_bills').select(BILL_SELECT).order('created_at', { ascending: false }).limit(300),
      supabase.from('billing_settings').select('*'),
    ]);
    const err = p.error || m.error || b.error || s.error;
    if (err) setMsg(err.message);
    setProperties(p.data || []); setMeters(m.data || []); setBills(b.data || []); setSettingsList(s.data || []);
    setBusy(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('bootstrap_admin');
      if (error) { setMsg(error.message); setAdmin(false); setBusy(false); return; }
      setAdmin(!!data);
      if (data) await load(); else setBusy(false);
    })();
  }, [load]);

  const settingsFor = useCallback(id => settingsList.find(s => s.property_id === id) || fallbackSettings(id), [settingsList]);
  const close = useCallback(() => setModal(null), []);
  const done = useCallback(async () => { setModal(null); await load(); }, [load]);
  const pending = bills.filter(b => b.status === 'PENDING_APPROVAL');

  if (admin === false) {
    return <main className="center"><div className="auth-shell"><BrandMark /><div className="card login">
      <div className="eyebrow">Owner console</div><h1>Not an administrator</h1>
      <p className="muted">{email || 'This account'} is signed in but is not the owner account for this property. Sign out and sign in with the owner email.</p>
      {msg && <div className="alert">{msg}</div>}
      <button className="secondary" onClick={() => supabase.auth.signOut()}><LogOut size={16} />Sign out</button>
    </div></div></main>;
  }

  return <main className="admin page-fade-in">
    <header className="topbar"><BrandMark /><div className="topbar-actions">
      <button className="ghost" onClick={load} title="Refresh" aria-label="Refresh"><RefreshCw size={18} /></button>
      <ThemeToggle />
      <button className="ghost" onClick={() => setModal({ type: 'password' })} title="Change password" aria-label="Change password"><KeyRound size={18} /></button>
      {email && <button className="ghost topbar-user hide-sm" onClick={() => setModal({ type: 'name' })} title={'Signed in as ' + email + ' · edit your name'}>{ownerName || email}</button>}
      <button className="secondary sm" onClick={() => supabase.auth.signOut()}><LogOut size={15} /><span className="hide-sm">Sign out</span></button>
    </div></header>
    <div className="page-head"><div><div className="eyebrow">Owner console</div><h1>{ownerName ? 'Hello, ' + ownerName.split(' ')[0] + '.' : 'Meters, readings & bills.'}</h1><p className="muted">Approve tenant readings, generate bills and record payments.</p></div>
      {properties.length > 0 && <button onClick={() => setModal({ type: 'meter' })}><Plus size={16} />Add meter</button>}</div>
    <nav className="tabs">
      {[['meters', 'Meters'], ['tenants', 'Tenants'], ['bills', 'Bills'], ['settings', 'Properties & Rates']].map(([k, l]) =>
        <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}{k === 'bills' && pending.length > 0 && <b>{pending.length}</b>}</button>)}
    </nav>
    {msg && <div className="alert">{msg}</div>}
    {busy ? <div className="card"><h2>Loading data…</h2></div>
      : properties.length === 0 ? <SetupCard onAdd={() => setModal({ type: 'property' })} />
        : tab === 'meters' ? <Dashboard meters={meters} bills={bills} onAdd={() => setModal({ type: 'meter' })} onGenerate={m => setModal({ type: 'generate', meter: m })} onEditTenant={m => setModal({ type: 'tenant', meter: m })} onOpenRoom={m => setModal({ type: 'room', meter: m })} onDelete={m => setModal({ type: 'deleteMeter', meter: m })} onEdit={m => setModal({ type: 'editMeter', meter: m })} />
          : tab === 'tenants' ? <TenantManager meters={meters} onEdit={m => setModal({ type: 'tenant', meter: m })} />
            : tab === 'bills' ? <Bills bills={bills} onApprove={b => setModal({ type: 'approve', bill: b })} onPaid={b => setModal({ type: 'pay', bill: b })} onDownload={downloadStored} onError={setMsg} />
              : <PropertySettings properties={properties} meters={meters} settingsFor={settingsFor} onSaved={load} onAdd={() => setModal({ type: 'property' })} onDelete={p => setModal({ type: 'deleteProperty', property: p })} />}
    {modal?.type === 'name' && <NameModal name={ownerName} email={email} onClose={close} onSaved={n => { setOwnerName(n); close(); }} />}
    {modal?.type === 'password' && <PasswordModal email={email} onClose={close} />}
    {modal?.type === 'deleteMeter' && <DeleteMeterModal meter={modal.meter} onClose={close} onDone={done} />}
    {modal?.type === 'deleteProperty' && <DeletePropertyModal property={modal.property} onClose={close} onDone={done} />}
    {modal?.type === 'property' && <PropertyModal onClose={close} onDone={done} />}
    {modal?.type === 'meter' && <MeterModal properties={properties} onClose={close} onDone={done} />}
    {modal?.type === 'editMeter' && <MeterModal properties={properties} meter={modal.meter} bills={bills} onClose={close} onDone={done} />}
    {modal?.type === 'generate' && <GenerateModal meter={modal.meter} bills={bills} settings={settingsFor(modal.meter.property_id)} onClose={close} onDone={done} />}
    {modal?.type === 'approve' && <ApproveModal bill={modal.bill} bills={bills} settings={settingsFor(modal.bill.property_id)} onClose={close} onDone={done} />}
    {modal?.type === 'pay' && <PayModal bill={modal.bill} onClose={close} onDone={done} />}
    {modal?.type === 'tenant' && <TenantModal meter={modal.meter} bills={bills} onClose={close} onDone={done} />}
    {modal?.type === 'room' && <RoomDetailsModal meter={modal.meter} bills={bills} settings={settingsFor(modal.meter.property_id)} onClose={close} />}
  </main>;
}

async function downloadStored(b, onError) {
  if (!b.pdf_path) return onError('The PDF for ' + b.bill_number + ' is not available yet.');
  const { data, error } = await supabase.storage.from('electricity-bills').createSignedUrl(b.pdf_path, 300, { download: b.bill_number + '.pdf' });
  if (error) return onError(error.message);
  location.href = data.signedUrl;
}

function SetupCard({ onAdd }) {
  return <section className="card empty"><Building2 size={30} className="muted" /><h3>Add your first property</h3>
    <p>Create a property, then add a room and meter for each electricity connection. Every meter gets a permanent QR code.</p>
    <button onClick={onAdd}><Plus size={16} />Add property</button></section>;
}

function Dashboard({ meters, bills, onAdd, onGenerate, onEditTenant, onOpenRoom, onDelete, onEdit }) {
  const pending = bills.filter(b => b.status === 'PENDING_APPROVAL').length;
  const due = bills.filter(b => b.status === 'APPROVED').reduce((s, b) => s + Number(b.total_amount || 0), 0);
  return <>
    <section className="ledger-panel"><div className="eyebrow">Today · Electricity at a glance</div>
      <div className="stats">
        <div><b>{meters.length}</b><span>Meters</span></div>
        <div><b>{meters.filter(m => activeAssignment(m)).length}</b><span>Occupied</span></div>
        <div className="gold"><b>{pending}</b><span>Pending approval</span></div>
        <div className="gold"><b>{money(due)}</b><span>Awaiting payment</span></div>
      </div>
    </section>
    <section className="table-card"><div className="table-head"><h2>Meter registry</h2><span>All readings are kWh</span></div>
      {meters.length === 0 ? <div className="empty"><Zap size={28} /><h3>No meters yet</h3><p>Add a room and meter to start billing.</p><button onClick={onAdd}><Plus size={16} />Add meter</button></div>
        : meters.map(m => {
          const a = activeAssignment(m);
          return <div className="row" key={m.id}>
            <div><button className="link-btn" onClick={() => onOpenRoom(m)} title="Open room details"><strong>{m.meter_code}</strong><small>Floor {m.rooms?.floor || '—'} · Room {m.rooms?.room_number || '—'}</small></button></div>
            <div><strong>{a?.tenants?.name || 'Vacant'}</strong><small>{a?.tenants?.phone || 'No mobile registered'}</small></div>
            {m.status !== 'active' ? <span className="pill red">{m.status === 'maintenance' ? 'Maintenance' : 'Inactive'}</span>
              : <span className={'pill ' + (a ? 'green' : '')}>{a ? 'Occupied' : 'Vacant'}</span>}
            <div className="row-actions">
              <button className="sm" onClick={() => onGenerate(m)}><FileText size={14} />Generate bill</button>
              <button className="secondary sm" onClick={() => onEditTenant(m)}><UserRound size={14} />Tenant</button>
              <button className="secondary sm" onClick={() => onOpenRoom(m)}><ArrowUpRight size={14} />Room</button>
              <button className="secondary sm" onClick={() => downloadQR(m, 'png')}><QrCode size={14} />PNG</button>
              <button className="secondary sm" onClick={() => downloadQR(m, 'pdf')}><QrCode size={14} />PDF</button>
              <button className="secondary sm" onClick={() => onEdit(m)} title={'Edit meter ' + m.meter_code} aria-label={'Edit meter ' + m.meter_code}><Pencil size={14} /></button>
              <button className="secondary sm danger-outline" onClick={() => onDelete(m)} title={'Delete meter ' + m.meter_code} aria-label={'Delete meter ' + m.meter_code}><Trash2 size={14} /></button>
            </div>
          </div>;
        })}
    </section>
  </>;
}

function RoomDetailsModal({ meter, bills, settings, onClose }) {
  const active = activeAssignment(meter), tenant = active?.tenants || null;
  const lastPaid = bills.filter(b => b.meter_id === meter.id).sort(byNewest).find(b => b.status === 'PAID');
  const lp = lastPaymentFor(meter.id, bills);
  const snapshot = () => downloadTenantSnapshotPdf(meter, bills, settings);
  return <Modal wide title={'Room ' + (meter.rooms?.room_number || '—') + ' · ' + meter.meter_code} onClose={onClose}>
    <div className="room-detail-head"><div><div className="eyebrow">Current room snapshot</div><h3>{tenant?.name || 'Vacant'}</h3><p className="muted">{meter.properties?.name || 'Property'} · Floor {meter.rooms?.floor || '—'} · Room {meter.rooms?.room_number || '—'}</p></div>
      <button className="secondary" title="Download tenant data PDF" aria-label="Download tenant data PDF" onClick={snapshot}><Download size={18} /></button></div>
    <div className="portal-grid">
      <Info a="Tenant name" b={tenant?.name || 'Vacant'} /><Info a="Registered mobile" b={tenant?.phone || '—'} />
      <Info a="Move-in date" b={active?.move_in_date ? fmt(active.move_in_date) : '—'} /><Info a="Tenant notes" b={tenant?.notes || '—'} />
      <Info a="Meter number" b={meter.meter_number || '—'} /><Info a="Opening reading" b={kwh(meter.opening_reading)} />
      <Info a="Rate" b={money(settings.rate_per_unit) + ' / kWh'} /><Info a="Last paid reading" b={kwh(lastPaid ? lastPaid.current_reading : meter.opening_reading)} />
      <Info a="Last payment" b={lp ? money(lp.amount) : '—'} /><Info a="Last payment date" b={lp ? fmt(lp.payment_date) : '—'} />
    </div>
    <div className="download-note">The tenant data PDF is a snapshot of this room exactly as it is now, with the permanent meter QR code on the final page. Portal link: <span className="mono">{portalUrl(meter.public_token)}</span></div>
    <div className="actions"><button className="secondary" onClick={onClose}>Close</button><button onClick={snapshot}><Download size={16} />Download tenant data PDF</button></div>
  </Modal>;
}

function TenantManager({ meters, onEdit }) {
  return <section className="table-card"><div className="table-head"><h2>Tenant details</h2><span>Owner-controlled · the registered mobile unlocks the meter portal</span></div>
    {meters.length === 0 ? <div className="empty">Add a meter first.</div> : meters.map(m => {
      const a = activeAssignment(m);
      return <div className="row" key={m.id}>
        <div><strong>{a?.tenants?.name || 'Vacant'}</strong><small>{a?.tenants?.phone || 'No registered mobile'}{a ? ' · since ' + fmt(a.move_in_date) : ''}</small></div>
        <div>Room {m.rooms?.room_number || '—'}<small>Floor {m.rooms?.floor || '—'} · Meter {m.meter_code}</small></div>
        <span className={'pill ' + (a ? 'green' : '')}>{a ? 'Assigned' : 'Unassigned'}</span>
        <div className="row-actions"><button className="sm" onClick={() => onEdit(m)}>{a ? 'Edit tenant' : 'Assign tenant'}</button></div>
      </div>;
    })}
  </section>;
}

function TenantModal({ meter, bills, onClose, onDone }) {
  const active = activeAssignment(meter);
  const [name, setName] = useState(active?.tenants?.name || '');
  const [phone, setPhone] = useState(active?.tenants?.phone || '');
  const [notes, setNotes] = useState(active?.tenants?.notes || '');
  const [moveIn, setMoveIn] = useState(active?.move_in_date || today());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const openBill = bills.find(b => b.meter_id === meter.id && OPEN.includes(b.status));

  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (!name.trim()) throw Error('Tenant name is required.');
      const normalized = cleanPhone(phone);
      if (normalized.length < 10) throw Error('Enter a valid registered mobile number (at least 10 digits).');
      if (active) {
        if (!moveIn) throw Error('Move-in date is required.');
        const { error } = await supabase.from('tenants').update({ name: name.trim(), phone: normalized, notes: notes.trim() || null }).eq('id', active.tenant_id);
        if (error) throw error;
        if (moveIn !== active.move_in_date) {
          const { error: e } = await supabase.from('tenant_assignments').update({ move_in_date: moveIn }).eq('id', active.id);
          if (e) throw e;
        }
      } else {
        const { data: t, error } = await supabase.from('tenants').insert({ property_id: meter.property_id, name: name.trim(), phone: normalized, notes: notes.trim() || null }).select('id').single();
        if (error) throw error;
        const { error: e } = await supabase.from('tenant_assignments').insert({ meter_id: meter.id, room_id: meter.room_id || null, tenant_id: t.id, move_in_date: moveIn || today() });
        if (e) { await supabase.from('tenants').delete().eq('id', t.id); throw e; }
      }
      await onDone();
    } catch (e) { setErr(e.message || 'Could not save tenant'); } finally { setSaving(false); }
  };

  const moveOut = async () => {
    if (openBill && !confirm(`Bill ${openBill.bill_number} is still open for this meter. Move the tenant out anyway?`)) return;
    if (!openBill && !confirm(`Move ${active.tenants?.name || 'this tenant'} out today? Their bill history is kept and the meter becomes vacant.`)) return;
    setSaving(true); setErr('');
    const moveOutDate = active.move_in_date > today() ? active.move_in_date : today();
    const { error } = await supabase.from('tenant_assignments').update({ move_out_date: moveOutDate }).eq('id', active.id);
    setSaving(false);
    if (error) setErr(error.message); else await onDone();
  };

  return <Modal title={(active ? 'Edit' : 'Assign') + ' tenant · ' + meter.meter_code} onClose={onClose}>
    <p className="muted">The registered mobile number is what the tenant enters after scanning the meter QR code.</p>
    <label>Tenant name<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Tenant full name" /></label>
    <label>Registered mobile number<input inputMode="numeric" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="10-digit mobile number" /></label>
    <label>Move-in date<input type="date" value={moveIn} onChange={e => setMoveIn(e.target.value)} /></label>
    <label>Notes<textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" /></label>
    {err && <div className="alert">{err}</div>}
    <div className="actions">
      {active && <button className="danger" disabled={saving} onClick={moveOut}>Move out</button>}
      <span className="spacer" />
      <button className="secondary" onClick={onClose}>Cancel</button>
      <button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save tenant'}</button>
    </div>
  </Modal>;
}

function Bills({ bills, onApprove, onPaid, onDownload, onError }) {
  const [filter, setFilter] = useState('ALL');
  const shown = filter === 'ALL' ? bills : bills.filter(b => b.status === filter);
  const filters = [['ALL', 'All'], ['PENDING_APPROVAL', 'Pending'], ['APPROVED', 'Awaiting payment'], ['PAID', 'Paid'], ['CANCELLED', 'Rejected']];
  return <section className="table-card"><div className="table-head"><h2>Electricity bills</h2>
    <div className="filters">{filters.map(([k, l]) => <button key={k} className={'secondary sm' + (filter === k ? ' active' : '')} onClick={() => setFilter(k)}>{l}</button>)}</div></div>
    {shown.length === 0 ? <div className="empty">No bills here yet.</div> : <div className="bill-list">{shown.map(b =>
      <div className="bill-card" key={b.id}>
        <div><strong>{b.bill_number}</strong><small>{b.meters?.meter_code || '—'} · {b.tenants?.name || 'Vacant'} · {fmt(b.bill_date)} · {b.source === 'TENANT' ? 'Tenant reading' : 'Owner'}</small></div>
        <div><span className="amount">{money(b.total_amount)}</span><small>{Number(b.units || 0).toFixed(2)} kWh</small></div>
        <StatusPill status={b.status} />
        <div className="row-actions">
          {b.status === 'PENDING_APPROVAL' && <button className="sm" onClick={() => onApprove(b)}>Review</button>}
          {b.reading_photo_path && b.status !== 'PENDING_APPROVAL' && <button className="secondary sm" onClick={() => openPhoto(b, onError)}><Camera size={14} />Photo</button>}
          {(b.status === 'APPROVED' || b.status === 'PAID') && <button className="secondary sm" onClick={() => onDownload(b, onError)}><Download size={14} />PDF</button>}
          {b.status === 'APPROVED' && <button className="sm" onClick={() => onPaid(b)}>Mark paid</button>}
        </div>
      </div>)}</div>}
  </section>;
}

function PropertySettings({ properties, meters, settingsFor, onSaved, onAdd, onDelete }) {
  return <div className="settings-list">
    {properties.map(p => <PropertyForm key={p.id} property={p} meterCount={meters.filter(m => m.property_id === p.id).length} settings={settingsFor(p.id)} onSaved={onSaved} onDelete={() => onDelete(p)} />)}
    <div><button className="secondary" onClick={onAdd}><Plus size={16} />Add property</button></div>
  </div>;
}

function PropertyForm({ property, meterCount, settings, onSaved, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(''), [address, setAddress] = useState('');
  const [rate, setRate] = useState(''), [dueDays, setDueDays] = useState('');
  const [msg, setMsg] = useState(null), [saving, setSaving] = useState(false);

  const startEdit = () => {
    setName(property.name || ''); setAddress(property.address || '');
    setRate(String(settings.rate_per_unit ?? DEFAULT_RATE)); setDueDays(String(settings.due_days ?? 7));
    setMsg(null); setEditing(true);
  };
  const save = async e => {
    e.preventDefault(); setMsg(null);
    const value = Number(rate), days = Number(dueDays), cleanName = name.trim().replace(/\s+/g, ' ');
    if (!cleanName) return setMsg({ ok: false, text: 'Property name is required. It appears on every PDF.' });
    if (rate === '' || !Number.isFinite(value) || value < 0) return setMsg({ ok: false, text: 'Enter a valid rate.' });
    if (dueDays === '' || !Number.isInteger(days) || days < 0) return setMsg({ ok: false, text: 'Enter whole days.' });
    setSaving(true);
    const [p, st] = await Promise.all([
      supabase.from('properties').update({ name: cleanName, address: address.trim() || null }).eq('id', property.id),
      supabase.from('billing_settings').upsert({ property_id: property.id, rate_per_unit: value, due_days: days, fixed_charge: 0, tax_percent: 0, updated_at: new Date().toISOString() }, { onConflict: 'property_id' }),
    ]);
    setSaving(false);
    const error = p.error || st.error;
    if (error) return setMsg({ ok: false, text: error.message });
    setEditing(false);
    setMsg({ ok: true, text: 'Saved. New PDFs will show the updated property details.' });
    onSaved();
  };

  const head = <div className="property-head"><div className="eyebrow">Property · {meterCount} meter{meterCount === 1 ? '' : 's'}</div>
    {!editing && <div className="row-actions">
      <button type="button" className="secondary sm" onClick={startEdit}><Pencil size={14} />Edit</button>
      <button type="button" className="secondary sm danger-outline" onClick={onDelete} disabled={meterCount > 0} title={meterCount > 0 ? 'Delete its meters first' : 'Delete property'}><Trash2 size={14} />Delete</button>
    </div>}</div>;

  if (!editing) return <section className="card">
    {head}
    <h2 className="property-name">{property.name}</h2>
    <p className="muted small">{property.address || 'No address added'}</p>
    <div className="property-facts">
      <Info a="Rate" b={money(settings.rate_per_unit ?? DEFAULT_RATE) + ' / kWh'} />
      <Info a="Bill due in" b={(settings.due_days ?? 7) + ' days'} />
    </div>
    {msg && <div className={msg.ok ? 'success' : 'alert'}>{msg.text}</div>}
    {meterCount > 0 && <p className="hint">To delete this property, delete its meters first.</p>}
  </section>;

  return <form className="card" onSubmit={save}>
    {head}
    <div className="field-row">
      <label>Property name <span className="hint-inline">(shown on all PDFs)</span><input autoFocus value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder="e.g. Sai Residency" /></label>
      <label>Address<input value={address} maxLength={200} onChange={e => setAddress(e.target.value)} placeholder="Shown on bills" /></label>
    </div>
    <div className="field-row">
      <label>Rate per kWh (₹)<input type="number" min="0" step="0.01" value={rate} onChange={e => setRate(e.target.value)} /></label>
      <label>Due in (days)<input type="number" min="0" step="1" value={dueDays} onChange={e => setDueDays(e.target.value)} /></label>
    </div>
    {msg && <div className={msg.ok ? 'success' : 'alert'}>{msg.text}</div>}
    <div className="actions"><button type="button" className="secondary" onClick={() => { setEditing(false); setMsg(null); }} disabled={saving}>Cancel</button><button disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
  </form>;
}

function PropertyModal({ onClose, onDone }) {
  const [name, setName] = useState(''), [address, setAddress] = useState(''), [rate, setRate] = useState(DEFAULT_RATE);
  const [saving, setSaving] = useState(false), [err, setErr] = useState('');
  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (!name.trim()) throw Error('Property name is required.');
      const r = Number(rate);
      if (!Number.isFinite(r) || r < 0) throw Error('Enter a valid rate.');
      const { data: p, error } = await supabase.from('properties').insert({ name: name.trim(), address: address.trim() || null }).select('id').single();
      if (error) throw error;
      const { error: e } = await supabase.from('billing_settings').upsert({ property_id: p.id, rate_per_unit: r }, { onConflict: 'property_id' });
      if (e) throw e;
      await onDone();
    } catch (e) { setErr(e.message || 'Could not add property'); } finally { setSaving(false); }
  };
  return <Modal title="Add property" onClose={onClose}>
    <label>Property name<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sai Residency" /></label>
    <label>Address<textarea value={address} onChange={e => setAddress(e.target.value)} placeholder="Shown on bills" /></label>
    <label>Electricity rate per kWh (₹)<input type="number" min="0" step="0.01" value={rate} onChange={e => setRate(e.target.value)} /></label>
    {err && <div className="alert">{err}</div>}
    <div className="actions"><button className="secondary" onClick={onClose}>Cancel</button><button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Add property'}</button></div>
  </Modal>;
}

const METER_STATUS = [['active', 'Active'], ['inactive', 'Inactive'], ['maintenance', 'Maintenance']];

/** Add a room + meter, or edit an existing meter when `meter` is given. */
function MeterModal({ properties, meter = null, bills = [], onClose, onDone }) {
  const editing = !!meter;
  const [propertyId, setPropertyId] = useState(meter?.property_id || properties[0]?.id || '');
  const [floor, setFloor] = useState(meter?.rooms?.floor || ''), [room, setRoom] = useState(meter?.rooms?.room_number || '');
  const [code, setCode] = useState(meter?.meter_code || ''), [number, setNumber] = useState(meter?.meter_number || '');
  const [opening, setOpening] = useState(String(meter?.opening_reading ?? 0));
  const [status, setStatus] = useState(meter?.status || 'active'), [notes, setNotes] = useState(meter?.notes || '');
  const [saving, setSaving] = useState(false), [err, setErr] = useState('');
  // Once bills exist they were calculated from this baseline, so it can't change.
  const billCount = editing ? bills.filter(b => b.meter_id === meter.id && b.status !== 'CANCELLED').length : 0;
  const openingLocked = billCount > 0;

  const findOrCreateRoom = async () => {
    const { data: r, error } = await supabase.from('rooms').select('id,floor').eq('property_id', propertyId).eq('room_number', room.trim()).maybeSingle();
    if (error) throw error;
    if (r) {
      if (r.floor !== floor.trim()) {
        const { error: fe } = await supabase.from('rooms').update({ floor: floor.trim() }).eq('id', r.id);
        if (fe) throw fe;
      }
      return r.id;
    }
    const { data: created, error: ce } = await supabase.from('rooms').insert({ property_id: propertyId, floor: floor.trim(), room_number: room.trim() }).select('id').single();
    if (ce) throw ce;
    return created.id;
  };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (!propertyId) throw Error('Choose a property.');
      if (!floor.trim() || !room.trim()) throw Error('Floor and room number are required.');
      if (!code.trim()) throw Error('Meter code is required.');
      const openingReading = Number(opening);
      if (opening === '' || !Number.isFinite(openingReading) || openingReading < 0) throw Error('Opening reading must be a non-negative number.');
      const roomId = await findOrCreateRoom();
      const fields = { room_id: roomId, meter_code: code.trim(), meter_number: number.trim() || null, notes: notes.trim() || null, status };
      if (!openingLocked) fields.opening_reading = openingReading;
      const { error: e } = editing
        ? await supabase.from('meters').update(fields).eq('id', meter.id)
        : await supabase.from('meters').insert({ ...fields, property_id: propertyId });
      if (e) throw Error(e.code === '23505' ? 'That meter code already exists for this property.' : e.message);
      if (editing && meter.room_id !== roomId) {
        const active = activeAssignment(meter);
        if (active) await supabase.from('tenant_assignments').update({ room_id: roomId }).eq('id', active.id);
        if (meter.room_id) {
          const { count } = await supabase.from('meters').select('id', { count: 'exact', head: true }).eq('room_id', meter.room_id);
          if (count === 0) await supabase.from('rooms').delete().eq('id', meter.room_id);
        }
      }
      await onDone();
    } catch (e) { setErr(e.message || 'Could not save meter'); } finally { setSaving(false); }
  };

  return <Modal title={editing ? 'Edit meter · ' + meter.meter_code : 'Add room & meter'} onClose={onClose}>
    {!editing && properties.length > 1 && <label>Property<select value={propertyId} onChange={e => setPropertyId(e.target.value)}>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    {editing && <p className="muted small">{meter.properties?.name || 'Property'} · the QR code stays the same after editing.</p>}
    <div className="field-row"><label>Floor<input autoFocus value={floor} onChange={e => setFloor(e.target.value)} placeholder="e.g. 1" /></label><label>Room number<input value={room} onChange={e => setRoom(e.target.value)} placeholder="e.g. 101" /></label></div>
    <div className="field-row"><label>Meter code<input value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. M-101" /></label><label>Meter number<input value={number} onChange={e => setNumber(e.target.value)} placeholder="Printed on meter" /></label></div>
    <div className="field-row">
      <label>Opening reading (kWh)<input type="number" min="0" step="0.001" value={opening} disabled={openingLocked} onChange={e => setOpening(e.target.value)} />
        {openingLocked && <span className="hint">Locked: {billCount} bill{billCount === 1 ? ' was' : 's were'} calculated from it.</span>}</label>
      {editing && <label>Status<select value={status} onChange={e => setStatus(e.target.value)}>{METER_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {status !== 'active' && <span className="hint">Tenants can't open this meter's QR portal until it is active again.</span>}</label>}
    </div>
    {editing && <label>Notes<textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional, owner-only notes" /></label>}
    {!editing && <p className="muted small">The first bill is calculated from the opening reading. A permanent QR code is created for the meter automatically.</p>}
    {err && <div className="alert">{err}</div>}
    <div className="actions"><button className="secondary" onClick={onClose}>Cancel</button><button disabled={saving} onClick={save}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add meter'}</button></div>
  </Modal>;
}

function BillPreview({ previous, reading, rate, settings }) {
  const current = Number(reading);
  if (reading === '' || !Number.isFinite(current) || current < previous) return null;
  const c = calcBill(current - previous, rate, settings.fixed_charge, settings.tax_percent);
  return <div className="preview-total"><span>{(current - previous).toFixed(3)} kWh × {money(rate)}</span><span className="amount">{money(c.total)}</span></div>;
}

function GenerateModal({ meter, bills, settings, onClose, onDone }) {
  const [reading, setReading] = useState(''), [notes, setNotes] = useState(''), [saving, setSaving] = useState(false), [err, setErr] = useState('');
  const meterBills = useMemo(() => bills.filter(b => b.meter_id === meter.id).sort(byNewest), [bills, meter.id]);
  const lastPaid = meterBills.find(b => b.status === 'PAID');
  const openBill = meterBills.find(b => OPEN.includes(b.status));
  const previous = Number(lastPaid?.current_reading ?? meter.opening_reading ?? 0);
  const rate = Number(settings.rate_per_unit ?? DEFAULT_RATE);

  const save = async () => {
    setSaving(true); setErr('');
    let uploaded = null;
    try {
      const { data: open, error: oe } = await supabase.from('electricity_bills').select('bill_number,status').eq('meter_id', meter.id).in('status', OPEN).limit(1).maybeSingle();
      if (oe) throw oe;
      if (open) throw Error(open.status === 'PENDING_APPROVAL' ? `Bill ${open.bill_number} is waiting for your approval. Review it in Bills first.` : `Bill ${open.bill_number} has not been marked paid yet.`);
      const current = Number(reading);
      if (reading === '' || !Number.isFinite(current) || current < previous) throw Error('Current kWh reading must be at least ' + previous + '.');
      const user = await currentUser();
      const tenant = activeAssignment(meter)?.tenants || null;
      const c = calcBill(current - previous, rate, settings.fixed_charge, settings.tax_percent);
      const d = today(), id = crypto.randomUUID(), path = meter.property_id + '/' + meter.id + '/' + id + '.pdf';
      const row = {
        id, property_id: meter.property_id, meter_id: meter.id, tenant_id: tenant?.id || null, bill_number: billNumber(), bill_date: d, reading_date: d,
        previous_reading: previous, current_reading: current, rate_per_unit: rate, energy_charge: c.energy, fixed_charge: c.fixed, other_charge: 0,
        tax_amount: c.tax, total_amount: c.total, status: 'APPROVED', source: 'OWNER', approved_at: new Date().toISOString(), approved_by: user.id, notes: notes.trim() || null,
      };
      const bill = { ...row, units: round3(current - previous) };
      const history = [bill, ...(await paidHistory(meter.id))];
      const ctx = { property: meter.properties, meter: { code: meter.meter_code, number: meter.meter_number }, room: meter.rooms, tenant, moveInDate: activeAssignment(meter)?.move_in_date, history, lastPayment: lastPaymentFor(meter.id, bills), previousDate: lastPaid?.reading_date, dueDays: settings.due_days };
      const blob = await createBillPdf(bill, ctx, portalUrl(meter.public_token));
      const up = await supabase.storage.from('electricity-bills').upload(path, blob, { contentType: 'application/pdf', upsert: false });
      if (up.error) throw up.error;
      uploaded = path;
      const { error } = await supabase.from('electricity_bills').insert({ ...row, pdf_path: path });
      if (error) throw error;
      uploaded = null;
      await logEvent(id, 'OWNER_GENERATED', user.id, { current_reading: current, rate_per_unit: rate, total_amount: c.total });
      downloadBlob(blob, bill.bill_number + '.pdf');
      await onDone();
    } catch (e) {
      if (uploaded) await supabase.storage.from('electricity-bills').remove([uploaded]);
      setErr(e.message || 'Could not generate bill');
    } finally { setSaving(false); }
  };

  return <Modal title={'Generate bill · ' + meter.meter_code} onClose={onClose}>
    <div className="mini-summary"><span>Last paid reading<b>{kwh(previous)}</b></span><span>Rate<b>{money(rate)} / kWh</b></span></div>
    {openBill && <div className="alert">Bill {openBill.bill_number} is still {openBill.status === 'PENDING_APPROVAL' ? 'waiting for approval' : 'unpaid'}. Settle it before generating a new one.</div>}
    <label>Current kWh reading<input autoFocus type="number" min={previous} step="0.001" value={reading} onChange={e => setReading(e.target.value)} placeholder="Enter current kWh reading" /></label>
    <BillPreview previous={previous} reading={reading} rate={rate} settings={settings} />
    <label>Note on bill (optional)<textarea value={notes} onChange={e => setNotes(e.target.value)} /></label>
    <p className="muted small">The bill date is today. Owner-generated bills are final and the PDF downloads immediately.</p>
    {err && <div className="alert">{err}</div>}
    <div className="actions"><button className="secondary" onClick={onClose}>Cancel</button><button disabled={saving || !!openBill} onClick={save}>{saving ? 'Generating…' : 'Generate & download'}</button></div>
  </Modal>;
}

function MeterPhoto({ path }) {
  const [url, setUrl] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    if (!path) return;
    let live = true;
    supabase.storage.from('meter-photos').createSignedUrl(path, 600).then(({ data, error }) => {
      if (!live) return;
      if (error) setError(error.message); else setUrl(data.signedUrl);
    });
    return () => { live = false; };
  }, [path]);
  if (!path) return <div className="photo-missing">No meter photo was attached to this reading.</div>;
  if (error) return <div className="alert">Could not load the meter photo: {error}</div>;
  if (!url) return <div className="photo-missing">Loading meter photo…</div>;
  return <a href={url} target="_blank" rel="noreferrer" title="Open full-size photo"><img className="meter-photo" src={url} alt="Meter photo submitted by the tenant" /></a>;
}

async function openPhoto(b, onError) {
  const { data, error } = await supabase.storage.from('meter-photos').createSignedUrl(b.reading_photo_path, 300);
  if (error) return onError(error.message);
  window.open(data.signedUrl, '_blank', 'noopener');
}

function ApproveModal({ bill, bills, settings, onClose, onDone }) {
  const [reading, setReading] = useState(String(bill.current_reading));
  const [rate, setRate] = useState(String(bill.rate_per_unit ?? settings.rate_per_unit ?? DEFAULT_RATE));
  const [saving, setSaving] = useState(false), [err, setErr] = useState('');
  const previous = Number(bill.previous_reading);
  const lastPaid = bills.filter(b => b.meter_id === bill.meter_id && b.status === 'PAID').sort(byNewest)[0];

  const approve = async () => {
    setSaving(true); setErr('');
    try {
      const current = Number(reading), r = Number(rate);
      if (reading === '' || !Number.isFinite(current) || current < previous) throw Error('Current kWh reading cannot be below the previous reading (' + previous + ').');
      if (rate === '' || !Number.isFinite(r) || r < 0) throw Error('Enter a valid rate.');
      const user = await currentUser();
      const c = calcBill(current - previous, r, settings.fixed_charge, settings.tax_percent);
      const changes = { current_reading: current, rate_per_unit: r, energy_charge: c.energy, fixed_charge: c.fixed, other_charge: 0, tax_amount: c.tax, total_amount: c.total, status: 'APPROVED', approved_at: new Date().toISOString(), approved_by: user.id };
      const merged = { ...bill, ...changes, units: round3(current - previous) };
      const history = [merged, ...(await paidHistory(bill.meter_id)).filter(h => h.id !== bill.id)];
      const ctx = { property: bill.meters?.properties, meter: { code: bill.meters?.meter_code, number: bill.meters?.meter_number }, room: bill.meters?.rooms, tenant: bill.tenants, moveInDate: billMoveIn(bill), history, lastPayment: lastPaymentFor(bill.meter_id, bills), previousDate: lastPaid?.reading_date, dueDays: settings.due_days };
      const blob = await createBillPdf(merged, ctx, portalUrl(bill.meters?.public_token));
      const path = bill.property_id + '/' + bill.meter_id + '/' + bill.id + '.pdf';
      const up = await supabase.storage.from('electricity-bills').upload(path, blob, { contentType: 'application/pdf', upsert: true });
      if (up.error) throw up.error;
      const { data, error } = await supabase.from('electricity_bills').update({ ...changes, pdf_path: path }).eq('id', bill.id).eq('status', 'PENDING_APPROVAL').select('id');
      if (error) throw error;
      if (!data?.length) throw Error('This bill was already processed. Refresh to see its current status.');
      await logEvent(bill.id, 'OWNER_APPROVED', user.id, { current_reading: current, rate_per_unit: r, total_amount: c.total });
      await onDone();
    } catch (e) { setErr(e.message || 'Approval failed'); } finally { setSaving(false); }
  };

  const reject = async () => {
    if (!confirm('Reject bill ' + bill.bill_number + '? The tenant will be able to submit a new reading.')) return;
    setSaving(true); setErr('');
    try {
      const user = await currentUser();
      const { data, error } = await supabase.from('electricity_bills').update({ status: 'CANCELLED' }).eq('id', bill.id).eq('status', 'PENDING_APPROVAL').select('id');
      if (error) throw error;
      if (!data?.length) throw Error('This bill was already processed.');
      await logEvent(bill.id, 'OWNER_REJECTED', user.id, { status: 'CANCELLED' });
      await onDone();
    } catch (e) { setErr(e.message || 'Could not reject bill'); } finally { setSaving(false); }
  };

  return <Modal wide title={'Review bill · ' + bill.bill_number} onClose={onClose}>
    <div className="mini-summary"><span>Previous reading<b>{kwh(previous)}</b></span><span>Tenant<b>{bill.tenants?.name || '—'}</b></span><span>Submitted<b>{fmt(bill.submitted_at)}</b></span><span>Meter<b>{bill.meters?.meter_code || '—'}</b></span></div>
    <div className="eyebrow" style={{ margin: '14px 0 8px' }}>Meter photo · check it matches {kwh(bill.current_reading)}</div>
    <MeterPhoto path={bill.reading_photo_path} />
    {bill.notes && <div className="download-note">Tenant note: {bill.notes}</div>}
    <label>Current kWh reading<input type="number" min={previous} step="0.001" value={reading} onChange={e => setReading(e.target.value)} /></label>
    <label>Rate per kWh (₹)<input type="number" min={0} step="0.01" value={rate} onChange={e => setRate(e.target.value)} /></label>
    <BillPreview previous={previous} reading={reading} rate={Number(rate)} settings={settings} />
    {err && <div className="alert">{err}</div>}
    <div className="actions"><button className="danger" disabled={saving} onClick={reject}>Reject</button><span className="spacer" /><button className="secondary" onClick={onClose}>Cancel</button><button disabled={saving} onClick={approve}>{saving ? 'Working…' : 'Approve & create PDF'}</button></div>
  </Modal>;
}

function PayModal({ bill, onClose, onDone }) {
  const [amount, setAmount] = useState(String(bill.total_amount)), [mode, setMode] = useState('UPI'), [date, setDate] = useState(today()), [receipt, setReceipt] = useState('');
  const [saving, setSaving] = useState(false), [err, setErr] = useState('');
  const save = async () => {
    setSaving(true); setErr('');
    try {
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) throw Error('Enter the amount received.');
      if (!date) throw Error('Enter the payment date.');
      const user = await currentUser();
      const { data: pay, error } = await supabase.from('bill_payments').insert({ bill_id: bill.id, amount: round2(value), payment_mode: mode, payment_date: date, receipt_no: receipt.trim() || null }).select('id').single();
      if (error) throw error;
      const { data, error: e } = await supabase.from('electricity_bills').update({ status: 'PAID' }).eq('id', bill.id).eq('status', 'APPROVED').select('id');
      if (e || !data?.length) {
        await supabase.from('bill_payments').delete().eq('id', pay.id);
        throw e || Error('This bill is no longer awaiting payment. Refresh to see its status.');
      }
      await logEvent(bill.id, 'PAYMENT_RECORDED', user.id, { amount: round2(value), payment_mode: mode, payment_date: date });
      await onDone();
    } catch (e) { setErr(e.message || 'Could not record payment'); } finally { setSaving(false); }
  };
  return <Modal title={'Record payment · ' + bill.bill_number} onClose={onClose}>
    <div className="mini-summary"><span>Bill total<b>{money(bill.total_amount)}</b></span><span>Tenant<b>{bill.tenants?.name || '—'}</b></span></div>
    <div className="field-row"><label>Amount received (₹)<input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label>Payment date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label></div>
    <div className="field-row"><label>Mode<select value={mode} onChange={e => setMode(e.target.value)}>{PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}</select></label>
      <label>Receipt / reference no.<input value={receipt} onChange={e => setReceipt(e.target.value)} placeholder="Optional" /></label></div>
    {err && <div className="alert">{err}</div>}
    <div className="actions"><button className="secondary" onClick={onClose}>Cancel</button><button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Mark as paid'}</button></div>
  </Modal>;
}

function PasswordModal({ email, onClose }) {
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [confirm, setConfirm] = useState('');
  const [err, setErr] = useState(''), [done, setDone] = useState(false), [saving, setSaving] = useState(false);
  const save = async e => {
    e.preventDefault(); setErr('');
    const pwError = validatePassword(next) || (next !== confirm ? 'New passwords do not match.' : null);
    if (pwError) return setErr(pwError);
    setSaving(true);
    try {
      // Confirm the current password before changing it.
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password: current });
      if (authError) throw Error(/invalid login/i.test(authError.message) ? 'Current password is incorrect.' : authError.message);
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      setDone(true);
    } catch (e) { setErr(friendlyAuthError(e)); } finally { setSaving(false); }
  };
  return <Modal title="Change password" onClose={onClose}>
    {done ? <><div className="success">Password changed. Use the new password next time you sign in.</div><div className="actions"><button onClick={onClose}>Done</button></div></>
      : <form onSubmit={save}>
        <p className="muted small">Signed in as {email}</p>
        <label>Current password<PasswordInput value={current} onChange={setCurrent} autoFocus /></label>
        <label>New password<PasswordInput value={next} onChange={setNext} placeholder="New password" autoComplete="new-password" /><span className="hint">At least 8 characters, with a letter and a number.</span></label>
        <label>Confirm new password<PasswordInput value={confirm} onChange={setConfirm} placeholder="Repeat new password" autoComplete="new-password" /></label>
        {err && <div className="alert">{err}</div>}
        <div className="actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button disabled={saving}>{saving ? 'Saving…' : 'Change password'}</button></div>
      </form>}
  </Modal>;
}

function NameModal({ name, email, onClose, onSaved }) {
  const [value, setValue] = useState(name), [err, setErr] = useState(''), [saving, setSaving] = useState(false);
  const save = async e => {
    e.preventDefault(); setErr('');
    const clean = value.trim().replace(/\s+/g, ' ');
    if (clean.length < 2) return setErr('Enter your full name.');
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ data: { full_name: clean } });
    setSaving(false);
    if (error) setErr(error.message); else onSaved(clean);
  };
  return <Modal title="Your profile" onClose={onClose}><form onSubmit={save}>
    <p className="muted small">Signed in as {email}</p>
    <label>Full name<input autoFocus maxLength={80} autoComplete="name" value={value} onChange={e => setValue(e.target.value)} placeholder="Your full name" /></label>
    {err && <div className="alert">{err}</div>}
    <div className="actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
  </form></Modal>;
}

function ConfirmByTyping({ word, value, onChange }) {
  return <label>Type <b className="mono">{word}</b> to confirm<input autoFocus value={value} onChange={e => onChange(e.target.value)} placeholder={word} autoComplete="off" /></label>;
}

function DeleteMeterModal({ meter, onClose, onDone }) {
  const [typed, setTyped] = useState(''), [bills, setBills] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const [people, setPeople] = useState(null);
  const tenant = activeAssignment(meter)?.tenants;
  useEffect(() => {
    supabase.from('electricity_bills').select('id,status,pdf_path,reading_photo_path').eq('meter_id', meter.id)
      .then(({ data, error }) => { if (error) setErr(error.message); else setBills(data || []); });
    // Everyone ever assigned to this meter; those living in another room right now are kept.
    supabase.from('tenant_assignments').select('tenant_id,tenants(name,phone,tenant_assignments(meter_id,move_out_date))').eq('meter_id', meter.id)
      .then(({ data, error }) => {
        if (error) return setErr(error.message);
        const byId = new Map((data || []).filter(a => a.tenants).map(a => [a.tenant_id, a.tenants]));
        const list = [...byId.values()].map(t => ({ ...t, keep: (t.tenant_assignments || []).some(x => x.meter_id !== meter.id && !x.move_out_date) }));
        setPeople({ remove: list.filter(t => !t.keep), keep: list.filter(t => t.keep) });
      });
  }, [meter.id]);
  const open = (bills || []).filter(b => OPEN.includes(b.status)).length;

  const remove = async () => {
    setBusy(true); setErr('');
    try {
      // One database transaction removes the meter, its bills (with payments and
      // audit events), assignments, readings, orphaned tenants and the empty room.
      const { data, error } = await supabase.rpc('delete_meter', { p_meter_id: meter.id });
      if (error) {
        if (error.code === 'PGRST202' || /could not find the function/i.test(error.message)) throw Error('Run the latest SQL migration (delete_meter) in Supabase first, then try again.');
        throw error;
      }
      // Then every stored file for this meter: bill PDFs and meter photos.
      const prefix = data?.storage_prefix || meter.property_id + '/' + meter.id;
      const referenced = { 'electricity-bills': (bills || []).map(b => b.pdf_path), 'meter-photos': (bills || []).map(b => b.reading_photo_path) };
      const failed = [];
      for (const bucket of ['electricity-bills', 'meter-photos']) {
        const { data: files } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
        const paths = new Set([...(files || []).map(f => prefix + '/' + f.name), ...referenced[bucket].filter(Boolean)]);
        if (paths.size) {
          const { error: se } = await supabase.storage.from(bucket).remove([...paths]);
          if (se) failed.push(bucket);
        }
      }
      if (failed.length) console.warn('Meter deleted, but some stored files could not be removed from', failed.join(', '));
      await onDone();
    } catch (e) { setErr(e.message || 'Could not delete the meter'); setBusy(false); }
  };

  return <Modal title={'Delete meter ' + meter.meter_code + '?'} onClose={onClose}>
    <p className="muted">Room {meter.rooms?.room_number || '—'} · Floor {meter.rooms?.floor || '—'}{tenant ? ' · Tenant ' + tenant.name : ''}</p>
    <div className="alert"><b>This cannot be undone.</b> Everything linked to this meter will be deleted: the meter and its permanent QR code, tenant details, all readings and meter photos, and the room if it becomes empty.
      {bills === null ? ' Checking bills…' : bills.length ? ` That includes ${bills.length} bill${bills.length === 1 ? '' : 's'} with their payments, PDFs and history.` : ' It has no bills.'}
      {open > 0 && ` ${open} of them ${open === 1 ? 'is' : 'are'} still open.`}</div>
    {people && people.remove.length > 0 && <div className="download-note"><b>Tenant details that will be deleted:</b> {people.remove.map(t => t.name + (t.phone ? ' (' + t.phone + ')' : '')).join(', ')}</div>}
    {people && people.keep.length > 0 && <div className="download-note"><b>Kept</b> because they currently live in another room: {people.keep.map(t => t.name).join(', ')}</div>}
    <ConfirmByTyping word={meter.meter_code} value={typed} onChange={setTyped} />
    {err && <div className="alert">{err}</div>}
    <div className="actions"><button className="secondary" onClick={onClose}>Cancel</button>
      <button className="danger" disabled={busy || bills === null || people === null || typed.trim() !== meter.meter_code} onClick={remove}><Trash2 size={16} />{busy ? 'Deleting…' : 'Delete meter'}</button></div>
  </Modal>;
}

function DeletePropertyModal({ property, onClose, onDone }) {
  const [typed, setTyped] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.from('properties').delete().eq('id', property.id);
    if (error) { setErr(error.message); setBusy(false); } else await onDone();
  };
  return <Modal title={'Delete ' + property.name + '?'} onClose={onClose}>
    <div className="alert"><b>This cannot be undone.</b> The property, its rooms, tenant records and billing settings will be removed.</div>
    <ConfirmByTyping word="DELETE" value={typed} onChange={setTyped} />
    {err && <div className="alert">{err}</div>}
    <div className="actions"><button className="secondary" onClick={onClose}>Cancel</button>
      <button className="danger" disabled={busy || typed.trim() !== 'DELETE'} onClick={remove}><Trash2 size={16} />{busy ? 'Deleting…' : 'Delete property'}</button></div>
  </Modal>;
}
