# Ollama Binary Setup

These binaries are NOT committed to git. CI downloads them automatically during the build.

For local development builds, run:

    npm run setup:ollama

This downloads `ollama-darwin` (macOS universal binary) into `resources/ollama/mac/ollama`.
Windows devs: run `scripts/download-ollama.ps1` in PowerShell instead.

## Version pin

The pinned version is set in both `scripts/download-ollama.sh` and `.github/workflows/build.yml`.
Update `OLLAMA_VERSION` in both places when bumping: https://github.com/ollama/ollama/releases

## How it works

- The binary is bundled into `Contents/Resources/bin/ollama` at build time via the
  `extraResources` field in `package.json`.
- In packaged mode the app spawns `ollama serve` using the bundled binary.
- In dev mode (`npm run dev`) the app uses the system `ollama` from PATH instead.
