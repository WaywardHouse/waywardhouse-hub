import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const essays = (await getCollection('essays', ({ data }) => !data.draft))
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
  return rss({
    title: 'Wayward House — Essays',
    description: 'Long-form writing on place, economy, and environment.',
    site: context.site,
    items: essays.map((e) => ({
      title: e.data.title,
      pubDate: e.data.pubDate,
      description: e.data.dek ?? '',
      link: `/essays/${e.id}/`,
      categories: e.data.topics,
    })),
  });
}
