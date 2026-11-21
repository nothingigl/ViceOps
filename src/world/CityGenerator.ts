import * as THREE from 'three';
import type { SurfaceType } from '../vehicle/VehicleSpecs';

export interface WorldCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CityBuildResult {
  group: THREE.Group;
  colliders: WorldCollider[];
  worldBounds: WorldCollider;
  roadMaterial: THREE.MeshStandardMaterial;
  oceanMaterial: THREE.MeshStandardMaterial;
  buildingMaterial: THREE.MeshStandardMaterial;
  neonMaterials: THREE.MeshBasicMaterial[];
  lampBulbMaterial: THREE.MeshBasicMaterial;
  lightPoolMaterial: THREE.MeshBasicMaterial;
  spawnPoint: { x: number; z: number; heading: number };
  getSurfaceType: (x: number, z: number) => SurfaceType;
  update: (elapsedSec: number) => void;
  dispose: () => void;
}

const BLOCK_CENTERS = [-240, -80, 80, 240];
const ROAD_CENTERS = [-320, -160, 0, 160, 320];
const OUTER_ROAD = 320;
const WORLD_HALF_DRIVE = 335;

/** Deterministic PRNG (Mulberry32) so the procedural city layout is stable and balanced. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createAsphaltTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#151926';
  ctx.fillRect(0, 0, size, size);

  const rng = createRng(1042);
  // Subtle micro-grain asphalt variation
  for (let i = 0; i < 6500; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const shade = 18 + Math.floor(rng() * 24);
    ctx.fillStyle = `rgb(${shade}, ${shade + 3}, ${shade + 11})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Subtle longitudinal tire wear bands
  const grad = ctx.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, 'rgba(0, 240, 255, 0.03)');
  grad.addColorStop(0.25, 'rgba(0, 0, 0, 0.16)');
  grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.03)');
  grad.addColorStop(0.75, 'rgba(0, 0, 0, 0.16)');
  grad.addColorStop(1, 'rgba(255, 42, 109, 0.03)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(48, 48);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBuildingFacadeTexture(): {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
} {
  const width = 256;
  const height = 512;

  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = width;
  baseCanvas.height = height;
  const bCtx = baseCanvas.getContext('2d')!;

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = width;
  glowCanvas.height = height;
  const gCtx = glowCanvas.getContext('2d')!;

  // Dark slate architectural facade
  bCtx.fillStyle = '#121828';
  bCtx.fillRect(0, 0, width, height);

  gCtx.fillStyle = '#000000';
  gCtx.fillRect(0, 0, width, height);

  const rng = createRng(8801);
  const cols = 8;
  const rows = 24;
  const padX = 5;
  const padY = 5;
  const cellW = width / cols;
  const cellH = height / rows;

  const windowColors = ['#00f0ff', '#ff70a6', '#ffd166', '#9ee7ff', '#d580ff', '#fff0c9'];

  // Subtle horizontal concrete bands
  for (let r = 0; r < rows; r++) {
    const y = r * cellH;
    bCtx.fillStyle = 'rgba(255, 255, 255, 0.035)';
    bCtx.fillRect(0, y, width, 2);

    const floorLitChance = 0.25 + rng() * 0.5;
    for (let c = 0; c < cols; c++) {
      const x = c * cellW;
      const wx = x + padX;
      const wy = y + padY;
      const ww = cellW - padX * 2;
      const wh = cellH - padY * 2;

      bCtx.fillStyle = '#0a0f1c';
      bCtx.fillRect(wx, wy, ww, wh);

      if (rng() < floorLitChance) {
        const col = windowColors[Math.floor(rng() * windowColors.length)];
        const alpha = 0.45 + rng() * 0.55;
        bCtx.fillStyle = col;
        bCtx.globalAlpha = alpha * 0.4;
        bCtx.fillRect(wx, wy, ww, wh);
        bCtx.globalAlpha = 1;

        gCtx.fillStyle = col;
        gCtx.globalAlpha = alpha;
        gCtx.fillRect(wx, wy, ww, wh);
        gCtx.globalAlpha = 1;
      }
    }
  }

  const map = new THREE.CanvasTexture(baseCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  const emissiveMap = new THREE.CanvasTexture(glowCanvas);
  emissiveMap.wrapS = THREE.RepeatWrapping;
  emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.anisotropy = 4;

  return { map, emissiveMap };
}

function createLightPoolTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(130, 240, 255, 0.55)');
  grad.addColorStop(0.4, 'rgba(0, 200, 255, 0.22)');
  grad.addColorStop(1, 'rgba(0, 200, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createOceanTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#081b33';
  ctx.fillRect(0, 0, size, size);

  const rng = createRng(3319);
  for (let i = 0; i < 420; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const w = 14 + rng() * 34;
    const h = 1.5 + rng() * 2;
    ctx.fillStyle = rng() > 0.5 ? 'rgba(0, 240, 255, 0.08)' : 'rgba(255, 80, 150, 0.06)';
    ctx.fillRect(x, y, w, h);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(36, 36);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildCity(): CityBuildResult {
  const group = new THREE.Group();
  const colliders: WorldCollider[] = [];
  const disposableGeometries: THREE.BufferGeometry[] = [];
  const disposableMaterials: THREE.Material[] = [];
  const disposableTextures: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposableGeometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposableMaterials.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    disposableTextures.push(t);
    return t;
  };

  // 1. Ocean surrounding the neon coastal island
  const oceanTex = trackTex(createOceanTexture());
  const oceanGeo = trackGeo(new THREE.PlaneGeometry(3400, 3400));
  oceanGeo.rotateX(-Math.PI / 2);
  const oceanMaterial = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0b2545,
      map: oceanTex,
      roughness: 0.22,
      metalness: 0.65,
    }),
  );
  const oceanMesh = new THREE.Mesh(oceanGeo, oceanMaterial);
  oceanMesh.position.y = -0.65;
  group.add(oceanMesh);

  // 2. Drivable coastal sandy off-road shoulder on East & South shores (Vice City beachfront)
  const beachMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x4b3f4e,
      roughness: 0.92,
      metalness: 0.04,
    }),
  );
  const eastBeachGeo = trackGeo(new THREE.BoxGeometry(56, 0.52, 740));
  const eastBeach = new THREE.Mesh(eastBeachGeo, beachMat);
  eastBeach.position.set(360, -0.265, 20);
  group.add(eastBeach);

  const southBeachGeo = trackGeo(new THREE.BoxGeometry(740, 0.52, 56));
  const southBeach = new THREE.Mesh(southBeachGeo, beachMat);
  southBeach.position.set(20, -0.265, 360);
  group.add(southBeach);

  // 3. Main drivable asphalt island surface (single smooth reflective deck up to x/z = 333)
  const asphaltTex = trackTex(createAsphaltTexture());
  const roadGeo = trackGeo(new THREE.PlaneGeometry(678, 678));
  roadGeo.rotateX(-Math.PI / 2);
  const roadMaterial = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x20273a,
      map: asphaltTex,
      roughness: 0.36,
      metalness: 0.28,
    }),
  );
  const roadDeck = new THREE.Mesh(roadGeo, roadMaterial);
  roadDeck.position.set(-6, 0, -6);
  roadDeck.receiveShadow = true;
  group.add(roadDeck);

  // Seawall / perimeter barrier curbs (East & South pushed out to 382 to include coastal sand shoulder)
  const curbMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1a2236,
      roughness: 0.5,
      metalness: 0.35,
    }),
  );
  const neonCyanMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x00f0ff }));
  const neonCrimsonMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xff2a6d }));
  const neonAmberMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xffa63d }));
  const neonVioletMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xb44cff }));
  const neonMaterials = [neonCyanMat, neonCrimsonMat, neonAmberMat, neonVioletMat];

  const barrierSpan = 726;
  const barrierCenter = 21;
  const barrierPositions: Array<[number, number, number, number]> = [
    [barrierCenter, -340, barrierSpan, 3],
    [barrierCenter, 382, barrierSpan, 3],
    [-340, barrierCenter, 3, barrierSpan],
    [382, barrierCenter, 3, barrierSpan],
  ];
  for (const [bx, bz, bw, bd] of barrierPositions) {
    const bGeo = trackGeo(new THREE.BoxGeometry(bw, 1.35, bd));
    const bMesh = new THREE.Mesh(bGeo, curbMat);
    bMesh.position.set(bx, 0.65, bz);
    group.add(bMesh);

    // Glowing safety rail strip on inner side of coastal barrier
    const stripW = bw > bd ? bw - 6 : 0.22;
    const stripD = bd > bw ? bd - 6 : 0.22;
    const stripGeo = trackGeo(new THREE.BoxGeometry(stripW, 0.14, stripD));
    const strip = new THREE.Mesh(stripGeo, bx === 382 || bz === 382 ? neonAmberMat : neonCyanMat);
    const offsetX = bw < bd ? (bx > 0 ? -1.55 : 1.55) : 0;
    const offsetZ = bd < bw ? (bz > 0 ? -1.55 : 1.55) : 0;
    strip.position.set(bx + offsetX, 0.92, bz + offsetZ);
    group.add(strip);
  }

  // 4. Instanced Road Markings (dashed centerlines + glowing edge stripes)
  const dashMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xbad9ff }));
  const doubleCenterMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xff3b7a }));
  const dashGeo = trackGeo(new THREE.PlaneGeometry(0.32, 6.2));
  dashGeo.rotateX(-Math.PI / 2);

  const dashTransforms: Array<{ x: number; z: number; rotY: number }> = [];
  const centerLineTransforms: Array<{ x: number; z: number; rotY: number }> = [];

  for (const roadCoord of ROAD_CENTERS) {
    const isOuter = Math.abs(roadCoord) === OUTER_ROAD;
    const laneOffset = isOuter ? 4.4 : 3.6;

    // North-South road markings
    for (let z = -310; z <= 310; z += 14) {
      // Skip intersection boxes
      const nearCross = ROAD_CENTERS.some((rc) => Math.abs(z - rc) < 16);
      if (nearCross) continue;
      dashTransforms.push({ x: roadCoord - laneOffset, z, rotY: 0 });
      dashTransforms.push({ x: roadCoord + laneOffset, z, rotY: 0 });
      centerLineTransforms.push({ x: roadCoord - 0.32, z, rotY: 0 });
      centerLineTransforms.push({ x: roadCoord + 0.32, z, rotY: 0 });
    }

    // East-West road markings
    for (let x = -310; x <= 310; x += 14) {
      const nearCross = ROAD_CENTERS.some((rc) => Math.abs(x - rc) < 16);
      if (nearCross) continue;
      dashTransforms.push({ x, z: roadCoord - laneOffset, rotY: Math.PI / 2 });
      dashTransforms.push({ x, z: roadCoord + laneOffset, rotY: Math.PI / 2 });
      centerLineTransforms.push({ x, z: roadCoord - 0.32, rotY: Math.PI / 2 });
      centerLineTransforms.push({ x, z: roadCoord + 0.32, rotY: Math.PI / 2 });
    }
  }

  const dummy = new THREE.Object3D();
  const dashInst = new THREE.InstancedMesh(dashGeo, dashMat, dashTransforms.length);
  dashTransforms.forEach((t, idx) => {
    dummy.position.set(t.x, 0.025, t.z);
    dummy.rotation.set(0, t.rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    dashInst.setMatrixAt(idx, dummy.matrix);
  });
  dashInst.instanceMatrix.needsUpdate = true;
  group.add(dashInst);

  const centerLineInst = new THREE.InstancedMesh(
    dashGeo,
    doubleCenterMat,
    centerLineTransforms.length,
  );
  centerLineTransforms.forEach((t, idx) => {
    dummy.position.set(t.x, 0.026, t.z);
    dummy.rotation.set(0, t.rotY, 0);
    dummy.scale.set(0.75, 1, 1.55);
    dummy.updateMatrix();
    centerLineInst.setMatrixAt(idx, dummy.matrix);
  });
  centerLineInst.instanceMatrix.needsUpdate = true;
  group.add(centerLineInst);

  // 5. City Blocks: Sidewalks + Procedural Neon Buildings (InstancedMesh)
  const sidewalkGeo = trackGeo(new THREE.BoxGeometry(126, 0.42, 126));
  const sidewalkMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1a2134,
      roughness: 0.72,
      metalness: 0.15,
    }),
  );
  const sidewalkInst = new THREE.InstancedMesh(
    sidewalkGeo,
    sidewalkMat,
    BLOCK_CENTERS.length * BLOCK_CENTERS.length,
  );

  const rng = createRng(2086);
  const buildingSpecs: Array<{
    x: number;
    z: number;
    w: number;
    h: number;
    d: number;
    neonIdx: number;
  }> = [];

  let blockIdx = 0;
  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      dummy.position.set(bx, 0.21, bz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      sidewalkInst.setMatrixAt(blockIdx++, dummy.matrix);

      // Clean block collider matching the raised sidewalk perimeter so the car glides around city blocks cleanly
      const halfBlock = 63.2;
      colliders.push({
        minX: bx - halfBlock,
        maxX: bx + halfBlock,
        minZ: bz - halfBlock,
        maxZ: bz + halfBlock,
      });

      // Populate each block with a 2x2 or 3x2 cluster of Vice neon towers
      const isDowntown = Math.abs(bx) === 80 && Math.abs(bz) === 80;
      const isCoastal = bx === 240 || bz === 240;
      const subOffsets = [
        [-30, -30],
        [30, -30],
        [-30, 30],
        [30, 30],
      ];

      for (const [ox, oz] of subOffsets) {
        const w = 34 + rng() * 18;
        const d = 34 + rng() * 18;
        let h: number;
        if (isDowntown) {
          h = 54 + rng() * 88;
        } else if (isCoastal) {
          h = 26 + rng() * 44;
        } else {
          h = 30 + rng() * 58;
        }

        const jitterX = (rng() - 0.5) * 6;
        const jitterZ = (rng() - 0.5) * 6;
        const neonIdx = Math.floor(rng() * neonMaterials.length);
        buildingSpecs.push({
          x: bx + ox + jitterX,
          z: bz + oz + jitterZ,
          w,
          h,
          d,
          neonIdx,
        });

        // Add occasional art-deco stepped crown tower on taller buildings
        if (h > 62 && rng() > 0.35) {
          buildingSpecs.push({
            x: bx + ox + jitterX,
            z: bz + oz + jitterZ,
            w: w * 0.56,
            h: h + 14 + rng() * 20,
            d: d * 0.56,
            neonIdx: (neonIdx + 1) % neonMaterials.length,
          });
        }
      }
    }
  }
  sidewalkInst.instanceMatrix.needsUpdate = true;
  group.add(sidewalkInst);

  const { map: facadeMap, emissiveMap: facadeGlow } = createBuildingFacadeTexture();
  trackTex(facadeMap);
  trackTex(facadeGlow);

  const buildingGeo = trackGeo(new THREE.BoxGeometry(1, 1, 1));
  const buildingMaterial = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x26314c,
      map: facadeMap,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: facadeGlow,
      emissiveIntensity: 0.95,
      roughness: 0.45,
      metalness: 0.38,
    }),
  );

  const buildingInst = new THREE.InstancedMesh(buildingGeo, buildingMaterial, buildingSpecs.length);
  const tintColor = new THREE.Color();
  const buildingTints = [0xcad9ff, 0xffe0ef, 0xd4f4ff, 0xe8d9ff];

  buildingSpecs.forEach((b, idx) => {
    dummy.position.set(b.x, b.h * 0.5 + 0.4, b.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.updateMatrix();
    buildingInst.setMatrixAt(idx, dummy.matrix);
    tintColor.setHex(buildingTints[idx % buildingTints.length]);
    buildingInst.setColorAt(idx, tintColor);
  });
  buildingInst.instanceMatrix.needsUpdate = true;
  if (buildingInst.instanceColor) buildingInst.instanceColor.needsUpdate = true;
  group.add(buildingInst);

  // Glowing neon roofline trim bands grouped by neon color (4 InstancedMeshes = 4 draw calls total!)
  const trimGeo = trackGeo(new THREE.BoxGeometry(1, 1, 1));
  neonMaterials.forEach((mat, matIdx) => {
    const matching = buildingSpecs.filter((b) => b.neonIdx === matIdx);
    if (matching.length === 0) return;
    const trimInst = new THREE.InstancedMesh(trimGeo, mat, matching.length);
    matching.forEach((b, idx) => {
      dummy.position.set(b.x, b.h + 0.65, b.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(b.w + 0.7, 0.85, b.d + 0.7);
      dummy.updateMatrix();
      trimInst.setMatrixAt(idx, dummy.matrix);
    });
    trimInst.instanceMatrix.needsUpdate = true;
    group.add(trimInst);
  });

  // 6. Street Lamps + Glowing Road Light Pools (InstancedMesh)
  const lampPositions: Array<{ x: number; z: number; armDirX: number; armDirZ: number }> = [];
  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      // Place sleek street lamps along all 4 sidewalk edges of each block
      for (const offset of [-44, 0, 44]) {
        lampPositions.push({ x: bx + offset, z: bz - 61.5, armDirX: 0, armDirZ: -1 });
        lampPositions.push({ x: bx + offset, z: bz + 61.5, armDirX: 0, armDirZ: 1 });
        lampPositions.push({ x: bx - 61.5, z: bz + offset, armDirX: -1, armDirZ: 0 });
        lampPositions.push({ x: bx + 61.5, z: bz + offset, armDirX: 1, armDirZ: 0 });
      }
    }
  }
  // Outer coastal highway outer-edge lamps
  for (let c = -280; c <= 280; c += 56) {
    lampPositions.push({ x: 336.5, z: c, armDirX: -1, armDirZ: 0 });
    lampPositions.push({ x: -336.5, z: c, armDirX: 1, armDirZ: 0 });
    lampPositions.push({ x: c, z: 336.5, armDirX: 0, armDirZ: -1 });
    lampPositions.push({ x: c, z: -336.5, armDirX: 0, armDirZ: 1 });
  }

  const poleMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x263044, roughness: 0.4, metalness: 0.7 }),
  );
  const poleGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.2, 9.2, 6));
  const armGeo = trackGeo(new THREE.BoxGeometry(0.2, 0.16, 2.8));
  const lampBulbGeo = trackGeo(new THREE.BoxGeometry(0.36, 0.14, 1.35));
  const lampBulbMaterial = trackMat(new THREE.MeshBasicMaterial({ color: 0x9cf8ff }));
  const lightPoolTex = trackTex(createLightPoolTexture());
  const lightPoolGeo = trackGeo(new THREE.PlaneGeometry(18, 18));
  lightPoolGeo.rotateX(-Math.PI / 2);
  const lightPoolMaterial = trackMat(
    new THREE.MeshBasicMaterial({
      map: lightPoolTex,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );

  const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, lampPositions.length);
  const armInst = new THREE.InstancedMesh(armGeo, poleMat, lampPositions.length);
  const bulbInst = new THREE.InstancedMesh(lampBulbGeo, lampBulbMaterial, lampPositions.length);
  const poolInst = new THREE.InstancedMesh(lightPoolGeo, lightPoolMaterial, lampPositions.length);

  lampPositions.forEach((lp, idx) => {
    const rotY = Math.atan2(lp.armDirX, lp.armDirZ);

    dummy.position.set(lp.x, 4.6, lp.z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poleInst.setMatrixAt(idx, dummy.matrix);

    dummy.position.set(lp.x + lp.armDirX * 1.25, 9.15, lp.z + lp.armDirZ * 1.25);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    armInst.setMatrixAt(idx, dummy.matrix);

    dummy.position.set(lp.x + lp.armDirX * 2.25, 9.04, lp.z + lp.armDirZ * 2.25);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bulbInst.setMatrixAt(idx, dummy.matrix);

    dummy.position.set(lp.x + lp.armDirX * 4.5, 0.032, lp.z + lp.armDirZ * 4.5);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poolInst.setMatrixAt(idx, dummy.matrix);
  });

  poleInst.instanceMatrix.needsUpdate = true;
  armInst.instanceMatrix.needsUpdate = true;
  bulbInst.instanceMatrix.needsUpdate = true;
  poolInst.instanceMatrix.needsUpdate = true;
  group.add(poleInst, armInst, bulbInst, poolInst);

  // 7. Stylized Vice City Coastal Palm Trees along beach promenade (InstancedMesh)
  const palmPositions: Array<{ x: number; z: number; scale: number; rotY: number }> = [];
  for (let c = -310; c <= 330; c += 28) {
    palmPositions.push({
      x: 350 + (rng() - 0.5) * 8,
      z: c,
      scale: 0.85 + rng() * 0.4,
      rotY: rng() * Math.PI * 2,
    });
    palmPositions.push({
      x: c,
      z: 350 + (rng() - 0.5) * 8,
      scale: 0.85 + rng() * 0.4,
      rotY: rng() * Math.PI * 2,
    });
  }

  const trunkGeo = trackGeo(new THREE.CylinderGeometry(0.18, 0.38, 10.5, 6));
  const trunkMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x3b2c35, roughness: 0.85, metalness: 0.05 }),
  );
  const frondGeo = trackGeo(new THREE.ConeGeometry(3.4, 2.2, 6));
  const frondMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x164a4a, roughness: 0.72, metalness: 0.1 }),
  );

  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, palmPositions.length);
  const frondInst = new THREE.InstancedMesh(frondGeo, frondMat, palmPositions.length * 2);

  palmPositions.forEach((p, idx) => {
    const h = 10.5 * p.scale;
    dummy.position.set(p.x, h * 0.48 - 0.2, p.z);
    dummy.rotation.set(0.08, p.rotY, 0.06);
    dummy.scale.set(p.scale, p.scale, p.scale);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(idx, dummy.matrix);

    // Lower frond canopy
    dummy.position.set(p.x + 0.4 * p.scale, h - 0.2, p.z + 0.3 * p.scale);
    dummy.rotation.set(0.12, p.rotY, 0);
    dummy.scale.set(p.scale * 1.15, p.scale * 0.75, p.scale * 1.15);
    dummy.updateMatrix();
    frondInst.setMatrixAt(idx * 2, dummy.matrix);

    // Upper frond crown
    dummy.position.set(p.x + 0.45 * p.scale, h + 0.85 * p.scale, p.z + 0.35 * p.scale);
    dummy.rotation.set(-0.08, p.rotY + 0.55, 0);
    dummy.scale.set(p.scale * 0.85, p.scale * 0.65, p.scale * 0.85);
    dummy.updateMatrix();
    frondInst.setMatrixAt(idx * 2 + 1, dummy.matrix);
  });
  trunkInst.instanceMatrix.needsUpdate = true;
  frondInst.instanceMatrix.needsUpdate = true;
  group.add(trunkInst, frondInst);

  // 8. Neon Highway Overhead Gantries on the Coastal Expressway (gives awesome speed sensation!)
  const gantryCoords: Array<{ x: number; z: number; rotY: number; cyan: boolean }> = [
    { x: OUTER_ROAD, z: -220, rotY: 0, cyan: true },
    { x: OUTER_ROAD, z: -80, rotY: 0, cyan: false },
    { x: OUTER_ROAD, z: 80, rotY: 0, cyan: true },
    { x: OUTER_ROAD, z: 220, rotY: 0, cyan: false },
    { x: -OUTER_ROAD, z: -80, rotY: 0, cyan: true },
    { x: -OUTER_ROAD, z: 80, rotY: 0, cyan: false },
    { x: -80, z: OUTER_ROAD, rotY: Math.PI / 2, cyan: true },
    { x: 80, z: OUTER_ROAD, rotY: Math.PI / 2, cyan: false },
    { x: -80, z: -OUTER_ROAD, rotY: Math.PI / 2, cyan: false },
    { x: 80, z: -OUTER_ROAD, rotY: Math.PI / 2, cyan: true },
  ];

  const gantryPillarGeo = trackGeo(new THREE.BoxGeometry(0.9, 10.5, 0.9));
  const gantryBeamGeo = trackGeo(new THREE.BoxGeometry(31, 0.95, 1.1));
  const gantryNeonGeo = trackGeo(new THREE.BoxGeometry(29.2, 0.28, 1.22));
  const gantryMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x161f33, roughness: 0.4, metalness: 0.75 }),
  );

  const gantryPillars = new THREE.InstancedMesh(
    gantryPillarGeo,
    gantryMat,
    gantryCoords.length * 2,
  );
  const gantryBeams = new THREE.InstancedMesh(gantryBeamGeo, gantryMat, gantryCoords.length);
  const cyanGantries = gantryCoords.filter((g) => g.cyan);
  const crimsonGantries = gantryCoords.filter((g) => !g.cyan);
  const gantryNeonCyan = new THREE.InstancedMesh(
    gantryNeonGeo,
    neonCyanMat,
    cyanGantries.length,
  );
  const gantryNeonCrimson = new THREE.InstancedMesh(
    gantryNeonGeo,
    neonCrimsonMat,
    crimsonGantries.length,
  );

  let cIdx = 0;
  let mIdx = 0;
  gantryCoords.forEach((g, idx) => {
    const cos = Math.cos(g.rotY);
    const sin = Math.sin(g.rotY);
    const halfSpan = 15.2;

    // Left & right pillars
    dummy.position.set(g.x - cos * halfSpan, 5.25, g.z + sin * halfSpan);
    dummy.rotation.set(0, g.rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    gantryPillars.setMatrixAt(idx * 2, dummy.matrix);

    dummy.position.set(g.x + cos * halfSpan, 5.25, g.z - sin * halfSpan);
    dummy.rotation.set(0, g.rotY, 0);
    dummy.updateMatrix();
    gantryPillars.setMatrixAt(idx * 2 + 1, dummy.matrix);

    // Overhead beam
    dummy.position.set(g.x, 10.4, g.z);
    dummy.rotation.set(0, g.rotY, 0);
    dummy.updateMatrix();
    gantryBeams.setMatrixAt(idx, dummy.matrix);

    // Neon light strip on beam
    dummy.position.set(g.x, 10.22, g.z);
    dummy.rotation.set(0, g.rotY, 0);
    dummy.updateMatrix();
    if (g.cyan) {
      gantryNeonCyan.setMatrixAt(cIdx++, dummy.matrix);
    } else {
      gantryNeonCrimson.setMatrixAt(mIdx++, dummy.matrix);
    }
  });

  gantryPillars.instanceMatrix.needsUpdate = true;
  gantryBeams.instanceMatrix.needsUpdate = true;
  gantryNeonCyan.instanceMatrix.needsUpdate = true;
  gantryNeonCrimson.instanceMatrix.needsUpdate = true;
  group.add(gantryPillars, gantryBeams, gantryNeonCyan, gantryNeonCrimson);

  return {
    group,
    colliders,
    worldBounds: {
      minX: -WORLD_HALF_DRIVE,
      maxX: 378,
      minZ: -WORLD_HALF_DRIVE,
      maxZ: 378,
    },
    roadMaterial,
    oceanMaterial,
    buildingMaterial,
    neonMaterials,
    lampBulbMaterial,
    lightPoolMaterial,
    // Spawn on the wide East Coastal Expressway facing North along the skyline & beachfront shoulder!
    spawnPoint: { x: OUTER_ROAD, z: 255, heading: Math.PI },
    getSurfaceType: (x: number, z: number): SurfaceType => {
      return x > 333 || z > 333 ? 'offroad' : 'asphalt';
    },
    update: (elapsedSec: number) => {
      // Gentle ocean drift animation without any allocations
      oceanTex.offset.x = (elapsedSec * 0.014) % 1;
      oceanTex.offset.y = (elapsedSec * 0.009) % 1;
    },
    dispose: () => {
      disposableGeometries.forEach((g) => g.dispose());
      disposableMaterials.forEach((m) => m.dispose());
      disposableTextures.forEach((t) => t.dispose());
    },
  };
}
