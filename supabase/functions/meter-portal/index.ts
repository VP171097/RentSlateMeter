import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const headers = {"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const billNumber=()=>{const d=new Date();return "EB-"+d.getUTCFullYear()+String(d.getUTCMonth()+1).padStart(2,"0")+"-"+crypto.randomUUID().slice(0,8).toUpperCase();};

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 const url=new URL(req.url),token=url.searchParams.get("token");
 if(!token)return json({error:"QR token is required"},400);
 const {data:meter,error:meterError}=await supabase.from("meters").select("id,property_id,meter_code,meter_number,meter_type,status,opening_reading,notes,public_token,rooms(floor,room_number),properties(name,address),tenant_assignments(id,tenant_id,move_in_date,move_out_date,tenants(id,name,phone))").eq("public_token",token).eq("status","active").maybeSingle();
 if(meterError)return json({error:meterError.message},500);
 if(!meter)return json({error:"Meter not found"},404);
 const active=meter.tenant_assignments?.find((a:any)=>!a.move_out_date),tenant=active?.tenants??null;
 if(req.method==="GET"){
  const [{data:settings},{data:bills,error:billsError},{data:allBillIds}]=await Promise.all([
   supabase.from("billing_settings").select("*").eq("property_id",meter.property_id).maybeSingle(),
   supabase.from("electricity_bills").select("id,bill_number,bill_date,reading_date,previous_reading,current_reading,units,rate_per_unit,energy_charge,fixed_charge,other_charge,tax_amount,total_amount,status,source,pdf_path").eq("meter_id",meter.id).in("status",["APPROVED","PAID"]).order("bill_date",{ascending:false}).limit(6),
   supabase.from("electricity_bills").select("id").eq("meter_id",meter.id)
  ]);
  if(billsError)return json({error:billsError.message},500);
  const ids=(allBillIds||[]).map((x:any)=>x.id);let lastPayment=null;
  if(ids.length){const {data}=await supabase.from("bill_payments").select("payment_date,amount,payment_mode,receipt_no,bill_id").in("bill_id",ids).order("payment_date",{ascending:false}).limit(1).maybeSingle();lastPayment=data||null;}
  const resultBills=[];for(const b of (bills||[])){let download_url=null;if(b.pdf_path){const {data:signed}=await supabase.storage.from("electricity-bills").createSignedUrl(b.pdf_path,900,{download:b.bill_number+".pdf"});download_url=signed?.signedUrl||null;}resultBills.push({...b,download_url});}
  const latestPaid=(bills||[]).find((b:any)=>b.status==="PAID"),baseline=latestPaid?.current_reading??meter.opening_reading??0;
  const {data:openBill}=await supabase.from("electricity_bills").select("id,bill_number,bill_date,current_reading,units,total_amount,status,source").eq("meter_id",meter.id).in("status",["PENDING_APPROVAL","APPROVED"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
  return json({meter:{id:meter.id,code:meter.meter_code,number:meter.meter_number,type:meter.meter_type,status:meter.status,opening_reading:meter.opening_reading,notes:meter.notes},property:meter.properties,room:meter.rooms,tenant:tenant?{id:tenant.id,name:tenant.name,phone:tenant.phone}:null,billing_settings:settings||{},baseline_reading:baseline,last_paid_bill:latestPaid||null,last_payment:lastPayment,bills:resultBills,pending:openBill||null});
 }
 if(req.method==="POST"){
  let body:any;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
  const current=Number(body.current_reading);if(!Number.isFinite(current)||current<0)return json({error:"Current reading must be a valid non-negative number"},400);
  if(!tenant)return json({error:"No active tenant is assigned to this meter."},409);
  const [{data:settings},{data:paid},{data:openBill}]=await Promise.all([
   supabase.from("billing_settings").select("*").eq("property_id",meter.property_id).maybeSingle(),
   supabase.from("electricity_bills").select("current_reading").eq("meter_id",meter.id).eq("status","PAID").order("bill_date",{ascending:false}).limit(1).maybeSingle(),
   supabase.from("electricity_bills").select("id,bill_number,status").eq("meter_id",meter.id).in("status",["PENDING_APPROVAL","APPROVED"]).order("created_at",{ascending:false}).limit(1).maybeSingle()
  ]);
  const previous=Number(paid?.current_reading??meter.opening_reading??0);
  if(current<previous)return json({error:"Current reading cannot be below the last paid reading ("+previous+")."},400);
  if(openBill)return json({error:openBill.status==="PENDING_APPROVAL"?"A bill is already pending owner approval.":"The previous approved bill has not been marked paid yet.",bill_number:openBill.bill_number,status:openBill.status},409);
  const rate=Number(settings?.rate_per_unit??0),fixed=Number(settings?.fixed_charge??0),taxPercent=Number(settings?.tax_percent??0),units=current-previous,energy=Math.round(units*rate*100)/100,tax=Math.round((energy+fixed)*taxPercent)/100,total=Math.round((energy+fixed+tax)*100)/100,billDate=new Date().toISOString().slice(0,10);
  const {data:bill,error}=await supabase.from("electricity_bills").insert({property_id:meter.property_id,meter_id:meter.id,tenant_id:tenant.id,bill_number:billNumber(),bill_date:billDate,reading_date:billDate,previous_reading:previous,current_reading:current,rate_per_unit:rate,energy_charge:energy,fixed_charge:fixed,other_charge:0,tax_amount:tax,total_amount:total,status:"PENDING_APPROVAL",source:"TENANT",submitted_at:new Date().toISOString(),notes:body.notes||null}).select("id,bill_number,bill_date,previous_reading,current_reading,units,rate_per_unit,energy_charge,fixed_charge,tax_amount,total_amount,status,source").single();
  if(error)return json({error:error.message},400);
  await supabase.from("bill_events").insert({bill_id:bill.id,event_type:"TENANT_SUBMITTED",new_values:bill});
  return json({bill},201);
 }
 return json({error:"Method not allowed"},405);
});