import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  ArrowLeft,
  Bone,
  Camera,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  Grid,
  Info,
  RotateCcw,
} from 'lucide-react';
import {
  buildKaelVeyr,
  CharacterSpecs,
  HeroAnimName,
  KaelCharacterInstance,
} from './kaelCharacter';

interface HeroShowcaseProps {
  onClose: () => void;
}

type CameraProjection = 'perspective' | 'orthographic';
type FocusPreset = 'full' | 'face' | 'armor' | 'blade';

const PRESET_VIEWS: Record<
  FocusPreset,
  { label: string; pos: [number, number, number]; target: [number, number, number] }
> = {
  full: { label: 'Full Body', pos: [0.65, 1.32, 3.05], target: [0, 0.96, 0] },
  face: { label: 'Face & Scar', pos: [0.18, 1.72, 0.72], target: [0, 1.70, 0.03] },
  armor: { label: 'Armor & Amulet', pos: [-0.42, 1.24, 1.18], target: [0.02, 1.15, 0.04] },
  blade: { label: 'Runic Sword', pos: [-0.95, 1.08, 1.15], target: [-0.28, 0.88, 0.38] },
};

const ANIMATIONS: HeroAnimName[] = ['Idle', 'Walk', 'Run', 'Attack', 'Death'];

function detectSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    return /SwiftShader|llvmpipe|Software|ANGLE.*Direct3D.*WARP/i.test(renderer);
  } catch {
    return false;
  }
}

