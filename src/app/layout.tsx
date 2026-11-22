import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HN Inbox",
  description:
    "Real-time Hacker News reply inbox, story milestone alerts, and score tracking powered by Vercel Schedules and ScopeDB.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        {children}
      </body>
    </html>
  );
}
