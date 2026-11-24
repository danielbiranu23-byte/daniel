import { BookOpen, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

interface Bible3DShowcaseProps {
  variant?: 'hero' | 'auth';
}

function detectSoftwareGl(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const r = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    return /SwiftShader|llvmpipe|Software|Mesa Offscreen/i.test(r);
  } catch {
    return false;
  }
}

function createScripturePageTexture(side: 'left' | 'right', maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 640;
  const ctx = canvas.getContext('2d')!;

  // Warm parchment paper gradient
  const grad = ctx.createLinearGradient(side === 'left' ? 512 : 0, 0, side === 'left' ? 0 : 512, 0);
  grad.addColorStop(0, '#e6decb');
  grad.addColorStop(0.14, '#f8f4ea');
  grad.addColorStop(0.85, '#fcfaf4');
  grad.addColorStop(1, '#ede5d4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 640);

  // Inner gilded frame border
  ctx.strokeStyle = 'rgba(154, 107, 22, 0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, 464, 592);
  ctx.strokeStyle = 'rgba(20, 45, 76, 0.14)';
  ctx.lineWidth = 1;
  ctx.strokeRect(32, 32, 448, 576);

  // Header
  ctx.fillStyle = '#9a6b16';
  ctx.font = 'bold 18px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    side === 'left' ? 'KITAABA QULQULLUU · AFAAN OROMO' : 'HOLY BIBLE · ENGLISH (WEB)',
    256,
    68
  );

  // Gold divider
  ctx.strokeStyle = '#c59437';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(86, 84);
  ctx.lineTo(426, 84);
  ctx.stroke();

  // Scripture text
  ctx.textAlign = 'left';
  ctx.fillStyle = '#142d4c';
  ctx.font = 'bold 24px Georgia, serif';
  ctx.fillText(side === 'left' ? 'Yohaannis 3:16' : 'John 3:16', 54, 132);

  const linesOm = [
    '“Waaqayyo, akkasitti tokkicha',
    'ilma isaa hamma kennutti',
    'biyya lafaa jaallate; kun',
    'immoo isatti kan amanu',
    'hundinuu jireenya bara baraa',
    'haa qabaatuuf malee,',
    'haa baduuf miti.”',
    '',
    'Faarfannaa 119:105',
    '“Dubbiin kee miilla kootiif',
    'ibsaa dha, daandii koo',
    'irrattis ifa dha.”',
  ];

  const linesEn = [
    '“For God so loved the world,',
    'that he gave his one and only',
    'Son, that whoever believes in',
    'him should not perish, but',
    'have eternal life.”',
    '',
    '',
    'Psalm 119:105',
    '“Your word is a lamp to my',
    'feet, and a light for my',
    'path.”',
    '— Proverbs 3:5-6',
  ];

  const lines = side === 'left' ? linesOm : linesEn;
  let y = 178;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('Faarfannaa') || line.startsWith('Psalm')) {
      ctx.fillStyle = '#142d4c';
      ctx.font = 'bold 22px Georgia, serif';
    } else {
      ctx.fillStyle = '#24211c';
      ctx.font = '19px Georgia, serif';
    }
    ctx.fillText(line, 54, y);
    y += 33;
  }

  // Footer gilded ornament
  ctx.fillStyle = '#9a6b16';
  ctx.font = '15px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(side === 'left' ? '✦  Kakuu Moofaa & Haaraa  ✦' : '✦  66 Sacred Books  ✦', 256, 594);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, Math.max(1, maxAniso));
  tex.needsUpdate = true;
  return tex;
}

function createFieryScriptureTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Dark ember backing band with soft vertical fade so molten gold-fire letters stay vivid on both dark & light UIs
  const bandGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bandGrad.addColorStop(0, 'rgba(20, 6, 2, 0)');
  bandGrad.addColorStop(0.18, 'rgba(34, 9, 2, 0.72)');
  bandGrad.addColorStop(0.5, 'rgba(46, 12, 3, 0.88)');
  bandGrad.addColorStop(0.82, 'rgba(34, 9, 2, 0.72)');
  bandGrad.addColorStop(1, 'rgba(20, 6, 2, 0)');
  ctx.fillStyle = bandGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Fiery top & bottom hairline rails
  const railGrad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  railGrad.addColorStop(0, '#ff6a00');
  railGrad.addColorStop(0.25, '#ffd166');
  railGrad.addColorStop(0.5, '#ff5400');
  railGrad.addColorStop(0.75, '#ffd166');
  railGrad.addColorStop(1, '#ff6a00');

  ctx.save();
  ctx.strokeStyle = railGrad;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = '#ff5e00';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(0, 34);
  ctx.lineTo(canvas.width, 34);
  ctx.moveTo(0, 158);
  ctx.lineTo(canvas.width, 158);
  ctx.stroke();
  ctx.restore();

  // Rising painted flame tongues along the ribbon edges
  for (let i = 0; i < 64; i++) {
    const x = (i / 64) * canvas.width + 16;
    const h = 14 + ((i * 37) % 22);
    const flameGrad = ctx.createRadialGradient(x, 156, 2, x, 156 - h * 0.5, h);
    flameGrad.addColorStop(0, 'rgba(255, 224, 115, 0.55)');
    flameGrad.addColorStop(0.45, 'rgba(255, 98, 0, 0.35)');
    flameGrad.addColorStop(1, 'rgba(220, 38, 38, 0)');
    ctx.fillStyle = flameGrad;
    ctx.beginPath();
    ctx.arc(x, 156 - h * 0.35, h * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }

  // Render the sacred verse repeated cleanly around the full 360-degree cylinder
  const verseText = '✦  “Yesuus karaadha, dhugaadha, jireenya” — Yohn 14:6  ✦';
  ctx.font = 'bold 42px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const drawGlowingSegment = (centerX: number) => {
    // Outer deep crimson-orange fire halo
    ctx.save();
    ctx.fillStyle = '#ff4800';
    ctx.shadowColor = '#ff3b00';
    ctx.shadowBlur = 26;
    ctx.fillText(verseText, centerX, 98);
    ctx.restore();

    // Mid molten amber glow
    ctx.save();
    ctx.fillStyle = '#ff9e00';
    ctx.shadowColor = '#ff9500';
    ctx.shadowBlur = 12;
    ctx.fillText(verseText, centerX, 97);
    ctx.restore();

    // Inner incandescent white-gold flame core
    const textGrad = ctx.createLinearGradient(0, 70, 0, 124);
    textGrad.addColorStop(0, '#fff9db');
    textGrad.addColorStop(0.48, '#ffd166');
    textGrad.addColorStop(0.82, '#ff7b00');
    textGrad.addColorStop(1, '#dc2f02');
    ctx.save();
    ctx.fillStyle = textGrad;
    ctx.shadowColor = '#ffb703';
    ctx.shadowBlur = 4;
    ctx.fillText(verseText, centerX, 96);
    ctx.restore();
  };

  drawGlowingSegment(canvas.width * 0.25);
  drawGlowingSegment(canvas.width * 0.75);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, Math.max(1, maxAniso));
  tex.needsUpdate = true;
  return tex;
}

