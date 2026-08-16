import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/server';
import { getValidSwiggyToken } from '@/lib/swiggy/token';
import { instamart, SwiggyMCPError, friendlyError } from '@/lib/swiggy/mcp';
import { extractAddresses, extractProducts, pickBestMatch } from '@/lib/swiggy/normalise';
import { mockInstamart } from '@/lib/swiggy/mock';

export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { items, addressId: requestedAddressId } = await req.json();
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'No items provided' }, { status: 400 });
  }

  const swiggyToken = await getValidSwiggyToken(user.id);

  // Mock path — Swiggy not connected
  if (!swiggyToken) {
    const resolved = [];
    for (const itemName of items) {
      const pref = await mockInstamart.yourGoToItems(itemName);
      const product = pref.preferred || (await mockInstamart.searchProducts(itemName)).results[0];
      resolved.push({ query: itemName, found: !!product, product, source: 'mock' });
    }
    return NextResponse.json({ resolved, mode: 'mock', needsSwiggyAuth: true });
  }

  // Live path
  try {
    const addrRaw = await instamart.getAddresses(swiggyToken);
    const addresses = extractAddresses(addrRaw);

    if (addresses.length === 0) {
      return NextResponse.json(
        {
          error: 'Could not read any delivery address from your Swiggy account.',
          debug: process.env.NODE_ENV === 'development' ? addrRaw : undefined,
        },
        { status: 400 }
      );
    }

    const address = addresses.find((a) => a.id === requestedAddressId) || addresses[0];

    // Brand preference from purchase history (optional — often empty for new users)
    let goToProducts = [];
    try {
      goToProducts = extractProducts(await instamart.yourGoToItems(address.id, swiggyToken));
    } catch (e) {
      console.warn('your_go_to_items unavailable:', e.message);
    }

    const resolved = [];
    for (const itemName of items) {
      try {
        const needle = itemName.toLowerCase();
        const preferred = goToProducts.find((p) => p.name.toLowerCase().includes(needle));

        let product = preferred;
        if (product) {
          product.chosenBecause = 'You order this regularly';
        } else {
          product = pickBestMatch(
            await instamart.searchProducts(itemName, address.id, swiggyToken),
            itemName
          );
        }

        resolved.push({
          query: itemName,
          found: !!product,
          product: product || null,
          fromPreference: !!preferred,
          source: 'live',
        });
      } catch (err) {
        resolved.push({ query: itemName, found: false, product: null, error: err.message });
      }
    }

    return NextResponse.json({ resolved, mode: 'live', address, addresses });
  } catch (err) {
    if (err instanceof SwiggyMCPError && err.kind === 'auth') {
      return NextResponse.json(
        { error: 'Your Swiggy session has ended', needsSwiggyAuth: true },
        { status: 401 }
      );
    }
    console.error('Live search failed:', err);
    return NextResponse.json({ error: friendlyError(err) }, { status: 500 });
  }
}
