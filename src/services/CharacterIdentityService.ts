import { Character } from '../types';

export class CharacterIdentityService {
  private characters: Map<string, Character> = new Map();

  loadFromProject(characters: Character[]): void {
    this.characters.clear();
    characters.forEach((c) => this.characters.set(c.id, c));
  }

  getAll(): Character[] {
    return Array.from(this.characters.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): Character | undefined {
    return this.characters.get(id);
  }

  create(name: string, description: string): Character {
    const character: Character = {
      id: `char_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      description,
      referenceImages: {},
      createdAt: Date.now(),
    };
    this.characters.set(character.id, character);
    return character;
  }

  setReferenceImage(characterId: string, angle: string, imagePath: string): boolean {
    const character = this.characters.get(characterId);
    if (!character) return false;
    character.referenceImages[angle] = imagePath;
    return true;
  }

  getReferenceImage(characterId: string, angle = '0'): string | null {
    const character = this.characters.get(characterId);
    if (!character) return null;
    return character.referenceImages[angle] ?? Object.values(character.referenceImages)[0] ?? null;
  }

  delete(characterId: string): boolean {
    return this.characters.delete(characterId);
  }

  update(characterId: string, updates: Partial<Pick<Character, 'name' | 'description'>>): boolean {
    const character = this.characters.get(characterId);
    if (!character) return false;
    Object.assign(character, updates);
    return true;
  }

  // Returns character names for display in a panel
  getCharacterNames(characterIds: string[]): string[] {
    return characterIds
      .map((id) => this.characters.get(id)?.name)
      .filter((name): name is string => Boolean(name));
  }
}

export const characterIdentityService = new CharacterIdentityService();
