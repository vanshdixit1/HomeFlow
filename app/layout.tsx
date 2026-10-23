import './globals.css';

export const metadata = { title: 'HomeFlow — Household Coordinator', description: 'Alexa+ powered household operations agent with MCP approval flow.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}