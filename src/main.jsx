import React,{useEffect,useState} from 'react';
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
const money=n=>`₹${Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})`;
const fmt=d=>d?new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—';
const cleanPhone=v=>String(v||'').replace(/\D/g,'');

async function portalRequest(q='',options={}){
 const res=await fetch(edgeUrl+q,{...options,headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json',...(options.headers||{})}});
 const data=await res.json().catch(()=>({error:'Invalid server response'}));
 if(!res.ok)throw Error(data.error||'Request failed');
 return data;
}

function App(){
 const [session,setSession]=useState(null),[loading,setLoading]=useState(true);
 useEffect(()=>{supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false)});const {data}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>data.subscription.unsubscribe()},[]);
 if(token)return <TenantAccess token={token}/>;
 if(loading)return <main className="center"><div className="card"><h1>Loading…</h1></div></main>;
 return session?<OwnerApp/>:<Login/>;
}

function Login(){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[signup,setSignup]=useState(false),[msg,setMsg]=useState('');
 const submit=async e=>{e.preventDefault();setMsg('');const r=signup?await supabase.auth.signUp({email,password}):await supabase.auth.signInWithPassword({email,password});if(r.error)setMsg(r.error.message);else if(signup&&!r.data.session)setMsg('Check your email to confirm the administrator account.')};
 return <main className="center"><form className="card login" onSubmit={submit}><div className="eyebrow">OWNER CONSOLE</div><h1>Electricity Bill Manager</h1><p className="muted">{signup?'Create the administrator account.':'Administrator sign in.'}</p><input required type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}/><input required minLength="6" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}/>{msg&&<div className="alert">{msg}</div>}<button>{signup?'Create account':'Sign in'}</button><button type="button" className="secondary" onClick={()=>setSignup(!signup)}>{signup?'Sign in instead':'Create administrator'}</button></form></main>
}

function OwnerApp(){
 const [tab,setTab]=useState('dashboard'),[meters,setMeters]=useState([]),[bills,setBills]=useState([]),[settings,setSettings]=useState(null),[modal,setModal]=useState(null),[busy,setBusy]=useState(true),[msg,setMsg]=useState('');
 const load=async()=>{setBusy(true);setMsg('');const [m,b,s]=await Promise.all([
  supabase.from('meters').select('id,property_id,room_id,meter_code,meter_number,status,opening_reading,notes,public_token,rooms(floor,room_number),properties(name,address),tenant_assignments(id,tenant_id,move_in_date,move_out_date,tenants(id,name,phone,notes))').order('meter_code'),
  supabase.from('electricity_bills').select('*,meters(meter_code,meter_number,public_token,rooms(floor,room_number),properties(name,address)),tenants(name,phone),bill_payments(payment_date,amount,payment_mode,receipt_no)').order('created_at',{ascending:false}).limit(100),
  supabase.from('billing_settings').select('*').limit(1).maybeSingle()
 ]);if(m.error||b.error||s.error)setMsg((m.error||b.error||s.error).message);setMeters(m.data||[]);setBills(b.data||[]);setSettings(s.data||{rate_per_unit:10,fixed_charge:0,tax_percent:0,due_days:7});setBusy(false)};
 useEffect(()=>{(async()=>{const {error}=await supabase.rpc('bootstrap_admin');if(error)setMsg(error.message);await load()})()},[]);
 const pending=bills.filter(b=>b.status==='PENDING_APPROVAL');
 return <main className="admin"><header><div><div className="eyebrow">OWNER CONSOLE</div><h1>Electricity Bill Manager</h1><p className="muted">Electricity billing, meter readings and tenant management.</p></div><button className="secondary" onClick={()=>supabase.auth.signOut()}>Sign out</button></header>
 <nav className="tabs"><button className={tab==='dashboard'?'active':''} onClick={()=>setTab('dashboard')}>Meters</button><button className={tab==='tenants'?'active':''} onClick={()=>setTab('tenants')}>Tenants</button><button className={tab==='bills'?'active':''} onClick={()=>setTab('bills')}>Bills {pending.length>0&&<b>{pending.length}</b>}</button><button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}>Billing Settings</button></nav>
 {msg&&<div className="alert">{msg}</div>}
 {busy?<div className="card"><h2>Loading data…</h2></div>:tab==='dashboard'?<Dashboard meters={meters} bills={bills} settings={settings} onGenerate={m=>setModal({type:'generate',meter:m})} onEditTenant={m=>setModal({type:'tenant',meter:m})} onOpenRoom={m=>setModal({type:'room',meter:m})}/>:tab==='tenants'?<TenantManager meters={meters} onEdit={m=>setModal({type:'tenant',meter:m})}/>:tab==='bills'?<Bills bills={bills} onApprove={b=>setModal({type:'approve',bill:b})} onPaid={markPaid} onDownload={downloadStored}/>:<Settings settings={settings} onSaved={load}/>}
 {modal?.type==='generate'&&<GenerateModal meter={modal.meter} settings={settings} onClose={()=>setModal(null)} onDone={async()=>{setModal(null);await load()}}/>}
 {modal?.type==='approve'&&<ApproveModal bill={modal.bill} settings={settings} onClose={()=>setModal(null)} onDone={async()=>{setModal(null);await load()}}/>}
 {modal?.type==='tenant'&&<TenantModal meter={modal.meter} onClose={()=>setModal(null)} onDone={async()=>{setModal(null);await load()}}/>}
 {modal?.type==='room'&&<RoomDetailsModal meter={modal.meter} bills={bills} settings={settings} onClose={()=>setModal(null)}/>}
 </main>
}

