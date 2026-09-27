import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { activeAssignment, byNewest, fmt, pdfMoney, DEFAULT_RATE, STATUS_LABEL } from './format';
import { TEAL_DARK, drawFooter, drawLetterhead } from './billPdf';

export const portalUrl = token => location.origin + location.pathname + '#/m/' + token;

export async function downloadQR(m, format = 'png') {
  const data = await QRCode.toDataURL(portalUrl(m.public_token), { width: 1200, margin: 3, errorCorrectionLevel: 'H' });
  if (format === 'png') {
    const a = document.createElement('a');
    a.href = data; a.download = m.meter_code + '-electricity-access.png'; a.click();
    return;
  }
  // Room/meter only — no tenant details — so the printed sticker stays valid
  // across tenant changes, exactly like the QR code itself.
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  drawLetterhead(doc, { title: m.properties?.name || 'Electricity Account', subtitle: 'Permanent Meter Access', address: m.properties?.address });
  doc.addImage(data, 'PNG', 45, 48, 120, 120);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...TEAL_DARK);
  doc.text('Room ' + (m.rooms?.room_number || '—') + ' · Floor ' + (m.rooms?.floor || '—'), 105, 182, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(28, 26, 22);
  doc.text('Meter ' + m.meter_code + (m.meter_number ? ' · No. ' + m.meter_number : ''), 105, 191, { align: 'center' });
  doc.setFontSize(10);
  doc.text('Scan this code and enter the mobile number registered with the owner to view bills and submit meter readings.', 105, 206, { align: 'center', maxWidth: 170 });
  doc.text('This code is permanent for this meter. It does not change when the tenant changes.', 105, 218, { align: 'center', maxWidth: 170 });
  drawFooter(doc);
  doc.save(m.meter_code + '-electricity-access.pdf');
}

export async function downloadTenantSnapshotPdf(m, bills, settings) {
  const active = activeAssignment(m), tenant = active?.tenants || null;
  const roomBills = bills.filter(b => b.meter_id === m.id).sort(byNewest);
  const lastPaid = roomBills.find(b => b.status === 'PAID');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const line = (label, value, y) => { doc.setFont('helvetica', 'bold'); doc.text(label, 20, y); doc.setFont('helvetica', 'normal'); doc.text(String(value || '—'), 62, y, { maxWidth: 135 }); };
  const heading = (t, y) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...TEAL_DARK); doc.text(t, 20, y); doc.setFontSize(10); doc.setTextColor(28, 26, 22); };

  drawLetterhead(doc, { title: 'Tenant & Room Snapshot', subtitle: 'Generated on ' + new Date().toLocaleString('en-IN'), address: m.properties?.name });
  heading('Property & Room', 52);
  line('Property', m.properties?.name, 62); line('Address', m.properties?.address, 70); line('Floor', m.rooms?.floor, 78); line('Room number', m.rooms?.room_number, 86);
  line('Meter code', m.meter_code, 94); line('Meter number', m.meter_number, 102); line('Meter status', m.status, 110);
  heading('Current Tenant', 126);
  line('Tenant ID', tenant?.id, 136); line('Tenant name', tenant?.name || 'Vacant', 144); line('Registered mobile', tenant?.phone, 152); line('Notes', tenant?.notes, 160);
  line('Move-in date', active?.move_in_date ? fmt(active.move_in_date) : '—', 168); line('Move-out date', active ? 'Active' : '—', 176);
  heading('Billing Snapshot', 192);
  line('Rate per kWh', pdfMoney(settings?.rate_per_unit ?? DEFAULT_RATE), 202); line('Opening reading', Number(m.opening_reading || 0).toFixed(3) + ' kWh', 210);
  line('Last paid reading', lastPaid ? Number(lastPaid.current_reading).toFixed(3) + ' kWh' : '—', 218); line('Last paid amount', lastPaid ? pdfMoney(lastPaid.total_amount) : '—', 226);
  line('Last paid bill date', lastPaid ? fmt(lastPaid.bill_date) : '—', 234);

  doc.addPage();
  drawLetterhead(doc, { title: 'Recent Electricity Bills', subtitle: m.meter_code + ' · Room ' + (m.rooms?.room_number || '—'), address: m.properties?.name });
  let y = 50;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...TEAL_DARK);
  ['Bill number', 'Date', 'Consumption', 'Amount', 'Status'].forEach((h, i) => doc.text(h, [20, 72, 102, 140, 170][i], y));
  doc.setTextColor(28, 26, 22); y += 7;
  if (!roomBills.length) { doc.setFont('helvetica', 'normal'); doc.text('No bills yet.', 20, y); }
  roomBills.slice(0, 24).forEach(b => {
    if (y > 275) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'normal');
    doc.text(String(b.bill_number || '—'), 20, y); doc.text(fmt(b.bill_date), 72, y); doc.text(Number(b.units || 0).toFixed(2) + ' kWh', 102, y);
    doc.text(pdfMoney(b.total_amount), 140, y); doc.text(STATUS_LABEL[b.status] || String(b.status || '—'), 170, y);
    y += 7;
  });

  doc.addPage();
  const qr = await QRCode.toDataURL(portalUrl(m.public_token), { width: 1400, margin: 4, errorCorrectionLevel: 'H' });
  drawLetterhead(doc, { title: 'Permanent Meter Access', subtitle: 'Room ' + (m.rooms?.room_number || '—') + ' · ' + m.meter_code, address: m.properties?.name });
  doc.addImage(qr, 'PNG', 45, 50, 120, 120);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text('Current tenant: ' + (tenant?.name || 'Vacant'), 105, 182, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('Scan to open the electricity account portal, then enter the registered mobile number.', 105, 192, { align: 'center', maxWidth: 170 });
  doc.text('This permanent access code is linked to the meter.', 105, 200, { align: 'center' });
  drawFooter(doc);
  doc.save(m.meter_code + '-tenant-data-snapshot.pdf');
}
