import { useCallback, useEffect, useState } from 'react';
import { Camera, Download, IndianRupee, LogOut, RefreshCw } from 'lucide-react';
import { EDGE_URL, PUBLIC_KEY } from './lib/supabase';
import { APP_NAME, DEFAULT_RATE, TAGLINE, UPI_ID, cleanPhone, fmt, kwh, money, upiLink } from './lib/format';
import { compressPhoto } from './lib/photo';
import { BrandMark, Info, StatusPill, ThemeToggle } from './ui';

const storageKey = token => 'meter_mobile_' + token;
const readSaved = token => { try { return sessionStorage.getItem(storageKey(token)) || ''; } catch { return ''; } };
const writeSaved = (token, mobile) => { try { mobile ? sessionStorage.setItem(storageKey(token), mobile) : sessionStorage.removeItem(storageKey(token)); } catch { /* not persisted */ } };

class PortalError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function portalRequest(token, mobile, options = {}) {
  let res;
  try {
    res = await fetch(EDGE_URL + '?token=' + encodeURIComponent(token), {
      ...options,
      // FormData bodies must let the browser set the multipart boundary.
      headers: { apikey: PUBLIC_KEY, 'x-meter-mobile': mobile, ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    });
  } catch {
    throw new PortalError('Could not reach the server. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({ error: 'Invalid server response' }));
  if (!res.ok) throw new PortalError(data.error || 'Request failed', res.status);
  return data;
}

export default function TenantAccess({ token }) {
  const [mobile, setMobile] = useState(() => readSaved(token));
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [initial, setInitial] = useState(null);

  const signOut = useCallback((message = '') => { writeSaved(token, ''); setMobile(''); setInitial(null); setError(message); }, [token]);

  const verify = async e => {
    e.preventDefault(); setError('');
    const m = cleanPhone(input);
    if (m.length < 10) { setError('Enter the full registered mobile number.'); return; }
    setChecking(true);
    try {
      const data = await portalRequest(token, m);
      writeSaved(token, m); setInitial(data); setMobile(m);
    } catch (err) { setError(err.message); } finally { setChecking(false); }
  };

  if (mobile) return <TenantPortal token={token} mobile={mobile} initial={initial} onSignOut={signOut} />;

  return <main className="center access page-fade-in"><div className="auth-shell">
    <div className="scan-top"><BrandMark /><ThemeToggle /></div>
    <form className="card login" onSubmit={verify}>
      <div className="eyebrow">Electricity account</div><h1>Meter access</h1>
      <p className="muted">Enter the mobile number your owner registered for this meter.</p>
      <input required inputMode="numeric" autoFocus type="tel" autoComplete="tel" placeholder="Registered mobile number" value={input} onChange={e => setInput(e.target.value)} />
      {error && <div className="alert">{error}</div>}
      <button disabled={checking}>{checking ? 'Checking…' : 'View electricity account'}</button>
      <p className="small muted" style={{ marginTop: 12 }}>No OTP or password needed. Wrong number? Ask your owner to update it.</p>
    </form>
    <p className="footer-note">{APP_NAME} · {TAGLINE}</p>
  </div></main>;
}

function TenantPortal({ token, mobile, initial, onSignOut }) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [reading, setReading] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pickPhoto = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMsg({ ok: false, text: 'Please take a photo of the meter.' }); return; }
    setMsg(null);
    const blob = await compressPhoto(file);
    setPhoto(blob);
    setPreview(URL.createObjectURL(blob));
  };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await portalRequest(token, mobile)); }
    catch (e) { if (e.status === 401 || e.status === 403) onSignOut(e.message); else setError(e.message); }
    finally { setLoading(false); }
  }, [token, mobile, onSignOut]);

  useEffect(() => { if (!initial) load(); }, [initial, load]);

  const submit = async () => {
    setMsg(null);
    const current = Number(reading);
    if (reading === '' || !Number.isFinite(current) || current < 0) { setMsg({ ok: false, text: 'Enter your current meter reading in kWh.' }); return; }
    if (data && current < Number(data.baseline_reading)) { setMsg({ ok: false, text: 'The reading cannot be below the last paid reading (' + kwh(data.baseline_reading) + ').' }); return; }
    if (!photo) { setMsg({ ok: false, text: 'Take a clear photo of the meter display first. The owner checks it before approving.' }); return; }
    setSubmitting(true);
    try {
      const body = new FormData();
      body.append('current_reading', String(current));
      body.append('photo', photo, 'meter.jpg');
      await portalRequest(token, mobile, { method: 'POST', body });
      setMsg({ ok: true, text: 'Reading and photo submitted. Your bill is waiting for owner approval.' });
      setReading(''); setPhoto(null); setPreview('');
      await load();
    } catch (e) {
      if (e.status === 401 || e.status === 403) onSignOut(e.message); else setMsg({ ok: false, text: e.message });
    } finally { setSubmitting(false); }
  };

  if (loading && !data) return <main className="center"><div className="card"><h2>Loading account…</h2></div></main>;
  if (error && !data) return <main className="center"><div className="auth-shell"><BrandMark /><div className="card login"><h1>Account unavailable</h1><p className="muted">{error}</p><button onClick={load}>Try again</button></div></div></main>;

  const m = data.meter, t = data.tenant, lp = data.last_payment;
  return <main className="scan page-fade-in"><div className="scan-inner">
    <div className="scan-top"><BrandMark /><div className="topbar-actions"><ThemeToggle /><button className="ghost" onClick={() => onSignOut('')} title="Leave this account" aria-label="Leave this account"><LogOut size={18} /></button></div></div>
    <section className="portal-card">
      <div className="portal-top"><div><div className="eyebrow">{data.property?.name || 'Electricity account'}</div><h1>{m.code}</h1><p className="muted">Room {data.room?.room_number || '—'} · Floor {data.room?.floor || '—'}</p></div><span className="pill green">Active</span></div>
      <div className="portal-grid">
        <Info a="Tenant" b={t?.name || '—'} /><Info a="Meter number" b={m.number || '—'} />
        <Info a="Last paid reading" b={kwh(data.baseline_reading)} /><Info a="Rate" b={money(data.billing_settings?.rate_per_unit ?? DEFAULT_RATE) + ' / kWh'} />
        <Info a="Last payment" b={lp ? money(lp.amount) : '—'} /><Info a="Payment date" b={lp ? fmt(lp.payment_date) : '—'} />
      </div>
      {data.pending && <div className="pending-box"><strong>{data.pending.status === 'APPROVED' ? 'Bill awaiting payment' : 'Bill waiting for owner approval'}</strong><span>{data.pending.bill_number} · {Number(data.pending.units || 0).toFixed(2)} kWh · {money(data.pending.total_amount)}</span></div>}
      {data.pending?.status === 'APPROVED' && <div className="pay-box">
        <div><strong>Pay {money(data.pending.total_amount)} by UPI</strong><span>UPI ID: <b className="mono">{UPI_ID}</b> · Ref {data.pending.bill_number}</span></div>
        <a className="button" href={upiLink(data.pending.total_amount, data.pending.bill_number)}><IndianRupee size={16} />Pay with UPI app</a>
        <p className="small muted">Or scan the payment QR on the bill PDF. The owner marks the bill paid once the money is received.</p>
      </div>}
      <div className="generate-box"><h2>Submit meter reading</h2>
        <p className="muted">1. Take a clear photo of the meter display. 2. Enter the current kWh reading. The date is captured automatically.</p>
        <label className={'photo-capture' + (preview ? ' has-photo' : '') + (data.pending ? ' disabled' : '')}>
          <input type="file" accept="image/*" capture="environment" onChange={pickPhoto} disabled={!!data.pending} />
          {preview ? <><img src={preview} alt="Meter photo to submit" /><span className="photo-retake"><RefreshCw size={14} />Retake photo</span></>
            : <><Camera size={28} /><strong>Capture meter photo</strong><span className="small muted">Required · make sure the reading is readable</span></>}
        </label>
        <input type="number" min={data.baseline_reading} step="0.001" inputMode="decimal" value={reading} onChange={e => setReading(e.target.value)} placeholder="Current kWh reading" disabled={!!data.pending} />
        <button disabled={submitting || !!data.pending || !photo} onClick={submit}>{submitting ? 'Uploading…' : data.pending ? 'Previous bill still open' : photo ? 'Submit reading' : 'Capture photo to continue'}</button>
        {msg && <div className={msg.ok ? 'success' : 'alert'}>{msg.text}</div>}
      </div>
      <section className="history"><div className="table-head"><h2>Last 6 bills</h2><span>Approved / paid</span></div>
        {data.bills.length === 0 ? <p className="muted" style={{ paddingTop: 12 }}>No approved bills yet.</p> : data.bills.map(b =>
          <div className="history-row" key={b.id}>
            <div><strong>{b.bill_number}</strong><small>{fmt(b.bill_date)} · {Number(b.units || 0).toFixed(2)} kWh</small></div>
            <div style={{ textAlign: 'right' }}><span className="amount">{money(b.total_amount)}</span><div style={{ marginTop: 4 }}><StatusPill status={b.status} /></div></div>
            {b.download_url ? <a className="button secondary sm" href={b.download_url}><Download size={14} />PDF</a> : <span className="muted small">PDF unavailable</span>}
          </div>)}
      </section>
    </section>
    <p className="footer-note">{APP_NAME} · {TAGLINE}. This is a property-managed bill, not an official utility bill.</p>
  </div></main>;
}
