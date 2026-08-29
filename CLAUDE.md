# Inspector

Photograph your fridge → Claude Vision works out what's running low → order it on
Swiggy Instamart. Built on the Swiggy MCP Builders Club.

Live: https://inspector-azure.vercel.app

---

## Read the Swiggy docs before writing MCP code

Swiggy publishes their docs in an LLM-readable form. **Consult them rather than
inferring behaviour from tool names** — several of the notes below exist because
we guessed instead of reading, and lost hours to it.

- Index: https://mcp.swiggy.com/builders/llms.txt
- Everything: https://mcp.swiggy.com/builders/llms-full.txt
- Any docs page as markdown: append `.md` to its URL

Never invent tool names, parameters, or response shapes. Verify first.

---

## Architecture

```
Browser ──session cookie──▶ Next.js API routes ──service_role──▶ Supabase
                                    │
                                    └──Bearer token──▶ Swiggy Instamart MCP
```

The browser never talks to Supabase or Swiggy directly. Every request carries
only a signed session cookie; the server looks up the user, decrypts their
Swiggy token, and makes the call.

- **Sign-in is Swiggy OAuth only.** No Supabase Auth, no passwords. `lib/session.js`
  mints a signed cookie after the OAuth callback.
- **Swiggy tokens last 5 days with no refresh token.** Re-authentication is a
  normal part of the flow, not an error state. Handle 401 by offering sign-in again.
- Tokens are encrypted (AES-256-GCM) before storage. Changing `TOKEN_ENCRYPTION_KEY`
  makes existing tokens unreadable.

---

## Swiggy MCP: things that are easy to get wrong

Each of these caused a real bug here first.

**Cart**
- `update_cart` **replaces** the cart. Always send the complete desired contents,
  never a delta. Sending items one at a time leaves only the last one.
- Switching delivery address mid-cart needs `clear_cart` first, or SKUs stay bound
  to the old store.
- Products carry no top-level SKU. Each entry in `variations[]` has its own
  `spinId` and `skuId`, and `update_cart` needs **both**.
- Parameter naming differs per tool: `addressId` for `search_products` and
  `checkout`, `selectedAddressId` for `update_cart`.

**Payment**
- `get_cart` does not return payment methods. `get_payment_options` is the only
  source, and it returns both device surfaces at once under `platforms.mobile`
  and `platforms.desktop`.
- Mobile methods arrive as bare intent schemes (`gpay://upi/`) with no label.
  Map them to app names before display.
- Desktop needs `generateUPIQR: true`. Intent app ids are deep links and do
  nothing from a laptop.
- **iOS blocks navigation to app schemes unless it comes from a direct tap.**
  Never call `window.location.href` after an `await` — render an anchor instead.
- `check_payment_status` is a long-poll the server holds ~19s. Honour
  `pollingIntervalInMs` / `maxTimeToPollForInMs` from the checkout response.
- On terminal success Swiggy usually confirms the order itself. Only call
  `confirm_order` when `confirmed` is false, or once if you hit your polling cap.
- `confirm_order` on Instamart takes `orderId` + `paasId`. Food's signature differs.
- Never ask for a UPI ID — NPCI compliance.

**Orders**
- Instamart has a ₹99 minimum and ₹1000 ceiling for MCP checkout.
- `checkout` is **not idempotent**. On 5xx, wait a few seconds and check
  `get_orders` before retrying, or you risk charging twice.
- `track_order` requires `lat`/`lng`. They only come from `get_cart`'s
  `selectedAddressDetails`, which is cleared once the order is placed — so we
  capture them at checkout into `order_history`.
- In `track_order`, `status` is an **object** (`{statusMessage: "..."}`), not a
  string. Comparing it directly silently never matches.
- `pollingIntervalSeconds: -1` means the order is terminal. Stop polling.
- There is no cancel tool. Direct users to Swiggy on 080-6746 6729.

**Errors**
- Tool failures arrive as **HTTP 200 with `isError: true`**. The envelope's
  `success` field is not what to check.
- No symbolic error codes yet. Classify on HTTP status, JSON-RPC code
  (`-32001` auth, `-32603` internal), and message text. See `lib/swiggy/mcp.js`.
- Retry only upstream and internal failures, with backoff and jitter.

**Not available**
- `apply_coupon` / `list_coupons` are documented but absent from `tools/list`.
  This is why our totals can be higher than the Swiggy app's.
- Using the Swiggy app at the same time can revoke the MCP session.

---

## Working here

**Layout**
```
app/
  page.js             scan (up to 2 photos, analysed together)
  cart/               review, edit, pay
  order/[id]/         live tracking
  orders/             order history
  welcome/            sign-in
  debug/              raw MCP responses — development only
  api/                see README for the full route list
lib/
  session.js          signed session cookie
  auth.js             currentUser() — use this, never Bearer tokens
  swiggy/             MCP client, DCR, identity, tokens, response parsing
supabase/schema.sql   full schema; migrations applied by hand
```

**Conventions**
- API routes authenticate with `currentUser()` from `lib/auth.js`. There is no
  Bearer-token path any more.
- All Swiggy response parsing lives in `lib/swiggy/normalise.js`. Add extractors
  there rather than reaching into raw payloads from a route.
- Swiggy's shapes are inconsistent and undocumented in places. Parse defensively,
  and prefer reading the real response over assuming.
- User-facing copy: plain English, no jargon, no Hinglish. Say what happened and
  what to do about it. `friendlyError()` in `lib/swiggy/mcp.js` handles the
  common failures.

**Before saying a change works**
- `npm run build` — a clean build does not catch undefined identifiers inside
  route handlers, which have bitten us more than once.
- Start the dev server and hit the affected routes. A 500 with an empty body
  means the handler threw before responding.

**Database**
- Migrations in `supabase/` are applied by hand in the Supabase SQL editor, never
  automatically. `schema.sql` holds the full current shape for fresh installs.
- Adding a column means: update `schema.sql`, add a numbered migration, and say
  clearly that it needs running.

**Deploys**
- `main` auto-deploys to production and is what Swiggy may look at. Work on
  branches.
- Only `inspector-azure.vercel.app` is allowlisted for OAuth — sign-in will not
  work on Vercel preview URLs.

---

## Testing payments

Checkout places **real orders with real money** on the signed-in Swiggy account.
When testing the flow, stop at the cart review step unless you actually want the
groceries. There is no way to cancel an Instamart order through the MCP.