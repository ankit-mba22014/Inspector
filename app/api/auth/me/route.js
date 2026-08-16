import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { getSwiggyToken } from '@/lib/swiggy/token';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ signedIn: false });

  const { token, reason } = await getSwiggyToken(user.id);

  return NextResponse.json({
    signedIn: true,
    profile: {
      id: user.id,
      name: user.display_name,
      phone: user.phone,
    },
    swiggyConnected: !!token,
    swiggyReason: reason,
  });
}
