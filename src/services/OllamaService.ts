import { StructuredPrompt, ScriptShot } from '../types';
import FILM_DICTIONARY, { lookupFilmTerm } from '../data/FilmLanguageDictionary';
import { getOllamaUrl } from '../config/services';
import { settingsService } from './SettingsService';
import { licenseService } from './LicenseService';

const FALLBACK_MODELS = ['qwen2.5:1.5b', 'qwen2.5:7b', 'llama3.2:3b', 'llama3.1:8b', 'mistral:7b', 'phi3:mini'];

// Ollama inference temperature settings — tuned per use case
const TEMP_STRUCTURED = 0.1;  // Deterministic structured JSON output (character names, classification)
const TEMP_BALANCED   = 0.3;  // Balanced — creative but consistent (shot and screenplay parsing)
const TEMP_CREATIVE   = 0.4;  // Slightly creative — varied output (motion prompt refinement)

// ── Parsing rules — shared across parseShot and parseScreenplay ───────────────

const RULE_TIME_OF_DAY = `CRITICAL RULE — TIME OF DAY:
Before doing anything else, scan the input for a Fountain scene heading (a line starting with INT. or EXT.).
If found, extract the time token at the end of the heading (NIGHT, DAY, DAWN, DUSK, MORNING, EVENING, MIDDAY, AFTERNOON, CONTINUOUS, LATER).
Use that token directly as timeOfDay — do NOT override it with mood, lighting, atmosphere, or context.
If no scene heading exists, then infer timeOfDay from context.
Examples:
  "INT. DETECTIVE'S OFFICE — NIGHT" → timeOfDay: "night"
  "EXT. CITY STREET — DAWN" → timeOfDay: "dawn"
  "INT. KITCHEN — DAY" → timeOfDay: "day"`;

const RULE_CHARACTER_COUNT = `CRITICAL RULE — CHARACTERS:
Only include characters explicitly named or described in the action line.
Do not add characters that are not mentioned.
If the action describes one person acting alone, the subject must describe one person only.
If the script says "Detective Kane sits at his desk" — subject is "Detective Kane alone at desk", not "two detectives".`;

const RULE_MOOD_GENRE = `RULE — MOOD:
Read the full scene context before assigning mood.
If the scene heading or content indicates crime/thriller/detective/murder — default mood to "tense", "dramatic", or "noir" unless dialogue explicitly indicates otherwise.
Do not assign "intimate" or "romantic" to crime scenes unless romance is explicitly described.`;

// ── Static system prompts for lightweight tasks ───────────────────────────────

const EXTRACT_CHARACTERS_PROMPT =
`You are a screenplay analyst. Extract character names from script text.
Return ONLY a JSON array of character name strings. No explanation, no markdown.
Example: ["KANE", "DETECTIVE", "WOMAN"]`;

const REFINE_MOTION_PROMPT =
`You are a cinematographer describing camera motion and subject movement.
Refine the given motion description into a precise, technical prompt for AI video generation.
Focus on: camera movement direction, speed, subject action, atmospheric elements.
Return only the refined prompt text, no explanation.`;

// ── Shot-parsing system prompt (built once at module load) ────────────────────

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

${RULE_TIME_OF_DAY}

${RULE_CHARACTER_COUNT}

${RULE_MOOD_GENRE}

