
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chemical Register",
  description: "Chemical Request Management System"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
