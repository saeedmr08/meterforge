import { describe, expect, it } from "vitest";

import { MeterForgeLedger, MeteringError } from "./metering";

describe("MeterForgeLedger", () => {
  it("accepts a first event and replays an identical idempotent retry", () => {
    const ledger = new MeterForgeLedger();
    const first = ledger.ingest({
      organizationId: "org-a",
      meter: "api_calls",
      quantity: 12,
      idempotencyKey: "req-1",
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    const second = ledger.ingest({
      organizationId: "org-a",
      meter: "api_calls",
      quantity: 12,
      idempotencyKey: "req-1",
      occurredAt: "2026-08-01T00:00:00.000Z",
    });

    expect(first.status).toBe("accepted");
    expect(second.status).toBe("replayed");
    expect(second.event.id).toBe(first.event.id);
    expect(ledger.listEvents("org-a")).toHaveLength(1);
  });

  it("rejects the same key with a different payload", () => {
    const ledger = new MeterForgeLedger();
    ledger.ingest({
      organizationId: "org-a",
      meter: "api_calls",
      quantity: 12,
      idempotencyKey: "req-1",
    });

    try {
      ledger.ingest({
        organizationId: "org-a",
        meter: "api_calls",
        quantity: 99,
        idempotencyKey: "req-1",
      });
      throw new Error("expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(MeteringError);
      expect((error as MeteringError).code).toBe("IDEMPOTENCY_CONFLICT");
    }
  });

  it("does not leak events across tenants", () => {
    const ledger = new MeterForgeLedger();
    ledger.ingest({
      organizationId: "org-a",
      meter: "api_calls",
      quantity: 5,
      idempotencyKey: "a",
    });
    ledger.ingest({
      organizationId: "org-b",
      meter: "api_calls",
      quantity: 5,
      idempotencyKey: "a",
    });

    expect(ledger.listEvents("org-a")).toHaveLength(1);
    expect(ledger.listEvents("org-b")).toHaveLength(1);
    expect(ledger.listEvents("org-a")[0]?.organizationId).toBe("org-a");
  });

  it("bills only overage after included units", () => {
    const ledger = new MeterForgeLedger();
    ledger.ingest({
      organizationId: "org-a",
      meter: "api_calls",
      quantity: 1_050,
      idempotencyKey: "big",
      occurredAt: "2026-08-10T00:00:00.000Z",
    });

    const invoice = ledger.invoice(
      "org-a",
      "api_calls",
      "starter",
      "2026-08-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
    );

    expect(invoice.billedUnits).toBe(1_050);
    expect(invoice.overageUnits).toBe(50);
    expect(invoice.amountCents).toBe(100);
    expect(invoice.eventCount).toBe(1);
  });

  it("does not double-count a replayed event on the invoice", () => {
    const ledger = new MeterForgeLedger();
    const payload = {
      organizationId: "org-a",
      meter: "api_calls",
      quantity: 40,
      idempotencyKey: "retry-storm",
      occurredAt: "2026-08-12T00:00:00.000Z",
    };
    ledger.ingest(payload);
    ledger.ingest(payload);

    const invoice = ledger.invoice(
      "org-a",
      "api_calls",
      "starter",
      "2026-08-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
    );
    expect(invoice.billedUnits).toBe(40);
    expect(invoice.eventCount).toBe(1);
  });

  it("restores unique events from a snapshot after restart", () => {
    const ledger = new MeterForgeLedger();
    ledger.ingest({
      organizationId: "org-a",
      meter: "api_calls",
      quantity: 7,
      idempotencyKey: "keep",
    });
    const clone = new MeterForgeLedger();
    clone.restore(ledger.snapshot());
    expect(clone.listEvents("org-a")).toHaveLength(1);
    expect(
      clone.ingest({
        organizationId: "org-a",
        meter: "api_calls",
        quantity: 7,
        idempotencyKey: "keep",
      }).status,
    ).toBe("replayed");
  });

  it("lists bundled plans", () => {
    expect(new MeterForgeLedger().listPlans().map((plan) => plan.id)).toEqual([
      "starter",
      "scale",
    ]);
  });
});
