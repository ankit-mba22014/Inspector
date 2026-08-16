import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { extractPaymentFromBridge } from '@/lib/swiggy/bridge';

/**
 * Development helper — checks whether we can pull the UPI intent out of a
 * Swiggy payment page, and shows what the page actually contains if not.
 *
 *   /api/swiggy/bridge-probe?url=<bridgeUrl>
 */
export async function GET(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const url = new URL(req.url).searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'Pass ?url=<bridgeUrl>' }, { status: 400 });
  if (!/^https:\/\/([\w-]+\.)*swiggy\.com\//.test(url)) {
    return NextResponse.json({ error: 'Only Swiggy URLs' }, { status: 400 });
  }

  const found = await extractPaymentFromBridge(url);

  // If extraction failed, return enough of the page to work out why
  let pageHints = null;
  if (!found.upiUrl && !found.qrImage) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      const html = await res.text();
      pageHints = {
        status: res.status,
        contentType: res.headers.get('content-type'),
        length: html.length,
        // Is the QR rendered client-side? Then there's nothing in the HTML.
        looksClientRendered: /<div id="__next"|__NEXT_DATA__|window\.__/.test(html),
        mentionsUpi: /upi/i.test(html),
        hasCanvas: /<canvas/i.test(html),
        hasSvg: /<svg/i.test(html),
        hasImgTag: /<img/i.test(html),
        head: html.slice(0, 600),
      };
    } catch (e) {
      pageHints = { error: e.message };
    }
  }

  return NextResponse.json({
    upiUrl: found.upiUrl,
    hasQrImage: !!found.qrImage,
    qrImagePreview: found.qrImage ? found.qrImage.slice(0, 80) + '…' : null,
    pageHints,
  });
}
