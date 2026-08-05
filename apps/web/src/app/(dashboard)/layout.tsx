"use client";

import { SessionProvider } from "@/lib/session-context";
import { AdminShell } from "@/components/layout/admin-shell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  );
}
