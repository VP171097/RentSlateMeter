import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Public tenant portal for RentSlate Meter. Deploy with JWT verification off
// (`supabase functions deploy meter-portal --no-verify-jwt`): tenants have no
// Supabase account. Access requires BOTH the meter's opaque QR token and the
// mobile number the owner registered for the active tenant.
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-meter-mobile",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const billNumber = () => { const d = new Date(); return "EB-" + d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + crypto.randomUUID().slice(0, 8).toUpperCase(); };
const round2 = (n: number) => Math.round(n * 100) / 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Compare the last 10 digits so "+91 98765 43210" matches "9876543210".
const phoneKey = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
const OPEN = ["PENDING_APPROVAL", "APPROVED"];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
// Trust the file's magic bytes, not the client-supplied MIME type.
const imageType = (b: Uint8Array) =>
  b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? { mime: "image/jpeg", ext: "jpg" }
  : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? { mime: "image/png", ext: "png" }
  : b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 ? { mime: "image/webp", ext: "webp" }
  : null;

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url), token = url.searchParams.get("token");
  if (!token || !UUID.test(token)) return json({ error: "A valid meter QR code is required." }, 400);

  const { data: meter, error: meterError } = await supabase.from("meters")
    .select("id,property_id,meter_code,meter_number,meter_type,status,opening_reading,rooms(floor,room_number),properties(name,address),tenant_assignments(id,tenant_id,move_in_date,move_out_date,tenants(id,name,phone))")
    .eq("public_token", token).eq("status", "active").maybeSingle();
  if (meterError) return json({ error: "Could not load this meter." }, 500);
  if (!meter) return json({ error: "This meter QR code is not active." }, 404);

  const active = (meter.tenant_assignments as any[] | null)?.find(a => !a.move_out_date);
  const tenant = active?.tenants ?? null;
  const supplied = phoneKey(req.headers.get("x-meter-mobile"));
  if (!tenant?.phone || phoneKey(tenant.phone).length < 10) return json({ error: "No tenant mobile number is registered for this meter yet. Please contact the owner." }, 403);
  if (supplied.length < 10 || supplied !== phoneKey(tenant.phone)) return json({ error: "The mobile number does not match the one registered for this meter." }, 401);

  const lastPaidQuery = () => supabase.from("electricity_bills").select("id,bill_number,bill_date,reading_date,current_reading,total_amount")
    .eq("meter_id", meter.id).eq("status", "PAID").order("bill_date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const openBillQuery = () => supabase.from("electricity_bills").select("id,bill_number,bill_date,current_reading,units,total_amount,status,source")
    .eq("meter_id", meter.id).in("status", OPEN).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const settingsQuery = () => supabase.from("billing_settings").select("rate_per_unit,fixed_charge,tax_percent,due_days,currency").eq("property_id", meter.property_id).maybeSingle();

  if (req.method === "GET") {
    const [{ data: settings }, { data: bills, error: billsError }, { data: lastPaid }, { data: openBill }] = await Promise.all([
      settingsQuery(),
      supabase.from("electricity_bills").select("id,bill_number,bill_date,reading_date,previous_reading,current_reading,units,rate_per_unit,energy_charge,fixed_charge,other_charge,tax_amount,total_amount,status,source,pdf_path")
        .eq("meter_id", meter.id).in("status", ["APPROVED", "PAID"]).order("bill_date", { ascending: false }).order("created_at", { ascending: false }).limit(6),
      lastPaidQuery(),
      openBillQuery(),
    ]);
    if (billsError) return json({ error: "Could not load bills." }, 500);

    const { data: payment } = await supabase.from("bill_payments").select("payment_date,amount,payment_mode,receipt_no,electricity_bills!inner(meter_id)")
      .eq("electricity_bills.meter_id", meter.id).order("payment_date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const lastPayment = payment ? { payment_date: payment.payment_date, amount: payment.amount, payment_mode: payment.payment_mode, receipt_no: payment.receipt_no } : null;

    const resultBills = await Promise.all((bills || []).map(async ({ pdf_path, ...b }) => {
      if (!pdf_path) return { ...b, download_url: null };
      const { data: signed } = await supabase.storage.from("electricity-bills").createSignedUrl(pdf_path, 900, { download: b.bill_number + ".pdf" });
      return { ...b, download_url: signed?.signedUrl || null };
    }));

    return json({
      meter: { id: meter.id, code: meter.meter_code, number: meter.meter_number, type: meter.meter_type, status: meter.status, opening_reading: meter.opening_reading },
      property: meter.properties, room: meter.rooms,
      tenant: { id: tenant.id, name: tenant.name },
      billing_settings: settings || {},
      baseline_reading: Number(lastPaid?.current_reading ?? meter.opening_reading ?? 0),
      last_paid_bill: lastPaid || null, last_payment: lastPayment, bills: resultBills, pending: openBill || null,
    });
  }

  // Tenant submissions are multipart: current_reading + a required meter photo
  // that the owner reviews before approving.
  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: "Invalid request. Please update the page and try again." }, 400); }
  const rawReading = form.get("current_reading");
  const current = Number(rawReading);
  if (typeof rawReading !== "string" || rawReading.trim() === "" || !Number.isFinite(current) || current < 0) return json({ error: "Current reading must be a valid non-negative number." }, 400);
  if (current > 1e10) return json({ error: "That reading is too large." }, 400);
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return json({ error: "A photo of the meter is required." }, 400);
  if (photo.size > MAX_PHOTO_BYTES) return json({ error: "The photo is too large (max 5 MB)." }, 400);
  const photoBytes = new Uint8Array(await photo.arrayBuffer());
  const photoType = imageType(photoBytes);
  if (!photoType) return json({ error: "The meter photo must be a JPEG, PNG or WebP image." }, 400);
  const notesRaw = form.get("notes");
  const notes = typeof notesRaw === "string" ? notesRaw.trim().slice(0, 500) || null : null;

  const [{ data: settings }, { data: paid }, { data: openBill }] = await Promise.all([settingsQuery(), lastPaidQuery(), openBillQuery()]);
  if (openBill) return json({ error: openBill.status === "PENDING_APPROVAL" ? "A bill is already pending owner approval." : "The previous approved bill has not been marked paid yet.", bill_number: openBill.bill_number, status: openBill.status }, 409);
  const previous = Number(paid?.current_reading ?? meter.opening_reading ?? 0);
  if (current < previous) return json({ error: "Current reading cannot be below the last paid reading (" + previous + ")." }, 400);

  const rate = Number(settings?.rate_per_unit ?? 10), fixed = round2(Math.max(Number(settings?.fixed_charge ?? 0), 0)), taxPercent = Math.max(Number(settings?.tax_percent ?? 0), 0);
  const energy = round2((current - previous) * rate), tax = round2((energy + fixed) * taxPercent / 100), total = round2(energy + fixed + tax);
  const billDate = new Date().toISOString().slice(0, 10);

  const billId = crypto.randomUUID();
  const photoPath = `${meter.property_id}/${meter.id}/${billId}.${photoType.ext}`;
  const upload = await supabase.storage.from("meter-photos").upload(photoPath, photoBytes, { contentType: photoType.mime, upsert: false });
  if (upload.error) return json({ error: "Could not upload the meter photo. Please try again." }, 500);

  const { data: bill, error } = await supabase.from("electricity_bills").insert({
    id: billId, property_id: meter.property_id, meter_id: meter.id, tenant_id: tenant.id, bill_number: billNumber(), bill_date: billDate, reading_date: billDate,
    previous_reading: previous, current_reading: current, rate_per_unit: rate, energy_charge: energy, fixed_charge: fixed, other_charge: 0, tax_amount: tax, total_amount: total,
    status: "PENDING_APPROVAL", source: "TENANT", submitted_at: new Date().toISOString(), notes, reading_photo_path: photoPath,
  }).select("id,bill_number,bill_date,previous_reading,current_reading,units,rate_per_unit,energy_charge,fixed_charge,tax_amount,total_amount,status,source").single();
  // 23505: the one-open-bill-per-meter index caught a concurrent submission.
  if (error) {
    await supabase.storage.from("meter-photos").remove([photoPath]);
    return json({ error: error.code === "23505" ? "A bill is already open for this meter." : "Could not submit the reading." }, error.code === "23505" ? 409 : 400);
  }
  await supabase.from("bill_events").insert({ bill_id: bill.id, event_type: "TENANT_SUBMITTED", new_values: bill });
  return json({ bill }, 201);
});
