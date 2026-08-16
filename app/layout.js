export const metadata = {
  title: "Inspector — Scan your fridge, order what's missing",
  description: 'AI-powered fridge scanner and Instamart ordering for Indian kitchens',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
