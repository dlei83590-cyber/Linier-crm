import { NextResponse } from "next/server";
import { withErrorHandler } from "@/src/lib/http/handler";

export const GET = withErrorHandler(() =>
  NextResponse.json({ status: "ok", service: "linier-crm" }),
);
