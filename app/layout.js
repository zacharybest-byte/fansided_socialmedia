import './globals.css';

export const metadata = {
  title: 'FanSided · Facebook Pages',
  description: 'Follower and engagement dashboard for all FanSided Facebook Pages',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a href="/" className="brand">FanSided <span>Facebook Pages</span></a>
          <a href="/api/export" className="btn">Export CSV</a>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
