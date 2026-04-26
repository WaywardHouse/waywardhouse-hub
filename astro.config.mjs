// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://wayward.house',
  output: 'static',
  // Cloudflare adapter — needed once we add server endpoints (OG generation, etc.).
  // For a pure static build, comment this out. Re-enable with output:'hybrid'
  // when adding server routes. Note: CF adapter v13 has a known ASSETS binding
  // conflict on Pages; re-enable once that is resolved upstream.
  // adapter: cloudflare({ imageService: 'compile', platformProxy: { enabled: true } }),
  integrations: [
    mdx({
      // wh-image, Figure, PullQuote etc. are auto-imported via remark plugins
      // declared in src/content.config.ts on a per-collection basis.
      optimize: true,
    }),
    sitemap(),
  ],
  build: {
    // Pagefind reads /dist after build; assets must be hashable but reachable.
    assets: '_assets',
    inlineStylesheets: 'auto',
  },
  image: {
    // Astro's built-in image service. For Cloudflare Images, swap to
    // `imageService: 'cloudflare'` and provide the account/token in env.
    domains: ['images.unsplash.com'],
    remotePatterns: [{ protocol: 'https', hostname: '**.unsplash.com' }],
  },
  vite: {
    // Pagefind's static UI lives in /pagefind after build.
    build: { sourcemap: false },
  },
});
