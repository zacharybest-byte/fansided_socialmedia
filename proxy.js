import { NextResponse } from 'next/server';

// Simple username/password gate for the whole dashboard (set DASHBOARD_USER and DASHBOARD_PASSWORD
// in Vercel). /api/sync is excluded because it checks CRON_SECRET itself.
export function proxy(request) {
  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!user || !pass) return NextResponse.next();

  const header = request.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    const decoded = atob(header.slice(6));
    const i = decoded.indexOf(':');
    if (i > -1 && decoded.slice(0, i) === user && decoded.slice(i + 1) === pass) {
      return NextResponse.next();
    }
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="FanSided Social Dashboard"' },
  });
}

export const config = {
  matcher: ['/((?!api/sync|_next/static|_next/image|favicon.ico).*)'],
};
