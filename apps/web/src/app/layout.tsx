import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nilier CRM",
  description: "Enterprise customer relationship management platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
