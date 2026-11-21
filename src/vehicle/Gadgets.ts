import * as THREE from 'three';
import type { GadgetId } from '../types';

export interface GadgetSpec {
  id: GadgetId;
  name: string;
  shortName: string;
  icon: string;
  description: string;
  cooldownSec: number;
  activeDurationSec: number;
}

export interface GadgetSlotSnapshot {
  slotIndex: 0 | 1;
  id: GadgetId;
  name: string;
  shortName: string;
  icon: string;
  cooldownRemaining: number;
  cooldownTotal: number;
  activeRemaining: number;
  activeTotal: number;
  ready: boolean;
}

export interface EmpBlastEvent {
  x: number;
  z: number;
  radius: number;
  disableSec: number;
}

export interface SmokeZone {
  x: number;
  z: number;
  radius: number;
  remaining: number;
  maxLife: number;
}

export const GADGET_ORDER: GadgetId[] = ['emp', 'smoke', 'jammer'];

export const GADGET_SPECS: Record<GadgetId, GadgetSpec> = {
  emp: {
    id: 'emp',
    name: 'ЭМИ-импульс',
    shortName: 'ЭМИ',
    icon: '⚡',
    description: 'Электромагнитная волна (34 м) на 4 сек. отключает ближайшие патрульные машины.',
    cooldownSec: 14,
    activeDurationSec: 0.75,
  },
  smoke: {
    id: 'smoke',
    name: 'Дымовая завеса',
    shortName: 'ДЫМ',
    icon: '☁',
    description: 'Выбрасывает плотное облако дыма позади авто, сбивая прицел и погоню ботов.',
    cooldownSec: 12,
    activeDurationSec: 6.5,
  },
  jammer: {
    id: 'jammer',
    name: 'Глушилка радаров',
    shortName: 'РАДАР',
    icon: '📡',
    description: 'Замедляет рост розыска (−45%) и расширяет окно скрытности; активация глушит радар на 6 сек.',
    cooldownSec: 16,
    activeDurationSec: 6.0,
  },
};

interface SmokePuffVisual {
  mesh: THREE.Mesh;
  active: boolean;
  age: number;
  maxAge: number;
  vx: number;
  vy: number;
  vz: number;
  baseScale: number;
}

interface SlotRuntime {
  id: GadgetId;
  cooldownRemaining: number;
  activeRemaining: number;
}

const SMOKE_PUFF_POOL_SIZE = 20;

export class GadgetSystem {
  public readonly group = new THREE.Group();

  private slots: [SlotRuntime, SlotRuntime] = [
    { id: 'emp', cooldownRemaining: 0, activeRemaining: 0 },
    { id: 'smoke', cooldownRemaining: 0, activeRemaining: 0 },
  ];

  // Simulation states
  private pendingEmpBlast: EmpBlastEvent | null = null;
  private readonly smokeZones: SmokeZone[] = [];
  private smokeEmitRemaining = 0;
  private smokeEmitAccum = 0;

  // 3D pooled visuals (low draw calls, zero runtime allocations)
  private readonly empRingMesh: THREE.Mesh;
  private readonly empDomeMesh: THREE.Mesh;
  private readonly empRingMat: THREE.MeshBasicMaterial;
  private readonly empDomeMat: THREE.MeshBasicMaterial;
  private empAnimProgress = 1;
  private empOriginX = 0;
  private empOriginZ = 0;

  private readonly jammerRingMesh: THREE.Mesh;
  private readonly jammerRingMat: THREE.MeshBasicMaterial;
  private jammerAnimPhase = 0;

