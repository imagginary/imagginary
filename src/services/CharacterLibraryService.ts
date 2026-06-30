import { Character, MultiViewPaths, MultiViewAngle } from '../types';

// Maps shot angle labels to the best MultiView angle key.
// ORDER MATTERS — first match wins. More specific patterns must come before general ones.
// In particular, frontLeft/frontRight checks must precede bare `left`/`right` checks
// so that e.g. "frontLeft" doesn't accidentally match the /\bleft\b/ entry.
const ANGLE_MAP: Array<{ patterns: RegExp; view: MultiViewAngle }> = [
  // Compound / specific patterns first
  { patterns: /front.?left|3\/4.?left|medium.?left/i,  view: 'frontLeft' },
  { patterns: /front.?right|3\/4.?right/i,              view: 'right' },
  { patterns: /3\/4|three.?quarter|over.the.shoulder|ots/i, view: 'frontLeft' },
  { patterns: /dutch/i,                                 view: 'frontLeft' },
  // Simple directional — word boundaries prevent matching inside compound words
  { patterns: /\bfront\b|\beye.?level\b|\bneutral\b|\bstraight\b/i, view: 'front' },
  { patterns: /\bback\b|\brear\b|\bbehind\b/i,          view: 'back' },
  { patterns: /\bright\b/i,                             view: 'right' },
  { patterns: /\bside\b|\bprofile\b|\bleft\b/i,         view: 'left' },
  // Camera angle descriptors — default to front view
  { patterns: /low.?angle|worm/i,                       view: 'front' },
  { patterns: /high.?angle|bird/i,                      view: 'front' },
];

export class CharacterLibraryService {
  private characters: Map<string, Character> = new Map();

  // ── Load/sync ────────────────────────────────────────────────────────────────

  loadFromProject(characters: Character[]): void {
    this.characters.clear();
    characters.forEach((c) => this.characters.set(c.id, this.migrate(c)));
  }

  /** Migrate legacy Character shapes (referenceImages map) to new schema */
  private migrate(c: Character): Character {
    // Check for field presence, not truthiness — a new-schema character with no
    // image set will have referenceImagePath: null, which is falsy but correct.
    if ('referenceImagePath' in c) return c; // already new shape
    const legacy = c as Character & { referenceImages?: Record<string, string> };
    const firstImg = Object.values(legacy.referenceImages ?? {})[0] ?? null;
    return {
      ...c,
      referenceImagePath: firstImg,
      referenceImageData: firstImg,
      multiViewPaths: null,
      multiViewData: null,
      multiViewStatus: 'idle',
      projectId: c.projectId ?? 'legacy',
    };
  }

  getAll(): Character[] {
    return Array.from(this.characters.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): Character | undefined {
    return this.characters.get(id);
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  create(
    name: string,
    description: string,
    projectId: string,
    referenceImagePath: string | null = null,
    referenceImageData: string | null = null
  ): Character {
    const character: Character = {
      id: `char_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      description,
      referenceImagePath,
      referenceImageData,
      multiViewPaths: null,
      multiViewData: null,
      multiViewStatus: 'idle',
      projectId,
      createdAt: Date.now(),
    };
    this.characters.set(character.id, character);
    return character;
  }

  update(id: string, updates: Partial<Character>): Character | null {
    const existing = this.characters.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.characters.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.characters.delete(id);
  }

  // ── Multi-view ───────────────────────────────────────────────────────────────

  setMultiViewStatus(id: string, status: Character['multiViewStatus']): void {
    const c = this.characters.get(id);
    if (c) this.characters.set(id, { ...c, multiViewStatus: status });
  }

  updateMultiView(id: string, paths: MultiViewPaths, data: MultiViewPaths): Character | null {
    return this.update(id, {
      multiViewPaths: paths,
      multiViewData: data,
      multiViewStatus: 'ready',
    });
  }

  // ── Reference image selection ────────────────────────────────────────────────

  /**
   * Returns the best angle reference image (base64 data URL) for a given shot angle.
   * Falls back through: multiViewData → referenceImageData → null.
   */
  getBestAngleReference(characterId: string, shotAngle: string): string | null {
    const character = this.characters.get(characterId);
    if (!character) return null;

    if (character.multiViewData) {
      const view = this.resolveAngle(shotAngle);
      const img = character.multiViewData[view];
      if (img) return img;
    }

    // Fall back to the original reference portrait
    return character.referenceImageData ?? null;
  }

  private resolveAngle(shotAngle: string): MultiViewAngle {
    for (const { patterns, view } of ANGLE_MAP) {
      if (patterns.test(shotAngle)) return view;
    }
    return 'front';
  }

  getCharacterNames(ids: string[]): string[] {
    return ids
      .map((id) => this.characters.get(id)?.name)
      .filter((n): n is string => Boolean(n));
  }
}

export const characterLibraryService = new CharacterLibraryService();
