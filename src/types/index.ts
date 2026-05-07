// Widened to string — options driven by FILM_DICTIONARY at runtime
export type ShotType = string;
export type CameraAngle = string;
export type Mood = string;

export type Lighting =
  | 'natural-day'
  | 'golden-hour'
  | 'blue-hour'
  | 'night'
  | 'interior-warm'
  | 'interior-cool'
  | 'backlit'
  | 'side-lit'
  | 'high-contrast'
  | 'low-key'
  | 'high-key'
  | 'neon'
  | 'candlelight';

export type TimeOfDay = 'dawn' | 'morning' | 'midday' | 'afternoon' | 'golden-hour' | 'dusk' | 'night' | 'midnight';

export interface StructuredPrompt {
  subject: string;
  background: string;
  mood: string;
  lighting: string;
  angle: string;
  shotType: string;
  timeOfDay: string;
  additionalDetails?: string;
}

export interface MultiViewPaths {
  front: string;
  frontLeft: string;
  left: string;
  back: string;
  right: string;
  frontRight: string;
}

export type MultiViewAngle = keyof MultiViewPaths;

export type MultiViewStatus = 'idle' | 'generating' | 'ready' | 'failed';

export interface Character {
  id: string;
  name: string;
  description: string;
  // Original generated reference (front-facing portrait from ComfyUI)
  referenceImagePath: string | null;
  referenceImageData: string | null; // base64 for display
  // InstantMesh 6-view output — null until generated
  multiViewPaths: MultiViewPaths | null;
  multiViewData: MultiViewPaths | null; // base64 versions for display
  multiViewStatus: MultiViewStatus;
  projectId: string;
  createdAt: number;
  // Legacy compatibility — kept so old project files still load
  referenceImages?: Record<string, string>;
}

export interface PanelRevision {
  id: string;
  imageData: string;
  prompt: string;
  timestamp: number;
  label?: string;
}

export interface Panel {
  id: string;
  order: number;
  shotDescription: string;
  structuredPrompt: StructuredPrompt | null;
  generatedImagePath: string | null;
  generatedImageData: string | null;
  shotType: ShotType | null;
  angle: CameraAngle | null;
  mood: Mood | null;
  characters: string[]; // character ids
  notes: string;
  duration: number; // seconds, 1-10
  editHistory?: string[]; // previous generatedImageData values, max 10 (session undo)
  revisions?: PanelRevision[]; // persistent cross-session revision history, max 20
  // Phase 6 — Motion Layer
  motionDescription: string;       // what the user typed for motion
  motionClipPath: string | null;   // absolute path to generated MP4/WebP
  motionClipData: string | null;   // base64 data URL for browser playback
  // Aspect ratio override — null means inherit from project.aspectRatioId
  aspectRatioId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StyleProfile {
  id: string;
  name: string;
  description: string;
  loraName: string | null;
  promptSuffix: string;
  negativePrompt: string;   // '' for community styles, style-specific terms for pro
  tier: 'community' | 'pro';
  previewImageUrl: string | null; // null until Phase 8 Pro preview images are added
}

export interface Project {
  id: string;
  title: string;
  panels: Panel[];
  characters: Character[];
  style: StyleProfile;
  filePath: string | null;
  // Project-level default aspect ratio — panels may override per-panel
  aspectRatioId?: string;
  createdAt: number;
  updatedAt: number;
}

export type ConnectionStatus = 'checking' | 'connected' | 'disconnected' | 'error';

export interface ServiceStatus {
  comfyui: ConnectionStatus;
  ollama: ConnectionStatus;
  instantmesh: ConnectionStatus;
}

export interface GenerationProgress {
  panelId: string;
  status: 'queued' | 'parsing' | 'generating' | 'animating' | 'complete' | 'error';
  progress: number;
  message: string;
  error?: string;
}

export interface CharacterGenerationProgress {
  characterId: string;
  stage: 'generating-reference' | 'generating-multiview' | 'complete' | 'error';
  message: string;
  error?: string;
}

// ── Phase 7 — Script Reader ───────────────────────────────────────────────────

export interface ScriptShot {
  order: number;
  shotDescription: string;
  shotType: string;
  subject: string;
  background: string;
  mood: string;
  lighting: string;
  angle: string;
  characterNames: string[];     // raw names extracted from script
  assignedCharacterIds: string[]; // matched against project.characters
}
