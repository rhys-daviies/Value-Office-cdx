import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Cardaxia Value Office",
  description: "Consultant-operated Value Office",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