function Dashboard({meters,bills,settings,onGenerate,onEditTenant,onOpenRoom}){
 const pending=bills.filter(b=>b.status==='PENDING_APPROVAL').length,paid=bills.filter(b=>b.status==='PAID').length;
 return <><section className="stats"><div><b>{meters.length}</b><span>Meters</span></div><div><b>{meters.filter(m=>m.tenant_assignments?.some(a=>!a.move_out_date)).length}</b><span>Occupied</span></div><div><b>{pending}</b><span>Pending Approval</span></div><div><b>{paid}</b><span>Paid Bills</span></div></section><section className="table-card"><div className="table-head"><h2>Meter registry</h2><span>All readings are kWh</span></div><div className="table">{meters.map(m=>{const a=m.tenant_assignments?.find(x=>!x.move_out_date);return <div className="row" key={m.id}><div><button className="link-btn" onClick={()=>onOpenRoom(m)} title="Open room details"><strong>{m.meter_code}</strong><small>Floor {m.rooms?.floor||'—'} · Room {m.rooms?.room_number||'—'}</small></button></div><div><strong>{a?.tenants?.name||'Vacant'}</strong><small>{a?.tenants?.phone||'No mobile registered'}</small></div><span className={'pill '+(a?'green':'')}>{a?'Occupied':'Vacant'}</span><button onClick={()=>onGenerate(m)}>Generate Bill</button><button className="secondary" onClick={()=>onEditTenant(m)}>Edit Tenant</button><button className="icon-btn" onClick={()=>onOpenRoom(m)} title="Open room details">↗ Room</button><button className="icon-btn" onClick={()=>downloadQR(m,'png')}>QR PNG</button><button className="icon-btn" onClick={()=>downloadQR(m,'pdf')}>QR PDF</button></div>})}</div></section></>
}

