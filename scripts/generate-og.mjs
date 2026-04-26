/**
 * generate-og.mjs — produce OG images for every essay, signal, and book.
 *
 * Runs after `astro build` (see package.json `postbuild:og`). Reads the built
 * site's content collections via the same JSON Astro emits at build time,
 * renders an SVG with Satori, rasterizes with @resvg/resvg-js, and writes
 * to `dist/og/...png` so the canonical /og/<route>.png URLs declared in
 * Layout.astro resolve.
 *
 * Design: black field, red rule, kicker in mono caps, title in Barlow
 * Condensed 80px, footer with coords + WH mark. Mirrors the site brand.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');
const ogDir = join(dist, 'og');

const fontPath = (n) => join(root, 'public', 'fonts', n);
const [barlowCond, barlowCondBold, mono] = await Promise.all([
  readFile(fontPath('BarlowCondensed-Regular.ttf')).catch(() => null),
  readFile(fontPath('BarlowCondensed-Bold.ttf')).catch(() => null),
  readFile(fontPath('IBMPlexMono-Regular.ttf')).catch(() => null),
]);

if (!barlowCond) {
  console.warn('[og] Fonts not found in /public/fonts — skipping OG generation. Drop the TTFs there to enable.');
  process.exit(0);
}

await mkdir(ogDir, { recursive: true });

function template({ kicker, title, footer }) {
  return {
    type: 'div',
    props: {
      style: {
        width: 1200, height: 630, display: 'flex', flexDirection: 'column',
        background: '#0a0a0a', color: '#fff', padding: '64px 72px',
        borderTop: '14px solid #e02020', justifyContent: 'space-between',
        fontFamily: 'Barlow Condensed',
      },
      children: [
        { type: 'div', props: { style: { fontFamily: 'IBM Plex Mono', fontSize: 22, letterSpacing: 4, textTransform: 'uppercase', color: '#f0a800' }, children: kicker } },
        { type: 'div', props: { style: { display: 'flex', flexDirection: 'column' }, children: [
          { type: 'div', props: { style: { fontSize: 92, fontWeight: 700, lineHeight: 1, textTransform: 'none' }, children: title } },
        ] } },
        { type: 'div', props: { style: { display: 'flex', justifyContent: 'space-between', fontFamily: 'IBM Plex Mono', fontSize: 22, letterSpacing: 4, textTransform: 'uppercase', color: '#9a9a94' }, children: [
          { type: 'div', props: { children: footer } },
          { type: 'div', props: { style: { color: '#fff' }, children: 'Wayward · House' } },
        ] } },
      ],
    },
  };
}

async function render({ kicker, title, footer }, outPath) {
  const fonts = [
    { name: 'Barlow Condensed', data: barlowCond, weight: 400, style: 'normal' },
    barlowCondBold && { name: 'Barlow Condensed', data: barlowCondBold, weight: 700, style: 'normal' },
    mono && { name: 'IBM Plex Mono', data: mono, weight: 400, style: 'normal' },
  ].filter(Boolean);
  const svg = await satori(template({ kicker, title, footer }), { width: 1200, height: 630, fonts });
  const png = new Resvg(svg).render().asPng();
  await writeFile(outPath, png);
  console.log('[og]', outPath.replace(dist + '/', ''));
}

async function walk(dir) {
  const out = [];
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(md|mdx)$/.test(f.name) && !f.name.startsWith('_')) out.push(p);
  }
  return out;
}

// Essays
for (const f of await walk(join(root, 'src', 'content', 'essays'))) {
  const { data } = matter(await readFile(f, 'utf8'));
  if (data.draft) continue;
  const slug = f.split('/').pop().replace(/\.(md|mdx)$/, '');
  await render({
    kicker: `Essay · ${data.topic}`,
    title: data.title,
    footer: data.coords ?? '53°32′N · 113°29′W',
  }, join(ogDir, 'essays', `${slug}.png`)).catch(async (e) => {
    await mkdir(join(ogDir, 'essays'), { recursive: true });
    return render({ kicker: `Essay · ${data.topic}`, title: data.title, footer: data.coords ?? '' }, join(ogDir, 'essays', `${slug}.png`));
  });
}

// Index card
await render({ kicker: 'Wayward House', title: 'Long-form writing on place, economy, and environment.', footer: 'wayward.house' }, join(ogDir, 'index.png'));
