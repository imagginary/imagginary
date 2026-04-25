# Ollama Binary Setup

Place the Ollama binaries here before running `npm run dist`.

## Mac (arm64 + x64)

Download the Ollama CLI binary from https://ollama.ai/download/mac and place it at:

    resources/ollama/mac/ollama

Make it executable:

    chmod +x resources/ollama/mac/ollama

The same binary works for both arm64 and x64 (it is a universal binary).

## Windows (x64)

Download the Ollama CLI binary from https://ollama.ai/download/windows and place it at:

    resources/ollama/win/ollama.exe

## Notes

- These binaries are NOT committed to git (listed in .gitignore).
- The binaries are bundled into the app's Resources/bin/ directory at build time
  via the `extraResources` field in package.json.
- In dev mode (npm run dev), Aeon uses the system `ollama` from PATH instead.
- The binary is spawned with `ollama serve` on app startup in packaged mode.