  private readonly smokePuffs: SmokePuffVisual[] = [];
  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];

  private readonly snapshots: [GadgetSlotSnapshot, GadgetSlotSnapshot];

  constructor() {
    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.disposableGeometries.push(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      this.disposableMaterials.push(m);
      return m;
    };

    // EMP expanding shockwave ring + translucent sphere dome
    const empRingGeo = trackGeo(new THREE.RingGeometry(0.75, 1.0, 32));
    empRingGeo.rotateX(-Math.PI / 2);
    this.empRingMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.empRingMesh = new THREE.Mesh(empRingGeo, this.empRingMat);
    this.empRingMesh.position.y = 0.25;
    this.empRingMesh.visible = false;
    this.group.add(this.empRingMesh);

    const empDomeGeo = trackGeo(new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2));
    this.empDomeMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x39f7ff,
        transparent: true,
        opacity: 0,
        wireframe: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.empDomeMesh = new THREE.Mesh(empDomeGeo, this.empDomeMat);
    this.empDomeMesh.position.y = 0.1;
    this.empDomeMesh.visible = false;
    this.group.add(this.empDomeMesh);

    // Jammer violet radar cloak pulse ring around car
    const jammerGeo = trackGeo(new THREE.TorusGeometry(3.1, 0.08, 8, 32));
    jammerGeo.rotateX(Math.PI / 2);
    this.jammerRingMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xb44cff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.jammerRingMesh = new THREE.Mesh(jammerGeo, this.jammerRingMat);
    this.jammerRingMesh.position.y = 0.35;
    this.jammerRingMesh.visible = false;
    this.group.add(this.jammerRingMesh);

    // Pooled low-poly smoke puffs (no allocations during gameplay)
    const puffGeo = trackGeo(new THREE.IcosahedronGeometry(1.15, 1));
    for (let i = 0; i < SMOKE_PUFF_POOL_SIZE; i++) {
      const mat = trackMat(
        new THREE.MeshStandardMaterial({
          color: 0x9cb4c9,
          emissive: new THREE.Color(0x162438),
          roughness: 0.95,
          metalness: 0.02,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      const mesh = new THREE.Mesh(puffGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.smokePuffs.push({
        mesh,
        active: false,
        age: 0,
        maxAge: 5,
        vx: 0,
        vy: 0,
        vz: 0,
        baseScale: 1,
      });
    }

    this.snapshots = [this.buildSnapshot(0), this.buildSnapshot(1)];
  }

  public setEquipped(gadgets: readonly GadgetId[]): void {
    const first: GadgetId = gadgets[0] ?? 'emp';
    const second: GadgetId = gadgets[1] && gadgets[1] !== first ? gadgets[1] : first === 'smoke' ? 'emp' : 'smoke';
    this.slots[0] = { id: first, cooldownRemaining: 0, activeRemaining: 0 };
    this.slots[1] = { id: second, cooldownRemaining: 0, activeRemaining: 0 };
    this.resetRuntime();
  }

  public resetRuntime(): void {
    this.slots[0].cooldownRemaining = 0;
    this.slots[0].activeRemaining = 0;
    this.slots[1].cooldownRemaining = 0;
    this.slots[1].activeRemaining = 0;
    this.pendingEmpBlast = null;
    this.smokeZones.length = 0;
    this.smokeEmitRemaining = 0;
    this.smokeEmitAccum = 0;
    this.empAnimProgress = 1;
    this.empRingMesh.visible = false;
    this.empDomeMesh.visible = false;
    this.jammerRingMesh.visible = false;
    for (let i = 0; i < this.smokePuffs.length; i++) {
      this.smokePuffs[i].active = false;
      this.smokePuffs[i].mesh.visible = false;
    }
    this.refreshSnapshots();
  }

  public hasGadget(id: GadgetId): boolean {
    return this.slots[0].id === id || this.slots[1].id === id;
  }

  public isJammerPulseActive(): boolean {
    for (let i = 0; i < 2; i++) {
      if (this.slots[i].id === 'jammer' && this.slots[i].activeRemaining > 0) {
        return true;
      }
    }
    return false;
  }

  /** Heat escalation speed multiplier: passive -45% when jammer equipped, 0% during active jammer pulse. */
  public getHeatRateMultiplier(): number {
    if (this.isJammerPulseActive()) return 0.05;
    return this.hasGadget('jammer') ? 0.55 : 1.0;
  }

  /** Police sight/detection range multiplier: jammer widens stealth evasion window. */
  public getStealthDetectionMultiplier(): number {
    if (this.isJammerPulseActive()) return 0.38;
    return this.hasGadget('jammer') ? 0.74 : 1.0;
  }

  public triggerSlot(
    slotIndex: 0 | 1,
    carX: number,
    carZ: number,
    carHeading: number,
  ): GadgetId | null {
    const slot = this.slots[slotIndex];
    if (slot.cooldownRemaining > 0) return null;

    const spec = GADGET_SPECS[slot.id];
    slot.cooldownRemaining = spec.cooldownSec;
    slot.activeRemaining = spec.activeDurationSec;

    if (slot.id === 'emp') {
      this.pendingEmpBlast = {
        x: carX,
        z: carZ,
        radius: 34,
        disableSec: 4.0,
      };
      this.empOriginX = carX;
      this.empOriginZ = carZ;
      this.empAnimProgress = 0;
    } else if (slot.id === 'smoke') {
      this.smokeEmitRemaining = 1.6;
      this.smokeEmitAccum = 0;
      const backX = carX - Math.sin(carHeading) * 3.2;
      const backZ = carZ - Math.cos(carHeading) * 3.2;
      this.spawnSmokeZone(backX, backZ, 13.5, 6.5);
      this.spawnSmokePuff(backX, backZ);
    } else if (slot.id === 'jammer') {
      this.jammerAnimPhase = 0;
    }

    this.refreshSnapshots();
    return slot.id;
  }

  public consumeEmpBlast(): EmpBlastEvent | null {
    const blast = this.pendingEmpBlast;
    this.pendingEmpBlast = null;
    return blast;
  }

  public isPointInSmoke(x: number, z: number): boolean {
    for (let i = 0; i < this.smokeZones.length; i++) {
      const sz = this.smokeZones[i];
      const dx = x - sz.x;
      const dz = z - sz.z;
      if (dx * dx + dz * dz <= sz.radius * sz.radius) {
        return true;
      }
    }
    return false;
  }

  public getActiveSmokeZones(): readonly SmokeZone[] {
    return this.smokeZones;
  }

  public step(dt: number, carX: number, carZ: number, carHeading: number): void {
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i];
      if (s.cooldownRemaining > 0) {
        s.cooldownRemaining = Math.max(0, s.cooldownRemaining - dt);
      }
      if (s.activeRemaining > 0) {
        s.activeRemaining = Math.max(0, s.activeRemaining - dt);
      }
    }

    // Continuous billowing smoke release behind the car for 1.6 seconds
    if (this.smokeEmitRemaining > 0) {
      this.smokeEmitRemaining = Math.max(0, this.smokeEmitRemaining - dt);
      this.smokeEmitAccum += dt;
      if (this.smokeEmitAccum >= 0.14) {
        this.smokeEmitAccum -= 0.14;
        const backX = carX - Math.sin(carHeading) * 3.4;
        const backZ = carZ - Math.cos(carHeading) * 3.4;
        this.spawnSmokePuff(backX, backZ);
        if (this.smokeZones.length < 6) {
          this.spawnSmokeZone(backX, backZ, 12.5, 6.0);
        }
      }
    }

    // Decay smoke zones
    for (let i = this.smokeZones.length - 1; i >= 0; i--) {
      this.smokeZones[i].remaining -= dt;
      if (this.smokeZones[i].remaining <= 0) {
        this.smokeZones.splice(i, 1);
      }
    }

    // Advance EMP visual timer
    if (this.empAnimProgress < 1) {
      this.empAnimProgress = Math.min(1, this.empAnimProgress + dt / 0.72);
    }

    this.jammerAnimPhase += dt * 3.4;

    // Advance pooled smoke puffs
    for (let i = 0; i < this.smokePuffs.length; i++) {
      const p = this.smokePuffs[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.y += dt * 0.6;
      const t = p.age / p.maxAge;
      const scale = p.baseScale * (1 + t * 2.8);
      p.mesh.scale.set(scale, scale * 0.75, scale);
      const mat = p.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = t < 0.15 ? (t / 0.15) * 0.62 : (1 - (t - 0.15) / 0.85) * 0.62;
    }

    this.refreshSnapshots();
  }

  public syncVisuals(carX: number, carZ: number): void {
    // EMP shockwave visuals
    if (this.empAnimProgress < 1) {
      const t = this.empAnimProgress;
      const easeOut = 1 - Math.pow(1 - t, 3);
      const radius = 2 + easeOut * 34;
      this.empRingMesh.visible = true;
      this.empRingMesh.position.set(this.empOriginX, 0.28, this.empOriginZ);
      this.empRingMesh.scale.set(radius, radius, 1);
      this.empRingMat.opacity = (1 - t) * 0.92;

      this.empDomeMesh.visible = true;
      this.empDomeMesh.position.set(this.empOriginX, 0.1, this.empOriginZ);
      this.empDomeMesh.scale.set(radius * 0.95, radius * 0.35, radius * 0.95);
      this.empDomeMat.opacity = (1 - t) * 0.35;
    } else {
      this.empRingMesh.visible = false;
      this.empDomeMesh.visible = false;
    }

    // Jammer cloak visual pulse ring around player car
    if (this.isJammerPulseActive()) {
      const pulse = 1 + Math.sin(this.jammerAnimPhase) * 0.14;
      this.jammerRingMesh.visible = true;
      this.jammerRingMesh.position.set(carX, 0.42, carZ);
      this.jammerRingMesh.scale.set(pulse, pulse, 1);
      this.jammerRingMat.opacity = 0.55 + 0.25 * Math.sin(this.jammerAnimPhase * 2);
    } else {
      this.jammerRingMesh.visible = false;
    }
  }

  public getSlotSnapshots(): readonly [GadgetSlotSnapshot, GadgetSlotSnapshot] {
    return this.snapshots;
  }

  private spawnSmokeZone(x: number, z: number, radius: number, life: number): void {
    this.smokeZones.push({ x, z, radius, remaining: life, maxLife: life });
  }

  private spawnSmokePuff(x: number, z: number): void {
    let chosen: SmokePuffVisual | null = null;
    for (let i = 0; i < this.smokePuffs.length; i++) {
      if (!this.smokePuffs[i].active) {
        chosen = this.smokePuffs[i];
        break;
      }
    }
    if (!chosen) chosen = this.smokePuffs[0];

    chosen.active = true;
    chosen.age = 0;
    chosen.maxAge = 4.6 + Math.random() * 1.6;
    chosen.vx = (Math.random() - 0.5) * 2.2;
    chosen.vy = 0.45 + Math.random() * 0.45;
    chosen.vz = (Math.random() - 0.5) * 2.2;
    chosen.baseScale = 1.2 + Math.random() * 0.6;
    chosen.mesh.position.set(
      x + (Math.random() - 0.5) * 2.2,
      0.9 + Math.random() * 0.4,
      z + (Math.random() - 0.5) * 2.2,
    );
    chosen.mesh.visible = true;
  }

  private buildSnapshot(slotIndex: 0 | 1): GadgetSlotSnapshot {
    const slot = this.slots[slotIndex];
    const spec = GADGET_SPECS[slot.id];
    return {
      slotIndex,
      id: slot.id,
      name: spec.name,
      shortName: spec.shortName,
      icon: spec.icon,
      cooldownRemaining: slot.cooldownRemaining,
      cooldownTotal: spec.cooldownSec,
      activeRemaining: slot.activeRemaining,
      activeTotal: spec.activeDurationSec,
      ready: slot.cooldownRemaining <= 0.01,
    };
  }

  private refreshSnapshots(): void {
    for (let i = 0; i < 2; i++) {
      const slot = this.slots[i];
      const spec = GADGET_SPECS[slot.id];
      const snap = this.snapshots[i];
      snap.id = slot.id;
      snap.name = spec.name;
      snap.shortName = spec.shortName;
      snap.icon = spec.icon;
      snap.cooldownRemaining = slot.cooldownRemaining;
      snap.cooldownTotal = spec.cooldownSec;
      snap.activeRemaining = slot.activeRemaining;
      snap.activeTotal = spec.activeDurationSec;
      snap.ready = slot.cooldownRemaining <= 0.01;
    }
  }

  public dispose(): void {
    this.disposableGeometries.forEach((g) => g.dispose());
    this.disposableMaterials.forEach((m) => m.dispose());
  }
}
