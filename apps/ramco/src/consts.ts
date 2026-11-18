// Place any global data in this file.
// You can import this data from anywhere in your site by using the `import` keyword.

export const SITE_TITLE = 'RAMCO MCP Server';
export const SITE_DESCRIPTION =
  'Model Context Protocol (MCP) server for RAMCO AMS API integration. Connect Claude to your RAMCO association management system with 17+ powerful tools for member management, analytics, and insights.';

export const SITE_METADATA = {
  title: {
    default: SITE_TITLE,
    template: '%s | RAMCO MCP',
  },
  description: SITE_DESCRIPTION,
  keywords: [
    'RAMCO',
    'MCP',
    'Model Context Protocol',
    'API',
    'Association Management',
    'Claude',
    'AI Integration',
    'Member Management',
  ],
  authors: [{ name: 'Warren Burrows' }],
  creator: 'Warren Burrows',
  publisher: 'AMS MCP',
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: '/favicon/favicon.ico', sizes: '48x48' },
      { url: '/favicon/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
      { url: '/favicon/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon/favicon.ico' },
    ],
    apple: [{ url: '/favicon/apple-touch-icon.png', sizes: '180x180' }],
    shortcut: [{ url: '/favicon/favicon.ico' }],
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: 'RAMCO MCP',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'RAMCO MCP Server - Connect Claude to RAMCO AMS',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ['/og-image.jpg'],
    creator: '@warrenburrows',
  },
};
