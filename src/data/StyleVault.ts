/**
 * StyleVault — single source of truth for all aesthetic profiles.
 *
 * Rules:
 *  - Zero style data lives outside this file.
 *  - All user-facing strings are exported constants — never inline them in components.
 *  - Community styles work without any LoRA.
 *  - Pro styles include a loraName placeholder; generation code checks existence before injecting.
 *  - previewImageUrl is null for all styles now — the field exists for a future asset pass.
 */

import { StyleProfile } from '../types';

// ── User-facing strings ───────────────────────────────────────────────────────

export const PRO_STYLE_UNAVAILABLE_MESSAGE =
  'Pro styles require a LoRA model — available when Pro tier launches.';

export const STYLE_CHANGE_WARNING =
  'Changing style affects future generations only. Existing panels are unchanged.';

// ── Community styles ──────────────────────────────────────────────────────────

export const STYLE_CLASSIC_STORYBOARD: StyleProfile = {
  id: 'classic-storyboard',
  name: 'Classic Storyboard',
  description: 'Professional ink sketch storyboard — bold lines, high contrast, black and white',
  loraName: null,
  promptSuffix:
    'storyboard art, ink sketch, black and white, cinematic composition, professional storyboard, bold lines, high contrast, film storyboard panel',
  negativePrompt: '',
  tier: 'community',
  previewImageUrl: null,
};

export const STYLE_FILM_NOIR: StyleProfile = {
  id: 'film-noir',
  name: 'Film Noir',
  description: 'Chiaroscuro shadows, cigarette smoke, rain-slicked streets — classic noir cinematography',
  loraName: null,
  promptSuffix:
    'film noir storyboard, deep chiaroscuro shadows, high contrast ink, low-key dramatic lighting, black and white, venetian blind shadow patterns, cinematic tension',
  negativePrompt:
    'bright colors, cheerful, flat lighting, midday sunlight, pastel, colorful',
  tier: 'community',
  previewImageUrl: null,
};

export const STYLE_ANIMATION_KEYFRAME: StyleProfile = {
  id: 'animation-keyframe',
  name: 'Animation Keyframe',
  description: 'Clean construction lines and key poses — ready for animation pipeline handoff',
  loraName: null,
  promptSuffix:
    'animation keyframe storyboard, clean linework, key animation pose, character action, 2D animation style, clear silhouette, expressive gesture',
  negativePrompt:
    'photorealistic, live action, rough sketch, noisy texture, film grain',
  tier: 'community',
  previewImageUrl: null,
};

export const STYLE_GRAPHIC_NOVEL: StyleProfile = {
  id: 'graphic-novel',
  name: 'Graphic Novel',
  description: 'Bold inks, flat blacks, sequential art composition — graphic novel panel ready',
  loraName: null,
  promptSuffix:
    'graphic novel panel, bold ink art, black and white, sequential art, strong panel composition, comic book inking, hatching and crosshatching',
  negativePrompt:
    'photorealistic, watercolor, soft rendering, oil painting, 3d render',
  tier: 'community',
  previewImageUrl: null,
};

export const STYLE_GAME_PREVIS: StyleProfile = {
  id: 'game-previs',
  name: 'Game Previs',
  description: 'Cinematic previs for game cutscenes — concept art fidelity, dramatic lighting',
  loraName: null,
  promptSuffix:
    'game cinematic previs storyboard, concept art, dramatic lighting, game engine style, cinematic framing, detailed environment, action-ready composition',
  negativePrompt:
    'hand drawn, soft watercolor, pencil sketch, traditional media',
  tier: 'community',
  previewImageUrl: null,
};

export const STYLE_ARCHITECTURAL_SKETCH: StyleProfile = {
  id: 'architectural-sketch',
  name: 'Architectural Sketch',
  description: 'Technical linework and spatial composition — environments and space over character',
  loraName: null,
  promptSuffix:
    'architectural visualization sketch, precise technical linework, one-point perspective, spatial composition, detailed environment drawing, blueprint aesthetic, structural clarity',
  negativePrompt:
    'portrait, close-up face, character focus, anime, cartoon face, photorealistic',
  tier: 'community',
  previewImageUrl: null,
};

// ── Pro styles — loraName values are PLACEHOLDERS not yet installed ───────────
// Generation code must call resolveLoraName() before injecting.
// If the LoRA is absent, generation proceeds without it (silent console warning).

export const STYLE_GHIBLI_WATERCOLOUR: StyleProfile = {
  id: 'ghibli-watercolour',
  name: 'Ghibli Watercolour',
  description: 'Soft painterly brushwork, warm palette, hand-painted backgrounds — Studio Ghibli aesthetic',
  loraName: 'ghibli_watercolour_v2', // PLACEHOLDER — LoRA not yet available
  promptSuffix:
    'studio ghibli watercolour style, soft painterly brushwork, warm pastel palette, hand-painted animation background, whimsical atmosphere, gentle light, lush environment detail',
  negativePrompt:
    'harsh black outlines, ink sketch, high contrast, photorealistic, 3d render, dark horror, gritty',
  tier: 'pro',
  previewImageUrl: null,
};

export const STYLE_COMIC_BOOK_BOLD: StyleProfile = {
  id: 'comic-book-bold',
  name: 'Comic Book Bold',
  description: 'Thick outlines, cel shading, vibrant flat colors — superhero comic action panels',
  loraName: 'comic_bold_v1', // PLACEHOLDER — LoRA not yet available
  promptSuffix:
    'bold comic book art, thick black outlines, cel shading, vibrant flat colors, action lines, dynamic composition, superhero comic style, Ben-Day dots, halftone',
  negativePrompt:
    'photorealistic, watercolor, pencil sketch, muted colors, soft rendering, film grain',
  tier: 'pro',
  previewImageUrl: null,
};

// ── Full vault array ──────────────────────────────────────────────────────────

export const STYLE_VAULT: StyleProfile[] = [
  STYLE_CLASSIC_STORYBOARD,
  STYLE_FILM_NOIR,
  STYLE_ANIMATION_KEYFRAME,
  STYLE_GRAPHIC_NOVEL,
  STYLE_GAME_PREVIS,
  STYLE_ARCHITECTURAL_SKETCH,
  STYLE_GHIBLI_WATERCOLOUR,
  STYLE_COMIC_BOOK_BOLD,
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Look up a style by id — throws at dev time so mismatches are caught early. */
export function getStyleById(id: string): StyleProfile {
  const style = STYLE_VAULT.find((s) => s.id === id);
  if (!style) throw new Error(`Style id '${id}' not found in STYLE_VAULT`);
  return style;
}