function RoomDetailsModal({meter,bills,settings,onClose}){
 const active=meter.tenant_assignments?.find(a=>!a.move_out_date),tenant=active?.tenants||null;
 const roomBills=bills.filter(b=>b.meter_id===meter.id).sort((a,b)=>new Date(b.bill_date)-new Date(a.bill_date));
 const lastPaid=roomBills.find(b=>b.status==='PAID');
 return <Modal title={'Room '+(meter.rooms?.room_number||'—')+' · '+meter.meter_code} onClose={onClose}>
  <div className="room-detail-head"><div><div className="eyebrow">CURRENT ROOM SNAPSHOT</div><h3>{tenant?.name||'Vacant'}</h3><p className="muted">{meter.properties?.name||'Property'} · Floor {meter.rooms?.floor||'—'} · Room {meter.rooms?.room_number||'—'}</p></div><button className="download-arrow" title="Download complete current tenant data PDF" aria-label="Download complete current tenant data PDF" onClick={()=>downloadTenantSnapshotPdf(meter,bills,settings)}>↓</button></div>
  <div className="portal-grid">
   <Info a="Tenant ID" b={tenant?.id||'—'}/><Info a="Tenant name" b={tenant?.name||'Vacant'}/><Info a="Registered mobile" b={tenant?.phone||'—'}/><Info a="Tenant notes" b={tenant?.notes||'—'}/>
   <Info a="Move-in date" b={active?.move_in_date?fmt(active.move_in_date):'—'}/><Info a="Move-out date" b={active?.move_out_date?fmt(active.move_out_date):'Active'}/><Info a="Meter number" b={meter.meter_number||'—'}/><Info a="Meter code" b={meter.meter_code}/>
   <Info a="Rate" b={money(settings?.rate_per_unit||10)+' / kWh'}/><Info a="Last paid reading" b={lastPaid?.current_reading!=null?Number(lastPaid.current_reading).toFixed(3)+' kWh':Number(meter.opening_reading||0).toFixed(3)+' kWh'}/><Info a="Last paid amount" b={lastPaid?money(lastPaid.total_amount):'—'}/><Info a="Last payment date" b={lastPaid?fmt(lastPaid.bill_date):'—'}/>
  </div>
  <div className="download-note">The download arrow creates a separate PDF snapshot of the tenant and room data exactly as it exists now, with the permanent access code on the final page.</div>
  <div className="actions"><button className="secondary" onClick={onClose}>Close</button><button onClick={()=>downloadTenantSnapshotPdf(meter,bills,settings)}>↓ Download Tenant Data PDF</button></div>
 </Modal>
}
function TenantManager({meters,onEdit}){
 return <section className="table-card"><div className="table-head"><h2>Tenant details</h2><span>Owner-controlled</span></div><div className="table">{meters.map(m=>{const a=m.tenant_assignments?.find(x=>!x.move_out_date);return <div className="row tenant-row" key={m.id}><div><strong>{a?.tenants?.name||'Vacant'}</strong><small>{a?.tenants?.phone||'No registered mobile'}</small></div><div>Room {m.rooms?.room_number||'—'}<small>Floor {m.rooms?.floor||'—'} · Meter {m.meter_code}</small></div><span className="pill">{a?'Assigned':'Unassigned'}</span><button onClick={()=>onEdit(m)}>{a?'Edit Tenant':'Assign Tenant'}</button></div>})}</div></section>
}

function TenantModal({meter,onClose,onDone}){
 const active=meter.tenant_assignments?.find(a=>!a.move_out_date),[name,setName]=useState(active?.tenants?.name||''),[phone,setPhone]=useState(active?.tenants?.phone||''),[notes,setNotes]=useState(active?.tenants?.notes||''),[saving,setSaving]=useState(false),[err,setErr]=useState('');
 const save=async()=>{setSaving(true);setErr('');try{if(!name.trim())throw Error('Tenant name is required.');const normalized=cleanPhone(phone);if(normalized.length<10)throw Error('Enter a valid registered mobile number.');if(active){const {error}=await supabase.from('tenants').update({name:name.trim(),phone:normalized,notes:notes.trim()||null}).eq('id',active.tenant_id);if(error)throw error}else{const {data:t,error}=await supabase.from('tenants').insert({property_id:meter.property_id,name:name.trim(),phone:normalized,notes:notes.trim()||null}).select('id').single();if(error)throw error;const {error:e}=await supabase.from('tenant_assignments').insert({meter_id:meter.id,room_id:meter.room_id||null,tenant_id:t.id,move_in_date:new Date().toISOString().slice(0,10)});if(e)throw e}await onDone()}catch(e){setErr(e.message||'Could not save tenant')}finally{setSaving(false)}};
 return <Modal title={(active?'Edit':'Assign')+' tenant · '+meter.meter_code} onClose={onClose}><p className="muted">The owner controls the tenant name and the registered mobile number used to access this meter's electricity portal.</p><label>Tenant name<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Tenant full name"/></label><label>Registered mobile number<input inputMode="numeric" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="10-digit mobile number"/></label><label>Notes<textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional notes"/></label>{err&&<div className="alert">{err}</div>}<div className="actions"><button className="secondary" onClick={onClose}>Cancel</button><button disabled={saving} onClick={save}>{saving?'Saving…':'Save tenant'}</button></div></Modal>
}

