#!/usr/bin/env python3
"""
Phase 6C — Motion Library Builder
==================================
Offline pipeline (run once) to build the full 200-clip motion library.

Usage:
    python scripts/build_motion_library.py

Requirements:
    pip install requests Pillow tqdm

Environment variables (set in .env or shell):
    PEXELS_API_KEY    — Pexels API key (required for downloading clips)
    OLLAMA_URL        — Ollama endpoint (default: http://localhost:11434)
    OPENPOSE_BIN      — path to OpenPose binary (optional, enables real pose extraction)
    FFMPEG_BIN        — path to ffmpeg binary (default: ffmpeg in PATH)

Outputs (added to resources/motion_library/):
    index.json                                  — updated clip index
    clips/{id}/metadata.json                    — per-clip metadata
    clips/{id}/pose_sequence.json               — extracted pose keyframes
    clips/{id}/thumbnail.jpg                    — first-frame thumbnail (256×256)

Quality filter:
    Clips where average joint confidence < 75% are rejected.
    When OpenPose is unavailable, synthetic sequences are generated.

The starter 20 clips already ship with the app — this script adds up to 180 more.
"""

import os
import sys
import json
import time
import hashlib
import subprocess
import tempfile
import argparse
import math
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent
LIBRARY_DIR = REPO_ROOT / "resources" / "motion_library"
CLIPS_DIR = LIBRARY_DIR / "clips"
INDEX_PATH = LIBRARY_DIR / "index.json"

PEXELS_API_KEY = os.environ.get("PEXELS_API_KEY", "")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OPENPOSE_BIN = os.environ.get("OPENPOSE_BIN", "")
FFMPEG_BIN = os.environ.get("FFMPEG_BIN", "ffmpeg")

FRAMES_PER_SEC = 8
MIN_CONFIDENCE = 0.75
TARGET_CLIPS = 200
CLIPS_PER_CATEGORY = 3

# 30 motion categories + Pexels search queries
CATEGORIES = {
    "walks":       ["walking person", "people walking street"],
    "turns":       ["person turning around", "character rotation"],
    "gestures":    ["hand gesture talking", "person gesturing"],
    "reactions":   ["surprised person reaction", "startled reaction"],
    "combat":      ["martial arts fight", "boxing training"],
    "emotional":   ["person crying emotional", "sad emotional scene"],
    "cinematic":   ["cinematic dramatic pose", "hero silhouette"],
    "sports":      ["athlete sports training", "sports action"],
    "dance":       ["person dancing", "dance performance"],
    "work":        ["person working office", "typing computer"],
    "sitting":     ["person sitting relaxed", "seated posture"],
    "standing":    ["person standing idle", "standing pose"],
    "transitions": ["sit to stand transition", "person getting up"],
    "crowd":       ["crowd cheering", "audience applause"],
    "nature":      ["person reaching climbing nature", "outdoor activity"],
    "vehicle":     ["person driving car", "motorcycle rider"],
    "animal":      ["person crawling ground", "animal movement human"],
    "fight":       ["street fight self defense", "combat defense"],
    "chase":       ["person running chase", "escape sprint"],
    "romance":     ["couple reaching embrace", "romantic gesture"],
    "comedy":      ["funny stumble comedy", "slapstick fall"],
    "horror":      ["person scared horror reaction", "creeping stealth"],
    "drama":       ["dramatic monologue acting", "theater acting"],
    "action":      ["action hero stunt", "action sequence"],
    "slow-motion": ["slow motion sports", "slow motion jump"],
    "running":     ["person running fast", "sprint athlete"],
    "falling":     ["person falling ground", "tumbling fall"],
    "climbing":    ["person climbing wall", "rock climbing gym"],
    "swimming":    ["person swimming pool", "swimming stroke"],
    "driving":     ["person driving steering wheel", "car interior driving"],
}

# ── Utilities ─────────────────────────────────────────────────────────────────

def log(msg, level="INFO"):
    print(f"[{level}] {msg}", flush=True)

def slug(text):
    import re
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")

def run_ffmpeg(*args, **kwargs):
    cmd = [FFMPEG_BIN, "-y", "-hide_banner", "-loglevel", "error"] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True, **kwargs)
    return result

