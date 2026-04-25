import { Character, MultiViewPaths, MultiViewAngle } from '../types';

// Maps shot angle labels to the best MultiView angle key
const ANGLE_MAP: Array<{ patterns: RegExp; view: MultiViewAngle }> = [
  { patterns: /front|eye.?level|neutral|straight/i,    view: 'front' },
  { patterns: /3\/4|three.quarter|medium.left/i,        view: 'frontLeft' },
  { patterns: /side|profile|left/i,                     view: 'left' },
  { patterns: /back|rear|behind/i,                      view: 'back' },
  { patterns: /right/i,                                 view: 'right' },
  { patterns: /over.the.shoulder|ots/i,                 view: 'frontLeft' },
  { patterns: /low.angle|worm/i,                        view: 'front' },
  { patterns: /high.angle|bird/i,                       view: 'front' },
  { patterns: /dutch/i,                                 view: 'frontLeft' },
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
    if (c.referenceImagePath) return c; // already new shape
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