function Bills({bills,onApprove,onPaid,onDownload}){
 return <section className="table-card"><div className="table-head"><h2>Electricity bills</h2><span>Tenant submissions require approval</span></div><div className="bill-list">{bills.map(b=><div className="bill-card" key={b.id}><div><strong>{b.bill_number}</strong><small>{b.meters?.meter_code||'—'} · {b.tenants?.name||'Vacant'} · {fmt(b.bill_date)}</small></div><div><strong>{Number(b.units||0).toFixed(2)} kWh</strong><small>{money(b.total_amount)}</small></div><span className={'pill '+(b.status==='PAID'||b.status==='APPROVED'?'green':'')}>{b.status.replace('_',' ')}</span>{b.status==='PENDING_APPROVAL'?<button onClick={()=>onApprove(b)}>Review / Approve</button>:<><button onClick={()=>onDownload(b)}>Download PDF</button>{b.status==='APPROVED'&&<button onClick={()=>onPaid(b)}>Mark Paid</button>}</>}</div>)}</div></section>
}

function Settings({settings,onSaved}){
 const [rate,setRate]=useState(settings?.rate_per_unit??10),[msg,setMsg]=useState('');
 useEffect(()=>{if(settings)setRate(settings.rate_per_unit??10)},[settings]);
 const save=async e=>{e.preventDefault();const value=Number(rate);if(!Number.isFinite(value)||value<0){setMsg('Enter a valid rate.');return}const {error}=await supabase.from('billing_settings').update({rate_per_unit:value,fixed_charge:0,tax_percent:0}).eq('property_id',settings.property_id);if(error)setMsg(error.message);else{setMsg('Rate saved.');onSaved()}};
 return <form className="card settings" onSubmit={save}><h2>Electricity Rate</h2><p className="muted">Only kWh consumption is used. The current default is ₹10 per kWh.</p><label>Rate per unit (₹)<input type="number" min="0" step="0.01" value={rate} onChange={e=>setRate(e.target.value)}/></label>{msg&&<div className="success">{msg}</div>}<button>Save rate</button></form>
}

function GenerateModal({meter,settings,onClose,onDone}){
 const [reading,setReading]=useState(''),[saving,setSaving]=useState(false),[err,setErr]=useState('');
 const save=async()=>{setSaving(true);setErr('');try{const {data:paid}=await supabase.from('electricity_bills').select('current_reading').eq('meter_id',meter.id).eq('status','PAID').order('bill_date',{ascending:false}).limit(1).maybeSingle();const previous=Number(paid?.current_reading??meter.opening_reading??0),current=Number(reading),rate=Number(settings?.rate_per_unit??10);if(!Number.isFinite(current)||current<previous)throw Error(`Current kWh reading must be at least ${previous}.`);const units=current-previous,energy=units*rate;const user=(await supabase.auth.getUser()).data.user;const tenant=meter.tenant_assignments?.find(a=>!a.move_out_date)?.tenants||null;const {data:b,error}=await supabase.from('electricity_bills').insert({property_id:meter.property_id,meter_id:meter.id,tenant_id:tenant?.id||null,bill_number:'EB-'+Date.now().toString(36).toUpperCase(),bill_date:new Date().toISOString().slice(0,10),reading_date:new Date().toISOString().slice(0,10),previous_reading:previous,current_reading:current,rate_per_unit:rate,energy_charge:energy,fixed_charge:0,other_charge:0,tax_amount:0,total_amount:energy,status:'APPROVED',source:'OWNER',approved_at:new Date().toISOString(),approved_by:user.id}).select('*').single();if(error)throw error;const {data:history}=await supabase.from('electricity_bills').select('*').eq('meter_id',meter.id).in('status',['APPROVED','PAID']).order('bill_date',{ascending:false}).limit(6);const ctx={property:meter.properties||{name:'Property'},meter:{code:meter.meter_code,number:meter.meter_number},room:meter.rooms,tenant,history:history||[]};const blob=await createBillPdf(b,ctx,baseUrl+'#/m/'+meter.public_token);const path=`${meter.property_id}/${meter.id}/${b.id}.pdf`;const up=await supabase.storage.from('electricity-bills').upload(path,blob,{contentType:'application/pdf',upsert:false});if(up.error)throw up.error;await supabase.from('electricity_bills').update({pdf_path:path}).eq('id',b.id);downloadBlob(blob,b.bill_number+'.pdf');await onDone()}catch(e){setErr(e.message||'Could not generate bill')}finally{setSaving(false)}};
 return <Modal title={'Generate bill · '+meter.meter_code} onClose={onClose}><p className="muted">Bill date is today automatically. Previous reading comes from the latest paid bill.</p><label>Current kWh reading<input autoFocus type="number" min={0} step="0.001" value={reading} onChange={e=>setReading(e.target.value)} placeholder="Enter current kWh reading"/></label>{err&&<div className="alert">{err}</div>}<div className="actions"><button className="secondary" onClick={onClose}>Cancel</button><button disabled={saving} onClick={save}>{saving?'Generating…':'Generate & Download'}</button></div></Modal>
}