def get_video_duration(video_path):
    """Return duration in seconds using ffprobe."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
            capture_output=True, text=True
        )
        return float(result.stdout.strip())
    except Exception:
        return 5.0

# ── Pexels API ────────────────────────────────────────────────────────────────

def search_pexels_videos(query, per_page=3):
    """Search Pexels for videos matching query. Returns list of video dicts."""
    if not PEXELS_API_KEY:
        log("PEXELS_API_KEY not set — skipping Pexels download", "WARN")
        return []

    try:
        import urllib.request
        import urllib.parse
        url = f"https://api.pexels.com/videos/search?query={urllib.parse.quote(query)}&per_page={per_page}&orientation=portrait"
        req = urllib.request.Request(url, headers={"Authorization": PEXELS_API_KEY})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        return data.get("videos", [])
    except Exception as e:
        log(f"Pexels search failed for '{query}': {e}", "WARN")
        return []

def download_video(video_dict, dest_path):
    """Download the HD version of a Pexels video."""
    try:
        import urllib.request
        files = sorted(video_dict.get("video_files", []),
                       key=lambda f: f.get("width", 0), reverse=True)
        for f in files:
            link = f.get("link", "")
            if link:
                log(f"  Downloading {link[:60]}…")
                urllib.request.urlretrieve(link, dest_path)
                return True
    except Exception as e:
        log(f"  Download failed: {e}", "WARN")
    return False

# ── Frame extraction ──────────────────────────────────────────────────────────

def extract_frames(video_path, out_dir, fps=FRAMES_PER_SEC, max_frames=60):
    """Extract frames from video at fps. Returns list of frame paths."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    duration = get_video_duration(video_path)
    actual_fps = min(fps, max_frames / max(duration, 1))

    result = run_ffmpeg(
        "-i", str(video_path),
        "-vf", f"fps={actual_fps:.2f},scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2",
        "-frames:v", str(max_frames),
        str(out_dir / "frame_%04d.jpg"),
    )

    frames = sorted(out_dir.glob("frame_*.jpg"))
    log(f"  Extracted {len(frames)} frames from {Path(video_path).name}")
    return frames

# ── OpenPose extraction ───────────────────────────────────────────────────────

def extract_pose_openpose(frame_paths):
    """
    Run OpenPose on frames. Returns list of PoseKeyframe dicts.
    Falls back to synthetic sequence if OpenPose is unavailable.
    """
    if not OPENPOSE_BIN or not Path(OPENPOSE_BIN).exists():
        log("  OpenPose not found — generating synthetic pose sequence", "WARN")
        return generate_synthetic_sequence(len(frame_paths))

    keyframes = []
    for frame_path in frame_paths:
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run([
                OPENPOSE_BIN,
                "--image_dir", str(frame_path.parent),
                "--write_json", tmp,
                "--number_people_max", "1",
                "--display", "0",
                "--render_pose", "0",
            ], capture_output=True, text=True)

            json_files = list(Path(tmp).glob("*.json"))
            if not json_files:
                keyframes.append(generate_neutral_pose())
                continue

            with open(json_files[0]) as f:
                op_data = json.load(f)

            people = op_data.get("people", [])
            if not people:
                keyframes.append(generate_neutral_pose())
                continue

            # OpenPose 25-keypoint BODY_25 → 17-keypoint format
            kps = people[0].get("pose_keypoints_2d", [])
            keyframes.append(convert_openpose_to_17joint(kps))

    return keyframes

def convert_openpose_to_17joint(kps_flat):
    """
    Convert OpenPose BODY_25 flat array [x,y,conf, ...] to 17-joint PoseKeyframe.
    Maps: nose(0), eyes(14,15), ears(16,17), shoulders(2,5), elbows(3,6),
          wrists(4,7), hips(8,11), knees(9,12), ankles(10,13).
    """
    def jnt(idx):
        x, y, c = kps_flat[idx*3], kps_flat[idx*3+1], kps_flat[idx*3+2]
        if c < 0.1:
            return None
        # Normalize to [0,1] assuming 512x512 input
        return {"x": round(min(x / 512.0, 1.0), 3), "y": round(min(y / 512.0, 1.0), 3), "conf": round(c, 3)}

    try:
        joints = [
            jnt(0),   # nose
            jnt(14),  # left_eye
            jnt(15),  # right_eye
            jnt(16),  # left_ear
            jnt(17),  # right_ear
            jnt(2),   # left_shoulder
            jnt(5),   # right_shoulder
            jnt(3),   # left_elbow
            jnt(6),   # right_elbow
            jnt(4),   # left_wrist
            jnt(7),   # right_wrist
            jnt(8),   # left_hip
            jnt(11),  # right_hip
            jnt(9),   # left_knee
            jnt(12),  # right_knee
            jnt(10),  # left_ankle
            jnt(13),  # right_ankle
        ]
        return {"joints": joints, "easing": "ease-in-out"}
    except (IndexError, TypeError):
        return generate_neutral_pose()

def average_confidence(pose_sequence):
    """Return average joint confidence score across sequence."""
    confs = []
    for kf in pose_sequence:
        for j in kf.get("joints", []):
            if j and "conf" in j:
                confs.append(j["conf"])
    return sum(confs) / len(confs) if confs else 1.0  # synthetic = 1.0

