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
1. Sign in to the owner console with email and password. **Forgot password?** sends a reset link, and the key icon in the console changes the password. **Set up owner account** (full name, email, password) appears only until the first owner exists; that account becomes the administrator. Click your name in the console to edit it.
2. Add properties, then rooms and meters, with an opening reading for each meter. **Bulk add** creates many meters at once: quick-fill a room range (e.g. rooms 101–110 → M-101…M-110), paste rows from Excel or Google Sheets (Floor, Room, Meter code, Meter number, Opening reading), or type them in. Each row is checked before saving, and rooms are created automatically.
3. Assign tenants with their registered mobile number, or move a tenant out. Bill history is kept.
4. Generate a bill directly from a meter. It is final, and the **Share bill** screen opens right away. Optionally switch on **Add rent to this bill** and enter the amount and period, e.g. "October 2026". It is pre-filled with the room's last rent. Rent is shown on the bill, share message and history only when added; an electricity-only bill never mentions rent. The same option is available when approving a tenant's reading.
5. Review tenant readings against the attached meter photo: edit the reading or rate, then **Approve & create PDF**, or **Reject**.
6. Record payments (amount, date, mode, receipt number) to mark bills paid.
7. **Share** any approved or paid bill (from Bills, a room's history, or right after generating/approving). It drafts a message starting "Hi, *Tenant Name*" with the bill number, readings, units consumed, amount, due date and UPI ID. You can edit it, then **Share with PDF** opens the phone's share sheet (WhatsApp, SMS, email…) with the PDF attached. There are also WhatsApp (pre-addressed to the tenant), Copy and PDF buttons.
8. **Room & bills** shows a room's complete bill history (every bill, any number of years), with year filters and totals (units, billed, received, outstanding). Each bill row shows the tenant at the time, readings, payment, and PDF/share/photo buttons. **Export CSV** saves the history as a spreadsheet.
9. Set the electricity rate (default ₹10/kWh) and due days for each property.
10. Download the meter QR as a PNG or PDF, and a tenant and room snapshot PDF.

Every bill PDF has a **Pay by UPI** QR code for `rentslate@ptaxis`, with the amount and bill number filled in. The UPI ID is set in `src/lib/format.js`.

Each meter can have only one open bill (pending or unpaid) at a time. This is enforced in the database.

## Install as an app

RentSlate Meter is an installable web app (PWA). In Chrome on Android or desktop, tap **Install app** in the top bar, or use the browser menu → **Install app** / **Add to Home screen**. It opens full-screen with its own icon.

- Tenants who install it from their meter's QR link go straight back to that meter when they launch it, and their verified mobile is remembered on that device. Leaving the account (the exit icon) forgets both.
- A service worker (`public/sw.js`) keeps the app shell available offline. It never caches Supabase or other cross-origin requests, so bills, readings and sign-ins always come from the network.
- Icons live in `public/icons/`. The maskable versions keep the bolt inside Android's safe zone.

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
npm run dev        # http://localhost:5173/
npm run lint       # eslint, zero warnings allowed
npm run typecheck  # tsc -p jsconfig.json
npm run build
```

Optional `.env` overrides: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the legacy name `VITE_SUPABASE_ANON_KEY` also works).

## Supabase

- Project: DynamicQR (ap-south-1).
- Apply the migrations in `supabase/migrations/` in order. `20260928090000_rentslate_meter_fixes.sql` fixes admin bootstrap, RLS recursion and audit-event inserts. It also adds default billing settings for each property and the one-open-bill-per-meter index. `20260928100000_meter_photos.sql` adds the meter photo column and bucket. `20260928110000_owner_login.sql` adds `admin_exists()` for the sign-in page. `20260928120000_delete_meter.sql` adds `delete_meter()`, which deletes a meter and all its data in one transaction. `20260928140000_bill_rent.sql` adds the optional `rent_amount`/`rent_period` columns. `20260928130000_delete_meter_tenants.sql` makes it also delete the tenant details of everyone who lived on that meter, except tenants currently living in another room.
- Under **Authentication → URL Configuration**, set the Site URL and add a Redirect URL for `https://vp171097.github.io/RentSlateMeter/`. Password-reset and confirmation emails return there.
- After the owner account is created, you can turn off **Allow new users to sign up** under Authentication → Sign In / Providers. Other accounts can't access owner data anyway.
- Deploy the portal function without JWT verification, because tenants have no Supabase account:
  `supabase functions deploy meter-portal --no-verify-jwt`

## Deployment

GitHub Pages is deployed by `.github/workflows/deploy.yml` (lint → typecheck → build) on every push to `main`. The site is served at https://vp171097.github.io/RentSlateMeter/. Asset paths are relative (`base: './'`), so the site keeps working if the repo is renamed. Meter QR codes encode the page URL, so re-download them after a rename.