function ApproveModal({bill,settings,onClose,onDone}){
 const [reading,setReading]=useState(bill.current_reading),[rate,setRate]=useState(bill.rate_per_unit||settings?.rate_per_unit||10),[saving,setSaving]=useState(false),[err,setErr]=useState('');
 const approve=async()=>{setSaving(true);setErr('');try{const current=Number(reading),previous=Number(bill.previous_reading),r=Number(rate);if(current<previous)throw Error('Current kWh reading cannot be below previous reading.');const units=current-previous,energy=units*r,user=(await supabase.auth.getUser()).data.user;const {data:b,error}=await supabase.from('electricity_bills').update({current_reading:current,rate_per_unit:r,energy_charge:energy,fixed_charge:0,other_charge:0,tax_amount:0,total_amount:energy,status:'APPROVED',approved_at:new Date().toISOString(),approved_by:user.id}).eq('id',bill.id).select('*').single();if(error)throw error;const {data:history}=await supabase.from('electricity_bills').select('*').eq('meter_id',bill.meter_id).in('status',['APPROVED','PAID']).order('bill_date',{ascending:false}).limit(6);const ctx={property:bill.meters?.properties||{name:'Property'},meter:{code:bill.meters?.meter_code,number:bill.meters?.meter_number},room:bill.meters?.rooms||{room_number:'—',floor:'—'},tenant:bill.tenants,history:history||[]};const blob=await createBillPdf(b,ctx,baseUrl+'#/m/'+bill.meters?.public_token);const path=`${bill.property_id}/${bill.meter_id}/${bill.id}.pdf`;const up=await supabase.storage.from('electricity-bills').upload(path,blob,{contentType:'application/pdf',upsert:true});if(up.error)throw up.error;await supabase.from('electricity_bills').update({pdf_path:path}).eq('id',bill.id);await supabase.from('bill_events').insert({bill_id:bill.id,event_type:'OWNER_APPROVED',actor_user_id:user.id,new_values:{current_reading:current,rate_per_unit:r,total_amount:energy}});await onDone()}catch(e){setErr(e.message||'Approval failed')}finally{setSaving(false)}};
 return <Modal title={'Review bill · '+bill.bill_number} onClose={onClose}><div className="mini-summary"><span>Previous reading <b>{bill.previous_reading} kWh</b></span><span>Tenant <b>{bill.tenants?.name||'—'}</b></span></div><label>Current kWh reading<input type="number" min={0} step="0.001" value={reading} onChange={e=>setReading(e.target.value)}/></label><label>Rate per kWh<input type="number" min={0} step="0.01" value={rate} onChange={e=>setRate(e.target.value)}/></label>{err&&<div className="alert">{err}</div>}<div className="actions"><button className="secondary" onClick={onClose}>Cancel</button><button disabled={saving} onClick={approve}>{saving?'Approving…':'Approve & Create PDF'}</button></div></Modal>
}