# ── Synthetic pose generation ─────────────────────────────────────────────────

def generate_neutral_pose():
    """Standing neutral pose."""
    return {
        "joints": [
            {"x": 0.50, "y": 0.08}, {"x": 0.47, "y": 0.06}, {"x": 0.53, "y": 0.06},
            {"x": 0.44, "y": 0.07}, {"x": 0.56, "y": 0.07},
            {"x": 0.42, "y": 0.20}, {"x": 0.58, "y": 0.20},
            {"x": 0.40, "y": 0.36}, {"x": 0.60, "y": 0.36},
            {"x": 0.38, "y": 0.51}, {"x": 0.62, "y": 0.51},
            {"x": 0.44, "y": 0.52}, {"x": 0.56, "y": 0.52},
            {"x": 0.44, "y": 0.70}, {"x": 0.56, "y": 0.70},
            {"x": 0.44, "y": 0.90}, {"x": 0.56, "y": 0.90},
        ],
        "easing": "ease-in-out"
    }

def generate_synthetic_sequence(frame_count, style="walk"):
    """Generate a synthetic walking-like pose sequence."""
    sequence = []
    for i in range(max(frame_count, 2)):
        t = i / max(frame_count - 1, 1)
        phase = t * math.pi * 4
        swing = math.sin(phase) * 0.08
        lift_l = max(0, math.sin(phase)) * 0.12
        lift_r = max(0, math.sin(phase + math.pi)) * 0.12
        sequence.append({
            "joints": [
                {"x": 0.50, "y": 0.08}, {"x": 0.47, "y": 0.06}, {"x": 0.53, "y": 0.06},
                {"x": 0.44, "y": 0.07}, {"x": 0.56, "y": 0.07},
                {"x": 0.42, "y": 0.20}, {"x": 0.58, "y": 0.20},
                {"x": round(0.42 + swing, 3), "y": 0.36}, {"x": round(0.58 - swing, 3), "y": 0.36},
                {"x": round(0.40 + swing * 1.5, 3), "y": 0.51}, {"x": round(0.60 - swing * 1.5, 3), "y": 0.51},
                {"x": 0.44, "y": 0.52}, {"x": 0.56, "y": 0.52},
                {"x": round(0.44 - swing * 0.5, 3), "y": round(0.70 - lift_l, 3)},
                {"x": round(0.56 + swing * 0.5, 3), "y": round(0.70 - lift_r, 3)},
                {"x": round(0.44 - swing, 3), "y": round(0.90 - lift_l, 3)},
                {"x": round(0.56 + swing, 3), "y": round(0.90 - lift_r, 3)},
            ],
            "easing": "ease-in-out"
        })
    return sequence

# ── LLaVA auto-tagging ────────────────────────────────────────────────────────

