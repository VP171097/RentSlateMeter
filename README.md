# DynamicQR — Electricity Bill Manager

Standalone QR-based electricity billing for rental rooms/meters.

## Core workflow

Each physical meter has a permanent QR code. Scanning it opens the tenant electricity portal without requiring a new sticker when the tenant changes.

### Tenant
1. Scan the meter QR.
2. View room, tenant, meter, last paid reading, last payment amount/date and billing rate.
3. Enter only the current meter reading.
4. The server captures the bill date automatically.
5. The bill is created as **Pending Approval**.
6. The tenant can see the submission but cannot download a final PDF until the owner approves it.
7. After approval, the bill PDF is stored privately and becomes downloadable.
8. The QR portal shows the latest six approved/paid bills with PDF download links.

### Owner
1. Sign in to the owner console.
2. Generate a bill directly from any meter by entering the current reading.
3. Owner-generated bills are finalized and downloaded immediately.
4. Review tenant-submitted bills.
5. Edit current reading/rate/fixed charge/tax if required.
6. Approve the bill and create the final PDF.
7. Mark approved bills as paid with payment date, amount and payment mode.
8. Configure the property billing rate and charges.

## Bill design

The generated PDF follows the supplied reference bill's information architecture: account/tenant section, billing summary, calculation details, meter reading details, last payment details, six-month consumption and a QR back to the live account portal. It is a property-managed electricity bill and is not presented as an official utility-company bill.

## Security

- Standalone Supabase project.
- RLS enabled on exposed billing tables.
- Owner changes require an authenticated admin.
- Tenant QR access is scoped to one permanent opaque meter token.
- Final PDFs are stored in a private Storage bucket.
- Tenant downloads use short-lived signed URLs.
- Service-role credentials are used only inside the Edge Function and are never shipped to the browser.

## Database

Main entities:
- properties
- rooms
- meters
- tenants
- tenant_assignments
- billing_settings
- electricity_bills
- bill_payments
- bill_events

## Supabase

Project: DynamicQR
Region: ap-south-1

The browser uses the Supabase publishable key. Never put a service-role/secret key in GitHub Pages or frontend code.

## GitHub Pages

Deployment is handled by .github/workflows/deploy.yml.
The application base path is /DynamicQR/.
