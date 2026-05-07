# Imagginary

**Local-first AI storyboard generator for filmmakers, screenwriters, and anyone with a story to tell.**

Type a shot. Get a cinematic storyboard panel in under 60 seconds. Free, open source, runs entirely on your machine.

![Imagginary hero panels](https://imagginary.com/og-image.png)

---

## The story was always in your head. Now it has a frame.

Every great film began as a vision no one else could see. Imagginary gives that vision a frame — before you have a budget, a crew, or a single day of production.

Describe a shot in plain language. Imagginary understands cinema — Dutch angle, rack focus, chiaroscuro, golden hour — and renders a professional storyboard panel in seconds. Chain panels into a sequence. Import a screenplay. Export an animatic. Pitch your film before you have cast anyone.

No cloud subscription. No API keys. No prompting expertise. Everything runs on your machine.

---

## Features

**Natural language to cinematic panel**
Write what you see. "A detective stands in the rain, street lamp behind her, rack focus from her face to the neon sign." Imagginary parses cinematic intent and generates the frame.

**Film Dictionary**
300+ cinematic vocabulary terms built in. Shot types, camera angles, lighting setups, moods, film movements. Say "Kurosawa composition" or "chiaroscuro" — it knows exactly what you mean.

**Character Studio**
Define a character once. Their costume, silhouette, and appearance stay consistent across every panel in your sequence.

**Script Reader**
Paste a screenplay excerpt. Imagginary reads every scene, generates panels automatically, and sequences them into a complete storyboard.

**Style Vault**
Lock a visual aesthetic across your entire project. Film Noir Ink. Studio Ghibli Watercolour. Comic Book Bold. Every panel belongs to the same film.

**Animatic Export**
Panels assembled into a playable MP4 with timing. Pitch it before you have cast anyone.

**Local. Always.**
Runs via Ollama and ComfyUI on your hardware. Your screenplay, your characters, your vision — none of it passes through a server. Not because we promise it. Because the architecture makes it impossible.

---

## Download

**[Download for Mac (Apple Silicon)](https://github.com/imagginary/imagginary/releases/download/v1.0.1/Imagginary-1.0.0-arm64.dmg)**

Windows and Linux AppImage coming soon.

---

## Getting Started

### Requirements

- Mac with Apple Silicon (M1, M2, or M3)
- macOS 13 or later
- 16GB RAM minimum, 32GB recommended
- 10GB free disk space (for models)

### Install

1. Download `Imagginary-1.0.0-arm64.dmg`
2. Drag Imagginary to your Applications folder
3. Open Imagginary

On first launch, Imagginary automatically:
- Starts Ollama (bundled)
- Finds or installs ComfyUI
- Downloads DreamShaper 8 (~2GB, one time only)
- Pulls the qwen2.5 language model

This takes 5-10 minutes on first launch. After that, the app opens in seconds.

### Your first panel

1. Complete the welcome flow (project type and first shot description)
2. Hit Generate
3. Your first storyboard panel appears in under 60 seconds

---

## Building from Source

### Prerequisites

- Node.js 18 or later
- npm
- Ollama installed and running
- ComfyUI installed at `~/ComfyUI` with DreamShaper 8

### Setup

```bash
git clone https://github.com/imagginary/imagginary.git
cd imagginary
npm install
```

### Development

```bash
npm run dev
```

This starts webpack in watch mode and opens the Electron app pointing to localhost:3000.

### Build

```bash
npm run dist
```

The built DMG appears in `release/`.

### Ollama binary (for packaged builds)

The packaged app bundles an Ollama binary. For local dev, Imagginary uses your system Ollama from PATH.

To build a fully bundled DMG:
```bash
# Place the Ollama binary at:
resources/ollama/mac/ollama
chmod +x resources/ollama/mac/ollama
npm run dist
```

See `SETUP.md` for details.

---

## Architecture

Imagginary has three layers:

| Layer | What it is | What the creator sees |
|---|---|---|
| Director Interface | Electron + React + TypeScript | A clean panel viewer, character library, and shot input |
| Intelligence Layer | Ollama (qwen2.5) + Film Dictionary | The AI that understands what they mean |
| Generation Engine | ComfyUI + Stable Diffusion (DreamShaper 8) | Cinematic storyboard panels |

ComfyUI never surfaces to the user. No workflow configuration. No checkpoint management. No SD terminology required.

---

## What is open source

The entire application is MIT licensed:
- Director Interface (Electron + React)
- Intelligence Layer (Ollama integration + Film Dictionary)
- Generation pipeline (ComfyUI integration)

**What is not open source** (proprietary Pro/Studio features, not yet built):
- Style LoRA library
- Cloud infrastructure
- Brand LoRA training pipeline
- Custom voice cloning

---

## Contributing

Contributions are welcome. The most impactful thing you can contribute right now is Film Dictionary terms.

### Contributing Film Dictionary terms

The Film Dictionary lives in `src/data/FilmLanguageDictionary.ts`. Each entry follows this structure:

```typescript
{
  term: "chiaroscuro",
  category: "lighting",
  promptBoost: "dramatic chiaroscuro lighting, deep shadows, single light source, high contrast",
  description: "Strong contrast between light and dark areas",
}
```

Open a PR with new terms. Good candidates: cinematography techniques, animation principles, colour theory terms, director-specific styles.

### Bug reports

Open an issue with:
- macOS version
- Hardware (M1/M2/M3, RAM)
- What happened vs what you expected
- Console logs if available

### Feature requests

Open an issue describing the creator outcome you want, not the technical implementation.

---

## Roadmap

| Phase | Feature | Status |
|---|---|---|
| 0-8 | Core app, panel engine, Film Dictionary, Character Studio, Animatic, Script Reader, Style Vault | Done |
| 6 | Motion layer (Wan 2.2) | Code complete, validation pending |
| 9 | InstantMesh character turntable | Scaffolded |
| 10 | Cloud generation bridge (Pro) | Not started |
| 14 | Bundled one-click installer | Done |

---

## Community

- **Discord** - join the community, share panels, get help
- **Twitter/X** - follow [@imagginaryapp](https://twitter.com/imagginaryapp) for updates
- **imagginary.com** — website and documentation

---

## License

MIT. See [LICENSE](LICENSE).

The panels you generate are yours. Imagginary uses DreamShaper 8 by default, released under a permissive licence for commercial use.

---

*Built for filmmakers. Not for AI enthusiasts.*
