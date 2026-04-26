/**
 * Image manifest — machine-readable source of truth for <WhImage>.
 * Mirror of the design's IMG_LIBRARY across the five content pillars.
 *
 * To vendor the actual photographs into the repo (recommended for production):
 *   1. Download each Unsplash original.
 *   2. Save under public/images/<pillar>/<slug>.jpg
 *   3. Set `unsplash: undefined` for that entry — the component will switch to
 *      the local file and Astro's image service will generate responsive sizes.
 */
export type Pillar = 'Geography' | 'Energy' | 'Systems' | 'Places' | 'Cartographic';
export type Treatment = 'raw' | 'warm' | 'duotone' | 'caption-bar';

export interface ImageEntry {
  id: string;
  pillar: Pillar;
  slug: string;
  unsplash?: string;          // photo ID — drop this once vendored locally
  title: string;
  coords: string;
  author: string;
  source?: string;
  license?: string;
  mood: string[];
  notes?: string;
  defaultTreatment?: Treatment;
  /** First entry is the natural aspect of the photograph. */
  aspects?: string[];
}

export const library: ImageEntry[] = [
  // Geography
  { id: 'geo-01', pillar: 'Geography', slug: 'braided-river-aerial', unsplash: '1506905925346-21bda4d32df4',
    title: 'Braided river, aerial', coords: '44.6°N · 110.4°W', author: 'Luca Bravo',
    license: 'Unsplash License', mood: ['cinematic', 'field-journal'],
    notes: 'Top-down braid pattern — reads as diagram + photograph at once.',
    defaultTreatment: 'warm', aspects: ['3/2', '21/9'] },
  { id: 'geo-02', pillar: 'Geography', slug: 'glacial-valley-dusk', unsplash: '1464822759023-fed622ff2c3b',
    title: 'Glacial valley at dusk', coords: '46.8°N · 7.6°E', author: 'Bailey Zindel',
    mood: ['cinematic'], defaultTreatment: 'duotone', aspects: ['21/9', '3/2'] },
  { id: 'geo-03', pillar: 'Geography', slug: 'coastline-satellite', unsplash: '1500534314209-a25ddb2bd429',
    title: 'Fjord coastline', coords: '60.9°N · 6.5°E', author: 'Robert Lukeman',
    mood: ['cinematic', 'field-journal'], defaultTreatment: 'warm', aspects: ['3/2'] },
  { id: 'geo-04', pillar: 'Geography', slug: 'prairie-section-road', unsplash: '1470071459604-3b5ec3a7fe05',
    title: 'Prairie section road', coords: '52.1°N · 106.6°W', author: 'Benjamin Voros',
    mood: ['field-journal', 'documentary'], defaultTreatment: 'caption-bar', aspects: ['3/2'] },

  // Energy
  { id: 'egy-01', pillar: 'Energy', slug: 'transmission-at-night', unsplash: '1473341304170-971dccb5ac1e',
    title: 'Transmission corridor at night', coords: '53.5°N · 113.5°W', author: 'Matthew Henry',
    mood: ['cinematic'], defaultTreatment: 'duotone', aspects: ['21/9', '3/2'] },
  { id: 'egy-02', pillar: 'Energy', slug: 'wind-turbines-flat-light', unsplash: '1466611653911-95081537e5b7',
    title: 'Wind turbines, flat light', coords: '54.8°N · 3.0°W', author: 'Karsten Würth',
    mood: ['documentary', 'field-journal'], defaultTreatment: 'warm', aspects: ['3/2'] },
  { id: 'egy-03', pillar: 'Energy', slug: 'refinery-dawn', unsplash: '1548337138-e87d889cc369',
    title: 'Refinery stacks at dawn', coords: '53.6°N · 113.2°W', author: 'Patrick Hendry',
    mood: ['cinematic', 'documentary'], defaultTreatment: 'duotone', aspects: ['21/9'] },
  { id: 'egy-04', pillar: 'Energy', slug: 'solar-array-oblique', unsplash: '1509391366360-2e959784a276',
    title: 'Solar array, oblique', coords: '36.1°N · 115.1°W', author: 'American Public Power',
    mood: ['documentary'], defaultTreatment: 'warm', aspects: ['3/2'] },

  // Systems
  { id: 'sys-01', pillar: 'Systems', slug: 'data-hall-cables', unsplash: '1558494949-ef010cbdcc31',
    title: 'Data hall, cable plane', coords: 'Ashburn · VA', author: 'Taylor Vick',
    mood: ['cinematic', 'documentary'], defaultTreatment: 'duotone', aspects: ['3/2'] },
  { id: 'sys-02', pillar: 'Systems', slug: 'circuit-macro', unsplash: '1518770660439-4636190af475',
    title: 'Circuit board, macro', coords: 'Macro · 10mm', author: 'Alexandre Debiève',
    mood: ['documentary', 'technical'], defaultTreatment: 'raw', aspects: ['3/2'] },
  { id: 'sys-03', pillar: 'Systems', slug: 'nodes-and-threads', unsplash: '1451187580459-43490279c0fa',
    title: 'Network abstraction', coords: 'Earth · night', author: 'NASA',
    mood: ['cinematic'], defaultTreatment: 'duotone', aspects: ['21/9'] },
  { id: 'sys-04', pillar: 'Systems', slug: 'terminal-amber', unsplash: '1555949963-aa79dcee981c',
    title: 'Terminal, amber-on-black', coords: 'Local · 03:14', author: 'Markus Spiske',
    mood: ['cinematic', 'technical'], defaultTreatment: 'raw', aspects: ['3/2'] },

  // Places
  { id: 'pl-01', pillar: 'Places', slug: 'rural-station-platform', unsplash: '1507608616759-54f48f0af0ee',
    title: 'Rural station platform', coords: '52.9°N · 1.8°W', author: 'Annie Spratt',
    mood: ['documentary', 'field-journal'], defaultTreatment: 'warm', aspects: ['3/2'] },
  { id: 'pl-02', pillar: 'Places', slug: 'hands-over-topo', unsplash: '1488646953014-85cb44e25828',
    title: 'Hands over topographic map', coords: 'Studio · field', author: 'Hari Nandakumar',
    mood: ['documentary', 'technical'], defaultTreatment: 'warm', aspects: ['3/2'] },
  { id: 'pl-03', pillar: 'Places', slug: 'smokestack-street', unsplash: '1519608487953-e999c86e7455',
    title: 'Industrial town, winter', coords: '51.2°N · 81.9°W', author: 'NeONBRAND',
    mood: ['documentary', 'cinematic'], defaultTreatment: 'caption-bar', aspects: ['3/2'] },
  { id: 'pl-04', pillar: 'Places', slug: 'port-cranes-hazed', unsplash: '1519003722824-194d4455a60c',
    title: 'Port cranes, hazed', coords: '49.3°N · 123.1°W', author: 'Mika Baumeister',
    mood: ['cinematic', 'documentary'], defaultTreatment: 'duotone', aspects: ['3/2'] },

  // Cartographic
  { id: 'crt-01', pillar: 'Cartographic', slug: 'hand-drawn-contour', unsplash: '1524661135-423995f22d0b',
    title: 'Hand-drawn contour sheet', coords: 'Field notebook', author: 'Andrew Neel',
    mood: ['technical', 'field-journal'], defaultTreatment: 'raw', aspects: ['3/2'] },
  { id: 'crt-02', pillar: 'Cartographic', slug: 'nautical-chart-detail', unsplash: '1569718212165-3a8278d5f624',
    title: 'Nautical chart, detail', coords: 'Chart · No. 4010', author: 'Timo Wielink',
    mood: ['technical'], defaultTreatment: 'raw', aspects: ['3/2'] },
  { id: 'crt-03', pillar: 'Cartographic', slug: 'topo-map-oblique', unsplash: '1519451241324-20b4ea2c4220',
    title: 'Topographic map, oblique', coords: 'Map · 1:50 000', author: 'Aaron Burden',
    mood: ['technical', 'documentary'], defaultTreatment: 'warm', aspects: ['3/2'] },
  { id: 'crt-04', pillar: 'Cartographic', slug: 'schematic-diagram-bw', unsplash: '1581093588401-fbb62a02f120',
    title: 'Mechanical schematic', coords: 'Drawing · rev 04', author: 'ThisisEngineering',
    mood: ['technical'], defaultTreatment: 'raw', aspects: ['3/2'] },
];

export const manifest: Record<string, ImageEntry> = Object.fromEntries(
  library.map((e) => [e.id, e]),
);

export type ImageId = string;
