import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  MeterForgeLedger,
  type InvoiceDraft,
  type UsageEvent,
} from "./metering";

const DATA_FILE = path.join(process.cwd(), "data", "ledger.json");

interface LedgerFile {
  events: UsageEvent[];
  invoices: InvoiceDraft[];
}

function loadFile(): LedgerFile {
  try {
    const parsed = JSON.parse(readFileSync(DATA_FILE, "utf8")) as
      | UsageEvent[]
      | LedgerFile;
    if (Array.isArray(parsed)) {
      return { events: parsed, invoices: [] };
    }
    return {
      events: parsed.events ?? [],
      invoices: parsed.invoices ?? [],
    };
  } catch {
    return { events: [], invoices: [] };
  }
}

function saveFile(file: LedgerFile): void {
  mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, `${JSON.stringify(file, null, 2)}\n`);
}

const globalForLedger = globalThis as unknown as {
  __meterForge?: MeterForgeLedger;
  __meterInvoices?: InvoiceDraft[];
};

export function getLedger(): MeterForgeLedger {
  if (!globalForLedger.__meterForge) {
    const file = loadFile();
    const ledger = new MeterForgeLedger();
    ledger.restore(file.events);
    globalForLedger.__meterForge = ledger;
    globalForLedger.__meterInvoices = file.invoices;
  }
  return globalForLedger.__meterForge;
}

export function listInvoices(organizationId: string): InvoiceDraft[] {
  getLedger();
  return (globalForLedger.__meterInvoices ?? []).filter(
    (invoice) => invoice.organizationId === organizationId,
  );
}

export function persistLedger(invoice?: InvoiceDraft): void {
  const invoices = globalForLedger.__meterInvoices ?? [];
  if (invoice) {
    invoices.unshift(invoice);
    globalForLedger.__meterInvoices = invoices.slice(0, 50);
  }
  saveFile({
    events: getLedger().snapshot(),
    invoices: globalForLedger.__meterInvoices ?? [],
  });
}
