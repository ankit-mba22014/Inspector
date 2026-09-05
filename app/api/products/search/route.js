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

  const { items: rawItems, addressId: requestedAddressId } = await req.json();
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: 'No items provided' }, { status: 400 });
  }
  // Accepts either a plain name string or { name, spokenAs } — spokenAs is
  // what a learned correction gets taught under (see openSearchForRow in
  // app/cart/page.js), so it has to be checkable here too, not just `name`.
  const items = rawItems.map((i) => (typeof i === 'string' ? { name: i, spokenAs: null } : i));

  const swiggyToken = await getValidSwiggyToken(user.id);

  // Mock path — Swiggy not connected
  if (!swiggyToken) {
    const resolved = [];
    for (const { name: itemName } of items) {
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

    // No explicit address chosen (e.g. building a fresh cart) — prefer
    // wherever the last real order actually went, not whichever address
    // Swiggy happens to list first. Only relevant when requestedAddressId
    // is empty; an explicit choice (changeAddress) is never overridden.
    let defaultAddressId = requestedAddressId;
    if (!defaultAddressId) {
      try {
        const { data: lastOrder } = await createAdminSupabase()
          .from('order_history')
          .select('delivery_address_id')
          .eq('user_id', user.id)
          .not('delivery_address_id', 'is', null)
          .order('placed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastOrder?.delivery_address_id) defaultAddressId = lastOrder.delivery_address_id;
      } catch (e) {
        console.warn('Could not read last order address:', e.message);
      }
    }

    const address = addresses.find((a) => a.id === defaultAddressId) || addresses[0];

    // Brand preference from purchase history (optional — often empty for new users)
    let goToProducts = [];
    try {
      goToProducts = extractProducts(await instamart.yourGoToItems(address.id, swiggyToken));
    } catch (e) {
      console.warn('your_go_to_items unavailable:', e.message);
    }

    // Learned corrections: a word that failed to auto-match before, and the
    // user resolved manually — remembered so it matches directly next time
    // instead of failing again. Fetched once, keyed by normalized query.
    let learnedByQuery = {};
    try {
      const { data } = await createAdminSupabase()
        .from('user_preferences')
        .select('item_query, sku_id, spin_id, brand, product_name')
        .eq('user_id', user.id);
      (data || []).forEach((row) => { learnedByQuery[row.item_query] = row; });
    } catch (e) {
      console.warn('user_preferences unavailable:', e.message);
    }

    const resolved = [];
    for (const { name: itemName, spokenAs } of items) {
      try {
        const needle = itemName.toLowerCase();
        const preferred = goToProducts.find((p) => p.name.toLowerCase().includes(needle));
        // spokenAs first — that's what a correction gets taught under, and
        // it's far more stable across calls than the translated/refined
        // catalogue name, which can legitimately vary run to run (e.g.
        // "Yellow Mustard" one time, "Yellow Mustard Seeds" the next) since
        // refining it is the point, not something we want to pin down.
        const learned = (spokenAs && learnedByQuery[spokenAs.toLowerCase()]) || learnedByQuery[needle];

        let product;
        let fromPreference = false;
        let fromLearned = false;

        if (preferred) {
          product = preferred;
          product.chosenBecause = product.brand ? `${product.brand}, like always` : 'Ordered before';
          fromPreference = true;
        } else if (learned?.spin_id) {
          // Only skuId/spinId/quantity actually reach update_cart — the real
          // name/price/image come back fresh from get_cart once synced, so a
          // stale display name here isn't a correctness problem.
          product = {
            skuId: learned.sku_id,
            spinId: learned.spin_id,
            name: learned.product_name || itemName,
            brand: learned.brand || '',
            chosenBecause: 'You picked this before',
          };
          fromLearned = true;
        } else {
          product = pickBestMatch(
            await instamart.searchProducts(itemName, address.id, swiggyToken),
            itemName
          );
          // The English translation ("Yellow Mustard Seeds") sometimes finds
          // nothing usable even though Swiggy's own search handles the native
          // spoken term fine ("peela sarson") — same thing a manual search
          // would try. Only a second call, and only on that failure path.
          if (!product && spokenAs && spokenAs.toLowerCase() !== needle) {
            product = pickBestMatch(
              await instamart.searchProducts(spokenAs, address.id, swiggyToken),
              spokenAs
            );
          }
        }

        resolved.push({
          query: itemName,
          found: !!product,
          product: product || null,
          fromPreference,
          fromLearned,
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
