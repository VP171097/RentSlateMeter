import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import QRCode from 'qrcode';
import {supabase} from './lib/supabase';
import './styles.css';

const baseUrl=location.origin+location.pathname;
const scanToken=location.hash.startsWith('#/m/')?location.hash.split('/')[2]:null;

function App(){
 const [session,setSession]=useState(null); const [loading,setLoading]=useState(true);
 useEffect(()=>{if(!supabase){setLoading(false);return}supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false)});const {data}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>data.subscription.unsubscribe()},[]);
 if(scanToken)return <Scan token={scanToken}/>;
 if(loading)return <main className="center"><div className="card"><h1>Loading…</h1></div></main>;
 if(!supabase)return <main className="center"><div className="card"><h1>Setup required</h1><p>Add Supabase environment variables to this deployment.</p></div></main>;
 return session?<Admin/>:<Login/>;
}
function Login(){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[signup,setSignup]=useState(false),[msg,setMsg]=useState('');
 const submit=async e=>{e.preventDefault();setMsg('');const {data,error}=signup?await supabase.auth.signUp({email,password}):await supabase.auth.signInWithPassword({email,password});if(error)setMsg(error.message);else if(signup&&!data.session)setMsg('Check your email to confirm the account.')};
 return <main className="center"><form className="card login" onSubmit={submit}><div className="eyebrow">STANDALONE PROPERTY TOOL</div><h1>Dynamic Meter QR</h1><p className="muted">{signup?'Create the first administrator account.':'Administrator sign in.'}</p><input required type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}/><input required minLength="6" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}/>{msg&&<div className="alert">{msg}</div>}<button>{signup?'Create account':'Sign in'}</button><button type="button" className="secondary" onClick={()=>setSignup(!signup)}>{signup?'Already have an account? Sign in':'First time? Create administrator'}</button></form></main>
}
function Admin(){
 const [meters,setMeters]=useState([]),[selected,setSelected]=useState(null),[busy,setBusy]=useState(true),[msg,setMsg]=useState('');
 const load=async()=>{setBusy(true);const {data,error}=await supabase.from('meters').select('id,meter_code,meter_number,meter_type,status,notes,public_token,room_id,property_id,rooms(floor,room_number),tenant_assignments(id,tenant_id,move_in_date,move_out_date,tenants(name,phone))').order('meter_code');if(error)setMsg(error.message);else setMeters(data||[]);setBusy(false)};
 useEffect(()=>{(async()=>{const {error}=await supabase.rpc('bootstrap_admin');if(error)setMsg(error.message);await load()})()},[]);
 const occupied=meters.filter(m=>m.tenant_assignments?.some(a=>!a.move_out_date)).length;
 return <main className="admin"><header><div><div className="eyebrow">PROPERTY TOOL</div><h1>Dynamic Meter QR</h1><p className="muted">Permanent QR codes. Change tenant details without reprinting.</p></div><button className="secondary" onClick={()=>supabase.auth.signOut()}>Sign out</button></header><section className="stats"><div><b>{meters.length}</b><span>Meters</span></div><div><b>{occupied}</b><span>Occupied</span></div><div><b>{meters.length-occupied}</b><span>Vacant</span></div></section>{msg&&<div className="alert">{msg}</div>}<section className="table-card"><div className="table-head"><h2>Meter registry</h2><span>{busy?'Loading…':'Cloud database connected'}</span></div><div className="table">{meters.map(m=><MeterRow key={m.id} meter={m} onEdit={()=>setSelected(m)}/>)}</div></section>{selected&&<Editor meter={selected} onClose={()=>setSelected(null)} onSaved={async()=>{setSelected(null);await load()}}/>}</main>
}
function MeterRow({meter,onEdit}){const a=meter.tenant_assignments?.find(x=>!x.move_out_date);return <div className="row"><div><strong>{meter.meter_code}</strong><small>Floor {meter.rooms?.floor||'—'} · Room {meter.rooms?.room_number||'—'}</small></div><div>{a?.tenants?.name||'Vacant'}</div><span className={'pill '+(a?'green':'')}>{a?'Occupied':'Vacant'}</span><button onClick={onEdit}>Edit</button><button className="icon-btn" onClick={()=>downloadQR(meter)}>QR</button></div>}
function Editor({meter,onClose,onSaved}){
 const active=meter.tenant_assignments?.find(a=>!a.move_out_date); const [room,setRoom]=useState(meter.rooms?.room_number||''),[floor,setFloor]=useState(meter.rooms?.floor||''),[tenant,setTenant]=useState(active?.tenants?.name||''),[phone,setPhone]=useState(active?.tenants?.phone||''),[status,setStatus]=useState(meter.status),[meterNo,setMeterNo]=useState(meter.meter_number||''),[notes,setNotes]=useState(meter.notes||''),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 const save=async()=>{setBusy(true);setErr('');try{if(!room.trim())throw Error('Room number is required');let roomId=meter.room_id;
  if(roomId){let {error}=await supabase.from('rooms').update({room_number:room.trim(),floor:floor.trim()}).eq('id',roomId);if(error)throw error}
  let {error}=await supabase.from('meters').update({room_id:roomId,status,meter_number:meterNo.trim(),notes:notes.trim()}).eq('id',meter.id);if(error)throw error;
  if(active){if(!tenant.trim()){let {error}=await supabase.from('tenant_assignments').update({move_out_date:new Date().toISOString().slice(0,10)}).eq('id',active.id);if(error)throw error}else{let {error}=await supabase.from('tenants').update({name:tenant.trim(),phone:phone.trim()}).eq('id',active.tenant_id);if(error)throw error}}
  else if(tenant.trim()){let {data:t,error:te}=await supabase.from('tenants').insert({property_id:meter.property_id,name:tenant.trim(),phone:phone.trim()}).select('id').single();if(te)throw te;let {error:ae}=await supabase.from('tenant_assignments').insert({meter_id:meter.id,tenant_id:t.id,room_id:roomId});if(ae)throw ae}
  await onSaved()
 }catch(e){setErr(e.message||'Save failed')}finally{setBusy(false)}};
 return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><h2>Edit {meter.meter_code}</h2><p className="muted">QR identity: permanent.</p></div><button onClick={onClose}>×</button></div><label>Floor<input value={floor} onChange={e=>setFloor(e.target.value)}/></label><label>Room number<input value={room} onChange={e=>setRoom(e.target.value)}/></label><label>Meter number<input value={meterNo} onChange={e=>setMeterNo(e.target.value)}/></label><label>Tenant name<input value={tenant} onChange={e=>setTenant(e.target.value)} placeholder="Blank = vacant"/></label><label>Tenant contact<input value={phone} onChange={e=>setPhone(e.target.value)}/></label><label>Meter status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="maintenance">Maintenance</option></select></label><label>Notes<textarea value={notes} onChange={e=>setNotes(e.target.value)}/></label>{err&&<div className="alert">{err}</div>}<div className="actions"><button className="secondary" onClick={onClose}>Cancel</button><button disabled={busy} onClick={save}>{busy?'Saving…':'Save changes'}</button></div></div></div>
}
function Scan({token}){
 const [state,setState]=useState({loading:true,meter:null,error:''});
 useEffect(()=>{(async()=>{if(!supabase){setState({loading:false,error:'System is not configured.',meter:null});return}const {data,error}=await supabase.from('meters').select('id,meter_code,meter_number,meter_type,status,notes,rooms(floor,room_number),tenant_assignments(move_in_date,move_out_date,tenants(name,phone))').eq('public_token',token).eq('status','active').maybeSingle();if(error)setState({loading:false,error:error.message,meter:null});else setState({loading:false,error:'',meter:data})})()},[token]);
 if(state.loading)return <main className="center"><div className="card"><h1>Loading…</h1></div></main>;
 if(state.error||!state.meter)return <main className="center"><div className="card"><h1>Meter not found</h1><p className="muted">{state.error||'This QR code is not registered or is inactive.'}</p></div></main>;
 const m=state.meter,a=m.tenant_assignments?.find(x=>!x.move_out_date);
 return <main className="scan"><div className="brand">Dynamic Meter QR</div><div className="meter-card"><div className="icon">⚡</div><span className="pill green">Active</span><h1>{m.meter_code}</h1><p className="muted">{m.meter_type}{m.meter_number?' · '+m.meter_number:''}</p><div className="grid"><Info a="Floor" b={m.rooms?.floor||'—'}/><Info a="Room" b={m.rooms?.room_number||'—'}/><Info a="Tenant" b={a?.tenants?.name||'Vacant'}/><Info a="Contact" b={a?.tenants?.phone||'—'}/></div>{m.notes&&<div className="notes">{m.notes}</div>}<p className="muted small">Details are maintained by the property administrator.</p></div></main>
}
function Info({a,b}){return <div className="info"><span>{a}</span><strong>{b}</strong></div>}
async function downloadQR(m){const data=await QRCode.toDataURL(baseUrl+'#/m/'+m.public_token,{width:900,margin:2,errorCorrectionLevel:'H'});const a=document.createElement('a');a.href=data;a.download=m.meter_code+'-qr.png';a.click()}
createRoot(document.getElementById('root')).render(<App/>);