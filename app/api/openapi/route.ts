import { NextResponse } from "next/server";
import { openapi } from "@/src/lib/openapi";

export function GET() {
  return NextResponse.json(openapi);
}
