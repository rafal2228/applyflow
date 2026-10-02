import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "ApplyFlow",
  description:
    "Kanban board for your job search, with automatic AI grading and tailoring.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-svh">
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
