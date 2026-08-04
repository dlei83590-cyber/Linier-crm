import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "linier-crm",
    version: "0.1.0-alpha",
    timestamp: new Date().toISOString(),
    database: "pending",
  });
}
