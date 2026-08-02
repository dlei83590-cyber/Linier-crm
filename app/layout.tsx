import type { Metadata } from "next";
import "swagger-ui-react/swagger-ui.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Linier CRM Management System",
  description: "福建利尼尔工业装备有限公司内部 CRM 管理系统",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
