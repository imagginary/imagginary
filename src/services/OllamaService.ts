import { StructuredPrompt, ScriptShot } from '../types';
import FILM_DICTIONARY, { lookupFilmTerm } from '../data/FilmLanguageDictionary';

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const MODEL = 'qwen2.5:14b';
const FALLBACK_MODELS = ['qwen2.5:7b', 'llama3.2:3b', 'llama3.1:8b', 'mistral:7b', 'phi3:mini'];

// Build a compact film dictionary context for the prompt
function buildDictionaryContext(): string {
  const shotTypes = FILM_DICTIONARY.filter((t) => t.category === 'shot-type')
    .map((t) => `${t.term} (${t.aliases.slice(0, 2).join(', ')}): ${t.promptTranslation}`)
    .join('\n');
  const angles = FILM_DICTIONARY.filter((t) => t.category === 'camera-angle')
    .map((t) => `${t.term} (${t.aliases.slice(0, 2).join(', ')}): ${t.promptTranslation}`)
    .join('\n');
  const lighting = FILM_DICTIONARY.filter((t) => t.category === 'lighting')
    .map((t) => `${t.term}: ${t.promptTranslation}`)
    .join('\n');
  const moods = FILM_DICTIONARY.filter((t) => t.category === 'mood')
    .map((t) => `${t.term}: ${t.promptTranslation}`)
    .join('\n');

  return `SHOT TYPES:\n${shotTypes}\n\nCAMERA ANGLES:\n${angles}\n\nLIGHTING:\n${lighting}\n\nMOODS:\n${moods}`;
}

const SYSTEM_PROMPT = `You are a professional cinematographer and storyboard artist.
You parse shot descriptions written by filmmakers and extract structured visual information.

You know the complete film language vocabulary including shot types, camera angles, lighting setups, and cinematic moods.

${buildDictionaryContext()}

Your task is to analyze a shot description and return a JSON object with these exact fields:
- subject: the main character(s) or subject matter in the shot
- background: the setting and environment
- mood: the emotional atmosphere (one or two descriptive words)
- lighting: describe the lighting setup
- angle: the camera angle
- shotType: the type of shot
- timeOfDay: time of day if relevant (dawn/morning/midday/afternoon/golden-hour/dusk/night/midnight)
- additionalDetails: any other important visual details

Rules:
1. Respond ONLY with valid JSON, no explanation, no markdown, no code blocks
2. Be specific and descriptive - these will become image generation prompts
3. Use cinematic language for prompt compatibility
4. If a field is not specified, make a reasonable artistic choice
5. The subject should describe what to draw, not the person's name
6. Keep each field concise but descriptive (max 20 words per field)`;

export class OllamaService {
  private availableModel: string | null = null;
  private isConnected = false;

  async checkConnection(): Promise<boolean> {
    // In packaged Electron, renderer fetch() is blocked by CSP from file:// origin.
    // Delegate to the main process IPC handler which has no such restriction.
    if ((window as any).electronAPI?.checkOllama) {
      try {
        const result = await (window as any).electronAPI.checkOllama();
        this.isConnected = result.connected;
        return result.connected;
      } catch {
        this.isConnected = false;
        return false;
      }
    }

    // Fallback: direct fetch for browser dev mode (no Electron)
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        this.isConnected = false;
        return false;
      }
      const data = await response.json() as { models: Array<{ name: string }> };
      const models = data.models?.map((m) => m.name) ?? [];

