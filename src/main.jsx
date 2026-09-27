import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import QRCode from 'qrcode';
import {supabase} from './lib/supabase';
import {createBillPdf,downloadBlob} from './lib/billPdf';
import './styles.css';

const SUPABASE_URL=import.meta.env.VITE_SUPABASE_URL||'https://ztsucnutfmlernqayqwx.supabase.co';
const PUBLIC_KEY=import.meta.env.VITE_SUPABASE_ANON_KEY||'sb_publishable_XHkcEEx_K1YoOOSDAJD_8Q_0kmd4VUq';
const baseUrl=location.origin+location.pathname;
const token=location.hash.startsWith('#/m/')?location.hash.split('/')[2]:null;
const edgeUrl=SUPABASE_URL+'/functions/v1/meter-portal';
const money=n=>\`₹\${Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})\`;
const fmt=d=>d?new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—';

async function portalRequest(q='',options={}){
 const res=await fetch(edgeUrl+q,{...options,headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json',...(options.headers||{})}});
 const data=await res.json().catch(()=>({error:'Invalid server response'}));
 if(!res.ok)throw Error(data.error||'Request failed');
 return data;
}

function App(){
 const [session,setSession]=useState(null),[loading,setLoading]=useState(true);
 useEffect(()=>{if(!supabase){setLoading(false);return}supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false)});const {data}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>data.subscription.unsubscribe()},[]);
 if(token)return <TenantPortal token={token}/>;
 if(loading)return <main className="center"><div className="card"><h1>Loading…</h1></div></main>;
 if(!supabase)return <main className="center"><div className="card"><h1>Setup required</h1></div></main>;
 return session?<OwnerApp/>:<Login/>;
}

function Login(){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[signup,setSignup]=useState(false),[msg,setMsg]=useState('');
 const submit=async e=>{e.preventDefault();setMsg('');const r=signup?await supabase.auth.signUp({email,password}):await supabase.auth.signInWithPassword({email,password});if(r.error)setMsg(r.error.message);else if(signup&&!r.data.session)setMsg('Check your email to confirm the account.')};
 return <main className="center"><form className="card login" onSubmit={submit}><div className="eyebrow">OWNER CONSOLE</div><h1>Electricity Bill Manager</h1><p className="muted">{signup?'Create the first administrator account.':'Administrator sign in.'}</p><input required type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}/><input required minLength="6" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}/>{msg&&<div className="alert">{msg}</div>}<button>{signup?'Create account':'Sign in'}</button><button type="button" className="secondary" onClick={()=>setSignup(!signup)}>{signup?'Sign in instead':'Create administrator'}</button></form></main>
}

function OwnerApp(){
 const [tab,setTab]=useState('dashboard'),[meters,setMeters]=useState([]),[bills,setBills]=useState([]),[settings,setSettings]=useState(null),[selected,setSelected]=useState(null),[modal,setModal]=useState(null),[busy,setBusy]=useState(true),[msg,setMsg]=useState('');
 const load=async()=>{setBusy(true);setMsg('');const [m,b,s]=await Promise.all([
  supabase.from('meters').select('id,property_id,meter_code,meter_number,meter_type,status,opening_reading,notes,public_token,rooms(floor,room_number),tenant_assignments(id,tenant_id,move_in_date,move_out_date,tenants(id,name,phone))').order('meter_code'),
  supabase.from('electricity_bills').select('*,meters(meter_code,meter_number,public_token),tenants(name,phone),bill_payments(payment_date,amount,payment_mode,receipt_no)').order('created_at',{ascending:false}).limit(100),
  supabase.from('billing_settings').select('*').limit(1).maybeSingle()
 ]);if(m.error||b.error||s.error)setMsg((m.error||b.error||s.error).message);setMeters(m.data||[]);setBills(b.data||[]);setSettings(s.data||null);setBusy(false)};
 useEffect(()=>{(async()=>{const {error}=await supabase.rpc('bootstrap_admin');if(error)setMsg(error.message);await load()})()},[]);
 const pending=bills.filter(b=>b.status==='PENDING_APPROVAL');
 return <main className="admin"><header><div><div className="eyebrow">OWNER CONSOLE</div><h1>Electricity Bill Manager</h1><p className="muted">QR-based billing, approval and six-month history.</p></div><button className="secondary" onClick={()=>supabase.auth.signOut()}>Sign out</button></header>
 <nav className="tabs"><button className={tab==='dashboard'?'active':''} onClick={()=>setTab('dashboard')}>Dashboard</button><button className={tab==='bills'?'active':''} onClick={()=>setTab('bills')}>Bills {pending.length>0&&<b>{pending.length}</b>}</button><button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}>Billing Settings</button></nav>
 {msg&&<div className="alert">{msg}</div>}
 {busy?<div className="card"><h2>Loading data…</h2></div>:tab==='dashboard'?<Dashboard meters={meters} bills={bills} onGenerate={m=>setModal({type:'generate',meter:m})} onOpen={m=>setSelected(m)}/>:tab==='bills'?<Bills bills={bills} onApprove={b=>setModal({type:'approve',bill:b})} onPaid={markPaid} onDownload={downloadStored}/>:<Settings settings={settings} onSaved={load}/>}
 {modal?.type==='generate'&&<GenerateModal meter={modal.meter} settings={settings} onClose={()=>setModal(null)} onDone={async()=>{setModal(null);await load()}}/>}
 {modal?.type==='approve'&&<ApproveModal bill={modal.bill} settings={settings} onClose={()=>setModal(null)} onDone={async()=>{setModal(null);await load()}}/>}
 </main>
}

function Dashboard({meters,bills,onGenerate,onOpen}){
 const pending=bills.filter(b=>b.status==='PENDING_APPROVAL').length,paid=bills.filter(b=>b.status==='PAID').length;
 return <><section className="stats"><div><b>{meters.length}</b><span>Meters</span></div><div><b>{meters.filter(m=>m.tenant_assignments?.some(a=>!a.move_out_date)).length}</b><span>Occupied</span></div><div><b>{pending}</b><span>Pending Approval</span></div><div><b>{paid}</b><span>Paid Bills</span></div></section><section className="table-card"><div className="table-head"><h2>Meter registry</h2><span>Permanent QR identity</span></div><div className="table">{meters.map(m=>{const a=m.tenant_assignments?.find(x=>!x.move_out_date);return <div className="row" key={m.id}><div><strong>{m.meter_code}</strong><small>Floor {m.rooms?.floor||'—'} · Room {m.rooms?.room_number||'—'}</small></div><div>{a?.tenants?.name||'Vacant'}</div><span className={'pill '+(a?'green':'')}>{a?'Occupied':'Vacant'}</span><button onClick={()=>onGenerate(m)}>Generate Bill</button><button className="icon-btn" onClick={()=>downloadQR(m)}>QR</button></div>})}</div></section></>
}

function Bills({bills,onApprove,onPaid,onDownload}){
 return <section className="table-card"><div className="table-head"><h2>Electricity bills</h2><span>Tenant submissions require approval</span></div><div className="bill-list">{bills.map(b=><div className="bill-card" key={b.id}><div><strong>{b.bill_number}</strong><small>{b.meters?.meter_code||'—'} · {b.tenants?.name||'Vacant'} · {fmt(b.bill_date)}</small></div><div><strong>{Number(b.units||0).toFixed(2)} units</strong><small>{money(b.total_amount)}</small></div><span className={'pill '+(b.status==='PAID'||b.status==='APPROVED'?'green':'')}>{b.status.replace('_',' ')}</span>{b.status==='PENDING_APPROVAL'?<button onClick={()=>onApprove(b)}>Review / Approve</button>:<><button onClick={()=>onDownload(b)}>Download PDF</button>{b.status==='APPROVED'&&<button onClick={()=>onPaid(b)}>Mark Paid</button>}</>}</div>)}</div></section>
}

function Settings({settings,onSaved}){
 const [rate,setRate]=useState(settings?.rate_per_unit||8),[fixed,setFixed]=useState(settings?.fixed_charge||0),[tax,setTax]=useState(settings?.tax_percent||0),[days,setDays]=useState(settings?.due_days||7),[msg,setMsg]=useState('');
 useEffect(()=>{if(settings){setRate(settings.rate_per_unit);setFixed(settings.fixed_charge);setTax(settings.tax_percent);setDays(settings.due_days)}},[settings]);
 const save=async e=>{e.preventDefault();const {error}=await supabase.from('billing_settings').update({rate_per_unit:Number(rate),fixed_charge:Number(fixed),tax_percent:Number(tax),due_days:Number(days)}).eq('property_id',settings.property_id);if(error)setMsg(error.message);else{setMsg('Settings saved.');onSaved()}};
 return <form className="card settings" onSubmit={save}><h2>Billing Settings</h2><p className="muted">These values are used for new bills. Existing bills retain their historical values.</p><label>Rate per unit (₹)<input type="number" step="0.01" value={rate} onChange={e=>setRate(e.target.value)}/></label><label>Fixed charge (₹)<input type="number" step="0.01" value={fixed} onChange={e=>setFixed(e.target.value)}/></label><label>Tax (%)<input type="number" step="0.001" value={tax} onChange={e=>setTax(e.target.value)}/></label><label>Due days<input type="number" value={days} onChange={e=>setDays(e.target.value)}/></label>{msg&&<div className="success">{msg}</div>}<button>Save billing settings</button></form>
}

function GenerateModal({meter,settings,onClose,onDone}){
 const paidBaseline=''; const [reading,setReading]=useState(''),[saving,setSaving]=useState(false),[err,setErr]=useState('');
 const save=async()=>{setSaving(true);setErr('');try{const {data:paid}=await supabase.from('electricity_bills').select('current_reading').eq('meter_id',meter.id).eq('status','PAID').order('bill_date',{ascending:false}).limit(1).maybeSingle();const previous=Number(paid?.current_reading??meter.opening_reading??0);const current=Number(reading);if(!Number.isFinite(current)||current<previous)throw Error(\`Current reading must be at least \${previous}.\`);const rate=Number(settings?.rate_per_unit||0),fixed=Number(settings?.fixed_charge||0),taxP=Number(settings?.tax_percent||0),units=current-previous,energy=units*rate,tax=(energy+fixed)*taxP/100,total=energy+fixed+tax;const tenant=meter.tenant_assignments?.find(a=>!a.move_out_date)?.tenants||null;const {data:b,error}=await supabase.from('electricity_bills').insert({property_id:meter.property_id,meter_id:meter.id,tenant_id:tenant?.id||null,bill_number:'EB-'+Date.now().toString(36).toUpperCase(),bill_date:new Date().toISOString().slice(0,10),reading_date:new Date().toISOString().slice(0,10),previous_reading:previous,current_reading:current,rate_per_unit:rate,energy_charge:energy,fixed_charge:fixed,other_charge:0,tax_amount:tax,total_amount:total,status:'APPROVED',source:'OWNER',approved_at:new Date().toISOString(),approved_by:(await supabase.auth.getUser()).data.user.id}).select('*').single();if(error)throw error;const ctx={property:{name:'Property'},meter:{code:meter.meter_code,number:meter.meter_number,type:meter.meter_type},room:meter.rooms,tenant};const blob=await createBillPdf(b,ctx,baseUrl+'#/m/'+meter.public_token);const path=\`\${meter.property_id}/\${meter.id}/\${b.id}.pdf\`;const up=await supabase.storage.from('electricity-bills').upload(path,blob,{contentType:'application/pdf',upsert:false});if(up.error)throw up.error;await supabase.from('electricity_bills').update({pdf_path:path}).eq('id',b.id);downloadBlob(blob,b.bill_number+'.pdf');await onDone()}catch(e){setErr(e.message||'Could not generate bill')}finally{setSaving(false)}};
 return <Modal title={'Generate bill · '+meter.meter_code} onClose={onClose}><p className="muted">Bill date will be today automatically. Previous reading is taken from the latest paid bill.</p><label>Current reading<input autoFocus type="number" step="0.001" value={reading} onChange={e=>setReading(e.target.value)} placeholder="Enter current meter reading"/></label>{err&&<div className="alert">{err}</div>}<div className="actions"><button className="secondary" onClick={onClose}>Cancel</button><button disabled={saving} onClick={save}>{saving?'Generating…':'Generate & Download'}</button></div></Modal>
}

function ApproveModal({bill,settings,onClose,onDone}){
 const [reading,setReading]=useState(bill.current_reading),[rate,setRate]=useState(bill.rate_per_unit),[fixed,setFixed]=useState(bill.fixed_charge),[tax,setTax]=useState(settings?.tax_percent||0),[saving,setSaving]=useState(false),[err,setErr]=useState('');
 const approve=async()=>{setSaving(true);setErr('');try{const current=Number(reading),previous=Number(bill.previous_reading),r=Number(rate),f=Number(fixed),t=Number(tax);if(current<previous)throw Error('Current reading cannot be below previous reading.');const units=current-previous,energy=units*r,taxAmt=(energy+f)*t/100,total=energy+f+taxAmt;const user=(await supabase.auth.getUser()).data.user;const final={...bill,current_reading:current,rate_per_unit:r,fixed_charge:f,energy_charge:energy,tax_amount:taxAmt,total_amount:total,status:'APPROVED',approved_at:new Date().toISOString(),approved_by:user.id};const {data:b,error}=await supabase.from('electricity_bills').update({current_reading:current,rate_per_unit:r,fixed_charge:f,energy_charge:energy,tax_amount:taxAmt,total_amount:total,status:'APPROVED',approved_at:final.approved_at,approved_by:user.id}).eq('id',bill.id).select('*').single();if(error)throw error;const tenant=bill.tenants||null;const ctx={property:{name:'Property'},meter:{code:bill.meters?.meter_code,number:bill.meters?.meter_number},room:{room_number:'—',floor:'—'},tenant};const blob=await createBillPdf(b,ctx,baseUrl+'#/m/'+bill.meters?.public_token);const path=\`\${bill.property_id}/\${bill.meter_id}/\${bill.id}.pdf\`;const up=await supabase.storage.from('electricity-bills').upload(path,blob,{contentType:'application/pdf',upsert:true});if(up.error)throw up.error;await supabase.from('electricity_bills').update({pdf_path:path}).eq('id',bill.id);await supabase.from('bill_events').insert({bill_id:bill.id,event_type:'OWNER_APPROVED',actor_user_id:user.id,new_values:{current_reading:current,rate_per_unit:r,fixed_charge:f,tax_percent:t,total_amount:total}});await onDone()}catch(e){setErr(e.message||'Approval failed')}finally{setSaving(false)}};
 return <Modal title={'Review bill · '+bill.bill_number} onClose={onClose}><div className="mini-summary"><span>Previous reading <b>{bill.previous_reading}</b></span><span>Tenant <b>{bill.tenants?.name||'—'}</b></span></div><label>Current reading<input type="number" step="0.001" value={reading} onChange={e=>setReading(e.target.value)}/></label><label>Rate per unit<input type="number" step="0.01" value={rate} onChange={e=>setRate(e.target.value)}/></label><label>Fixed charge<input type="number" step="0.01" value={fixed} onChange={e=>setFixed(e.target.value)}/></label><label>Tax %<input type="number" step="0.001" value={tax} onChange={e=>setTax(e.target.value)}/></label>{err&&<div className="alert">{err}</div>}<div className="actions"><button className="secondary" onClick={onClose}>Cancel</button><button disabled={saving} onClick={approve}>{saving?'Approving…':'Approve & Create PDF'}</button></div></Modal>
}

function Modal({title,onClose,children}){return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h2>{title}</h2><button onClick={onClose}>×</button></div>{children}</div></div>}

async function markPaid(b){const amount=prompt('Payment amount',String(b.total_amount));if(amount===null)return;const mode=prompt('Payment mode','UPI');if(mode===null)return;const {error}=await supabase.from('bill_payments').insert({bill_id:b.id,amount:Number(amount),payment_mode:mode,payment_date:new Date().toISOString().slice(0,10)});if(!error)await supabase.from('electricity_bills').update({status:'PAID'}).eq('id',b.id);location.reload()}
async function downloadStored(b){if(!b.pdf_path)return alert('PDF is not available yet.');const {data,error}=await supabase.storage.from('electricity-bills').createSignedUrl(b.pdf_path,300,{download:b.bill_number+'.pdf'});if(error)return alert(error.message);location.href=data.signedUrl}
async function downloadQR(m){const data=await QRCode.toDataURL(baseUrl+'#/m/'+m.public_token,{width:900,margin:2,errorCorrectionLevel:'H'});const a=document.createElement('a');a.href=data;a.download=m.meter_code+'-qr.png';a.click()}

function TenantPortal({token}){
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reading,setReading]=useState(''),[submitting,setSubmitting]=useState(false),[msg,setMsg]=useState('');
 const load=async()=>{setLoading(true);try{setData(await portalRequest('?token='+encodeURIComponent(token)))}catch(e){setError(e.message)}finally{setLoading(false)}};useEffect(()=>{load()},[token]);
 const submit=async()=>{setSubmitting(true);setMsg('');try{const r=await portalRequest('?token='+encodeURIComponent(token),{method:'POST',body:JSON.stringify({current_reading:Number(reading)})});setMsg('Bill submitted successfully. It is waiting for owner approval.');setReading('');await load()}catch(e){setMsg(e.message)}finally{setSubmitting(false)}};
 if(loading)return <main className="center"><div className="card"><h1>Loading account…</h1></div></main>;
 if(error||!data)return <main className="center"><div className="card"><h1>Meter not found</h1><p>{error||'This QR is not active.'}</p></div></main>;
 const m=data.meter,a=data.tenant,lp=data.last_payment;
 return <main className="scan"><div className="brand">{data.property?.name||'Electricity Account'}</div><section className="portal-card"><div className="portal-top"><div><div className="eyebrow">ELECTRICITY ACCOUNT</div><h1>{m.code}</h1><p className="muted">Room {data.room?.room_number||'—'} · Floor {data.room?.floor||'—'}</p></div><span className="pill green">Active</span></div><div className="portal-grid"><Info a="Tenant" b={a?.name||'Vacant'}/><Info a="Meter" b={m.number||'—'}/><Info a="Last paid reading" b={data.baseline_reading}/><Info a="Last payment" b={lp?money(lp.amount):'—'}/><Info a="Payment date" b={lp?fmt(lp.payment_date):'—'}/><Info a="Rate" b={money(data.billing_settings?.rate_per_unit||0)+'/ unit'}/></div>{data.pending&&<div className="pending-box"><strong>Bill pending owner approval</strong><span>{data.pending.bill_number} · {money(data.pending.total_amount)}</span></div>}<div className="generate-box"><h2>Generate Electricity Bill</h2><p className="muted">Enter only the current meter reading. The bill date is captured automatically.</p><input type="number" step="0.001" value={reading} onChange={e=>setReading(e.target.value)} placeholder="Current meter reading"/><button disabled={submitting||!!data.pending} onClick={submit}>{submitting?'Submitting…':'Generate Bill'}</button>{msg&&<div className={msg.includes('successfully')?'success':'alert'}>{msg}</div>}</div><section className="history"><div className="table-head"><h2>Last 6 Bills</h2><span>Approved / paid only</span></div>{data.bills.length===0?<p className="muted">No approved bills yet.</p>:data.bills.map(b=><div className="history-row" key={b.id}><div><strong>{b.bill_number}</strong><small>{fmt(b.bill_date)} · {Number(b.units||0).toFixed(2)} units</small></div><strong>{money(b.total_amount)}</strong>{b.download_url?<a className="button" href={b.download_url}>Download PDF</a>:<span className="muted">PDF pending</span>}</div>)}</section></section></main>
}
function Info({a,b}){return <div className="info"><span>{a}</span><strong>{b}</strong></div>}
createRoot(document.getElementById('root')).render(<App/>);