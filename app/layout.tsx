import './globals.css';

export const metadata = {
  title: 'HomeFlow Demo — Household Coordinator',
  description: 'Single-household operations demo agent with MCP approval flow and ephemeral SQLite storage.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
