import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const issues = (await getCollection('signals', ({ data }) => !data.draft))
    .sort((a, b) => b.data.issue - a.data.issue);
  return rss({
    title: 'Wayward House — System Signals',
    description: 'Monthly digest of energy, infrastructure, and spatial systems in motion.',
    site: context.site,
    items: issues.map((s) => ({
      title: `№ ${String(s.data.issue).padStart(3, '0')} — ${s.data.title}`,
      pubDate: s.data.pubDate,
      description: s.data.summary,
      link: `/signals/${s.id}/`,
    })),
  });
}
