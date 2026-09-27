import { UPI_ID, fmt, money } from './format';

const n3 = v => Number(v || 0).toFixed(3).replace(/\.?0+$/, '') || '0';
const addDays = (d, days) => { const x = new Date(d); x.setDate(x.getDate() + Number(days || 0)); return x; };

/** Everything the share message needs, from a bill row with its meter/tenant joins. */
export function billShareInfo(bill, { dueDays, ownerName } = {}) {
  const payments = bill.bill_payments || [];
  const lastPay = [...payments].sort((a, b) => String(b.payment_date).localeCompare(String(a.payment_date)))[0];
  return {
    tenantName: bill.tenants?.name || 'Tenant',
    tenantPhone: bill.tenants?.phone || '',
    propertyName: bill.meters?.properties?.name || '',
    room: bill.meters?.rooms?.room_number || '',
    meterCode: bill.meters?.meter_code || '',
    billNumber: bill.bill_number,
    billDate: bill.bill_date,
    previous: bill.previous_reading,
    current: bill.current_reading,
    units: bill.units ?? (Number(bill.current_reading) - Number(bill.previous_reading)),
    rate: bill.rate_per_unit,
    total: bill.total_amount,
    rent: Number(bill.rent_amount) || 0,
    rentPeriod: bill.rent_period || '',
    status: bill.status,
    dueDate: dueDays != null ? addDays(bill.bill_date, dueDays) : null,
    paidOn: lastPay?.payment_date || null,
    paidAmount: lastPay?.amount ?? null,
    signOff: ownerName || bill.meters?.properties?.name || 'RentSlate Meter',
  };
}

/** Draft message: "Hi, <Tenant Name>" + amount and units consumed up to the current reading. */
export function billMessage(i) {
  const where = [i.propertyName, i.room && 'Room ' + i.room, i.meterCode && 'Meter ' + i.meterCode].filter(Boolean).join(', ');
  const lines = [
    `Hi, ${i.tenantName}`,
    '',
    `Your ${i.rent > 0 ? 'electricity and rent bill' : 'electricity bill'}${where ? ' for ' + where : ''} is ready.`,
    '',
    `Bill No: ${i.billNumber}`,
    `Bill date: ${fmt(i.billDate)}`,
    `Meter reading: ${n3(i.previous)} → ${n3(i.current)} kWh`,
    `Units consumed (till reading ${n3(i.current)}): ${n3(i.units)} kWh`,
    `Rate: ${money(i.rate)} per kWh`,
  ];
  if (i.rent > 0) {
    lines.push(`Electricity charges: ${money(i.total - i.rent)}`);
    lines.push(`Rent${i.rentPeriod ? ' (' + i.rentPeriod + ')' : ''}: ${money(i.rent)}`);
    lines.push(`Total amount: ${money(i.total)}`);
  } else {
    lines.push(`Amount: ${money(i.total)}`);
  }
  if (i.status === 'PAID') {
    lines.push(`Status: Paid${i.paidOn ? ' on ' + fmt(i.paidOn) : ''}. Thank you!`);
  } else {
    if (i.dueDate) lines.push(`Please pay by: ${fmt(i.dueDate)}`);
    lines.push('', `Pay by UPI: ${UPI_ID}`);
  }
  lines.push('', 'The bill PDF is attached.', '', 'Thank you,', i.signOff);
  return lines.join('\n');
}

export const pdfFile = (blob, billNumber) => new File([blob], billNumber + '.pdf', { type: 'application/pdf' });
export const canShareFiles = file => !!(navigator.canShare && file && navigator.canShare({ files: [file] }));
export const canShareText = () => !!navigator.share;

/** Opens the phone's share sheet (WhatsApp, SMS, email…) with the message and, when supported, the PDF. */
export async function shareBill({ text, file, title }) {
  const withFile = canShareFiles(file);
  // Some apps drop `text` when a file is attached unless it's also in `title`; send both.
  await navigator.share(withFile ? { title, text, files: [file] } : { title, text });
  return withFile;
}

/** WhatsApp chat with the tenant's number and the message pre-filled (WhatsApp can't take files via links). */
export function whatsappLink(phone, text) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) digits = '91' + digits;
  return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text);
}