function TenantAccess({token}){
 const [mobile,setMobile]=useState(''),[verified,setVerified]=useState(false),[error,setError]=useState('');
 const verify=async e=>{e.preventDefault();setError('');try{await portalRequest('?token='+encodeURIComponent(token)+'&mobile='+encodeURIComponent(cleanPhone(mobile)));sessionStorage.setItem('meter_mobile_'+token,cleanPhone(mobile));setVerified(true)}catch(e){setError('The registered mobile number does not match this meter.')}};
 if(verified)return <TenantPortal token={token} mobile={cleanPhone(mobile)}/>;
 const saved=sessionStorage.getItem('meter_mobile_'+token);
 if(saved){return <TenantPortal token={token} mobile={saved}/>;}
 return <main className="center access"><form className="card login" onSubmit={verify}><div className="eyebrow">ELECTRICITY BILL</div><h1>Meter Access</h1><p className="muted">Enter the mobile number registered by the owner for this meter.</p><input required inputMode="numeric" autoFocus type="tel" placeholder="Registered mobile number" value={mobile} onChange={e=>setMobile(e.target.value)}/>{error&&<div className="alert">{error}</div>}<button>View Electricity Account</button><p className="small muted">No OTP or password is required.</p></form></main>
}

function TenantPortal({token,mobile}){
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reading,setReading]=useState(''),[submitting,setSubmitting]=useState(false),[msg,setMsg]=useState('');
 const load=async()=>{setLoading(true);try{setData(await portalRequest('?token='+encodeURIComponent(token)+'&mobile='+encodeURIComponent(mobile)))}catch(e){setError(e.message)}finally{setLoading(false)}};useEffect(()=>{load()},[token,mobile]);
 const submit=async()=>{setSubmitting(true);setMsg('');try{await portalRequest('?token='+encodeURIComponent(token),{method:'POST',body:JSON.stringify({current_reading:Number(reading),mobile})});setMsg('Bill submitted. It is waiting for owner approval.');setReading('');await load()}catch(e){setMsg(e.message)}finally{setSubmitting(false)}};
 if(loading)return <main className="center"><div className="card"><h1>Loading account…</h1></div></main>;
 if(error||!data)return <main className="center"><div className="card"><h1>Account unavailable</h1><p>{error||'This meter is not active.'}</p></div></main>;
 const m=data.meter,a=data.tenant,lp=data.last_payment;
 return <main className="scan"><div className="brand">{data.property?.name||'Electricity Bill'}</div><section className="portal-card"><div className="portal-top"><div><div className="eyebrow">ELECTRICITY ACCOUNT</div><h1>{m.code}</h1><p className="muted">Room {data.room?.room_number||'—'} · Floor {data.room?.floor||'—'}</p></div><span className="pill green">Active</span></div><div className="portal-grid"><Info a="Tenant" b={a?.name||'—'}/><Info a="Meter Number" b={m.number||'—'}/><Info a="Last paid reading" b={data.baseline_reading+' kWh'}/><Info a="Last paid amount" b={lp?money(lp.amount):'—'}/><Info a="Payment date" b={lp?fmt(lp.payment_date):'—'}/><Info a="Rate" b={money(data.billing_settings?.rate_per_unit||10)+'/ kWh'}/></div>{data.pending&&<div className="pending-box"><strong>{data.pending.status==='APPROVED'?'Bill awaiting payment':'Bill waiting for owner approval'}</strong><span>{data.pending.bill_number} · {Number(data.pending.units||0).toFixed(2)} kWh · {money(data.pending.total_amount)}</span></div>}<div className="generate-box"><h2>Generate Electricity Bill</h2><p className="muted">Enter only the current kWh reading. The date is captured automatically.</p><input type="number" min={0} step="0.001" value={reading} onChange={e=>setReading(e.target.value)} placeholder="Current kWh reading"/><button disabled={submitting||!!data.pending} onClick={submit}>{submitting?'Submitting…':'Generate Bill'}</button>{msg&&<div className={msg.includes('submitted')?'success':'alert'}>{msg}</div>}</div><section className="history"><div className="table-head"><h2>Last 6 Bills</h2><span>Approved / paid</span></div>{data.bills.length===0?<p className="muted">No approved bills yet.</p>:data.bills.map(b=><div className="history-row" key={b.id}><div><strong>{b.bill_number}</strong><small>{fmt(b.bill_date)} · {Number(b.units||0).toFixed(2)} kWh</small></div><strong>{money(b.total_amount)}</strong>{b.download_url?<a className="button" href={b.download_url}>Download PDF</a>:<span className="muted">PDF unavailable</span>}</div>)}</section></section></main>
}
function Info({a,b}){return <div className="info"><span>{a}</span><strong>{b}</strong></div>}
function Modal({title,onClose,children}){return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h2>{title}</h2><button onClick={onClose}>×</button></div>{children}</div></div>}
async function markPaid(b){const amount=prompt('Payment amount',String(b.total_amount));if(amount===null)return;const mode=prompt('Payment mode','UPI');if(mode===null)return;const {error}=await supabase.from('bill_payments').insert({bill_id:b.id,amount:Number(amount),payment_mode:mode,payment_date:new Date().toISOString().slice(0,10)});if(!error)await supabase.from('electricity_bills').update({status:'PAID'}).eq('id',b.id);location.reload()}
async function downloadStored(b){if(!b.pdf_path)return alert('PDF is not available yet.');const {data,error}=await supabase.storage.from('electricity-bills').createSignedUrl(b.pdf_path,300,{download:b.bill_number+'.pdf'});if(error)return alert(error.message);location.href=data.signedUrl}
async function downloadTenantSnapshotPdf(m,bills,settings){
 const active=m.tenant_assignments?.find(a=>!a.move_out_date),tenant=active?.tenants||null;
 const roomBills=bills.filter(b=>b.meter_id===m.id).sort((a,b)=>new Date(b.bill_date)-new Date(a.bill_date));
 const lastPaid=roomBills.find(b=>b.status==='PAID');
 const {jsPDF}=await import('jspdf');
 const doc=new jsPDF({unit:'mm',format:'a4'});
 const line=(label,value,y,x=20)=>{doc.setFont('helvetica','bold');doc.text(label,x,y);doc.setFont('helvetica','normal');doc.text(String(value||'—'),x+42,y,{maxWidth:135})};
 doc.setFont('helvetica','bold');doc.setFontSize(21);doc.text('Electricity Bill Manager',105,25,{align:'center'});
 doc.setFont('helvetica','normal');doc.setFontSize(12);doc.text('Complete Tenant & Room Data Snapshot',105,34,{align:'center'});
 doc.setFontSize(9);doc.text('Generated on '+new Date().toLocaleString('en-IN'),105,41,{align:'center'});
 doc.setFontSize(14);doc.setFont('helvetica','bold');doc.text('Property & Room',20,55);
 doc.setFontSize(10);line('Property',m.properties?.name,65);line('Address',m.properties?.address,73);line('Floor',m.rooms?.floor,81);line('Room number',m.rooms?.room_number,89);line('Meter code',m.meter_code,97);line('Meter number',m.meter_number,105);line('Meter status',m.status,113);
 doc.setFontSize(14);doc.setFont('helvetica','bold');doc.text('Current Tenant',20,130);
 doc.setFontSize(10);line('Tenant ID',tenant?.id,140);line('Tenant name',tenant?.name||'Vacant',148);line('Registered mobile',tenant?.phone,156);line('Notes',tenant?.notes,164);line('Move-in date',active?.move_in_date?fmt(active.move_in_date):'—',172);line('Move-out date',active?.move_out_date?fmt(active.move_out_date):'Active',180);
 doc.setFontSize(14);doc.setFont('helvetica','bold');doc.text('Billing Snapshot',20,198);
 doc.setFontSize(10);line('Rate per kWh',money(settings?.rate_per_unit||10),208);line('Opening reading',Number(m.opening_reading||0).toFixed(3)+' kWh',216);line('Last paid reading',lastPaid?.current_reading!=null?Number(lastPaid.current_reading).toFixed(3)+' kWh':'—',224);line('Last paid amount',lastPaid?money(lastPaid.total_amount):'—',232);line('Last bill date',lastPaid?fmt(lastPaid.bill_date):'—',240);
 doc.addPage();
 doc.setFont('helvetica','bold');doc.setFontSize(18);doc.text('Recent Electricity Bills',105,25,{align:'center'});
 let y=40;doc.setFontSize(9);doc.text('Bill number',20,y);doc.text('Date',75,y);doc.text('Consumption',105,y);doc.text('Amount',150,y);doc.text('Status',180,y);y+=7;
 roomBills.slice(0,12).forEach(b=>{if(y>275){doc.addPage();y=20}doc.setFont('helvetica','normal');doc.text(String(b.bill_number||'—'),20,y);doc.text(fmt(b.bill_date),75,y);doc.text(Number(b.units||0).toFixed(2)+' kWh',105,y);doc.text(money(b.total_amount),150,y);doc.text(String(b.status||'—'),180,y);y+=7});
 doc.addPage();
 const portal=baseUrl+'#/m/'+m.public_token;
 const qr=await QRCode.toDataURL(portal,{width:1400,margin:4,errorCorrectionLevel:'H'});
 doc.setFont('helvetica','bold');doc.setFontSize(22);doc.text('Permanent Meter Access',105,28,{align:'center'});
 doc.setFont('helvetica','normal');doc.setFontSize(12);doc.text('Room '+(m.rooms?.room_number||'—')+' · '+m.meter_code,105,37,{align:'center'});
 doc.addImage(qr,'PNG',45,50,120,120);
 doc.setFont('helvetica','bold');doc.setFontSize(14);doc.text('Current tenant: '+(tenant?.name||'Vacant'),105,180,{align:'center'});
 doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text('Registered mobile: '+(tenant?.phone||'—'),105,188,{align:'center'});
 doc.text('Scan to open the electricity account portal.',105,198,{align:'center'});
 doc.text('This permanent access code is linked to the meter.',105,206,{align:'center'});
 doc.setFontSize(8);doc.text('Snapshot generated '+new Date().toLocaleString('en-IN'),105,218,{align:'center'});
 doc.save(m.meter_code+'-tenant-data-snapshot.pdf');
}
async function downloadQR(m,format='png'){
 const portal=baseUrl+'#/m/'+m.public_token;
 const data=await QRCode.toDataURL(portal,{width:1200,margin:3,errorCorrectionLevel:'H'});
 const active=m.tenant_assignments?.find(a=>!a.move_out_date);
 const tenant=active?.tenants||null;
 if(format==='png'){
  const a=document.createElement('a');a.href=data;a.download=m.meter_code+'-electricity-access.png';a.click();return;
 }
 const {jsPDF}=await import('jspdf');
 const doc=new jsPDF({unit:'mm',format:'a4'});
 doc.setFont('helvetica','bold');doc.setFontSize(22);doc.text('Electricity Bill Manager',105,25,{align:'center'});
 doc.setFont('helvetica','normal');doc.setFontSize(13);doc.text('Permanent Meter Access',105,35,{align:'center'});
 doc.addImage(data,'PNG',55,45,100,100);
 doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text('Meter & Room',20,160);
 doc.setFont('helvetica','normal');doc.setFontSize(11);
 doc.text('Room: '+(m.rooms?.room_number||'—'),20,170);
 doc.text('Floor: '+(m.rooms?.floor||'—'),20,178);
 doc.text('Meter Code: '+m.meter_code,20,186);
 doc.text('Meter Number: '+(m.meter_number||'—'),20,194);
 doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text('Current Tenant',105,160);
 doc.setFont('helvetica','normal');doc.setFontSize(11);
 doc.text('Name: '+(tenant?.name||'Vacant'),105,170);
 doc.text('Mobile: '+(tenant?.phone||'Not registered'),105,178);
 doc.text('Notes: '+(tenant?.notes||'—'),105,186,{maxWidth:85});
 doc.setFontSize(10);doc.text('Scan this code to open the electricity account portal.',105,207,{align:'center',maxWidth:170});
 doc.text('The access code remains linked to this meter. Tenant details shown are the current owner records.',105,215,{align:'center',maxWidth:175});
 doc.setFontSize(8);doc.text('Generated: '+new Date().toLocaleDateString('en-IN'),105,224,{align:'center'});
 doc.save(m.meter_code+'-electricity-access-with-tenant.pdf');
}
createRoot(document.getElementById('root')).render(<App/>);
