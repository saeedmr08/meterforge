export type IngestStatus = "accepted" | "replayed" | "conflict";

export interface UsageEvent {
  id: string;
  organizationId: string;
  meter: string;
  quantity: number;
  idempotencyKey: string;
  occurredAt: string;
}

export interface Plan {
  id: string;
  name: string;
  includedUnits: number;
  overageCentsPerUnit: number;
}

export const METERS = ["api_calls", "storage_gb", "seats"] as const;
export type MeterName = (typeof METERS)[number];

export interface InvoiceDraft {
  organizationId: string;
  meter: string;
  periodStart: string;
  periodEnd: string;
  billedUnits: number;
  includedUnits: number;
  overageUnits: number;
  amountCents: number;
  eventCount: number;
}

export class MeteringError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "MeteringError";
    this.code = code;
    this.status = status;
  }
}

export interface IngestInput {
  organizationId: string;
  meter: string;
  quantity: number;
  idempotencyKey: string;
  occurredAt?: string;
  id?: string;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 128) {
    throw new MeteringError(
      "VALIDATION_ERROR",
      `${field} must contain between 1 and 128 characters`,
      400,
    );
  }
  return normalized;
}

function fingerprint(event: Pick<UsageEvent, "meter" | "quantity">): string {
  return `${event.meter}:${event.quantity}`;
}

export class MeterForgeLedger {
  private readonly events: UsageEvent[] = [];
  private readonly keys = new Map<string, UsageEvent>();
  private readonly plans = new Map<string, Plan>();

  constructor() {
    this.plans.set("starter", {
      id: "starter",
      name: "Starter",
      includedUnits: 1_000,
      overageCentsPerUnit: 2,
    });
    this.plans.set("scale", {
      id: "scale",
      name: "Scale",
      includedUnits: 25_000,
      overageCentsPerUnit: 1,
    });
  }

  ingest(input: IngestInput): { status: IngestStatus; event: UsageEvent } {
    const organizationId = requiredText(input.organizationId, "organizationId");
    const meter = requiredText(input.meter, "meter").toLowerCase();
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");

    if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 1_000_000) {
      throw new MeteringError(
        "VALIDATION_ERROR",
        "quantity must be an integer between 1 and 1000000",
        400,
      );
    }

    const mapKey = `${organizationId}::${idempotencyKey}`;
    const existing = this.keys.get(mapKey);
    const candidate: UsageEvent = {
      id: input.id ?? `evt_${this.events.length + 1}`,
      organizationId,
      meter,
      quantity: input.quantity,
      idempotencyKey,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    };

    if (existing) {
      if (fingerprint(existing) !== fingerprint(candidate)) {
        throw new MeteringError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key was reused with a different payload",
          409,
        );
      }
      return { status: "replayed", event: existing };
    }

    this.keys.set(mapKey, candidate);
    this.events.push(candidate);
    return { status: "accepted", event: candidate };
  }

  snapshot(): UsageEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  restore(events: UsageEvent[]): void {
    this.events.length = 0;
    this.keys.clear();
    for (const event of events) {
      this.events.push({ ...event });
      this.keys.set(`${event.organizationId}::${event.idempotencyKey}`, event);
    }
  }

  listEvents(organizationId: string): UsageEvent[] {
    const scoped = requiredText(organizationId, "organizationId");
    return this.events.filter((event) => event.organizationId === scoped);
  }

  getPlan(planId: string): Plan {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new MeteringError("PLAN_NOT_FOUND", "Unknown plan", 404);
    }
    return plan;
  }

  listPlans(): Plan[] {
    return [...this.plans.values()];
  }

  invoice(
    organizationId: string,
    meter: string,
    planId: string,
    periodStart: string,
    periodEnd: string,
  ): InvoiceDraft {
    const plan = this.getPlan(planId);
    const start = Date.parse(periodStart);
    const end = Date.parse(periodEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new MeteringError("VALIDATION_ERROR", "Invalid invoice period", 400);
    }

    const scoped = this.listEvents(organizationId).filter((event) => {
      const at = Date.parse(event.occurredAt);
      return event.meter === meter && at >= start && at < end;
    });

    const billedUnits = scoped.reduce((sum, event) => sum + event.quantity, 0);
    const overageUnits = Math.max(0, billedUnits - plan.includedUnits);

    return {
      organizationId,
      meter,
      periodStart,
      periodEnd,
      billedUnits,
      includedUnits: plan.includedUnits,
      overageUnits,
      amountCents: overageUnits * plan.overageCentsPerUnit,
      eventCount: scoped.length,
    };
  }
}
