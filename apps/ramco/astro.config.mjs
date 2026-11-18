// @ts-check
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'server', // Enable server-side rendering for MCP endpoints
  adapter: vercel(),
  site: 'https://scalar-astro-template.vercel.app',
  integrations: [
    starlight({
      title: 'RAMCO MCP',
      description: 'RAMCO MCP Server - Transform RAMCO API into an association analytics powerhouse',
      favicon: '/favicon/favicon.svg',
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Overview', slug: 'docs' },
            { label: 'Installation', slug: 'installation' },
            { label: 'Configuration', slug: 'configuration' },
          ],
        },
        {
          label: 'Documentation',
          items: [
            { label: 'Examples', slug: 'examples' },
            { label: 'Guides', slug: 'guides' },
          ],
        },
      ],
      expressiveCode: {
        themes: ['github-light', 'github-dark'],
      },
    }),
    mdx(),
    sitemap(),
    react(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
