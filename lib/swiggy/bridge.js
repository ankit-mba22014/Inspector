/**
 * Swiggy's checkout response gives us a `bridgeUrl` — an HTTPS page that shows
 * a UPI QR and an "open in your UPI app" button. On desktop we'd rather show
 * that QR in place than send the user to another tab mid-payment.
 *
 * The URL itself is an opaque deeplink-redirect token, so a QR of it would just
 * open a browser. The real `upi://pay?...` string only exists inside that page,
 * so we fetch it server-side and pull it out.
 *
 * This depends on Swiggy's page markup, so every caller must handle null and
 * fall back to opening the page directly.
 */

const UPI_SCHEMES = /(?:upi|tez|phonepe|paytmmp|gpay|bhim):\/\/[^\s"'<>\\]+/i;

/** Undoes the HTML entity escaping that appears in server-rendered markup. */
function unescapeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Returns { upiUrl, qrImage } from a Swiggy payment bridge page.
 *
 *   upiUrl  — the real UPI intent string, if we can find it
 *   qrImage — a data: or https: QR image already on the page, as a fallback
 */
export async function extractPaymentFromBridge(bridgeUrl) {
  if (!bridgeUrl) return { upiUrl: null, qrImage: null };

  let html;
  try {
    const res = await fetch(bridgeUrl, {
      redirect: 'follow',
      headers: {
        // Some pages vary their markup by client; ask as a normal browser.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return { upiUrl: null, qrImage: null };
    html = await res.text();
  } catch (err) {
    console.warn('Could not read the Swiggy payment page:', err.message);
    return { upiUrl: null, qrImage: null };
  }

  // 1. A UPI intent anywhere in the markup — usually the button's href.
  const direct = html.match(UPI_SCHEMES);
  if (direct) return { upiUrl: unescapeHtml(direct[0]), qrImage: null };

  // 2. Escaped inside a JSON blob (Next.js/Nuxt hydration payloads do this).
  const escaped = html.match(/(?:upi|tez|phonepe|paytmmp):\\\/\\\/[^"'\\]+/i);
  if (escaped) {
    return { upiUrl: unescapeHtml(escaped[0].replace(/\\\//g, '/')), qrImage: null };
  }

  // 3. Percent-encoded inside another URL.
  const encoded = html.match(/(?:upi|tez|phonepe)%3A%2F%2F[^"'&\s]+/i);
  if (encoded) {
    try {
      return { upiUrl: decodeURIComponent(encoded[0]), qrImage: null };
    } catch { /* fall through */ }
  }

  // 4. No intent string, but the page may embed the QR as an image we can reuse.
  const dataImg = html.match(/data:image\/(?:png|svg\+xml|jpeg);base64,[A-Za-z0-9+/=]+/);
  if (dataImg) return { upiUrl: null, qrImage: dataImg[0] };

  const svg = html.match(/<svg[^>]*>[\s\S]*?<\/svg>/i);
  if (svg && /qr/i.test(html.slice(Math.max(0, html.indexOf(svg[0]) - 300), html.indexOf(svg[0])))) {
    return {
      upiUrl: null,
      qrImage: `data:image/svg+xml;base64,${Buffer.from(svg[0]).toString('base64')}`,
    };
  }

  return { upiUrl: null, qrImage: null };
}