export const HeroShowcase: React.FC<HeroShowcaseProps> = ({ onClose }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const [activeAnim, setActiveAnim] = useState<HeroAnimName>('Idle');
  const [projection, setProjection] = useState<CameraProjection>('perspective');
  const [focusPreset, setFocusPreset] = useState<FocusPreset>('full');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [specsOpen, setSpecsOpen] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [specs, setSpecs] = useState<CharacterSpecs | null>(null);

  // Refs bridging React controls into the Three.js runtime
  const runtimeRef = useRef<{
    character: KaelCharacterInstance;
    mixer: THREE.AnimationMixer;
    actions: Record<HeroAnimName, THREE.AnimationAction>;
    currentAction: THREE.AnimationAction;
    perspCam: THREE.PerspectiveCamera;
    orthoCam: THREE.OrthographicCamera;
    activeCam: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    controls: OrbitControls;
    tweenTarget: {
      active: boolean;
      goalPos: THREE.Vector3;
      goalTarget: THREE.Vector3;
    };
  } | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const aspect = width / Math.max(1, height);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    const isSoftware = detectSoftwareRenderer(renderer.getContext());
    const dpr = isSoftware ? 1 : Math.min(window.devicePixelRatio || 1, 2);

    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0c0e14');
    scene.fog = new THREE.FogExp2('#0c0e14', 0.085);

    // Neutral studio IBL environment for realistic PBR steel reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();

    // Cameras (Perspective + Orthographic sharing OrbitControls)
    const perspCam = new THREE.PerspectiveCamera(36, aspect, 0.08, 40);
    perspCam.position.set(...PRESET_VIEWS.full.pos);

    const orthoHalfH = 1.32;
    const orthoCam = new THREE.OrthographicCamera(
      -orthoHalfH * aspect,
      orthoHalfH * aspect,
      orthoHalfH,
      -orthoHalfH,
      0.08,
      40
    );
    orthoCam.position.copy(perspCam.position);

    const controls = new OrbitControls(perspCam, renderer.domElement);
    controls.target.set(...PRESET_VIEWS.full.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 0.42;
    controls.maxDistance = 6.0;
    controls.minPolarAngle = 0.14;
    controls.maxPolarAngle = Math.PI * 0.505;
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    controls.update();

    // Studio Three-Point + Atmospheric Dark Fantasy Lighting
    const hemiLight = new THREE.HemisphereLight(0xb8c4d8, 0x261f1c, 0.72);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.35);
    keyLight.position.set(2.4, 3.8, 3.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(isSoftware ? 1024 : 2048, isSoftware ? 1024 : 2048);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 12;
    keyLight.shadow.camera.left = -1.8;
    keyLight.shadow.camera.right = 1.8;
    keyLight.shadow.camera.top = 2.5;
    keyLight.shadow.camera.bottom = -0.5;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.018;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x88a4c8, 0.78);
    fillLight.position.set(-2.6, 1.9, 1.8);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xd7c099, 1.45);
    rimLight.position.set(-1.4, 2.6, -2.8);
    scene.add(rimLight);

    // Dark Fantasy Stone Pedestal & Studio Floor
    const studioGroup = new THREE.Group();
    const floorGeo = new THREE.CircleGeometry(7.5, 48);
    floorGeo.rotateX(-Math.PI * 0.5);
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#11141c',
      roughness: 0.92,
      metalness: 0.08,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.y = -0.06;
    floorMesh.receiveShadow = true;

    const plinthGeo = new THREE.CylinderGeometry(0.82, 0.92, 0.06, 48);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: '#1c202a',
      roughness: 0.84,
      metalness: 0.16,
    });
    const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
    plinthMesh.position.y = -0.03;
    plinthMesh.receiveShadow = true;
    plinthMesh.castShadow = true;

    const ringGeo = new THREE.TorusGeometry(0.835, 0.008, 12, 64);
    ringGeo.rotateX(Math.PI * 0.5);
    const ringMat = new THREE.MeshStandardMaterial({
      color: '#5a4a33',
      roughness: 0.52,
      metalness: 0.78,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = -0.002;

    studioGroup.add(floorMesh, plinthMesh, ringMesh);
    scene.add(studioGroup);

    // Build Kael Veyr Character
    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const character = buildKaelVeyr(maxAniso);
    scene.add(character.root);
    scene.add(character.skeletonHelper);
    setSpecs(character.specs);

    // AnimationMixer setup
    const mixer = new THREE.AnimationMixer(character.root);
    const actions: Record<HeroAnimName, THREE.AnimationAction> = {
      Idle: mixer.clipAction(character.clips.Idle),
      Walk: mixer.clipAction(character.clips.Walk),
      Run: mixer.clipAction(character.clips.Run),
      Attack: mixer.clipAction(character.clips.Attack),
      Death: mixer.clipAction(character.clips.Death),
    };
    actions.Death.setLoop(THREE.LoopOnce, 1);
    actions.Death.clampWhenFinished = true;

    actions.Idle.play();

    runtimeRef.current = {
      character,
      mixer,
      actions,
      currentAction: actions.Idle,
      perspCam,
      orthoCam,
      activeCam: perspCam,
      controls,
      tweenTarget: {
        active: false,
        goalPos: new THREE.Vector3(),
        goalTarget: new THREE.Vector3(),
      },
    };

    const handleResize = () => {
      if (!container || !runtimeRef.current) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      const a = w / Math.max(1, h);
      perspCam.aspect = a;
      perspCam.updateProjectionMatrix();

      const hh = 1.32;
      orthoCam.left = -hh * a;
      orthoCam.right = hh * a;
      orthoCam.top = hh;
      orthoCam.bottom = -hh;
      orthoCam.updateProjectionMatrix();

      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Cancel camera preset tween immediately if user starts orbiting/zooming manually
    const onControlStart = () => {
      if (runtimeRef.current) {
        runtimeRef.current.tweenTarget.active = false;
      }
    };
    controls.addEventListener('start', onControlStart);

    let rafId = 0;
    let lastTime = performance.now();
    let elapsed = 0;

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      elapsed += dt;

      const rt = runtimeRef.current;
      if (!rt) return;

      rt.mixer.update(dt);
      rt.character.updateVisualFx(elapsed);

      if (rt.tweenTarget.active) {
        const alpha = 1 - Math.exp(-7.5 * dt);
        rt.activeCam.position.lerp(rt.tweenTarget.goalPos, alpha);
        rt.controls.target.lerp(rt.tweenTarget.goalTarget, alpha);
        if (
          rt.activeCam.position.distanceTo(rt.tweenTarget.goalPos) < 0.008 &&
          rt.controls.target.distanceTo(rt.tweenTarget.goalTarget) < 0.008
        ) {
          rt.activeCam.position.copy(rt.tweenTarget.goalPos);
          rt.controls.target.copy(rt.tweenTarget.goalTarget);
          rt.tweenTarget.active = false;
        }
      }

      rt.controls.update();
      renderer.render(scene, rt.activeCam);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      mixer.stopAllAction();
      character.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      plinthGeo.dispose();
      plinthMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      runtimeRef.current = null;
    };
  }, []);

  // Switch animation with smooth crossfade
  const handleSelectAnim = (anim: HeroAnimName) => {
    setActiveAnim(anim);
    const rt = runtimeRef.current;
    if (!rt) return;
    const nextAction = rt.actions[anim];
    const prevAction = rt.currentAction;

    if (anim === 'Death') {
      nextAction.reset();
      nextAction.setEffectiveTimeScale(1);
      nextAction.setEffectiveWeight(1);
      nextAction.play();
      if (prevAction !== nextAction) {
        prevAction.crossFadeTo(nextAction, 0.25, true);
      }
      rt.currentAction = nextAction;
      return;
    }

    if (prevAction === nextAction) {
      nextAction.reset().play();
      return;
    }

    nextAction.enabled = true;
    nextAction.reset();
    nextAction.setEffectiveTimeScale(1);
    nextAction.setEffectiveWeight(1);
    nextAction.play();
    prevAction.crossFadeTo(nextAction, 0.28, true);
    rt.currentAction = nextAction;
  };

  // Switch Perspective <-> Orthographic seamlessly preserving viewpoint
  const handleToggleProjection = (mode: CameraProjection) => {
    setProjection(mode);
    const rt = runtimeRef.current;
    if (!rt) return;

    const target = rt.controls.target;
    if (mode === 'orthographic' && rt.activeCam !== rt.orthoCam) {
      const dist = rt.perspCam.position.distanceTo(target);
      rt.orthoCam.position.copy(rt.perspCam.position);
      rt.orthoCam.zoom = THREE.MathUtils.clamp(2.8 / Math.max(0.45, dist), 0.45, 5.2);
      rt.orthoCam.updateProjectionMatrix();
      rt.activeCam = rt.orthoCam;
      rt.controls.object = rt.orthoCam;
      rt.controls.update();
    } else if (mode === 'perspective' && rt.activeCam !== rt.perspCam) {
      rt.perspCam.position.copy(rt.orthoCam.position);
      rt.perspCam.updateProjectionMatrix();
      rt.activeCam = rt.perspCam;
      rt.controls.object = rt.perspCam;
      rt.controls.update();
    }
  };

  const handleFocusPreset = (preset: FocusPreset) => {
    setFocusPreset(preset);
    const rt = runtimeRef.current;
    if (!rt) return;
    const cfg = PRESET_VIEWS[preset];
    rt.tweenTarget.goalPos.set(...cfg.pos);
    rt.tweenTarget.goalTarget.set(...cfg.target);
    rt.tweenTarget.active = true;

    if (rt.activeCam === rt.orthoCam) {
      const dist = rt.tweenTarget.goalPos.distanceTo(rt.tweenTarget.goalTarget);
      rt.orthoCam.zoom = THREE.MathUtils.clamp(2.8 / Math.max(0.45, dist), 0.45, 5.2);
      rt.orthoCam.updateProjectionMatrix();
    }
  };

  const handleToggleWireframe = () => {
    const next = !wireframe;
    setWireframe(next);
    runtimeRef.current?.character.setWireframe(next);
  };

  const handleToggleSkeleton = () => {
    const next = !showSkeleton;
    setShowSkeleton(next);
    if (runtimeRef.current) {
      runtimeRef.current.character.skeletonHelper.visible = next;
    }
  };

  const handleExportGlb = async () => {
    const rt = runtimeRef.current;
    if (!rt) return;
    setExportStatus('Exporting GLB...');
    try {
      const exporter = new GLTFExporter();
      const buffer = await exporter.parseAsync(rt.character.root, {
        binary: true,
        animations: rt.character.clipList,
      });
      if (buffer instanceof ArrayBuffer) {
        const blob = new Blob([buffer], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'kael_veyr_ashen_warden.glb';
        a.click();
        URL.revokeObjectURL(url);
        const kb = Math.round(buffer.byteLength / 1024);
        setExportStatus(`Exported ${kb} KB (.glb)`);
      }
    } catch (err) {
      setExportStatus(err instanceof Error ? `Export error: ${err.message}` : 'Export failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0c0e14] text-[#eae3d2] select-none overflow-hidden">
      {/* Dedicated WebGL Mount Container (never apply CSS backdrop-blur over this) */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full touch-none" />

      {/* Minimal Top-Left Character Identity & Back Button */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-start justify-between gap-3 pointer-events-none">
        <div className="flex items-center gap-2.5 pointer-events-auto">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-3.5 py-2 rounded-md bg-[#121620] hover:bg-[#1b2130] border border-[#c49a45]/45 text-[#eae3d2] text-xs sm:text-sm font-medium flex items-center gap-2 cursor-pointer shadow-lg"
          >
            <ArrowLeft className="w-4 h-4 text-[#c49a45]" />
            <span>Back</span>
          </button>

          <div className="px-3.5 py-1.5 rounded-md bg-[#121620]/95 border border-[#2b3242] shadow-lg">
            <div className="text-[10px] tracking-[0.18em] uppercase text-[#c49a45] font-semibold">
              Hero Asset Showcase
            </div>
            <h1 className="font-display text-sm sm:text-base font-bold text-[#f2ece0] leading-tight">
              Kael Veyr — The Ashen Warden
            </h1>
          </div>
        </div>

        {/* Top-Right Technical Specs & Pipeline Drawer Trigger */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={() => handleFocusPreset('full')}
            aria-label="Reset Camera"
            className="min-h-[44px] min-w-[44px] px-3 rounded-md bg-[#121620] hover:bg-[#1b2130] border border-[#2b3242] text-[#c5beae] hover:text-[#f2ece0] flex items-center justify-center gap-1.5 text-xs cursor-pointer shadow-lg"
          >
            <RotateCcw className="w-4 h-4 text-[#c49a45]" />
            <span className="hidden sm:inline">Reset View</span>
          </button>
          <button
            type="button"
            onClick={() => setSpecsOpen((v) => !v)}
            className={`min-h-[44px] px-3.5 py-2 rounded-md border text-xs sm:text-sm font-medium flex items-center gap-2 cursor-pointer shadow-lg ${
              specsOpen
                ? 'bg-[#c49a45] border-[#c49a45] text-[#101218]'
                : 'bg-[#121620] hover:bg-[#1b2130] border-[#c49a45]/45 text-[#eae3d2]'
            }`}
          >
            <Info className="w-4 h-4" />
            <span className="hidden sm:inline">Specs &amp; .GLB</span>
          </button>
        </div>
      </div>

      {/* Collapsible Top-Right Technical Specs / Rig / Export Drawer */}
      {specsOpen && specs && (
        <div className="absolute top-16 right-3 z-20 w-[calc(100%-1.5rem)] max-w-sm rounded-lg bg-[#11151f] border border-[#c49a45]/45 shadow-2xl p-4 flex flex-col gap-3 max-h-[68vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-[#252c3c] pb-2">
            <div>
              <h2 className="font-display text-sm font-bold text-[#f2ece0]">
                3D Character Technical Report
              </h2>
              <p className="text-[11px] text-[#9e9788]">
                Three.js SkinnedMesh · PBR · AnimationMixer
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded bg-[#181c27] border border-[#262d3d]">
              <div className="text-[10px] text-[#8f8879]">Triangles</div>
              <div className="font-mono-num font-semibold text-[#f2ece0]">
                {specs.triangleCount.toLocaleString()}
              </div>
            </div>
            <div className="p-2 rounded bg-[#181c27] border border-[#262d3d]">
              <div className="text-[10px] text-[#8f8879]">Vertices / Meshes</div>
              <div className="font-mono-num font-semibold text-[#f2ece0]">
                {specs.vertexCount.toLocaleString()} / {specs.meshCount}
              </div>
            </div>
            <div className="p-2 rounded bg-[#181c27] border border-[#262d3d]">
              <div className="text-[10px] text-[#8f8879]">Skeleton Bones</div>
              <div className="font-mono-num font-semibold text-[#f2ece0]">
                {specs.boneCount} Bones
              </div>
            </div>
            <div className="p-2 rounded bg-[#181c27] border border-[#262d3d]">
              <div className="text-[10px] text-[#8f8879]">Materials / Maps</div>
              <div className="font-mono-num font-semibold text-[#f2ece0]">
                {specs.materialCount} Mats · {specs.textureCount} Maps
              </div>
            </div>
          </div>

          <div className="text-[11px] text-[#b4ad9d] space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-[#c49a45] font-semibold">
              Procedural PBR Texture Maps
            </div>
            {specs.textureSummary.map((line) => (
              <div key={line} className="truncate">
                · {line}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={handleToggleWireframe}
              className={`min-h-[40px] flex-1 px-3 py-1.5 rounded text-xs font-medium border flex items-center justify-center gap-1.5 cursor-pointer ${
                wireframe
                  ? 'bg-[#c49a45] border-[#c49a45] text-[#101218]'
                  : 'bg-[#181c27] border-[#2c3447] text-[#eae3d2]'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>Wireframe</span>
            </button>
            <button
              type="button"
              onClick={handleToggleSkeleton}
              className={`min-h-[40px] flex-1 px-3 py-1.5 rounded text-xs font-medium border flex items-center justify-center gap-1.5 cursor-pointer ${
                showSkeleton
                  ? 'bg-[#c49a45] border-[#c49a45] text-[#101218]'
                  : 'bg-[#181c27] border-[#2c3447] text-[#eae3d2]'
              }`}
            >
              <Bone className="w-3.5 h-3.5" />
              <span>Rig Bones</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportGlb}
            className="min-h-[44px] w-full px-3 py-2 rounded bg-[#c49a45] hover:bg-[#d6ac56] text-[#101218] font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export Rigged .GLB Asset</span>
          </button>
          {exportStatus && (
            <div className="text-[11px] text-center text-[#9fd3a8]">{exportStatus}</div>
          )}
        </div>
      )}

      {/* Single Collapsible Bottom Control Dock (Animation + Camera + Focus) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 w-[calc(100%-1.5rem)] max-w-3xl pointer-events-none">
        <div className="rounded-lg bg-[#11151f]/95 border border-[#c49a45]/40 shadow-2xl pointer-events-auto overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#232939]">
            <div className="text-[11px] text-[#9e9788] flex items-center gap-2 truncate">
              <span className="text-[#c49a45] font-semibold">Controls</span>
              <span className="hidden sm:inline">
                Drag / Touch 1-Finger: Orbit 360° · Scroll / Pinch: Zoom
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDockCollapsed((v) => !v)}
              className="min-h-[34px] px-2 text-xs text-[#c5beae] hover:text-[#f2ece0] flex items-center gap-1 cursor-pointer"
            >
              <span>{dockCollapsed ? 'Show' : 'Hide'}</span>
              {dockCollapsed ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          </div>

          {!dockCollapsed && (
            <div className="p-2.5 sm:p-3 flex flex-col gap-2.5">
              {/* Row 1: 5 Skeletal Animations */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-[#8f8879] mr-1 hidden sm:inline">
                  Anim
                </span>
                {ANIMATIONS.map((anim) => {
                  const active = activeAnim === anim;
                  return (
                    <button
                      key={anim}
                      type="button"
                      onClick={() => handleSelectAnim(anim)}
                      className={`min-h-[42px] flex-1 min-w-[58px] px-2.5 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#c49a45] text-[#101218]'
                          : 'bg-[#1a1f2b] hover:bg-[#242b3c] text-[#eae3d2] border border-[#2d3548]'
                      }`}
                    >
                      {anim}
                    </button>
                  );
                })}
              </div>

              {/* Row 2: Camera Projection & Inspection Focus Presets */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#1e2433]">
                <div className="flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-[#c49a45] hidden sm:block" />
                  <button
                    type="button"
                    onClick={() => handleToggleProjection('perspective')}
                    className={`min-h-[38px] px-3 py-1 rounded text-xs font-medium cursor-pointer ${
                      projection === 'perspective'
                        ? 'bg-[#2a3246] text-[#f2ece0] border border-[#c49a45]/60'
                        : 'bg-[#171b26] text-[#9e9788] border border-[#262d3d]'
                    }`}
                  >
                    Perspective
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleProjection('orthographic')}
                    className={`min-h-[38px] px-3 py-1 rounded text-xs font-medium cursor-pointer ${
                      projection === 'orthographic'
                        ? 'bg-[#2a3246] text-[#f2ece0] border border-[#c49a45]/60'
                        : 'bg-[#171b26] text-[#9e9788] border border-[#262d3d]'
                    }`}
                  >
                    Orthographic
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-[#c49a45] hidden sm:block" />
                  {(Object.keys(PRESET_VIEWS) as FocusPreset[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleFocusPreset(key)}
                      className={`min-h-[38px] px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                        focusPreset === key
                          ? 'bg-[#2a3246] text-[#f2ece0] border border-[#c49a45]/60'
                          : 'bg-[#171b26] text-[#9e9788] border border-[#262d3d]'
                      }`}
                    >
                      {PRESET_VIEWS[key].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