Your task is to analyze a shot description and return a JSON object with these exact fields:
- subject: the main character(s) AND their primary action in the shot. Include what they are doing, not just who they are. Examples:
  "husband stabbing wife with knife" not "husband"
  "detective examining crime scene" not "detective"
  "two men fighting, one punching the other" not "two men"
  "woman running through dark alley" not "woman"
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
5. The subject must include both WHO is in the shot AND WHAT they are doing. A subject with no action is incomplete. "man" is wrong. "man aiming gun at another man" is correct.
6. Keep each field concise but descriptive (max 20 words per field)
7. timeOfDay: if the description contains an explicit time token from a scene heading
   (NIGHT, DAY, DAWN, DUSK, MORNING, EVENING) use it directly — do NOT infer timeOfDay
   from mood, weather, atmosphere, or tone. Only infer when no explicit token is present.`;

export class OllamaService {
  private availableModel: string | null = null;
  private isConnected = false;

  /** Returns the model to use: user setting → discovered installed model → hardcoded default. */
  private getModel(): string {
    return settingsService.getKey('ollamaModel') || this.availableModel || 'qwen2.5:14b';
  }

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
      // User preference is checked first, then qwen2.5:14b default, then fallbacks
      const userPref = settingsService.getKey('ollamaModel');
      const priorityList = userPref
        ? [userPref, 'qwen2.5:14b', ...FALLBACK_MODELS]
        : ['qwen2.5:14b', ...FALLBACK_MODELS];
      const found = installed.find((name) => priorityList.includes(name)) ?? null;
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
    // Pro/Studio: try DeepSeek cloud first for better quality
    if (licenseService.isPro()) {
      const cloudResult = await this.parseWithDeepSeek(description, SYSTEM_PROMPT);
      if (cloudResult) return cloudResult;
    }

    const model = this.getModel();

    const userPrompt =
`Parse this shot description and return structured JSON.
REMEMBER: If you see INT./EXT. followed by a time token (NIGHT/DAY/DAWN etc), use that exact time — never override it.
Only include characters explicitly mentioned. Match mood to genre.

${description}

Return ONLY valid JSON, no explanation, no markdown:`;

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
          options: { temperature: TEMP_BALANCED, top_p: 0.9 },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        throw new Error('Could not parse shot description. Check that Ollama is running.');
      }

      const data = await response.json() as { message: { content: string } };
      const content = data.message?.content ?? '';

      return this.parseJSON(content, description);
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('Shot parsing timed out. Ollama may be overloaded — please try again.');
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
  private buildScreenplaySystemPrompt(): string {
    const shotTypes = [...new Set(FILM_DICTIONARY.filter((t) => t.category === 'shot-type').map((t) => t.term))].join(', ');
    const angles    = [...new Set(FILM_DICTIONARY.filter((t) => t.category === 'camera-angle').map((t) => t.term))].join(', ');
    const moods     = [...new Set(FILM_DICTIONARY.filter((t) => t.category === 'mood').map((t) => t.term))].join(', ');
    const lighting  = [...new Set(FILM_DICTIONARY.filter((t) => t.category === 'lighting').map((t) => t.term))].join(', ');

    return `You are a professional storyboard supervisor breaking down a screenplay into shots.
Analyse the script and identify the appropriate number of shots to fully visualise this scene.
Use your judgement — a short scene needs 3-4 shots, a complex multi-beat scene may need up to 12.
Never pad with unnecessary shots. Never truncate a scene that needs more coverage.

For each shot return a JSON array with this exact structure:
[
  {
    "order": 1,
    "shotDescription": "complete natural language shot description for storyboard generation",
    "shotType": "one of: ${shotTypes}",
    "subject": "who is in the shot and what they are doing",
    "background": "setting and environment",
    "mood": "one of: ${moods}",
    "lighting": "one of: ${lighting}",
    "angle": "one of: ${angles}",
    "timeOfDay": "time token from the scene heading — see rule below",
    "characterNames": ["any character names spoken or present in this shot"]
  }
]

${RULE_TIME_OF_DAY}

${RULE_CHARACTER_COUNT}

${RULE_MOOD_GENRE}

