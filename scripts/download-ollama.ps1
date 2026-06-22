# Downloads Ollama binary for local development builds on Windows.
# Run once before: npm run build or electron-builder
# Update $OllamaVersion when bumping: https://github.com/ollama/ollama/releases

$OllamaVersion = "v0.9.0"

Write-Host "Downloading Ollama $OllamaVersion for Windows..."
New-Item -ItemType Directory -Force -Path resources\ollama\win | Out-Null
Invoke-WebRequest `
  -Uri "https://github.com/ollama/ollama/releases/download/$OllamaVersion/ollama-windows-amd64.exe" `
  -OutFile "resources\ollama\win\ollama.exe"

Write-Host "Done. resources\ollama\win\ollama.exe is ready."
