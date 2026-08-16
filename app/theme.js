/**
 * Inspector design tokens — matched to Swiggy's own consent-screen palette
 * so the app reads as a native part of the Swiggy ecosystem.
 */

export const T = {
  // Swiggy's signature orange (sampled from their OAuth consent screen)
  orange: '#FC8019',
  orangeDeep: '#E8640C',
  orangeSoft: '#FFF3E9',

  // Structure
  ink: '#1C1C1C',
  inkSoft: '#3D4152',
  muted: '#7E808C',
  hairline: '#E9E9EB',
  card: '#FFFFFF',

  // Status
  red: '#C0392B',
  redSoft: '#FDECEA',
  amber: '#B07A0A',
  amberSoft: '#FEF6E4',
  green: '#1BA672',
  greenSoft: '#E9F7F1',
};

// The centered card shell — fills the screen on mobile,
// floats as a card on orange on desktop.
export const shell = {
  page: {
    minHeight: '100vh',
    background: T.orange,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: '0',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    WebkitFontSmoothing: 'antialiased',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    background: T.card,
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
  },
  // Header sits INSIDE the card
  header: {
    padding: '20px 22px 16px',
    borderBottom: `1px solid ${T.hairline}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  brand: {
    fontSize: 21,
    fontWeight: 700,
    color: T.ink,
    letterSpacing: '-0.3px',
    margin: 0,
    lineHeight: 1.2,
  },
  tagline: {
    fontSize: 13,
    color: T.muted,
    margin: '3px 0 0',
  },
  body: {
    padding: '20px 22px 40px',
    flex: 1,
  },
  ghostBtn: {
    background: 'transparent',
    border: `1px solid ${T.hairline}`,
    color: T.muted,
    borderRadius: 999,
    padding: '6px 14px',
    fontSize: 13,
    cursor: 'pointer',
    flexShrink: 0,
    fontFamily: 'inherit',
  },
  primaryBtn: {
    width: '100%',
    background: T.orange,
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '15px',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  successBtn: {
    width: '100%',
    background: T.green,
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '15px',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};

// Desktop-only: give the card breathing room and rounded corners.
// Injected as a <style> tag since inline styles can't hold media queries.
export const responsiveCSS = `
  html, body { margin: 0; padding: 0; background: ${T.orange}; }
  * { box-sizing: border-box; }
  @media (min-width: 520px) {
    .ins-card {
      min-height: auto !important;
      margin: 32px 0 48px;
      border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.16);
      overflow: hidden;
    }
    .ins-page { align-items: center !important; padding: 0 20px !important; }
  }
`;
