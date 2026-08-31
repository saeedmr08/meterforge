import { NextResponse } from "next/server";

import { getLedger } from "@/lib/persist";

export async function GET() {
  return NextResponse.json({ data: getLedger().listPlans() });
}
