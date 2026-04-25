# Contributing to Imagginary

Thank you for wanting to make Imagginary better. This document covers how to contribute effectively.

Imagginary is open source because the community catches edge cases faster than any single team, contributes Film Dictionary terms we haven't thought of, and improves prompt engineering in ways that benefit every creator who uses the tool.

---

## What to contribute

### Film Dictionary terms (highest impact)

The Film Dictionary is the heart of Imagginary. Every new term makes the tool more expressive for every creator. If you know cinematography, animation, lighting, or visual storytelling — this is where your knowledge matters most.

The dictionary lives in `src/data/FilmLanguageDictionary.ts`. Each entry follows this structure:

```typescript
{
  term: "chiaroscuro",
  category: "lighting",
  promptBoost: "dramatic chiaroscuro lighting, deep shadows, single light source, high contrast black and white",
  description: "Strong contrast between light and dark, used in film noir and Renaissance painting",
  aliases: ["chiaroscuro lighting", "light and shadow contrast"],
}
```

**Good candidates for new terms:**
- Cinematography techniques (split diopter, dolly zoom, anamorphic flare)
- Animation principles (squash and stretch, anticipation, smear frame, limited animation)
- Director-specific styles (Kubrick symmetry, Tarkovsky long take, Wong Kar-wai colour grading)
- Lighting setups (Rembrandt lighting, butterfly lighting, motivated practical)
- Colour theory terms (complementary colour, desaturated palette, warm key cool fill)
- Storyboard conventions (panel transition types, action lines, camera move notation)

**How to submit:**
1. Fork the repository
2. Add your terms to `FilmLanguageDictionary.ts`
3. Test that the terms generate sensible panels in the app
4. Open a PR with the terms and a brief note on what they unlock

### Bug reports

Open an issue with:
- macOS version and chip (M1, M2, M3)
- RAM
- What you did
- What you expected
- What happened instead
- Console logs if available (open the app, then View > Toggle Developer Tools)

Good bug reports get fixed. Vague ones sit in the backlog.

### Feature requests

Open an issue describing the **creator outcome** you want, not the technical implementation.

Good: "I want to be able to describe a character's emotion and have it reflected in their posture across panels."

Not as useful: "Add ControlNet pose estimation support."

The first tells us what the creator experiences. The second tells us one possible solution — there may be better ones.

### Code contributions

Before writing code, open an issue describing what you want to build. This prevents duplicated effort and ensures the contribution fits the architecture.

Good areas for code contributions:
- Film Dictionary tooling (validation scripts, term coverage reports)
- Export formats (PDF storyboard, FCP XML, Final Draft sync)
- Performance improvements to the ComfyUI integration
- Platform support (Windows installer improvements, Linux AppImage)
- Accessibility improvements

Areas to avoid without prior discussion:
- Changes to the core generation pipeline
- New AI model integrations
- UI redesigns

---

## Development setup

### Prerequisites

- Node.js 18 or later
- npm
- Ollama running locally
- ComfyUI installed at `~/ComfyUI` with DreamShaper 8

### Clone and install

```bash
git clone https://github.com/imagginary/imagginary.git
cd imagginary
npm install
```

### Run in development

```bash
npm run dev
```

This starts webpack and opens the Electron app. Changes to React components hot-reload. Changes to `electron.mjs` require an app restart.

### Project structure

```
src/                    React components and TypeScript source
  data/
    FilmLanguageDictionary.ts   The Film Dictionary
    StyleVault.ts               Style profiles
  components/
    App.tsx                     Root component
    PanelViewer.tsx             Main panel display
    WelcomeFlow.tsx             Onboarding flow
    CharacterLibrary.tsx        Character management
    ScriptReader.tsx            Screenplay import
  services/
    OllamaService.ts            LLM integration
    ComfyUIService.ts           Image generation
    CharacterLibraryService.ts  Character persistence
public/
  electron.mjs                  Main process
  preload.js                    Renderer bridge
  loading.html                  Splash screen
build/
  icon.png                      App icon source
resources/
  ollama/                       Bundled Ollama binary (not in git)
```

### Code style

- TypeScript throughout
- No `any` types without a comment explaining why
- Component files use PascalCase, service files use PascalCase + Service suffix
- Keep components focused — if a component is over 300 lines, consider splitting

---

## Pull request process

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Test manually — generate a panel, check the feature works end to end
4. Open a PR with a clear description of what changed and why
5. Link any related issues

PRs are reviewed within a few days. Film Dictionary PRs are merged quickly. Code PRs take longer.

---

## What we will not merge

- Changes that add cloud dependencies to the Community tier
- Telemetry or analytics without explicit opt-in
- Features that surface ComfyUI or Stable Diffusion terminology to the user
- Anything that breaks the local-first privacy guarantee

---

## Licence

By contributing, you agree your contributions will be licensed under the MIT licence.

---

*Built for filmmakers. Not for AI enthusiasts.*
