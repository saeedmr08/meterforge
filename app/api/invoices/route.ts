import { NextResponse } from "next/server";

import { MeteringError } from "@/lib/metering";
import { getLedger, listInvoices, persistLedger } from "@/lib/persist";

export async function GET(request: Request) {
  const organizationId =
    new URL(request.url).searchParams.get("organizationId") ?? "northwind";
  return NextResponse.json({ data: listInvoices(organizationId) });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    organizationId?: string;
    meter?: string;
    planId?: string;
    periodStart?: string;
    periodEnd?: string;
  };
  try {
    const invoice = getLedger().invoice(
      body.organizationId ?? "northwind",
      body.meter ?? "api_calls",
      body.planId ?? "starter",
      body.periodStart ?? "2026-08-01T00:00:00.000Z",
      body.periodEnd ?? "2026-09-01T00:00:00.000Z",
    );
    persistLedger(invoice);
    return NextResponse.json({ data: invoice });
  } catch (error) {
    if (error instanceof MeteringError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }
}