      // Find best available model
      const preferred = [MODEL, ...FALLBACK_MODELS].find((m) =>
        models.some((available) => available.startsWith(m.split(':')[0]))
      );
      this.availableModel = preferred ?? null;
      this.isConnected = true;
      return true;
    } catch {
      this.isConnected = false;
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = await response.json() as { models: Array<{ name: string }> };
      return data.models?.map((m) => m.name) ?? [];
    } catch {
      return [];
    }
  }

  async parseShot(description: string): Promise<StructuredPrompt> {
    const model = this.availableModel ?? MODEL;

    const userPrompt = `Parse this shot description and return structured JSON:

"${description}"

Return only valid JSON with these fields: subject, background, mood, lighting, angle, shotType, timeOfDay, additionalDetails`;

    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
          options: {
            temperature: 0.3,
            top_p: 0.9,
          },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { message: { content: string } };
      const content = data.message?.content ?? '';

      return this.parseJSON(content, description);
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('Ollama request timed out. Is Ollama running?');
      }
      throw error;
    }
  }

  // ── Phase 7 — Script Reader ───────────────────────────────────────────────

  /**
   * Parse a screenplay excerpt (any format: INT./EXT., Fountain, or plain prose)
   * into an ordered array of storyboard shots.
   * Term lists are derived dynamically from FILM_DICTIONARY — never hardcoded.
   */
  async parseScreenplay(scriptText: string): Promise<ScriptShot[]> {
    const model = this.availableModel ?? MODEL;

    const shotTypes = [...new Set(FILM_DICTIONARY.filter((t) => t.category === 'shot-type').map((t) => t.term))].join(', ');
    const angles    = [...new Set(FILM_DICTIONARY.filter((t) => t.category === 'camera-angle').map((t) => t.term))].join(', ');
    const moods     = [...new Set(FILM_DICTIONARY.filter((t) => t.category === 'mood').map((t) => t.term))].join(', ');
    const lighting  = [...new Set(FILM_DICTIONARY.filter((t) => t.category === 'lighting').map((t) => t.term))].join(', ');

    const systemPrompt =
`You are a professional storyboard supervisor breaking down a screenplay into shots.
Analyse the script and identify the appropriate number of shots to fully visualise this scene.
Use your judgement — a short scene needs 3-4 shots, a complex multi-beat scene may need up to 12.
Never pad with unnecessary shots. Never truncate a scene that needs more coverage.

For each shot return a JSON array with this exact structure:
[
  {
    "order": 1,
    "shotDescription": "complete natural language shot description for storyboard generation",
    "shotType": "one of: ${shotTypes}",
    "subject": "what or who is in focus",
    "background": "setting and environment",
    "mood": "one of: ${moods}",
    "lighting": "one of: ${lighting}",
    "angle": "one of: ${angles}",
    "characterNames": ["any character names spoken or present in this shot"]
  }
]

Accept any format: standard screenplay (INT./EXT.), Fountain, or plain prose story description.
Return only the JSON array. No explanation, no markdown, no preamble.`;

    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: scriptText },
          ],
          stream: false,
          options: { temperature: 0.3, top_p: 0.9 },
        }),
        signal: AbortSignal.timeout(120000), // 2 min — full scene parse
      });

      if (!response.ok) throw new Error(`Ollama error: ${response.status}`);

      const data = await response.json() as { message: { content: string } };
      return this.parseScreenplayJSON(data.message?.content ?? '', scriptText);
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('Screenplay parsing timed out. Is Ollama running?');
      }
      return this.screenplayFallback(scriptText);
    }
  }

  private parseScreenplayJSON(content: string, fallbackText: string): ScriptShot[] {
    let cleaned = content.trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    const start = cleaned.indexOf('[');
    const end   = cleaned.lastIndexOf(']');
    if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);

    try {
      const parsed = JSON.parse(cleaned) as Partial<ScriptShot>[];
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('empty');
      return parsed.map((shot, i) => ({
        order:               shot.order ?? i + 1,
        shotDescription:     shot.shotDescription ?? fallbackText.slice(0, 200),
        shotType:            shot.shotType ?? 'medium shot',
        subject:             shot.subject ?? 'scene',
        background:          shot.background ?? 'environment',
        mood:                shot.mood ?? 'dramatic',
        lighting:            shot.lighting ?? 'natural light',
        angle:               shot.angle ?? 'eye level',
        characterNames:      Array.isArray(shot.characterNames) ? shot.characterNames : [],
        assignedCharacterIds: [],
      }));
    } catch {
      return this.screenplayFallback(fallbackText);
    }
  }

  private screenplayFallback(text: string): ScriptShot[] {
    return [{
      order: 1,
      shotDescription: text.slice(0, 500),
      shotType: 'medium shot',
      subject: 'scene',
      background: 'as described in script',
      mood: 'dramatic',
      lighting: 'natural light',
      angle: 'eye level',
      characterNames: [],
      assignedCharacterIds: [],
    }];
  }

  /**
   * Extract all character names from a script excerpt.
   * Lightweight second pass — more reliable than relying on per-shot extraction.
   */
  async extractCharacterNames(scriptText: string): Promise<string[]> {
    const model = this.availableModel ?? MODEL;

    const systemPrompt =
`Extract all character names from this script excerpt.
Return a JSON array of strings containing only the character names, nothing else.
Example: ["Kane", "Sarah", "The Detective"]
If no characters are identifiable return an empty array [].`;

    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: scriptText },
          ],
          stream: false,
          options: { temperature: 0.1, top_p: 0.9 },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) return [];
      const data = await response.json() as { message: { content: string } };
      const raw = (data.message?.content ?? '').trim()
        .replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
      const start = raw.indexOf('[');
      const end   = raw.lastIndexOf(']');
      if (start === -1 || end === -1) return [];
      const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
      return Array.isArray(parsed) ? (parsed as unknown[]).filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  async refineMotionPrompt(description: string): Promise<string> {
    const model = this.availableModel ?? MODEL;

    const systemPrompt = `You are a video motion prompt engineer for Wan 2.2 image-to-video.
Convert the user's motion description into a concise Wan 2.2 compatible prompt.
Focus on: camera movement, subject action, environmental effects, lighting changes.
Return only the prompt string, no explanation. Max 50 words.
Keep it cinematic and specific.`;

    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: description },
          ],
          stream: false,
          options: { temperature: 0.4, top_p: 0.9 },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) return description;
      const data = await response.json() as { message: { content: string } };
      const refined = (data.message?.content ?? '').trim();
      return refined || description;
    } catch {
      return description; // fallback to raw description
    }
  }

  private parseJSON(content: string, fallbackDescription: string): StructuredPrompt {
    // Strip markdown code blocks if present
    let cleaned = content.trim();
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');

    try {
      const parsed = JSON.parse(cleaned) as Partial<StructuredPrompt>;
      return {
        subject: parsed.subject ?? 'figure in scene',
        background: parsed.background ?? 'environment',
        mood: parsed.mood ?? 'dramatic',
        lighting: parsed.angle ?? 'natural lighting',
        angle: parsed.angle ?? 'eye level',
        shotType: parsed.shotType ?? 'medium shot',
        timeOfDay: parsed.timeOfDay ?? 'day',
        additionalDetails: parsed.additionalDetails,
      };
    } catch {
      // Fallback: extract what we can with regex
      return this.fallbackParse(content, fallbackDescription);
    }
  }

  private fallbackParse(content: string, description: string): StructuredPrompt {
    const lower = description.toLowerCase();

    // Detect shot type from film dictionary
    let shotType = 'medium shot';
    let angle = 'eye level';
    let timeOfDay = 'day';

    for (const term of FILM_DICTIONARY) {
      const searchTerms = [term.term, ...term.aliases];
      for (const t of searchTerms) {
        if (lower.includes(t.toLowerCase())) {
          if (term.category === 'shot-type') shotType = term.promptTranslation;
          if (term.category === 'camera-angle') angle = term.promptTranslation;
        }
      }
    }

    if (lower.includes('night') || lower.includes('midnight')) timeOfDay = 'night';
    else if (lower.includes('dawn') || lower.includes('sunrise')) timeOfDay = 'dawn';
    else if (lower.includes('golden') || lower.includes('sunset')) timeOfDay = 'golden-hour';
    else if (lower.includes('rain') || lower.includes('storm')) timeOfDay = 'night';

    return {
      subject: description.slice(0, 60),
      background: 'cinematic environment',
      mood: lower.includes('noir') || lower.includes('dark') ? 'dark and moody' : 'dramatic',
      lighting: lower.includes('night') ? 'low-key night lighting' : 'natural lighting',
      angle,
      shotType,
      timeOfDay,
      additionalDetails: description,
    };
  }
}

export const ollamaService = new OllamaService();
