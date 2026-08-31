import { NextResponse } from "next/server";

import { MeteringError } from "@/lib/metering";
import { getLedger, persistLedger } from "@/lib/persist";

export async function GET(request: Request) {
  const organizationId =
    new URL(request.url).searchParams.get("organizationId") ?? "northwind";
  return NextResponse.json({ data: getLedger().listEvents(organizationId) });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    organizationId?: string;
    meter?: string;
    quantity?: number;
    idempotencyKey?: string;
  };
  try {
    const result = getLedger().ingest({
      organizationId: body.organizationId ?? "northwind",
      meter: body.meter ?? "api_calls",
      quantity: body.quantity ?? 0,
      idempotencyKey: body.idempotencyKey ?? "",
    });
    persistLedger();
    return NextResponse.json(result, {
      status: result.status === "accepted" ? 201 : 200,
    });
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
