import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Download, Box, X, Loader2, AlertCircle, Lock } from 'lucide-react';
import { Character, MultiViewPaths, MeshGenerationProgress } from '../types';

const ANGLE_LABELS: Array<{ key: keyof MultiViewPaths; label: string }> = [
  { key: 'front',      label: 'Front' },
  { key: 'frontLeft',  label: '¾ L' },
  { key: 'left',       label: 'Side L' },
  { key: 'back',       label: 'Back' },
  { key: 'right',      label: 'Side R' },
  { key: 'frontRight', label: '¾ R' },
];

// ── Three.js OBJ viewer ────────────────────────────────────────────────────────

function ObjViewer({ objPath }: { objPath: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const width = el.clientWidth;
    const height = el.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    renderer.setClearColor(0x111111, 1);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
    camera.position.set(0, 1, 3);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(5, 10, 7.5);
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0x8899ff, 0.4);
    fill.position.set(-5, -2, -5);
    scene.add(fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.5;

    // Load OBJ — file:// prefix required for Electron local paths
    const fileUrl = objPath.startsWith('file://') ? objPath : `file://${objPath}`;
    const loader = new OBJLoader();
    loader.load(
      fileUrl,
      (obj) => {
        // Auto-center and scale to fit view
        const box = new THREE.Box3().setFromObject(obj);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 2 / maxDim;
        obj.scale.setScalar(scale);
        obj.position.sub(center.multiplyScalar(scale));

        // Apply a default material if OBJ has none
        obj.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            if (!mesh.material || (Array.isArray(mesh.material) && mesh.material.length === 0)) {
              mesh.material = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
            }
          }
        });

        scene.add(obj);
      },
      undefined,
      (err) => console.error('[ObjViewer] load error', err),
    );

    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [objPath]);

  return <div ref={mountRef} className="w-full h-full" />;
}

// ── Main TurntableViewer component ────────────────────────────────────────────

interface TurntableViewerProps {
  character: Character;
  isPro: boolean;
  onClose: () => void;
  onGenerate: (characterId: string) => void;
  meshProgress: MeshGenerationProgress | null;
}

export default function TurntableViewer({
  character,
  isPro,
  onClose,
  onGenerate,
  meshProgress,
}: TurntableViewerProps) {
  const isGenerating =
    meshProgress?.characterId === character.id &&
    (meshProgress.stage === 'generating-mesh' || meshProgress.stage === 'generating-turntable');

  const progressPct =
    meshProgress?.characterId === character.id ? meshProgress.pct : 0;

  const progressMsg =
    meshProgress?.characterId === character.id ? meshProgress.message : '';

  const hasMesh = Boolean(character.meshPath);
  const hasVideo = Boolean(character.turntableVideoPath);

  function handleDownload(filePath: string) {
    const api = (window as unknown as { electronAPI?: { openMeshFile?: (p: string) => void } }).electronAPI;
    api?.openMeshFile?.(filePath);
  }

  return (
    // Fixed overlay — renders on top of the sidebar
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-950 border border-gray-800 rounded-xl shadow-2xl w-[520px] max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <Box className="w-4 h-4 text-imagginary-400" />
            <span className="text-sm font-semibold text-gray-200">{character.name} — 3D Model</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-imagginary-900/60 text-imagginary-300 font-medium">Pro+</span>
          </div>
          <button onClick={onClose} className="p-1 rounded text-gray-600 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-3 p-4 overflow-y-auto flex-1">

          {/* Pro gate */}
          {!isPro && (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <Lock className="w-8 h-8 text-imagginary-400/50" />
              <p className="text-sm text-gray-400 font-medium">3D Turntable requires Pro+</p>
              <p className="text-xs text-gray-600 max-w-64">
                Upgrade to generate OBJ / GLB meshes and 360° turntable videos from your characters.
              </p>
            </div>
          )}

          {isPro && (
            <>
              {/* 3D viewport */}
              <div className="w-full aspect-video bg-gray-900 rounded-lg overflow-hidden relative">
                {hasVideo ? (
                  // Pre-rendered turntable video
                  <video
                    src={`file://${character.turntableVideoPath}`}
                    className="w-full h-full object-contain"
                    autoPlay
                    loop
                    muted
                    playsInline
                  />
                ) : hasMesh ? (
                  // Live three.js OBJ viewer with orbit controls
                  <ObjViewer objPath={character.meshPath!} />
                ) : isGenerating ? (
                  // Progress state
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                    <Loader2 className="w-8 h-8 text-imagginary-400 animate-spin" />
                    <div className="text-xs text-gray-400 text-center max-w-64">{progressMsg || 'Generating…'}</div>
                    <div className="w-40 h-1 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-imagginary-500 transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  // Empty state — generate button
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                    <Box className="w-10 h-10 text-gray-700" />
                    <p className="text-xs text-gray-600">No 3D model generated yet</p>
                    <button
                      onClick={() => onGenerate(character.id)}
                      disabled={!character.referenceImagePath}
                      className="px-4 py-2 bg-imagginary-600 hover:bg-imagginary-500 disabled:bg-gray-800 disabled:text-gray-600 text-black text-xs font-semibold rounded-lg transition-colors"
                    >
                      Generate 3D Model
                    </button>
                    {!character.referenceImagePath && (
                      <p className="text-[10px] text-gray-700">Character needs a reference image first</p>
                    )}
                  </div>
                )}

                {/* InstantMesh not available notice — shown if generation failed */}
                {meshProgress?.characterId === character.id && meshProgress.stage === 'error' && (
                  <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 bg-red-950/80 border border-red-800/40 rounded px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span className="text-[10px] text-red-300 truncate">{meshProgress.error ?? 'Generation failed'}</span>
                  </div>
                )}
              </div>

              {/* Download buttons */}
              {(hasMesh || character.glbPath) && (
                <div className="flex gap-2">
                  {character.meshPath && (
                    <button
                      onClick={() => handleDownload(character.meshPath!)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      Download OBJ
                    </button>
                  )}
                  {character.glbPath && (
                    <button
                      onClick={() => handleDownload(character.glbPath!)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      Download GLB
                    </button>
                  )}
                  {hasMesh && !isGenerating && (
                    <button
                      onClick={() => onGenerate(character.id)}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded-lg transition-colors"
                    >
                      Regenerate
                    </button>
                  )}
                </div>
              )}

              {/* 6-angle multiview thumbnails */}
              {character.multiViewData && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Source views</p>
                  <div className="grid grid-cols-6 gap-1">
                    {ANGLE_LABELS.map(({ key, label }) => (
                      <div key={key} className="flex flex-col items-center gap-0.5">
                        <div className="w-full aspect-square bg-gray-800 rounded overflow-hidden">
                          {character.multiViewData![key] && (
                            <img src={character.multiViewData![key]} alt={label} className="w-full h-full object-cover" />
                          )}
                        </div>
                        <span className="text-[8px] text-gray-700">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* InstantMesh availability note */}
              <p className="text-[10px] text-gray-700 text-center">
                Requires InstantMesh running on <span className="font-mono">localhost:7860</span>
                {' '}with GPU for mesh generation.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
