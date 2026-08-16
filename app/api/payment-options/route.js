import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { getValidSwiggyToken } from '@/lib/swiggy/token';
import { instamart, friendlyError } from '@/lib/swiggy/mcp';
import { extractPaymentOptions } from '@/lib/swiggy/normalise';

export async function GET(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const swiggyToken = await getValidSwiggyToken(user.id);
  if (!swiggyToken) {
    return NextResponse.json({
      mobile: [], desktop: [],
      cash: [{ id: 'Cash', label: 'Cash on delivery', kind: 'cash' }],
      hasUpi: false, mode: 'mock',
    });
  }

  try {
    const options = extractPaymentOptions(await instamart.getPaymentOptions(swiggyToken));
    return NextResponse.json({ ...options, mode: 'live' });
  } catch (err) {
    const unauth = err.kind === 'auth';
    return NextResponse.json(
      { error: err.message, needsSwiggyAuth: unauth },
      { status: unauth ? 401 : 500 }
    );
  }
}
