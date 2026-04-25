## Motion Generation (Phase 6)

### Community tier

Motion generation requires a Wan 2.1 I2V 14B model (~14GB on disk) plus a T5 text encoder (~9GB)
and a VAE (~484MB). Total disk: ~24GB.

**Minimum hardware:**
- NVIDIA RTX 3080 10GB or better
- Apple Silicon with 64GB unified memory

Most laptops and 16GB machines cannot run this locally. If you click **Animate** and no local model
is detected, Aeon shows an upgrade prompt pointing to Pro cloud generation instead.

### Pro tier (recommended for most users)

Cloud generation via Muapi — works on any machine, no local model needed.
Under 60 seconds per clip. Counts against your monthly cloud panel allowance.

### Local setup for power users

**Step 1 — Install the ComfyUI-WanVideoWrapper custom node**
```bash
cd ~/ComfyUI/custom_nodes
git clone https://github.com/kijai/ComfyUI-WanVideoWrapper
cd ComfyUI-WanVideoWrapper
# IMPORTANT: use ComfyUI's own venv, not system Python
~/ComfyUI/venv/bin/pip install -r requirements.txt
```

> **Note:** If you see `ModuleNotFoundError: No module named 'accelerate'` on ComfyUI startup,
> run `~/ComfyUI/venv/bin/pip install accelerate` — ComfyUI uses its own venv, not system Python.

**Step 2 — Download the three required model files**

Use `~/ComfyUI/venv/bin/hf` (not system `huggingface-cli`) to ensure downloads go through
ComfyUI's venv. Set `HF_TOKEN` to avoid unauthenticated rate limiting.

**2a — Wan 2.1 I2V 14B fp8 480P diffusion model (~14 GB on disk)**

```bash
mkdir -p ~/ComfyUI/models/diffusion_models
HF_TOKEN=<your_token> ~/ComfyUI/venv/bin/hf download kijai/WanVideo_comfy \
  Wan2_1-I2V-14B-480P_fp8_e4m3fn.safetensors \
  --local-dir ~/ComfyUI/models/diffusion_models
```

This is the smallest viable I2V model. No Wan I2V model smaller than 14B exists — the 1.3B
variants are text-to-video only.

**2b — T5 text encoder (~9GB)**
```bash
mkdir -p ~/ComfyUI/models/text_encoders
HF_TOKEN=<your_token> ~/ComfyUI/venv/bin/hf download kijai/WanVideo_comfy \
  umt5-xxl-enc-bf16.safetensors \
  --local-dir ~/ComfyUI/models/text_encoders
```

**2c — Wan VAE (~484MB)**
```bash
mkdir -p ~/ComfyUI/models/vae
HF_TOKEN=<your_token> ~/ComfyUI/venv/bin/hf download kijai/WanVideo_comfy \
  Wan2_2_VAE_bf16.safetensors \
  --local-dir ~/ComfyUI/models/vae
```

**Step 3 — Restart ComfyUI**

> **Required on Apple Silicon:** The fp8 model loads ~14 GB onto the MPS device; the BF16 model
> loads ~27 GB. On a 32 GB machine this leaves very little headroom. You **must** start ComfyUI
> with `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0` — this disables the MPS memory ceiling and lets
> macOS use swap rather than hard-crashing with an OOM error.

```bash
# Required on Apple Silicon — disables MPS memory ceiling
lsof -ti:8188 | xargs kill -9 2>/dev/null
cd ~/ComfyUI && PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0 ./start.sh
```

On 32 GB machines generation is still likely to fail or be very slow (swap thrashing). The upgrade
prompt in Aeon will show a low-memory warning automatically. For reliable local generation use a
machine with 64 GB unified memory or an NVIDIA GPU with ≥ 16 GB VRAM (e.g. RTX 3080/4080 on RunPod).

**Step 4 — Verify**

Open ComfyUI at localhost:8188, search for "WanVideoModelLoader" in the node list.
In Aeon Storyboard, generate a panel image, then click **Animate** — if all three model files
are found, the generation UI appears instead of the upgrade prompt (~3–8 min on Apple Silicon with
64 GB, or via RunPod with an RTX 4090).

---

# InstantMesh Setup

InstantMesh enables multi-angle character consistency in Aeon Storyboard.
When a character is created, their reference portrait is processed through
InstantMesh to generate 6 consistent views (front, ¾ left, side left, back,
side right, ¾ right). These are used with IP-Adapter to anchor character
appearance in subsequent shots.

## Install

```bash
git clone https://github.com/instantmesh/InstantMesh
cd InstantMesh
pip install -r requirements.txt
python app.py
```

Server starts at http://localhost:7860

## Apple Silicon (MPS)

```bash
python app.py --device mps
```

## Not required

Aeon Storyboard works fully without InstantMesh. If offline:
- Character creation still generates the portrait via ComfyUI
- The portrait is used directly as the character reference
- IP-Adapter will use the single front-facing image for all angles
- The "InstantMesh" status dot in the title bar shows red — this is informational only

## IP-Adapter

For IP-Adapter character injection in panel generation, install the ComfyUI
IP-Adapter extension:

```bash
cd ~/ComfyUI/custom_nodes
git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus
cd ~/ComfyUI && pip install -r custom_nodes/ComfyUI_IPAdapter_plus/requirements.txt
```

Then restart ComfyUI. Aeon detects IP-Adapter availability automatically.
If not installed, panel generation proceeds normally without character reference injection.

### Download IPAdapter models

```bash
mkdir -p ~/ComfyUI/models/ipadapter
mkdir -p ~/ComfyUI/models/clip_vision

# IPAdapter model
curl -L "https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter_sd15.bin" \
  -o ~/ComfyUI/models/ipadapter/ip-adapter_sd15.bin

# CLIP Vision model
curl -L "https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/pytorch_model.bin" \
  -o ~/ComfyUI/models/clip_vision/clip_vision_g.safetensors
```