export function Bible3DShowcase({ variant = 'hero' }: Bible3DShowcaseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resetTargetRef = useRef<(() => void) | null>(null);
  const [fallbackMode, setFallbackMode] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isSoftwareGl = detectSoftwareGl();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: isSoftwareGl ? 'low-power' : 'high-performance',
      });
    } catch {
      setFallbackMode(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1 : 2));
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      36,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      40
    );
    camera.position.set(0, 2.48, 5.95);
    camera.lookAt(0, 0.16, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();

    const hemi = new THREE.HemisphereLight('#fff8eb', '#264166', 1.15);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fff0d2', 2.2);
    keyLight.position.set(3.5, 5.5, 4.2);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.bias = -0.0005;
    }
    scene.add(keyLight);

    const goldRim = new THREE.PointLight('#f5cb78', 1.8, 12);
    goldRim.position.set(-2.5, 2.6, -2.0);
    scene.add(goldRim);

    const emberLight = new THREE.PointLight('#ff7a18', 1.5, 10);
    emberLight.position.set(0, 0.45, 2.25);
    scene.add(emberLight);

    // 10-Part Composite 3D Sacred Open Bible Group
    const bibleGroup = new THREE.Group();
    bibleGroup.rotation.x = 0.22;
    scene.add(bibleGroup);

    const leatherMat = new THREE.MeshStandardMaterial({
      color: variant === 'auth' ? '#0e223d' : '#142d4c',
      roughness: 0.45,
      metalness: 0.18,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: '#d4a24c',
      roughness: 0.24,
      metalness: 0.88,
    });
    const ivorySideMat = new THREE.MeshStandardMaterial({
      color: '#eee6d4',
      roughness: 0.72,
      metalness: 0.04,
    });
    const ribbonMat = new THREE.MeshStandardMaterial({
      color: '#9e2a2b',
      roughness: 0.55,
      metalness: 0.1,
    });

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const leftTex = createScripturePageTexture('left', maxAniso);
    const rightTex = createScripturePageTexture('right', maxAniso);
    const leftPageTopMat = new THREE.MeshStandardMaterial({
      map: leftTex,
      roughness: 0.65,
      metalness: 0.02,
    });
    const rightPageTopMat = new THREE.MeshStandardMaterial({
      map: rightTex,
      roughness: 0.65,
      metalness: 0.02,
    });

    // 1. Center Spine Cylinder & Gilded Ribs
    const spineGeo = new THREE.CylinderGeometry(0.16, 0.16, 2.38, 24);
    const spine = new THREE.Mesh(spineGeo, leatherMat);
    spine.rotation.x = Math.PI / 2;
    spine.position.set(0, -0.06, 0);
    bibleGroup.add(spine);

    const ribGeo = new THREE.TorusGeometry(0.168, 0.018, 10, 24, Math.PI);
    const ribs: THREE.Mesh[] = [];
    for (let i = -2; i <= 2; i++) {
      const rib = new THREE.Mesh(ribGeo, goldMat);
      rib.position.set(0, -0.06, i * 0.45);
      rib.rotation.z = Math.PI;
      bibleGroup.add(rib);
      ribs.push(rib);
    }

    // 2 & 3. Left & Right Lapis Leather Covers (tilted open V-angle)
    const coverGeo = new THREE.BoxGeometry(1.75, 0.08, 2.42);
    const leftCover = new THREE.Mesh(coverGeo, leatherMat);
    leftCover.position.set(-0.92, 0.02, 0);
    leftCover.rotation.z = -0.14;
    leftCover.castShadow = !isSoftwareGl;
    leftCover.receiveShadow = !isSoftwareGl;
    bibleGroup.add(leftCover);

    const rightCover = new THREE.Mesh(coverGeo, leatherMat);
    rightCover.position.set(0.92, 0.02, 0);
    rightCover.rotation.z = 0.14;
    rightCover.castShadow = !isSoftwareGl;
    rightCover.receiveShadow = !isSoftwareGl;
    bibleGroup.add(rightCover);

    // 4 & 5. Left & Right Parchment Page Blocks with Scripture CanvasTextures
    const pageBlockGeo = new THREE.BoxGeometry(1.62, 0.19, 2.24);
    const leftPageMaterials = [
      ivorySideMat,
      ivorySideMat,
      leftPageTopMat,
      ivorySideMat,
      ivorySideMat,
      ivorySideMat,
    ];
    const rightPageMaterials = [
      ivorySideMat,
      ivorySideMat,
      rightPageTopMat,
      ivorySideMat,
      ivorySideMat,
      ivorySideMat,
    ];

    const leftPages = new THREE.Mesh(pageBlockGeo, leftPageMaterials);
    leftPages.position.set(-0.85, 0.14, 0);
    leftPages.rotation.z = -0.13;
    leftPages.castShadow = !isSoftwareGl;
    leftPages.receiveShadow = !isSoftwareGl;
    bibleGroup.add(leftPages);

    const rightPages = new THREE.Mesh(pageBlockGeo, rightPageMaterials);
    rightPages.position.set(0.85, 0.14, 0);
    rightPages.rotation.z = 0.13;
    rightPages.castShadow = !isSoftwareGl;
    rightPages.receiveShadow = !isSoftwareGl;
    bibleGroup.add(rightPages);

    // 6. Raised Curved Open Page Arch in Middle
    const archGeo = new THREE.CylinderGeometry(0.14, 0.14, 2.22, 20, 1, false, -Math.PI / 2, Math.PI);
    const centerValley = new THREE.Mesh(archGeo, ivorySideMat);
    centerValley.rotation.x = Math.PI / 2;
    centerValley.position.set(0, 0.12, 0);
    bibleGroup.add(centerValley);

    // 7. Four Gold Corner Clasps on Covers
    const claspGeo = new THREE.BoxGeometry(0.14, 0.11, 0.14);
    const claspCoords: Array<[number, number, number, number]> = [
      [-1.72, 0.13, 1.14, -0.14],
      [-1.72, 0.13, -1.14, -0.14],
      [1.72, 0.13, 1.14, 0.14],
      [1.72, 0.13, -1.14, 0.14],
    ];
    claspCoords.forEach(([x, y, z, rz]) => {
      const clasp = new THREE.Mesh(claspGeo, goldMat);
      clasp.position.set(x, y, z);
      clasp.rotation.z = rz;
      bibleGroup.add(clasp);
    });

    // 8. Crimson & Gold Bookmark Ribbon
    const ribbonGeo = new THREE.BoxGeometry(0.085, 0.015, 1.55);
    const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
    ribbon.position.set(0.28, 0.27, 0.56);
    ribbon.rotation.y = 0.16;
    ribbon.rotation.z = 0.13;
    bibleGroup.add(ribbon);

    // 9. Floating Blazing Burning 3D Cross Emblem with Living Fire
    const crossGroup = new THREE.Group();
    crossGroup.position.set(0, 0.92, -0.05);
    const crossVertGeo = new THREE.BoxGeometry(0.12, 0.66, 0.08);
    const crossHorizGeo = new THREE.BoxGeometry(0.44, 0.12, 0.08);

    const fireCrossMat = new THREE.MeshStandardMaterial({
      color: '#ff5500',
      emissive: '#ff3300',
      emissiveIntensity: 2.2,
      roughness: 0.22,
      metalness: 0.82,
    });
    const crossVert = new THREE.Mesh(crossVertGeo, fireCrossMat);
    const crossHoriz = new THREE.Mesh(crossHorizGeo, fireCrossMat);
    crossHoriz.position.set(0, 0.12, 0);

    const crossFireLight = new THREE.PointLight('#ff4800', 2.8, 3.2);
    crossFireLight.position.set(0, 0.12, 0);

    crossGroup.add(crossVert, crossHoriz, crossFireLight);
    bibleGroup.add(crossGroup);

    // 10. Fiery 3D Orbiting Scripture Ring ("Yesuus karaadha, dhugaadha, jireenya — Yohn 14:6")
    const orbitGroup = new THREE.Group();
    orbitGroup.position.set(0, 0.18, 0);
    orbitGroup.rotation.x = 0.12;
    orbitGroup.rotation.z = -0.06;
    scene.add(orbitGroup);

    const scriptureTex = createFieryScriptureTexture(maxAniso);
    const scriptureRibbonGeo = new THREE.CylinderGeometry(2.38, 2.38, 0.44, 72, 1, true);
    const scriptureRibbonMat = new THREE.MeshBasicMaterial({
      map: scriptureTex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const scriptureRibbonMesh = new THREE.Mesh(scriptureRibbonGeo, scriptureRibbonMat);
    scriptureRibbonMesh.renderOrder = 2;
    orbitGroup.add(scriptureRibbonMesh);

    // Living GLSL Flame Aura Sleeve around the Orbiting Scripture Ring
    const flameAuraGeo = new THREE.CylinderGeometry(2.35, 2.41, 0.62, 72, 1, true);
    const flameAuraMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        uniform float uTime;
        void main() {
          vUv = uv;
          vec3 pos = position;
          float wave = sin(uv.x * 24.0 - uTime * 3.6) * 0.025 * uv.y;
          pos.xz += normalize(pos.xz) * wave;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        void main() {
          vec2 uvFlame = vec2(vUv.x * 16.0 + sin(uTime * 0.9) * 0.35, vUv.y * 3.2 - uTime * 2.4);
          float n = noise(uvFlame) * 0.65 + noise(uvFlame * 2.1 + vec2(1.7, -uTime * 1.4)) * 0.35;
          float verticalMask = smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.18, vUv.y);
          float flame = smoothstep(0.32, 0.88, n + (1.0 - vUv.y) * 0.36) * verticalMask;
          vec3 deepEmber = vec3(0.88, 0.16, 0.02);
          vec3 brightFire = vec3(1.0, 0.56, 0.06);
          vec3 goldCore = vec3(1.0, 0.92, 0.58);
          vec3 col = mix(deepEmber, brightFire, smoothstep(0.2, 0.65, flame));
          col = mix(col, goldCore, smoothstep(0.65, 0.95, flame));
          gl_FragColor = vec4(col, flame * 0.58);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const flameAuraMesh = new THREE.Mesh(flameAuraGeo, flameAuraMat);
    flameAuraMesh.position.y = 0.05;
    flameAuraMesh.renderOrder = 1;
    orbitGroup.add(flameAuraMesh);

    // Orbiting Rising Fire Embers (Zero-GC GPU Shader Points)
    const sparkCount = 44;
    const sparkPositions = new Float32Array(sparkCount * 3);
    const sparkAngles = new Float32Array(sparkCount);
    const sparkRadii = new Float32Array(sparkCount);
    const sparkSpeeds = new Float32Array(sparkCount);
    const sparkPhases = new Float32Array(sparkCount);
    for (let i = 0; i < sparkCount; i++) {
      const a = (i / sparkCount) * Math.PI * 2;
      const r = 2.26 + ((i * 19) % 10) * 0.03;
      sparkPositions[i * 3] = Math.cos(a) * r;
      sparkPositions[i * 3 + 1] = (((i * 7) % 10) - 5) * 0.04;
      sparkPositions[i * 3 + 2] = Math.sin(a) * r;
      sparkAngles[i] = a;
      sparkRadii[i] = r;
      sparkSpeeds[i] = 0.35 + ((i * 13) % 7) * 0.05;
      sparkPhases[i] = (i * 1.37) % 6.283;
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    sparkGeo.setAttribute('aAngle', new THREE.BufferAttribute(sparkAngles, 1));
    sparkGeo.setAttribute('aRadius', new THREE.BufferAttribute(sparkRadii, 1));
    sparkGeo.setAttribute('aSpeed', new THREE.BufferAttribute(sparkSpeeds, 1));
    sparkGeo.setAttribute('aPhase', new THREE.BufferAttribute(sparkPhases, 1));

    const sparkMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1 : 2) },
      },
      vertexShader: `
        attribute float aAngle;
        attribute float aRadius;
        attribute float aSpeed;
        attribute float aPhase;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vLife;
        void main() {
          float life = fract(uTime * 0.45 * aSpeed + aPhase / 6.28318);
          vLife = life;
          float angle = aAngle + uTime * (0.42 + aSpeed * 0.25);
          float r = aRadius + sin(uTime * 2.5 + aPhase) * 0.06;
          vec3 pos = vec3(
            cos(angle) * r,
            -0.22 + life * 0.72,
            sin(angle) * r
          );
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = (18.0 * (1.0 - life * 0.55) * uPixelRatio) / max(1.0, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vLife;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float glow = pow(1.0 - d * 2.0, 2.0);
          float alpha = glow * sin(vLife * 3.14159);
          vec3 col = mix(vec3(1.0, 0.36, 0.02), vec3(1.0, 0.9, 0.5), glow);
          gl_FragColor = vec4(col, alpha * 0.95);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    sparkPoints.frustumCulled = false;
    sparkPoints.renderOrder = 3;
    orbitGroup.add(sparkPoints);

    // Subtle Golden Sanctuary Halo Ring + Soft Ground Shadow Disc
    const haloGeo = new THREE.TorusGeometry(2.15, 0.02, 16, 84);
    const haloMat = new THREE.MeshStandardMaterial({
      color: '#ff9f33',
      emissive: '#ff5500',
      emissiveIntensity: 0.45,
      metalness: 0.85,
      roughness: 0.22,
      transparent: true,
      opacity: 0.78,
    });
    const haloRing = new THREE.Mesh(haloGeo, haloMat);
    haloRing.rotation.x = Math.PI / 2 - 0.15;
    haloRing.position.set(0, -0.15, 0);
    bibleGroup.add(haloRing);

    const shadowPlaneGeo = new THREE.CircleGeometry(2.45, 48);
    const shadowPlaneMat = new THREE.MeshBasicMaterial({
      color: variant === 'auth' ? '#071222' : '#cfc7b6',
      transparent: true,
      opacity: variant === 'auth' ? 0.35 : 0.28,
    });
    const shadowDisc = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.set(0, -0.68, 0);
    scene.add(shadowDisc);

    // Interactive Pointer Drag Orbit + Smooth Damp
    let targetRotY = -0.22;
    let targetRotX = 0.22;
    let currentRotY = targetRotY;
    let currentRotX = targetRotX;
    let isDragging = false;
    let lastClientX = 0;
    let lastClientY = 0;

    resetTargetRef.current = () => {
      targetRotY = -0.22;
      targetRotX = 0.22;
    };

    const dom = renderer.domElement;
    dom.style.touchAction = 'none';
    dom.style.cursor = 'grab';

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      dom.style.cursor = 'grabbing';
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastClientX;
      const dy = e.clientY - lastClientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      targetRotY = THREE.MathUtils.clamp(targetRotY + dx * 0.009, -1.25, 1.25);
      targetRotX = THREE.MathUtils.clamp(targetRotX + dy * 0.007, -0.25, 0.85);
    };

    const onPointerUp = (e: PointerEvent) => {
      isDragging = false;
      dom.style.cursor = 'grab';
      try {
        dom.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };

    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('pointercancel', onPointerUp);

    const onResize = () => {
      if (!container) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    let contextLost = false;
    const onContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
    };
    const onContextRestored = () => {
      contextLost = false;
    };
    dom.addEventListener('webglcontextlost', onContextLost);
    dom.addEventListener('webglcontextrestored', onContextRestored);

    let disposed = false;
    let rafId = 0;
    let timerId: number | null = null;
    const clock = new THREE.Clock();

    const tick = () => {
      if (disposed) return;
      if (document.hidden || contextLost) {
        if (!prefersReducedMotion) scheduleNext();
        return;
      }

      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;

      const autoY = !isDragging && !prefersReducedMotion ? Math.sin(t * 0.45) * 0.16 : 0;
      currentRotY = THREE.MathUtils.damp(currentRotY, targetRotY + autoY, 5, dt);
      currentRotX = THREE.MathUtils.damp(currentRotX, targetRotX, 5, dt);

      bibleGroup.rotation.y = currentRotY;
      bibleGroup.rotation.x = currentRotX;
      bibleGroup.position.y = prefersReducedMotion ? 0 : Math.sin(t * 1.1) * 0.06;

      if (!prefersReducedMotion) {
        crossGroup.rotation.y = Math.sin(t * 0.7) * 0.25;
        crossGroup.position.y = 0.92 + Math.cos(t * 1.5) * 0.04;
        haloRing.rotation.z += dt * 0.35;
        crossFireLight.intensity = 2.2 + Math.sin(t * 7.5) * 0.9 + Math.cos(t * 12.0) * 0.45;

        // Orbit the fiery scripture cylinder around the 3D Bible
        scriptureRibbonMesh.rotation.y -= dt * 0.42;
        flameAuraMesh.rotation.y -= dt * 0.26;
        flameAuraMat.uniforms.uTime.value = t;
        sparkMat.uniforms.uTime.value = t;

        emberLight.position.x = Math.sin(t * 1.2) * 2.1;
        emberLight.position.z = Math.cos(t * 1.2) * 2.1;
        emberLight.intensity = 1.35 + Math.sin(t * 6.5) * 0.28;
      }

      renderer.render(scene, camera);
      if (!prefersReducedMotion) scheduleNext();
    };

    const scheduleNext = () => {
      if (disposed) return;
      if (isSoftwareGl) {
        timerId = window.setTimeout(() => {
          rafId = requestAnimationFrame(tick);
        }, 40);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    renderer.render(scene, camera);
    if (!prefersReducedMotion) {
      scheduleNext();
    }

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (timerId !== null) clearTimeout(timerId);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('webglcontextlost', onContextLost);
      dom.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('resize', onResize);

      spineGeo.dispose();
      ribGeo.dispose();
      coverGeo.dispose();
      pageBlockGeo.dispose();
      archGeo.dispose();
      claspGeo.dispose();
      ribbonGeo.dispose();
      crossVertGeo.dispose();
      crossHorizGeo.dispose();
      scriptureRibbonGeo.dispose();
      flameAuraGeo.dispose();
      sparkGeo.dispose();
      haloGeo.dispose();
      shadowPlaneGeo.dispose();

      leftTex.dispose();
      rightTex.dispose();
      scriptureTex.dispose();
      leatherMat.dispose();
      goldMat.dispose();
      fireCrossMat.dispose();
      ivorySideMat.dispose();
      ribbonMat.dispose();
      leftPageTopMat.dispose();
      rightPageTopMat.dispose();
      scriptureRibbonMat.dispose();
      flameAuraMat.dispose();
      sparkMat.dispose();
      haloMat.dispose();
      shadowPlaneMat.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();

      if (dom.parentNode === container) {
        container.removeChild(dom);
      }
    };
  }, [variant]);

  if (fallbackMode) {
    return (
      <div
        className={`w-full h-full flex flex-col items-center justify-center p-6 text-center gap-3 ${
          variant === 'auth' ? 'text-white' : 'text-[#142d4c]'
        }`}
      >
        <div className="w-16 h-16 rounded-2xl bg-[#142d4c] border-b-4 border-[#091729] text-[#f5d08a] flex items-center justify-center shadow-xl">
          <BookOpen className="w-8 h-8" />
        </div>
        <p className="font-editorial text-lg font-semibold text-3d-subtle">
          Qajeelcha Macaafaa Qulqulluu 3D
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[240px] select-none">
      <div ref={containerRef} className="w-full h-full" />

      <div className="pointer-events-none absolute inset-x-0 bottom-3 px-4 flex items-center justify-between gap-2">
        <span
          className={`text-[11px] font-semibold tracking-wide ${
            variant === 'auth' ? 'text-[#f5d08a]' : 'text-[#52504b]'
          }`}
        >
          Qajeelcha Macaafaa Qulqulluu 3D · Harkaan naannessi
        </span>
        <button
          type="button"
          onClick={() => resetTargetRef.current?.()}
          title="Deebisi (Reset 3D View)"
          aria-label="Reset 3D Bible View"
          className="pointer-events-auto inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white text-[#142d4c] border border-[#d8d2c5] border-b-2 hover:bg-[#f7f6f2] cursor-pointer shadow-xs"
        >
          <RotateCcw className="w-3 h-3" />
          <span>3D</span>
        </button>
      </div>
    </div>
  );
}
