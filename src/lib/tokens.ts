/**
 * Wayward House design tokens (TS).
 * Mirrored from /src/styles/global.css :root variables for use in OG generation,
 * generated covers, and any island that wants the canonical hex.
 */
export const tokens = {
  black: '#0a0a0a',
  dark: '#1c1c1a',
  dark2: '#242420',
  mid: '#5a5a56',
  muted: '#9a9a94',
  rule: '#d0d0c8',
  ruleLight: '#e8e8e4',
  paper: '#f8f8f4',
  white: '#ffffff',
  red: '#e02020',
  redDark: '#b81818',
  amber: '#f0a800',
  fontDisplay: "'Barlow Condensed', 'Arial Narrow', sans-serif",
  fontBody: "'Barlow', Arial, sans-serif",
  fontRead: "'Literata', Georgia, serif",
  fontMono: "'IBM Plex Mono', 'Courier New', monospace",
} as const;

export const navItems = [
  { label: 'Essays', key: 'essays', href: '/essays/' },
  { label: 'System Signals', key: 'signals', href: '/signals/' },
  { label: 'Library', key: 'library', href: '/library/' },
  { label: 'Topics', key: 'topics', href: '/topics/' },
  { label: 'About', key: 'about', href: '/about/' },
] as const;

export type NavKey = (typeof navItems)[number]['key'];
