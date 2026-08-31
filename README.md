# MeterForge

Complete usage-billing desk: ingest events, retry safely, choose a plan, draft invoices, keep history on disk.

## Complete product flows

1. Pick organization `northwind` and meter `api_calls`, send 120 units.
2. Click **Retry same key** — status should be `replayed`, still one event.
3. Choose Starter, **Draft invoice**, restart `npm run dev`, history is still there.

```bash
npm install
npm test
npm run dev
```
