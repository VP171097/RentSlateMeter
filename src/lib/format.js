export const APP_NAME = 'RentSlate Meter';
export const TAGLINE = 'Smart Electricity Billing';

export const DEFAULT_RATE = 10;

// Payment collection UPI ID printed on bills and offered in the tenant portal.
export const UPI_ID = 'rentslate@ptaxis';
export const UPI_PAYEE = 'RentSlate';
/** Standard UPI deep link (NPCI "upi://pay"); any UPI app can scan or open it. */
// Built by hand: several UPI apps reject "%40" in pa or "+" for spaces.
export const upiLink = (amount, billNo) => 'upi://pay?pa=' + UPI_ID + '&pn=' + encodeURIComponent(UPI_PAYEE)
  + '&am=' + Number(amount || 0).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent(('Electricity bill ' + (billNo || '')).trim());

export const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
export const round3 = n => Math.round((Number(n) || 0) * 1000) / 1000;

/** Same formula as the meter-portal Edge Function and public.calculate_bill_amount. */
export function calcBill(units, rate, fixed = 0, taxPercent = 0) {
  const energy = round2(Math.max(units, 0) * Math.max(Number(rate) || 0, 0));
  const fixedCharge = round2(Math.max(Number(fixed) || 0, 0));
  const tax = round2((energy + fixedCharge) * Math.max(Number(taxPercent) || 0, 0) / 100);
  return { energy, fixed: fixedCharge, tax, total: round2(energy + fixedCharge + tax) };
}
export const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// jsPDF's built-in Helvetica has no ₹ glyph, so PDFs use "Rs.".
export const pdfMoney = n => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const kwh = n => Number(n || 0).toFixed(3) + ' kWh';
export const cleanPhone = v => String(v || '').replace(/\D/g, '');
export const today = () => new Date().toISOString().slice(0, 10);
export const billNumber = () => {
  const d = new Date();
  return 'EB-' + d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + crypto.randomUUID().slice(0, 8).toUpperCase();
};

export const activeAssignment = meter => meter?.tenant_assignments?.find(a => !a.move_out_date) || null;

/** Latest bill first; ties on bill_date broken by creation time. */
export const byNewest = (a, b) => String(b.bill_date).localeCompare(String(a.bill_date)) || String(b.created_at || '').localeCompare(String(a.created_at || ''));

export const STATUS_LABEL = { PENDING_APPROVAL: 'Pending approval', APPROVED: 'Awaiting payment', PAID: 'Paid', CANCELLED: 'Rejected' };
export const STATUS_TONE = { PENDING_APPROVAL: 'gold', APPROVED: 'gold', PAID: 'green', CANCELLED: 'red' };
