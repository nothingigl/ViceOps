import * as THREE from 'three';
import type { VehicleSetup } from '../types';
import { CarMesh } from '../vehicle/CarMesh';

export type GarageFraming = 'menu' | 'garage';

function createGarageFloorTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#090e1b';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(0, 240, 255, 0.14)';
  ctx.lineWidth = 2;
  const step = 64;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255, 42, 109, 0.08)';
  ctx.lineWidth = 1;
  for (let i = step / 2; i < size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class GarageView {
  public readonly scene = new THREE.Scene();
  public readonly camera: THREE.PerspectiveCamera;

  private readonly carMesh: CarMesh;
  private readonly podiumGroup = new THREE.Group();
  private readonly accentRingMat: THREE.MeshBasicMaterial;
  private readonly accentPointLight: THREE.PointLight;
  private readonly interactionTarget: HTMLElement;

  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];
  private readonly disposableTextures: THREE.Texture[] = [];

  // Orbit camera state
  private azimuth = 0.62;
  private targetAzimuth = 0.62;
  private elevation = 0.25;
  private targetElevation = 0.25;
  private distance = 7.4;
  private framing: GarageFraming = 'menu';

  private interactive = false;
  private dragging = false;
  private activePointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private idleDelay = 0;
  private bounceAmp = 0;
  private bouncePhase = 0;

  // Pre-allocated vectors for zero-GC updates
  private readonly lookAtVec = new THREE.Vector3(0, 0.95, 0);
  private readonly desiredLookAt = new THREE.Vector3(0, 0.95, 0);

  private readonly onPointerDownBound: (e: PointerEvent) => void;
  private readonly onPointerMoveBound: (e: PointerEvent) => void;
  private readonly onPointerUpBound: (e: PointerEvent) => void;
  private readonly onWheelBound: (e: WheelEvent) => void;

  constructor(interactionTarget: HTMLElement, initialSetup: VehicleSetup) {
    this.interactionTarget = interactionTarget;

    this.scene.background = new THREE.Color(0x060a14);
    this.scene.fog = new THREE.FogExp2(0x060a14, 0.032);

    const aspect =
      (interactionTarget.clientWidth || window.innerWidth) /
      Math.max(1, interactionTarget.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.2, 120);

    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.disposableGeometries.push(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      this.disposableMaterials.push(m);
      return m;
    };
    const trackTex = <T extends THREE.Texture>(t: T): T => {
      this.disposableTextures.push(t);
      return t;
    };

    // Studio neon lighting
    const hemi = new THREE.HemisphereLight(0x6db8ff, 0x101324, 0.9);
    const keyLight = new THREE.DirectionalLight(0xeef7ff, 1.55);
    keyLight.position.set(6, 11, 7);
    const rimCyan = new THREE.DirectionalLight(0x00f0ff, 1.05);
    rimCyan.position.set(-8, 4.5, -6);
    const rimCrimson = new THREE.DirectionalLight(0xff2a6d, 0.95);
    rimCrimson.position.set(8, 3.8, -7);
    this.accentPointLight = new THREE.PointLight(0x00f0ff, 14, 18, 1.6);
    this.accentPointLight.position.set(0, 0.7, 0);
    this.scene.add(hemi, keyLight, rimCyan, rimCrimson, this.accentPointLight);

    // Reflective grid garage floor
    const floorTex = trackTex(createGarageFloorTexture());
    const floorGeo = trackGeo(new THREE.PlaneGeometry(64, 64));
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x162035,
        map: floorTex,
        roughness: 0.2,
        metalness: 0.58,
      }),
    );
    const floor = new THREE.Mesh(floorGeo, floorMat);
    this.scene.add(floor);

    // Turntable Podium
    const podiumBase = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(4.0, 4.35, 0.22, 48)),
      trackMat(
        new THREE.MeshStandardMaterial({
          color: 0x0e1526,
          roughness: 0.18,
          metalness: 0.78,
        }),
      ),
    );
    podiumBase.position.y = 0.11;
    this.podiumGroup.add(podiumBase);

    const podiumDeck = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(3.75, 3.75, 0.04, 48)),
      trackMat(
        new THREE.MeshStandardMaterial({
          color: 0x141d31,
          roughness: 0.12,
          metalness: 0.86,
        }),
      ),
    );
    podiumDeck.position.y = 0.23;
    this.podiumGroup.add(podiumDeck);

    // Concentric glowing neon rings around turntable
    this.accentRingMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x00f0ff }));
    const crimsonRingMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xff2a6d }));

    const innerRing = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(3.84, 0.04, 8, 64)),
      this.accentRingMat,
    );
    innerRing.rotation.x = Math.PI / 2;
    innerRing.position.y = 0.24;
    this.podiumGroup.add(innerRing);

    const outerRing = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(4.42, 0.032, 8, 64)),
      crimsonRingMat,
    );
    outerRing.rotation.x = Math.PI / 2;
    outerRing.position.y = 0.04;
    this.podiumGroup.add(outerRing);

    this.scene.add(this.podiumGroup);

    // Architectural Showroom Pillars + Vertical Neon Light Tubes (InstancedMesh)
    const pillarGeo = trackGeo(new THREE.BoxGeometry(0.65, 9, 0.65));
    const pillarMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x11192c, roughness: 0.42, metalness: 0.6 }),
    );
    const tubeGeo = trackGeo(new THREE.BoxGeometry(0.1, 6.2, 0.1));
    const pillarCount = 12;
    const pillarInst = new THREE.InstancedMesh(pillarGeo, pillarMat, pillarCount);
    const tubeInst = new THREE.InstancedMesh(tubeGeo, this.accentRingMat, pillarCount);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < pillarCount; i++) {
      const angle = (i / pillarCount) * Math.PI * 2 + Math.PI / 12;
      const radius = 14.5;
      const px = Math.cos(angle) * radius;
      const pz = Math.sin(angle) * radius;

      dummy.position.set(px, 4.5, pz);
      dummy.rotation.set(0, -angle, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      pillarInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(Math.cos(angle) * (radius - 0.36), 3.6, Math.sin(angle) * (radius - 0.36));
      dummy.updateMatrix();
      tubeInst.setMatrixAt(i, dummy.matrix);
    }
    pillarInst.instanceMatrix.needsUpdate = true;
    tubeInst.instanceMatrix.needsUpdate = true;
    this.scene.add(pillarInst, tubeInst);

    // Overhead softbox neon light bars
    const ceilingBarGeo = trackGeo(new THREE.BoxGeometry(6.8, 0.09, 0.42));
    const ceilingBarMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xdff8ff }));
    for (const offset of [-2.4, 0, 2.4]) {
      const bar = new THREE.Mesh(ceilingBarGeo, ceilingBarMat);
      bar.position.set(0, 6.2, offset);
      this.scene.add(bar);
    }

    // Car showcase mesh mounted on podium deck
    this.carMesh = new CarMesh(initialSetup);
    this.carMesh.setShowroomMode(true);
    this.carMesh.root.position.set(0, 0.25, 0);
    this.podiumGroup.add(this.carMesh.root);

    this.applySetup(initialSetup, false);

    // Pointer orbit listeners attached to canvas/container
    this.onPointerDownBound = (e) => this.handlePointerDown(e);
    this.onPointerMoveBound = (e) => this.handlePointerMove(e);
    this.onPointerUpBound = (e) => this.handlePointerUp(e);
    this.onWheelBound = (e) => this.handleWheel(e);

    interactionTarget.addEventListener('pointerdown', this.onPointerDownBound);
    window.addEventListener('pointermove', this.onPointerMoveBound);
    window.addEventListener('pointerup', this.onPointerUpBound);
    window.addEventListener('pointercancel', this.onPointerUpBound);
    interactionTarget.addEventListener('wheel', this.onWheelBound, { passive: true });
  }

  public setGraphicsQuality(quality: 'low' | 'medium' | 'high'): void {
    this.accentPointLight.visible = quality !== 'low';
  }

  public setInteractive(interactive: boolean): void {
    this.interactive = interactive;
    if (!interactive) {
      this.dragging = false;
      this.activePointerId = null;
    }
  }

  public setFraming(framing: GarageFraming): void {
    this.framing = framing;
    if (framing === 'menu') {
      this.distance = 7.8;
      this.targetElevation = 0.24;
    } else {
      this.distance = 7.1;
      this.targetElevation = 0.26;
    }
  }

  public applySetup(setup: VehicleSetup, animateBounce = true): void {
    this.carMesh.applySetup(setup);
    this.accentRingMat.color.set(setup.accentColor);
    this.accentPointLight.color.set(setup.accentColor);
    if (animateBounce) {
      this.bounceAmp = 0.055;
      this.bouncePhase = 0;
    }
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  public update(dt: number): void {
    // Gentle automatic turntable orbit when user isn't dragging
    if (!this.dragging) {
      if (this.idleDelay > 0) {
        this.idleDelay = Math.max(0, this.idleDelay - dt);
      } else {
        const autoSpeed = this.framing === 'menu' ? 0.22 : 0.16;
        this.targetAzimuth += autoSpeed * dt;
      }
    }

    const damp = 1 - Math.exp(-8.5 * dt);
    this.azimuth += (this.targetAzimuth - this.azimuth) * damp;
    this.elevation += (this.targetElevation - this.elevation) * damp;

    // Subtle suspension bounce feedback on class/tuning changes
    if (this.bounceAmp > 0.001) {
      this.bouncePhase += dt * 15;
      this.bounceAmp *= Math.exp(-4.5 * dt);
      this.carMesh.chassisGroup.position.y = Math.sin(this.bouncePhase) * this.bounceAmp;
    } else {
      this.carMesh.chassisGroup.position.y = 0;
    }

    // Offset lookAt slightly on wide desktop screens in garage mode so car frames beside side panel
    const isWideDesktop = window.innerWidth >= 960;
    const rightShift = this.framing === 'garage' && isWideDesktop ? 1.55 : 0;
    const verticalOffset = this.framing === 'garage' && !isWideDesktop ? 0.45 : 0.95;

    const camX = Math.sin(this.azimuth) * Math.cos(this.elevation) * this.distance;
    const camY = Math.sin(this.elevation) * this.distance + 0.95;
    const camZ = Math.cos(this.azimuth) * Math.cos(this.elevation) * this.distance;

    // Shift perpendicular to camera view direction for clean asymmetric showroom composition
    const sideX = Math.cos(this.azimuth) * rightShift;
    const sideZ = -Math.sin(this.azimuth) * rightShift;

    this.desiredLookAt.set(sideX, verticalOffset, sideZ);
    this.lookAtVec.lerp(this.desiredLookAt, damp);

    this.camera.position.set(camX + sideX, camY, camZ + sideZ);
    this.camera.lookAt(this.lookAtVec);
  }

  private handlePointerDown(e: PointerEvent): void {
    if (!this.interactive) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.dragging = true;
    this.activePointerId = e.pointerId;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.idleDelay = 2.4;
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.dragging || e.pointerId !== this.activePointerId) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    this.targetAzimuth -= dx * 0.0085;
    this.targetElevation = Math.max(0.12, Math.min(0.68, this.targetElevation + dy * 0.0055));
    this.idleDelay = 2.4;
  }

  private handlePointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.activePointerId) return;
    this.dragging = false;
    this.activePointerId = null;
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.interactive) return;
    this.distance = Math.max(5.4, Math.min(10.5, this.distance + e.deltaY * 0.004));
  }

  public dispose(): void {
    this.interactionTarget.removeEventListener('pointerdown', this.onPointerDownBound);
    window.removeEventListener('pointermove', this.onPointerMoveBound);
    window.removeEventListener('pointerup', this.onPointerUpBound);
    window.removeEventListener('pointercancel', this.onPointerUpBound);
    this.interactionTarget.removeEventListener('wheel', this.onWheelBound);

    this.carMesh.dispose();
    this.disposableGeometries.forEach((g) => g.dispose());
    this.disposableMaterials.forEach((m) => m.dispose());
    this.disposableTextures.forEach((t) => t.dispose());
  }
}
