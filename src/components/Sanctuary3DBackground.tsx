import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

function detectSoftwareRenderer(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const rendererStr = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    return /SwiftShader|llvmpipe|Software|Mesa Offscreen/i.test(rendererStr);
  } catch {
    return false;
  }
}

export function Sanctuary3DBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [webGLAvailable, setWebGLAvailable] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isSoftwareGl = detectSoftwareRenderer();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: isSoftwareGl ? 'low-power' : 'high-performance',
      });
    } catch {
      setWebGLAvailable(false);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1 : 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#f7f6f2', 16, 44);

    const camera = new THREE.PerspectiveCamera(
      42,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.5,
      80
    );
    camera.position.set(0, 0.8, 17);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();

    const hemi = new THREE.HemisphereLight('#fff8eb', '#c8d4e6', 0.85);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fff2d6', 1.4);
    keyLight.position.set(8, 12, 10);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#bfd4f2', 0.55);
    rimLight.position.set(-10, -4, -6);
    scene.add(rimLight);

    // Sculpted 3D Sanctuary Architectural Group
    const architecturalGroup = new THREE.Group();
    scene.add(architecturalGroup);

    const goldMat = new THREE.MeshStandardMaterial({
      color: '#c99738',
      metalness: 0.78,
      roughness: 0.28,
      transparent: true,
      opacity: 0.48,
    });
    const lapisMat = new THREE.MeshStandardMaterial({
      color: '#142d4c',
      metalness: 0.35,
      roughness: 0.42,
      transparent: true,
      opacity: 0.22,
    });
    const ivoryMat = new THREE.MeshStandardMaterial({
      color: '#ebe4d5',
      metalness: 0.08,
      roughness: 0.65,
      transparent: true,
      opacity: 0.55,
    });

    // Outer & inner golden astrolabe rings
    const outerRingGeo = new THREE.TorusGeometry(6.8, 0.045, 16, 96);
    const outerRing = new THREE.Mesh(outerRingGeo, goldMat);
    outerRing.position.set(5.4, 1.4, -5);
    outerRing.rotation.set(0.45, -0.35, 0.2);
    architecturalGroup.add(outerRing);

    const innerRingGeo = new THREE.TorusGeometry(4.5, 0.032, 16, 80);
    const innerRing = new THREE.Mesh(innerRingGeo, goldMat);
    innerRing.position.set(-5.8, -1.8, -6.5);
    innerRing.rotation.set(-0.55, 0.4, -0.2);
    architecturalGroup.add(innerRing);

    const archRingGeo = new THREE.TorusGeometry(8.5, 0.03, 12, 96);
    const archRing = new THREE.Mesh(archRingGeo, lapisMat);
    archRing.position.set(0, 0.5, -10);
    archRing.rotation.set(0.2, 0.15, 0);
    architecturalGroup.add(archRing);

    // Subtle 3D geometric sanctuary accents (octahedra + beveled prisms)
    const accentGeo = new THREE.OctahedronGeometry(0.46, 0);
    const accentOffsets: Array<[number, number, number]> = [
      [-6.5, 3.2, -3.5],
      [6.8, -2.9, -4.2],
      [-3.8, -3.6, -5.0],
      [4.2, 4.1, -6.0],
    ];
    const accentMeshes = accentOffsets.map(([x, y, z], i) => {
      const m = new THREE.Mesh(accentGeo, i % 2 === 0 ? goldMat : ivoryMat);
      m.position.set(x, y, z);
      architecturalGroup.add(m);
      return m;
    });

    // Instanced floating sanctuary light motes (zero per-frame allocations)
    const moteCount = isSoftwareGl ? 36 : 72;
    const moteGeo = new THREE.IcosahedronGeometry(0.055, 0);
    const moteMat = new THREE.MeshStandardMaterial({
      color: '#dfb056',
      emissive: '#9a6b16',
      emissiveIntensity: 0.35,
      metalness: 0.5,
      roughness: 0.3,
      transparent: true,
      opacity: 0.6,
    });
    const motes = new THREE.InstancedMesh(moteGeo, moteMat, moteCount);
    const moteSeeds: Array<{ x: number; y: number; z: number; speed: number; phase: number; scale: number }> = [];
    const dummy = new THREE.Object3D();

    for (let i = 0; i < moteCount; i++) {
      const seed = {
        x: ((i * 73) % 100) / 100 * 24 - 12,
        y: ((i * 41) % 100) / 100 * 14 - 7,
        z: -(((i * 29) % 100) / 100 * 12 + 1),
        speed: 0.25 + ((i * 19) % 10) * 0.035,
        phase: (i * 1.37) % (Math.PI * 2),
        scale: 0.65 + ((i * 13) % 8) * 0.14,
      };
      moteSeeds.push(seed);
      dummy.position.set(seed.x, seed.y, seed.z);
      dummy.scale.setScalar(seed.scale);
      dummy.updateMatrix();
      motes.setMatrixAt(i, dummy.matrix);
    }
    motes.instanceMatrix.needsUpdate = true;
    motes.computeBoundingSphere();
    scene.add(motes);

    let pointerX = 0;
    let pointerY = 0;
    const onPointerMove = (e: PointerEvent) => {
      if (window.innerWidth <= 0 || window.innerHeight <= 0) return;
      pointerX = (e.clientX / window.innerWidth - 0.5) * 2;
      pointerY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

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
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    let rafId = 0;
    let timerId: number | null = null;
    let disposed = false;
    const clock = new THREE.Clock();

    const tick = () => {
      if (disposed) return;
      if (document.hidden || contextLost) {
        if (!prefersReducedMotion) {
          scheduleNext();
        }
        return;
      }

      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;

      if (!prefersReducedMotion) {
        outerRing.rotation.z += dt * 0.08;
        outerRing.rotation.y = -0.35 + Math.sin(t * 0.25) * 0.12;
        innerRing.rotation.z -= dt * 0.1;
        innerRing.rotation.x = -0.55 + Math.cos(t * 0.22) * 0.1;
        archRing.rotation.y += dt * 0.03;

        for (let i = 0; i < accentMeshes.length; i++) {
          const m = accentMeshes[i];
          m.rotation.y += dt * (0.28 + i * 0.05);
          m.rotation.x += dt * 0.14;
          m.position.y = accentOffsets[i][1] + Math.sin(t * 0.7 + i * 1.4) * 0.25;
        }

        for (let i = 0; i < moteCount; i++) {
          const s = moteSeeds[i];
          dummy.position.set(
            s.x + Math.sin(t * s.speed + s.phase) * 0.35,
            s.y + Math.cos(t * s.speed * 0.8 + s.phase) * 0.4,
            s.z
          );
          dummy.rotation.set(t * 0.3 + s.phase, t * 0.4, 0);
          dummy.scale.setScalar(s.scale);
          dummy.updateMatrix();
          motes.setMatrixAt(i, dummy.matrix);
        }
        motes.instanceMatrix.needsUpdate = true;
      }

      camera.position.x = THREE.MathUtils.damp(camera.position.x, pointerX * 0.85, 3, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, 0.8 - pointerY * 0.55, 3, dt);
      camera.lookAt(0, 0, -4);

      renderer.render(scene, camera);

      if (!prefersReducedMotion) {
        scheduleNext();
      }
    };

    const scheduleNext = () => {
      if (disposed) return;
      if (isSoftwareGl) {
        timerId = window.setTimeout(() => {
          rafId = requestAnimationFrame(tick);
        }, 42);
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
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      outerRingGeo.dispose();
      innerRingGeo.dispose();
      archRingGeo.dispose();
      accentGeo.dispose();
      moteGeo.dispose();
      goldMat.dispose();
      lapisMat.dispose();
      ivoryMat.dispose();
      moteMat.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  if (!webGLAvailable) return null;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="fixed inset-0 z-0 pointer-events-none opacity-80"
    />
  );
}
