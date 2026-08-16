# Inspector

Photograph your fridge. Order what's missing on Swiggy Instamart.

Built on the [Swiggy MCP Builders Club](https://mcp.swiggy.com/builders/).

---

## How it works

```
📷 Photo of your fridge
      ↓  Claude Vision reads what's there and what's low
🔍 Items matched to real Instamart products
      ↓  preferring brands you already buy, then bestsellers and ratings
🛒 Cart you can edit — change quantities, add anything the scan missed
      ↓  UPI (app on mobile, scan-QR on desktop) or cash
🛵 Live order tracking through to delivery
```

## Sign-in

Swiggy OAuth is the only sign-in — phone number and OTP, no separate account.
Inspector holds a session cookie; the Swiggy access token stays encrypted on
the server and never reaches the browser.

Swiggy tokens last five days and there are no refresh tokens, so signing in
again is a normal part of the flow, not an error.

## Setup

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run dev
```

Run `supabase/schema.sql` in the Supabase SQL editor once before first use.

| Variable | Where it comes from |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `SESSION_SECRET` | `openssl rand -base64 32` |

`SWIGGY_BASE_URL` and `SWIGGY_REDIRECT_URI` are pre-filled. There's no Swiggy
client id or secret to obtain — Swiggy issues one via Dynamic Client
Registration, handled in `lib/swiggy/dcr.js`.

Changing `TOKEN_ENCRYPTION_KEY` makes stored tokens unreadable and everyone
signs in again.

## Architecture

```
Browser  ──cookie──▶  Next.js API routes  ──service_role──▶  Supabase
                              │
                              └──Bearer token──▶  Swiggy Instamart MCP
```

The browser never talks to Supabase or Swiggy directly. Every request carries
only a signed session cookie; the server looks up the user, decrypts their
Swiggy token, and makes the call.

## Structure

```
app/
  welcome/            sign-in
  page.js             scan a fridge, see results
  cart/               review, edit, pay
  order/[id]/         live tracking
  orders/             order history
  debug/              raw MCP responses (development)
  api/
    auth/             OAuth start, callback, session, logout
    analyse/          Claude Vision
    products/         item → SKU matching, free-text search
    cart/             read and replace the Instamart cart
    checkout/         place the order
    payment-options/  what the user can pay with
    payment-status/   poll an in-flight UPI payment
    track/[orderId]/  delivery status
lib/
  session.js          signed session cookie
  auth.js             current user from that cookie
  supabase/server.js  service_role client (server only)
  swiggy/             MCP client, DCR, identity, token storage, response parsing
supabase/schema.sql
```

## Notes on the Swiggy API

Things that aren't obvious from the tool list:

- `update_cart` **replaces** the cart — always send the full desired contents.
- Parameter naming differs per tool: `addressId` for `search_products` and
  `checkout`, `selectedAddressId` for `update_cart`.
- Products carry no top-level SKU; each entry in `variations[]` has its own
  `skuId` and `spinId`, and `update_cart` needs both.
- UPI on desktop needs `generateUPIQR: true`. Intent app ids are Android deep
  links and do nothing from a laptop.
- `check_payment_status` is a long-poll the server holds for ~19s. Honour the
  cadence `checkout` returns rather than looping.
- On terminal payment success Swiggy confirms the order itself — don't call
  `confirm_order` as well.
- Errors arrive as HTTP 200 with `isError: true`, so the envelope's `success`
  field isn't the thing to check.

---

## Things the docs say that are easy to get wrong

Collected while building — each of these caused a real bug here first.

**Cart**
- `update_cart` **replaces** the cart. Always send the full desired contents.
- Switching delivery address mid-cart needs `clear_cart` first, or SKUs stay
  bound to the old store.
- Products carry no top-level SKU. Each entry in `variations[]` has its own
  `spinId` and `skuId`, and you add variations, not parent products.
- Parameter naming differs per tool: `addressId` for `search_products` and
  `checkout`, `selectedAddressId` for `update_cart`.

**Payment**
- `get_cart` does **not** return UPI methods. `get_payment_options` is the only
  source, and it returns both device surfaces at once.
- The checkout response includes `bridgeUrl` — an HTTPS link to Swiggy's own
  payment page that renders a QR on desktop and an app-open button on mobile.
  Don't render your own QR.
- `check_payment_status` is a long-poll the server holds ~19s. Honour
  `pollingIntervalInMs` / `maxTimeToPollForInMs` from checkout; tight-looping
  stresses their payment cache.
- On terminal success Swiggy usually confirms the order itself. Only call
  `confirm_order` when `data.confirmed` is false, or once if you hit your cap
  while still pending.
- `confirm_order` on Instamart takes `orderId` + `paasId`. Food's signature is
  different.
- Never ask for a UPI ID — NPCI compliance. The picker and QR handle it.

**Orders**
- Instamart has a ₹99 minimum and a ₹1000 ceiling for MCP checkout.
- `checkout` is **not** idempotent. On 5xx, wait a few seconds and check
  `get_orders` before retrying, or you risk charging twice.
- Cancellation isn't available through MCP — direct users to Swiggy on
  080-67466729.

**Errors**
- Tool failures arrive as HTTP 200 with `isError: true`, so the envelope's
  `success` field isn't what to check.
- No symbolic `error.code` yet — classify on HTTP status, JSON-RPC code
  (`-32001` auth, `-32603` internal), and message text.
- Retry only upstream and internal failures, with exponential backoff and
  jitter, capped at 30s of wall clock.

**Sessions**
- Tokens last 5 days and there are no refresh tokens — re-auth is normal.
- Using the Swiggy app at the same time can revoke the MCP session.

**Not available yet**
- `apply_coupon` / `list_coupons` are documented but absent from `tools/list`
  and from the Instamart overview tables.
- There's no cancel tool. Orders can only be cancelled by calling Swiggy on
  080-6746 6729, and Instamart orders often can't be cancelled at all — the
  tracking screen says so rather than leaving a dead end.
- `create_address` is wrapped but unused; Inspector only picks from addresses
  already on the account rather than creating new ones.