Accept any format: standard screenplay (INT./EXT.), Fountain, or plain prose story description.
Return only the JSON array. No explanation, no markdown, no preamble.`;
  }

  async parseScreenplay(scriptText: string): Promise<ScriptShot[]> {
    const systemPrompt = this.buildScreenplaySystemPrompt();

    // Pro/Studio: try DeepSeek cloud first for better quality
    if (licenseService.isPro()) {
      const cloudResult = await this.parseScreenplayWithDeepSeek(scriptText, systemPrompt);
      if (cloudResult && cloudResult.length > 0) return cloudResult;
    }

    const model = this.getModel();

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
          options: { temperature: TEMP_BALANCED, top_p: 0.9 },
        }),
        signal: AbortSignal.timeout(120000), // 2 min — full scene parse
      });

      if (!response.ok) throw new Error('Could not parse screenplay. Check that Ollama is running.');

      const data = await response.json() as { message: { content: string } };
      return this.parseScreenplayJSON(data.message?.content ?? '', scriptText);
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('Screenplay parsing timed out. Please try again with a shorter script.');
      }
      return this.screenplayFallback(scriptText);
    }
  }

  // ── DeepSeek cloud parsing (Pro/Studio — falls back to Ollama silently) ──────

  private async parseWithDeepSeek(
    description: string,
    systemPrompt: string,
  ): Promise<StructuredPrompt | null> {
    const apiKey = settingsService.getKey('deepseekApiKey') || (process.env.DEEPSEEK_API_KEY ?? '');
    if (!apiKey) return null;

    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: `Parse this shot description and return structured JSON.
REMEMBER: If you see INT./EXT. followed by a time token (NIGHT/DAY/DAWN etc), use that exact time — never override it.
Only include characters explicitly mentioned. Match mood to genre.

${description}

Return ONLY valid JSON, no explanation, no markdown:`,
            },
          ],
          temperature: TEMP_BALANCED,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        console.warn('[DeepSeek] API error:', res.status);
        return null;
      }

      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;

      return this.validateStructuredPrompt(JSON.parse(content));
    } catch (err) {
      console.warn('[DeepSeek] Parse error — falling back to Ollama:', err);
      return null;
    }
  }

  private validateStructuredPrompt(raw: any): StructuredPrompt {
    return {
      subject:           raw.subject           || '',
      background:        raw.background        || '',
      mood:              raw.mood              || '',
      lighting:          raw.lighting          || '',
      angle:             raw.angle             || '',
      shotType:          raw.shotType          || '',
      timeOfDay:         raw.timeOfDay         || 'day',
      additionalDetails: raw.additionalDetails || '',
    };
  }

  private async parseScreenplayWithDeepSeek(
    scriptText: string,
    systemPrompt: string,
  ): Promise<ScriptShot[] | null> {
    const apiKey = settingsService.getKey('deepseekApiKey') || (process.env.DEEPSEEK_API_KEY ?? '');
    if (!apiKey) return null;

    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: `Parse this screenplay and return a JSON array of shots:\n\n${scriptText}\n\nReturn ONLY a valid JSON array, no explanation, no markdown.`,
            },
          ],
          temperature: TEMP_BALANCED,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) return null;

      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;

      const parsed = JSON.parse(content);
      // DeepSeek may return { shots: [...] } or directly [...]
      const shots = Array.isArray(parsed) ? parsed : (parsed.shots ?? parsed.result ?? []);
      if (!Array.isArray(shots) || shots.length === 0) return null;

      return this.parseScreenplayJSON(JSON.stringify(shots), scriptText);
    } catch (err) {
      console.warn('[DeepSeek] Screenplay parse error — falling back to Ollama:', err);
      return null;
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
    const model = this.getModel();

    try {
      const response = await fetch(`${getOllamaUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: EXTRACT_CHARACTERS_PROMPT },
            { role: 'user', content: scriptText },
          ],
          stream: false,
          options: { temperature: TEMP_STRUCTURED, top_p: 0.9 },
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
    const model = this.getModel();

    try {
      const response = await fetch(`${getOllamaUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: REFINE_MOTION_PROMPT },
            { role: 'user', content: description },
          ],
          stream: false,
          options: { temperature: TEMP_CREATIVE, top_p: 0.9 },
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
