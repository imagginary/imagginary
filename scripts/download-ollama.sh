#!/bin/bash
# Downloads Ollama binaries for local development builds.
# Run once before: npm run build or electron-builder
# Update OLLAMA_VERSION when bumping: https://github.com/ollama/ollama/releases

set -e

OLLAMA_VERSION="v0.9.0"

echo "Downloading Ollama $OLLAMA_VERSION for macOS..."
mkdir -p resources/ollama/mac
curl -fsSL "https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-darwin" \
  -o resources/ollama/mac/ollama
chmod +x resources/ollama/mac/ollama

echo "Done. resources/ollama/mac/ollama is ready."
