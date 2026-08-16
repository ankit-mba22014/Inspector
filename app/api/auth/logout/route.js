import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { clearSessionCookie } from '@/lib/session';
import { clearSwiggyToken } from '@/lib/swiggy/token';

export async function POST() {
  const user = await currentUser();

  // Remove the stored Swiggy credentials too — they belong to the account,
  // not the browser, so leaving them behind would expose them to whoever
  // uses this machine next.
  if (user) await clearSwiggyToken(user.id);

  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