def auto_tag_with_llava(thumbnail_path, category):
    """
    Use LLaVA via Ollama to auto-describe and tag a clip thumbnail.
    Falls back to category-based defaults if LLaVA is unavailable.
    """
    try:
        import base64
        import urllib.request

        with open(thumbnail_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()

        payload = {
            "model": "llava:latest",
            "messages": [{
                "role": "user",
                "content": f"Describe this image as a motion clip for a storyboard tool. Category: {category}. "
                           f"Return ONLY a JSON object: {{\"name\": \"...\", \"description\": \"...\", \"tags\": [...]}} "
                           f"Name: max 3 words. Description: 1 sentence. Tags: 3-6 keywords.",
                "images": [img_b64],
            }],
            "stream": False,
        }

        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/chat",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        content = result.get("message", {}).get("content", "")

        # Extract JSON from response
        import re
        m = re.search(r"\{[\s\S]*\}", content)
        if m:
            parsed = json.loads(m.group(0))
            return parsed.get("name", category), parsed.get("description", ""), parsed.get("tags", [])
    except Exception as e:
        log(f"  LLaVA tagging failed: {e}", "WARN")

    # Fallback
    return f"{category.title()} Motion", f"Motion clip in the {category} category.", [category]

# ── Thumbnail extraction ──────────────────────────────────────────────────────

def extract_thumbnail(video_path, out_path, timestamp=1.0):
    """Extract a single frame as thumbnail."""
    result = run_ffmpeg(
        "-ss", str(timestamp),
        "-i", str(video_path),
        "-vframes", "1",
        "-vf", "scale=256:256:force_original_aspect_ratio=decrease,pad=256:256:(ow-iw)/2:(oh-ih)/2",
        str(out_path),
    )
    return result.returncode == 0

# ── Main pipeline ─────────────────────────────────────────────────────────────

def process_video(video_dict, category, clip_id, clip_dir):
    """Full pipeline for a single Pexels video."""
    clip_dir = Path(clip_dir)
    clip_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        video_path = Path(tmp) / "source.mp4"

        # Download
        if not download_video(video_dict, video_path):
            return None

        duration = get_video_duration(video_path)

        # Extract thumbnail
        thumbnail_path = clip_dir / "thumbnail.jpg"
        extract_thumbnail(video_path, thumbnail_path)

        # Extract frames
        frame_dir = Path(tmp) / "frames"
        frame_paths = extract_frames(video_path, frame_dir)
        if not frame_paths:
            log(f"  No frames extracted for {clip_id}", "WARN")
            return None

        # Extract poses
        pose_sequence = extract_pose_openpose(frame_paths)

        # Quality filter
        avg_conf = average_confidence(pose_sequence)
        log(f"  Average pose confidence: {avg_conf:.2f}")
        if avg_conf < MIN_CONFIDENCE and OPENPOSE_BIN:
            log(f"  Rejected: confidence {avg_conf:.2f} < {MIN_CONFIDENCE}", "WARN")
            return None

        # Auto-tag
        name, description, tags = auto_tag_with_llava(thumbnail_path, category)

        # Save outputs
        with open(clip_dir / "pose_sequence.json", "w") as f:
            json.dump(pose_sequence, f, indent=2)

        metadata = {
            "id": clip_id,
            "name": name,
            "description": description,
            "category": category,
            "duration": round(duration, 2),
            "tags": list(set([category] + tags)),
            "confidence": round(avg_conf * 100),
            "pexelsId": video_dict.get("id"),
            "pexelsUrl": video_dict.get("url", ""),
        }

        with open(clip_dir / "metadata.json", "w") as f:
            json.dump(metadata, f, indent=2)

        log(f"  ✓ Saved clip: {clip_id} ({name})")
        return metadata

def load_existing_index():
    """Load existing index.json, returning list of metadata dicts."""
    if INDEX_PATH.exists():
        with open(INDEX_PATH) as f:
            return json.load(f)
    return []

def save_index(clips):
    """Write updated index.json."""
    with open(INDEX_PATH, "w") as f:
        json.dump(clips, f, indent=2)
    log(f"Index updated: {len(clips)} total clips")

# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Build Imagginary motion library")
    parser.add_argument("--categories", nargs="*", help="Limit to specific categories")
    parser.add_argument("--clips-per-category", type=int, default=CLIPS_PER_CATEGORY)
    parser.add_argument("--dry-run", action="store_true", help="List clips without downloading")
    args = parser.parse_args()

    if not PEXELS_API_KEY and not args.dry_run:
        print("ERROR: PEXELS_API_KEY environment variable is required.")
        print("Set it with: export PEXELS_API_KEY=your_key_here")
        print("Get a free key at: https://www.pexels.com/api/")
        sys.exit(1)

    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    existing = load_existing_index()
    existing_ids = {c["id"] for c in existing}
    new_clips = list(existing)

    categories = args.categories or list(CATEGORIES.keys())
    total_new = 0

    for category in categories:
        queries = CATEGORIES.get(category, [category])
        cat_existing = sum(1 for c in new_clips if c.get("category") == category)
        needed = args.clips_per_category - cat_existing

        if needed <= 0:
            log(f"Category '{category}' already has {cat_existing} clips — skipping")
            continue

        log(f"\n── Category: {category} (need {needed} more) ──")

        for query in queries:
            if needed <= 0:
                break

            log(f"Searching Pexels: '{query}'")
            if args.dry_run:
                log(f"  [DRY RUN] Would search for: {query}")
                continue

            videos = search_pexels_videos(query, per_page=min(needed + 1, 5))
            for video in videos:
                if needed <= 0:
                    break

                pexels_id = str(video.get("id", ""))
                clip_id = f"{category}-{slug(query[:20])}-{pexels_id}"

                if clip_id in existing_ids:
                    log(f"  Skip (already exists): {clip_id}")
                    continue

                log(f"Processing video ID {pexels_id}…")
                clip_dir = CLIPS_DIR / clip_id
                metadata = process_video(video, category, clip_id, clip_dir)

                if metadata:
                    new_clips.append(metadata)
                    existing_ids.add(clip_id)
                    needed -= 1
                    total_new += 1

                    # Rate limit
                    time.sleep(0.5)

    save_index(new_clips)
    starter_count = sum(1 for c in new_clips if c.get("isStarter"))
    log(f"\n✓ Done. Total clips: {len(new_clips)} ({total_new} new, {starter_count} starter)")
    log(f"Library at: {LIBRARY_DIR}")

if __name__ == "__main__":
    main()
