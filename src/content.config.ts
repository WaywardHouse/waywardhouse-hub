import { defineCollection, z } from 'astro:content';
import { file } from 'astro/loaders';

const essays = defineCollection({
  loader: file("src/content/essays/_essays.json"),
  schema: z.object({
    id: z.string(),
    title: z.string(),
    dek: z.string().optional(),
    author: z.string().default('Paul Hobson'),
    pubDate: z.coerce.date(),
    topic: z.string(),
    topics: z.array(z.string()).default([]),
    readTime: z.number().default(10),
    coords: z.string().optional(),
    heroImage: z.string().optional(),
    heroTreatment: z.enum(['raw', 'warm', 'duotone', 'caption-bar']).optional(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const signals = defineCollection({
  loader: file("src/content/signals/_signals.json"),
  schema: z.object({
    id: z.string(),
    issue: z.number(),
    title: z.string(),
    pubDate: z.coerce.date(),
    topic: z.string(),
    summary: z.string(),
    bullets: z.array(z.string()).default([]),
    heroImage: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const books = defineCollection({
  loader: file("src/content/books/_books.json"),
  schema: z.object({
    id: z.string().optional(),               // used by file loader
    n: z.string(),                           // "01", "02", …
    title: z.string(),
    slug: z.string(),                        // route segment under /
    status: z.enum(['flagship', 'active', 'drafting', 'scaffolded', 'companion']),
    statusLabel: z.string(),
    description: z.string(),
    topics: z.array(z.string()).default([]),
    cover: z.object({
      mode: z.enum(['typographic', 'photo']).default('typographic'),
      color: z.string().default('#e02020'),
      image: z.string().optional(),          // image manifest id when mode=photo
      kicker: z.string().optional(),
    }),
    repo: z.string(),                        // github org/repo
    deployUrl: z.string().optional(),        // where Cloudflare routes to
    pdfUrl: z.string().optional(),
    chapters: z.array(z.object({
      n: z.string(),
      title: z.string(),
      part: z.string().optional(),
    })).default([]),
    featured: z.boolean().default(false),
  }),
});

const topics = defineCollection({
  loader: file("src/content/topics/_topics.json"), 
  schema: z.object({
    // Astro will now expect this file to be an array of these objects
    // OR an object where each value matches this schema
    id: z.string(), // The file loader usually requires an ID field or uses the key
    title: z.string(),
    slug: z.string(),
    description: z.string(),
    pillar: z.enum(['Geography', 'Economy', 'Energy', 'Systems', 'Places', 'Cartographic']).optional(),
  }),
});

export const collections = { essays, signals, books, topics };
