# Dynamic Meter QR

Standalone QR-based meter/room information manager.

## Core idea
Each physical meter receives a permanent QR URL. The QR contains only a stable meter identifier, not tenant information. Tenant, room, floor and notes can therefore change without reprinting the physical QR sticker.

## Current build
The first prototype uses browser localStorage so the UI can be tested immediately. For real multi-device dynamic QR operation, connect the app to a small standalone Supabase database. The QR architecture does not depend on RentSlate and can later be integrated into it if desired.

## Included
- 8 starter meter records (M01–M08)
- Permanent scan routes
- Tenant/floor/room/status editor
- QR PNG download
- Mobile scan view
- GitHub Pages deployment workflow

## Run locally
npm install
npm run dev

## GitHub Pages
Enable **Settings → Pages → Source: GitHub Actions**. Pushes to `main` will then deploy the Vite build automatically.
