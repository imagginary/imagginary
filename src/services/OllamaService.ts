import { StructuredPrompt, ScriptShot } from '../types';
import FILM_DICTIONARY, { lookupFilmTerm } from '../data/FilmLanguageDictionary';
import { getOllamaUrl } from '../config/services';
const MODEL = 'qwen2.5:14b';
const FALLBACK_MODELS = ['qwen2.5:1.5b', 'qwen2.5:7b', 'llama3.2:3b', 'llama3.1:8b', 'mistral:7b', 'phi3:mini'];

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
6. Keep each field concise but descriptive (max 20 words per field)
7. timeOfDay: if the description contains an explicit time token from a scene heading
   (NIGHT, DAY, DAWN, DUSK, MORNING, EVENING) use it directly — do NOT infer timeOfDay
   from mood, weather, atmosphere, or tone. Only infer when no explicit token is present.`;

export class OllamaService {
  private availableModel: string | null = null;
  private isConnected = false;

  async checkConnection(): Promise<boolean> {
    // In packaged Electron, renderer fetch() is blocked by CSP from file:// origin.
    // Delegate to the main process IPC handler which has no such restriction.
    if ((window as any).electronAPI?.checkOllama) {
      try {
        const result = await (window as any).electronAPI.checkOllama();
        if (!result.connected) {
          this.isConnected = false;
          return false;
        }
        // Confirmed connected — discover which model is actually installed
        await this.discoverAvailableModel();
        this.isConnected = true;
        return true;
      } catch {
        this.isConnected = false;
        return false;
      }
    }

    // Fallback: direct fetch for browser dev mode (no Electron)
    try {
      const response = await fetch(`${getOllamaUrl()}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        this.isConnected = false;
        return false;
      }
      await this.discoverAvailableModel();
      this.isConnected = true;
      return true;
    } catch {
      this.isConnected = false;
      return false;
    }
  }

  private async discoverAvailableModel(): Promise<void> {
    try {
      const response = await fetch(`${getOllamaUrl()}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return;
      const data = await response.json() as { models: Array<{ name: string }> };
      const installed = data.models?.map((m) => m.name) ?? [];
      // Exact match only — prefix matching caused qwen2.5:7b to satisfy qwen2.5:14b
      const found = installed.find((name) =>
        [MODEL, ...FALLBACK_MODELS].includes(name)
      ) ?? null;
      this.availableModel = found;
      console.log('[OllamaService] Installed models:', installed.join(', ') || '(none)');
      console.log('[OllamaService] Using model:', this.availableModel ?? '(none found)');
    } catch {
      // Leave availableModel unchanged if the tags request fails
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${getOllamaUrl()}/api/tags`, {
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
    const model = this.availableModel ?? FALLBACK_MODELS[0];

    const userPrompt = `Parse this shot description and return structured JSON:

"${description}"

Return only valid JSON with these fields: subject, background, mood, lighting, angle, shotType, timeOfDay, additionalDetails`;

    try {
      const response = await fetch(`${getOllamaUrl()}/api/chat`, {
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
            temperature: 0.3, // Balanced — creative but consistent (shot descriptions)
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
    const model = this.availableModel ?? FALLBACK_MODELS[0];

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
    "timeOfDay": "time token from the scene heading — see rule below",
    "characterNames": ["any character names spoken or present in this shot"]
  }
]

RULE 1 — timeOfDay (scene heading takes absolute priority):
Scene headings follow the format: INT./EXT. LOCATION - TIME
Read the TIME token at the end of the heading and map it directly:
  NIGHT or NIGHT-CONTINUOUS → "night"
  DAY or DAY-CONTINUOUS     → "day"
  DAWN                      → "dawn"
  DUSK                      → "dusk"
  MORNING                   → "morning"
  EVENING                   → "dusk"
Use the heading value directly. Do NOT override it with mood, weather, or tone from the
scene body. All shots within the same scene share the same timeOfDay unless a new scene
heading with a different TIME token appears. If no scene heading is present, infer from
explicit time language only — never from mood, atmosphere, or lighting description.

RULE 2 — character count (only what the script states):
Subject and shotDescription must reflect only the characters explicitly named or described
in the action lines for that beat. Do NOT add, imply, or invent additional people.
If the action line describes one person acting alone, the shot contains one person.
If two characters are named, the shot contains those two characters — no more.
Never write "they", "the group", "the crowd", or any plural that is not in the script.

RULE 3 — mood (genre-appropriate default):
Choose mood based on the scene's genre context, not on surface emotional tone of dialogue.
For detective, crime, noir, thriller, interrogation, or investigation scenes, default to
"tense" or "dramatic". Only assign "intimate", "romantic", or "tender" if the dialogue or
action line explicitly describes that emotional register — never infer intimacy from two
characters being in the same room or from a close-up shot type.

Accept any format: standard screenplay (INT./EXT.), Fountain, or plain prose story description.
Return only the JSON array. No explanation, no markdown, no preamble.`;

    try {
      const response = await fetch(`${getOllamaUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: scriptText },
          ],
          stream: false,
          options: { temperature: 0.3, top_p: 0.9 }, // Balanced — creative but consistent (shot descriptions)
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
        timeOfDay:           shot.timeOfDay ?? 'day',
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
    // Best-effort: scan the raw text for a scene heading time token
    const headingMatch = text.match(/\b(INT\.|EXT\.)[^\n]*[-–]\s*(NIGHT|DAY|DAWN|DUSK|MORNING|EVENING)/i);
    const headingToken = headingMatch?.[2]?.toLowerCase() ?? null;
    const timeOfDay = headingToken === 'night' ? 'night'
      : headingToken === 'dawn'    ? 'dawn'
      : headingToken === 'dusk' || headingToken === 'evening' ? 'dusk'
      : headingToken === 'morning' ? 'morning'
      : 'day';

    return [{
      order: 1,
      shotDescription: text.slice(0, 500),
      shotType: 'medium shot',
      subject: 'scene',
      background: 'as described in script',
      mood: 'dramatic',
      lighting: 'natural light',
      angle: 'eye level',
      timeOfDay,
      characterNames: [],
      assignedCharacterIds: [],
    }];
  }

  /**
   * Extract all character names from a script excerpt.
   * Lightweight second pass — more reliable than relying on per-shot extraction.
   */
  async extractCharacterNames(scriptText: string): Promise<string[]> {
    const model = this.availableModel ?? FALLBACK_MODELS[0];

    const systemPrompt =
`Extract all character names from this script excerpt.
Return a JSON array of strings containing only the character names, nothing else.
Example: ["Kane", "Sarah", "The Detective"]
If no characters are identifiable return an empty array [].`;

    try {
      const response = await fetch(`${getOllamaUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: scriptText },
          ],
          stream: false,
          options: { temperature: 0.1, top_p: 0.9 }, // Low temperature — deterministic structured output (JSON parsing)
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
    const model = this.availableModel ?? FALLBACK_MODELS[0];

    const systemPrompt = `You are a video motion prompt engineer for Wan 2.2 image-to-video.
Convert the user's motion description into a concise Wan 2.2 compatible prompt.
Focus on: camera movement, subject action, environmental effects, lighting changes.
Return only the prompt string, no explanation. Max 50 words.
Keep it cinematic and specific.`;

    try {
      const response = await fetch(`${getOllamaUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: description },
          ],
          stream: false,
          options: { temperature: 0.4, top_p: 0.9 }, // Slightly creative — varied output for style suggestions
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
    else if (lower.includes('dusk') || lower.includes('golden') || lower.includes('sunset')) timeOfDay = 'golden-hour';

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
