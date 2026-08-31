"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import type { InvoiceDraft, Plan, UsageEvent } from "../lib/metering";

export function BillingDesk() {
  const [org, setOrg] = useState("northwind");
  const [meter, setMeter] = useState("api_calls");
  const [planId, setPlanId] = useState("starter");
  const [key, setKey] = useState(`evt-${Date.now()}`);
  const [quantity, setQuantity] = useState(120);
  const [log, setLog] = useState<string[]>([]);
  const [invoice, setInvoice] = useState<InvoiceDraft | null>(null);
  const [history, setHistory] = useState<InvoiceDraft[]>([]);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);

  const refresh = useCallback(async () => {
    const [eventsRes, plansRes, invoicesRes] = await Promise.all([
      fetch(`/api/events?organizationId=${encodeURIComponent(org)}`),
      fetch("/api/plans"),
      fetch(`/api/invoices?organizationId=${encodeURIComponent(org)}`),
    ]);
    const eventsBody = (await eventsRes.json()) as { data: UsageEvent[] };
    const plansBody = (await plansRes.json()) as { data: Plan[] };
    const invoicesBody = (await invoicesRes.json()) as { data: InvoiceDraft[] };
    setEvents(eventsBody.data);
    setPlans(plansBody.data);
    setHistory(invoicesBody.data);
  }, [org]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function record(message: string) {
    setLog((current) => [message, ...current].slice(0, 16));
  }

  async function ingest(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: org,
        meter,
        quantity,
        idempotencyKey: key,
      }),
    });
    const body = (await response.json()) as {
      status?: string;
      event?: UsageEvent;
      error?: { message: string };
    };
    if (!response.ok) {
      record(body.error?.message ?? "Ingest failed");
      return;
    }
    record(`${body.status?.toUpperCase()} ${body.event?.id} · ${meter} · ${body.event?.quantity}`);
    await refresh();
  }

  async function replay() {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: org,
        meter,
        quantity,
        idempotencyKey: key,
      }),
    });
    const body = (await response.json()) as { status?: string; error?: { message: string } };
    record(body.status ? `Replay → ${body.status}` : body.error?.message ?? "Replay failed");
    await refresh();
  }

  async function draftInvoice() {
    const response = await fetch("/api/invoices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: org,
        meter,
        planId,
        periodStart: "2026-08-01T00:00:00.000Z",
        periodEnd: "2026-09-01T00:00:00.000Z",
      }),
    });
    const body = (await response.json()) as { data?: InvoiceDraft; error?: { message: string } };
    if (!response.ok || !body.data) {
      record(body.error?.message ?? "Invoice failed");
      return;
    }
    setInvoice(body.data);
    record(`Saved August invoice: ${body.data.billedUnits} ${meter}`);
    await refresh();
  }

  const plan = plans.find((item) => item.id === planId);
  const meterTotal = events
    .filter((item) => item.meter === meter)
    .reduce((sum, item) => sum + item.quantity, 0);

  return (
    <main className="desk">
      <header>
        <p className="eyebrow">Usage billing</p>
        <h1>MeterForge</h1>
        <p>
          Ingest usage, retry safely, then draft an overage invoice. Events and invoices live in
          <code> data/ledger.json</code>.
        </p>
      </header>
      <section className="grid">
        <form className="panel" onSubmit={(event) => void ingest(event)}>
          <h2>Ingest</h2>
          <label>
            Organization
            <select value={org} onChange={(e) => setOrg(e.target.value)}>
              <option value="northwind">northwind</option>
              <option value="atlas">atlas</option>
            </select>
          </label>
          <label>
            Meter
            <select value={meter} onChange={(e) => setMeter(e.target.value)}>
              <option value="api_calls">api_calls</option>
              <option value="storage_gb">storage_gb</option>
              <option value="seats">seats</option>
            </select>
          </label>
          <label>
            Plan
            <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.includedUnits} included
                </option>
              ))}
            </select>
          </label>
          <label>
            Idempotency key
            <input value={key} onChange={(e) => setKey(e.target.value)} />
          </label>
          <label>
            Quantity
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>
          <div className="actions">
            <button type="submit">Send event</button>
            <button type="button" className="ghost" onClick={() => void replay()}>
              Retry same key
            </button>
            <button type="button" className="ghost" onClick={() => void draftInvoice()}>
              Draft invoice
            </button>
          </div>
        </form>
        <article className="panel">
          <h2>{org} · {meter}</h2>
          <p className="muted">
            {events.length} unique events · {meterTotal} units this meter
            {plan ? ` · plan includes ${plan.includedUnits}` : ""}
          </p>
          {events.length === 0 ? (
            <p className="muted">No events yet. Send one, then retry the same key.</p>
          ) : (
            <ul>
              {events.map((item) => (
                <li key={item.id}>
                  <strong>{item.id}</strong>
                  <span>
                    {item.meter} · {item.quantity} · {item.idempotencyKey}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="panel">
          <h2>Latest invoice</h2>
          {invoice ? (
            <dl>
              <div>
                <dt>Meter</dt>
                <dd>{invoice.meter}</dd>
              </div>
              <div>
                <dt>Billed</dt>
                <dd>{invoice.billedUnits}</dd>
              </div>
              <div>
                <dt>Included</dt>
                <dd>{invoice.includedUnits}</dd>
              </div>
              <div>
                <dt>Overage</dt>
                <dd>{invoice.overageUnits}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>${(invoice.amountCents / 100).toFixed(2)}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Draft an invoice after ingesting usage.</p>
          )}
          <h2>History</h2>
          {history.length === 0 ? (
            <p className="muted">None saved yet.</p>
          ) : (
            <ul>
              {history.map((item, index) => (
                <li key={`${item.periodStart}-${index}`}>
                  <strong>{item.meter}</strong>
                  <span>
                    {item.billedUnits} u · ${(item.amountCents / 100).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
      <aside className="panel log">
        <h2>Activity</h2>
        <ol>
          {log.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ol>
      </aside>
    </main>
  );
}
