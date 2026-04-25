// ── AspectRatios — single source of truth for output dimensions ──────────────
// All width/height values MUST be divisible by 8 (VAE tile alignment).
// Never hardcode pixel dimensions outside this file.

export interface AspectRatio {
  id: string;
  label: string;
  cssRatio: string;   // value for CSS aspect-ratio property (e.g. '16/9')
  width: number;      // ComfyUI EmptyLatentImage width — divisible by 8
  height: number;     // ComfyUI EmptyLatentImage height — divisible by 8
  description: string;
}

export const ASPECT_RATIOS: AspectRatio[] = [
  {
    id: '16:9',
    label: '16:9',
    cssRatio: '16/9',
    width: 768,
    height: 432,
    description: 'Widescreen — film, TV, YouTube',
  },
  {
    id: '2.39:1',
    label: '2.39:1',
    cssRatio: '239/100',
    width: 856,
    height: 360,
    description: 'Cinemascope — anamorphic widescreen',
  },
  {
    id: '4:3',
    label: '4:3',
    cssRatio: '4/3',
    width: 768,
    height: 576,
    description: 'Classic TV / Academy ratio',
  },
  {
    id: '1:1',
    label: '1:1',
    cssRatio: '1/1',
    width: 512,
    height: 512,
    description: 'Square — social media',
  },
  {
    id: '9:16',
    label: '9:16',
    cssRatio: '9/16',
    width: 432,
    height: 768,
    description: 'Vertical — TikTok, Reels, Stories',
  },
];

export const DEFAULT_ASPECT_RATIO_ID = '16:9';

/** Resolve an aspect ratio id to its definition, falling back to the default. */
export function getAspectRatio(id: string | null | undefined): AspectRatio {
  return ASPECT_RATIOS.find((r) => r.id === id) ?? ASPECT_RATIOS[0];
}
