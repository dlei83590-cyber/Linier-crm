import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "linier-crm",
    version: process.env.NEXT_PUBLIC_RELEASE_VERSION ?? "unknown",
    timestamp: new Date().toISOString(),
  });
}
