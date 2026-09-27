# RentSlate Meter

**Smart Electricity Billing** for rental rooms, part of the RentSlate family. It uses the same "Ledger" look as RentSlate: a deep-teal and marigold palette on warm paper-cream, with DM Sans and Playfair Display type. It has light, dark and system themes, and the theme preference is shared with RentSlate.

Each physical meter has a permanent QR code. Scanning it opens that meter's electricity account, so the sticker never changes when the tenant does.

## Workflow

### Tenant
1. Scan the meter QR and enter the mobile number the owner registered. There is no OTP or password; the server checks the number.
2. View the room, meter, last paid reading, last payment and rate.
3. Take a photo of the meter display (required), then enter the current kWh reading. The bill date is captured automatically.
4. The bill is created as **Pending approval**. No PDF is available until the owner approves it.
5. Pay an approved bill with the **Pay with UPI app** button, or scan the UPI QR on the bill PDF.
6. Download PDFs for the latest six approved or paid bills.

### Owner
1. Sign in to the owner console. The first account created becomes the administrator.
2. Add properties, then rooms and meters, with an opening reading for each meter.
3. Assign tenants with their registered mobile number, or move a tenant out. Bill history is kept.
4. Generate a bill directly from a meter. It is final and the PDF downloads immediately.
5. Review tenant readings against the attached meter photo: edit the reading or rate, then **Approve & create PDF**, or **Reject**.
6. Record payments (amount, date, mode, receipt number) to mark bills paid.
7. Set the electricity rate (default ₹10/kWh) and due days for each property.
8. Download the meter QR as a PNG or PDF, and a tenant and room snapshot PDF.

Every bill PDF has a **Pay by UPI** QR code for `rentslate@ptaxis`, with the amount and bill number filled in. The UPI ID is set in `src/lib/format.js`.

Each meter can have only one open bill (pending or unpaid) at a time. This is enforced in the database.

## Security

- RLS is enabled on every table. Owner reads and writes require an admin (`admin_users`).
- Tenant access goes only through the `meter-portal` Edge Function. It needs **both** the meter's opaque QR token and the registered mobile number (sent in the `x-meter-mobile` header).
- The printed meter QR PDF does not show the tenant's mobile number.
- Meter photos are uploaded through the Edge Function. Only JPEG, PNG or WebP up to 5 MB is accepted, checked by the file's contents. They are stored in the private `meter-photos` bucket, and only admins can read them.
- Final PDFs are stored in a private bucket, and tenants get 15-minute signed URLs.
- The service-role key is used only inside the Edge Function and is never shipped to the browser. The browser uses the publishable key only.

## Development

```bash
npm ci
npm run dev        # http://localhost:5173/DynamicQR/
npm run lint       # eslint, zero warnings allowed
npm run typecheck  # tsc -p jsconfig.json
npm run build
```

Optional `.env` overrides: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Supabase

- Project: DynamicQR (ap-south-1).
- Apply the migrations in `supabase/migrations/` in order. `20260928090000_rentslate_meter_fixes.sql` fixes admin bootstrap, RLS recursion and audit-event inserts. It also adds default billing settings for each property and the one-open-bill-per-meter index. `20260928100000_meter_photos.sql` adds the meter photo column and bucket.
- Deploy the portal function without JWT verification, because tenants have no Supabase account:
  `supabase functions deploy meter-portal --no-verify-jwt`

## Deployment

GitHub Pages is deployed by `.github/workflows/deploy.yml` (lint → typecheck → build) on every push to `main`. The base path is `/DynamicQR/`.
