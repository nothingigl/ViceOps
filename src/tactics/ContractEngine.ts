import * as THREE from 'three';
import type { Contract, DailyContractRecord, GadgetId, TireType, WeatherMode } from '../types';
import { WEATHER_LABELS } from '../world/WeatherSystem';

export interface ZoneMarker {
  x: number;
  z: number;
  radius: number;
  label: string;
}

export interface PatrolSector {
  x: number;
  z: number;
  radius: number;
}

export interface TacticalContract extends Contract {
  stars: 1 | 2 | 3;
  isDaily?: boolean;
  dailyDate?: string;
  spawnPoint: { x: number; z: number; heading: number };
  targetZone: ZoneMarker;
  extractionZone: ZoneMarker;
  patrolSectors: PatrolSector[];
}

export type ContractPhase = 'idle' | 'approach' | 'uploading' | 'extract' | 'extracted' | 'failed';

export type ContractFailReason = 'none' | 'destroyed' | 'timeout';

export interface ContractStepEvents {
  capturedTarget: boolean;
  extracted: boolean;
  failed: boolean;
}

export interface ContractSnapshot {
  active: boolean;
  contract: TacticalContract | null;
  phase: ContractPhase;
  objectiveText: string;
  subText: string;
  timeRemainingSec: number;
  elapsedSec: number;
  uploadProgress: number; // 0..1
  extractProgress: number; // 0..1
  hp: number;
  maxHp: number;
  distanceMeters: number;
  waypoint: { x: number; z: number; kind: 'target' | 'extract' } | null;
  earnedCredits: number;
  failReason: ContractFailReason;
}

const TARGET_HOLD_SEC = 5.0;
const EXTRACT_HOLD_SEC = 1.2;

const CONTRACT_NODES: Array<{ x: number; z: number; district: string }> = [
  { x: 0, z: 0, district: 'Деловой центр' },
  { x: -160, z: -160, district: 'Северный узел' },
  { x: 160, z: -160, district: 'Башни Майами' },
  { x: -160, z: 160, district: 'Промзона Доков' },
  { x: 160, z: 160, district: 'Неоновый бульвар' },
  { x: 352, z: -90, district: 'Пляжная обочина' },
  { x: -320, z: 0, district: 'Западная магистраль' },
  { x: 0, z: -320, district: 'Северное шоссе' },
  { x: 320, z: -260, district: 'Прибрежный терминал' },
  { x: -320, z: 240, district: 'Юго-Западный порт' },
];

const TITLES_BY_STARS: Record<1 | 2 | 3, string[]> = {
  1: ['Курьерский перехват', 'Ночная закладка', 'Тихий рейд на сервер'],
  2: ['Угон зашифрованного кэша', 'Штормовой транзит', 'Прорыв блокады'],
  3: ['Чёрный протокол DMZ', 'Операция «Красный прибой»', 'Высоковольтный отрыв'],
};

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getTodayDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function hashDateKey(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

const DAILY_CODENAMES = [
  'Операция «Неоновый вектор»',
  'Контракт дня: «Чёрный маяк»',
  'Контракт дня: «Береговой прорыв»',
  'Контракт дня: «Грозовой курьер»',
  'Контракт дня: «Ночной трафик»',
  'Контракт дня: «Красная линия»',
];

/**
 * Deterministically generates today's «Контракт дня» from calendar date (YYYY-MM-DD)
 * so all players get the exact same route, weather, and difficulty even 100% offline.
 */
export function generateDailyContract(dateKey = getTodayDateKey()): TacticalContract {
  const rng = createRng(hashDateKey(`VICE_OPS_DAILY_${dateKey}`));
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

  const weathers: WeatherMode[] = ['sunset', 'neon_night', 'rain'];
  const weather = pick(weathers);
  const stars: 1 | 2 | 3 = rng() > 0.45 ? 3 : 2;
  const spawn = { x: 320, z: 255, heading: Math.PI };

  const targetCandidates = CONTRACT_NODES.filter(
    (n) => Math.hypot(n.x - spawn.x, n.z - spawn.z) > 220,
  );
  const targetNode = pick(targetCandidates);
  const extractCandidates = CONTRACT_NODES.filter(
    (n) => Math.hypot(n.x - targetNode.x, n.z - targetNode.z) > 280,
  );
  const extractNode = pick(extractCandidates.length > 0 ? extractCandidates : CONTRACT_NODES);

  let recommendedTires: TireType = 'slick';
  if (weather === 'rain') {
    recommendedTires = 'wet';
  } else if (targetNode.x > 330 || extractNode.x > 330) {
    recommendedTires = 'offroad';
  }

  const patrolCount = stars === 3 ? 4 : 3;
  const patrolSectors: PatrolSector[] = [];
  for (let p = 0; p < patrolCount; p++) {
    const t = (p + 1) / (patrolCount + 1);
    const sx = targetNode.x + (extractNode.x - targetNode.x) * t + (rng() - 0.5) * 120;
    const sz = targetNode.z + (extractNode.z - targetNode.z) * t + (rng() - 0.5) * 120;
    patrolSectors.push({
      x: Math.max(-290, Math.min(290, Math.round(sx))),
      z: Math.max(-290, Math.min(290, Math.round(sz))),
      radius: 62 + Math.round(rng() * 24),
    });
  }

  const rewardCredits = stars === 3 ? 38000 : 28000;
  const timeLimitSec = stars === 3 ? 102 : 114;

  return {
    id: `daily_${dateKey}`,
    isDaily: true,
    dailyDate: dateKey,
    title: pick(DAILY_CODENAMES),
    description: `Единый офлайн-маршрут на ${dateKey}: захватите цель в секторе «${targetNode.district}» (5 сек.) и эвакуируйтесь через «${extractNode.district}». Сравните время с друзьями!`,
    district: targetNode.district,
    weather,
    difficulty: stars === 3 ? 'high' : 'medium',
    stars,
    timeLimitSec,
    rewardCredits,
    heatLevel: stars,
    recommendedTires,
    recommendedGadgets: stars === 3 ? ['emp', 'jammer'] : ['emp', 'smoke'],
    spawnPoint: spawn,
    targetZone: {
      x: targetNode.x,
      z: targetNode.z,
      radius: 15.5,
      label: targetNode.district,
    },
    extractionZone: {
      x: extractNode.x,
      z: extractNode.z,
      radius: 17.0,
      label: extractNode.district,
    },
    patrolSectors,
  };
}

export function formatDailyShareCard(record: DailyContractRecord): string {
  return [
    `🏁 Vice Ops: Tactical Drive — Контракт дня (${record.dateKey})`,
    `🚗 ${record.vehicleName} • Шины: ${record.tireName}`,
    `⏱ Эвакуация: ${record.bestTimeSec.toFixed(1)} сек. | 🛡 Прочность: ${record.hpRemaining}/${record.maxHp} HP`,
    `🌦 Погода: ${WEATHER_LABELS[record.weather]} | 💰 +${record.rewardCredits.toLocaleString('ru-RU')} ₵`,
  ].join('\n');
}

export function generateProceduralContracts(seed = Date.now()): TacticalContract[] {
  const rng = createRng(seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

  const weathers: [WeatherMode, WeatherMode, WeatherMode] = ['sunset', 'neon_night', 'rain'];
  // Shuffle weather assignment across the 3 contracts so all 3 atmospheres appear!
  for (let i = weathers.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = weathers[i];
    weathers[i] = weathers[j];
    weathers[j] = tmp;
  }

  const tiers: Array<{
    stars: 1 | 2 | 3;
    difficulty: 'low' | 'medium' | 'high';
    timeLimitSec: number;
    rewardCredits: number;
    heatLevel: number;
    patrolCount: number;
    forceOffroad?: boolean;
  }> = [
    {
      stars: 1,
      difficulty: 'low',
      timeLimitSec: 125,
      rewardCredits: 12500,
      heatLevel: 1,
      patrolCount: 2,
    },
    {
      stars: 2,
      difficulty: 'medium',
      timeLimitSec: 110,
      rewardCredits: 21000,
      heatLevel: 2,
      patrolCount: 3,
      forceOffroad: true,
    },
    {
      stars: 3,
      difficulty: 'high',
      timeLimitSec: 98,
      rewardCredits: 34000,
      heatLevel: 3,
      patrolCount: 4,
    },
  ];

  return tiers.map((tier, idx) => {
    const weather = weathers[idx];
    const spawn = { x: 320, z: 255, heading: Math.PI };

    // Choose target node sufficiently far from spawn
    const targetPool = CONTRACT_NODES.filter((n) => {
      const dist = Math.hypot(n.x - spawn.x, n.z - spawn.z);
      if (tier.forceOffroad && weather !== 'rain') {
        return n.x > 330 || dist > 230;
      }
      return dist > 210;
    });
    const targetNode =
      tier.forceOffroad && weather !== 'rain'
        ? CONTRACT_NODES.find((n) => n.x > 330) ?? pick(targetPool)
        : pick(targetPool);

    // Choose extraction node well separated from target
    const extractPool = CONTRACT_NODES.filter(
      (n) => Math.hypot(n.x - targetNode.x, n.z - targetNode.z) > 260,
    );
    const extractNode = pick(extractPool.length > 0 ? extractPool : CONTRACT_NODES);

    // Recommended tires based on weather & beachfront offroad terrain
    let recommendedTires: TireType = 'slick';
    if (weather === 'rain') {
      recommendedTires = 'wet';
    } else if (targetNode.x > 330 || extractNode.x > 330) {
      recommendedTires = 'offroad';
    }

    const recommendedGadgets: GadgetId[] =
      tier.stars === 1
        ? ['smoke', 'jammer']
        : tier.stars === 2
          ? ['emp', 'smoke']
          : ['emp', 'jammer'];

    // Approximate patrol sectors around target & extraction corridor
    const patrolSectors: PatrolSector[] = [];
    for (let p = 0; p < tier.patrolCount; p++) {
      const t = (p + 1) / (tier.patrolCount + 1);
      const sx = targetNode.x + (extractNode.x - targetNode.x) * t + (rng() - 0.5) * 140;
      const sz = targetNode.z + (extractNode.z - targetNode.z) * t + (rng() - 0.5) * 140;
      patrolSectors.push({
        x: Math.max(-290, Math.min(290, Math.round(sx))),
        z: Math.max(-290, Math.min(290, Math.round(sz))),
        radius: 58 + Math.round(rng() * 28),
      });
    }

    const title = pick(TITLES_BY_STARS[tier.stars]);
    const description =
      tier.stars === 1
        ? `Перехватите пакет данных в секторе «${targetNode.district}» (удержание 5 сек.) и эвакуируйтесь в точку «${extractNode.district}».`
        : tier.stars === 2
          ? `Тактический рейд повышенного риска: скачайте данные в зоне «${targetNode.district}», оторвитесь от патрулей и уйдите через «${extractNode.district}».`
          : `Экстремальный контракт DMZ: после захвата груза в «${targetNode.district}» активируются блокпосты и усиленный перехват. Вырвитесь в «${extractNode.district}».`;

    return {
      id: `dmz_${seed}_${idx + 1}`,
      title,
      description,
      district: targetNode.district,
      weather,
      difficulty: tier.difficulty,
      stars: tier.stars,
      timeLimitSec: tier.timeLimitSec,
      rewardCredits: tier.rewardCredits,
      heatLevel: tier.heatLevel,
      recommendedTires,
      recommendedGadgets,
      spawnPoint: spawn,
      targetZone: {
        x: targetNode.x,
        z: targetNode.z,
        radius: 15.5,
        label: targetNode.district,
      },
      extractionZone: {
        x: extractNode.x,
        z: extractNode.z,
        radius: 17.0,
        label: extractNode.district,
      },
      patrolSectors,
    };
  });
}

export class ContractEngine {
  public readonly group = new THREE.Group();

  private contract: TacticalContract | null = null;
  private phase: ContractPhase = 'idle';
  private timeRemainingSec = 0;
  private elapsedSec = 0;
  private uploadTimer = 0;
  private extractTimer = 0;
  private hp = 100;
  private maxHp = 100;
  private earnedCredits = 0;
  private failReason: ContractFailReason = 'none';
  private beaconClock = 0;

  // 3D Holographic Beacons (2 draw-call groups: target beacon & extraction beacon)
  private readonly targetBeacon = new THREE.Group();
  private readonly targetRingMesh: THREE.Mesh;
  private readonly targetBeamMesh: THREE.Mesh;
  private readonly targetBeamMat: THREE.MeshBasicMaterial;

  private readonly extractBeacon = new THREE.Group();
  private readonly extractRingMesh: THREE.Mesh;
  private readonly extractBeamMesh: THREE.Mesh;
  private readonly extractBeamMat: THREE.MeshBasicMaterial;

  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];

  private readonly events: ContractStepEvents = {
    capturedTarget: false,
    extracted: false,
    failed: false,
  };

  private readonly snapshot: ContractSnapshot = {
    active: false,
    contract: null,
    phase: 'idle',
    objectiveText: '',
    subText: '',
    timeRemainingSec: 0,
    elapsedSec: 0,
    uploadProgress: 0,
    extractProgress: 0,
    hp: 100,
    maxHp: 100,
    distanceMeters: 0,
    waypoint: null,
    earnedCredits: 0,
    failReason: 'none',
  };

  constructor() {
    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.disposableGeometries.push(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      this.disposableMaterials.push(m);
      return m;
    };

    // Target Beacon (Vibrant Cyan / Amber Holo Cylinder + Ground Ring)
    const targetRingGeo = trackGeo(new THREE.RingGeometry(13.8, 15.6, 40));
    targetRingGeo.rotateX(-Math.PI / 2);
    const targetRingMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.targetRingMesh = new THREE.Mesh(targetRingGeo, targetRingMat);
    this.targetRingMesh.position.y = 0.14;

    const targetBeamGeo = trackGeo(new THREE.CylinderGeometry(2.6, 5.2, 130, 16, 1, true));
    this.targetBeamMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.targetBeamMesh = new THREE.Mesh(targetBeamGeo, this.targetBeamMat);
    this.targetBeamMesh.position.y = 65;

    this.targetBeacon.add(this.targetRingMesh, this.targetBeamMesh);
    this.targetBeacon.visible = false;
    this.group.add(this.targetBeacon);

    // Extraction Beacon (Vibrant Neon Emerald / Lime Evacuation Beam)
    const extractRingGeo = trackGeo(new THREE.RingGeometry(15.2, 17.2, 40));
    extractRingGeo.rotateX(-Math.PI / 2);
    const extractRingMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x39ff88,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.extractRingMesh = new THREE.Mesh(extractRingGeo, extractRingMat);
    this.extractRingMesh.position.y = 0.16;

    const extractBeamGeo = trackGeo(new THREE.CylinderGeometry(3.2, 6.2, 150, 16, 1, true));
    this.extractBeamMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x39ff88,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.extractBeamMesh = new THREE.Mesh(extractBeamGeo, this.extractBeamMat);
    this.extractBeamMesh.position.y = 75;

    this.extractBeacon.add(this.extractRingMesh, this.extractBeamMesh);
    this.extractBeacon.visible = false;
    this.group.add(this.extractBeacon);
  }

  public startContract(contract: TacticalContract, maxDurability: number): void {
    this.contract = contract;
    this.phase = 'approach';
    this.timeRemainingSec = contract.timeLimitSec;
    this.elapsedSec = 0;
    this.uploadTimer = 0;
    this.extractTimer = 0;
    this.maxHp = Math.max(80, Math.round(maxDurability));
    this.hp = this.maxHp;
    this.earnedCredits = 0;
    this.failReason = 'none';

    this.targetBeacon.position.set(contract.targetZone.x, 0, contract.targetZone.z);
    this.targetBeacon.visible = true;

    this.extractBeacon.position.set(contract.extractionZone.x, 0, contract.extractionZone.z);
    this.extractBeacon.visible = false;

    this.syncSnapshot(contract.spawnPoint.x, contract.spawnPoint.z);
  }

  public clearContract(): void {
    this.contract = null;
    this.phase = 'idle';
    this.targetBeacon.visible = false;
    this.extractBeacon.visible = false;
    this.syncSnapshot(0, 0);
  }

  public isActive(): boolean {
    return this.contract !== null && this.phase !== 'idle';
  }

  public isFinished(): boolean {
    return this.phase === 'extracted' || this.phase === 'failed';
  }

  public applyDamage(amount: number): void {
    if (!this.contract || this.isFinished() || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
  }

  public step(dt: number, carX: number, carZ: number): Readonly<ContractStepEvents> {
    this.events.capturedTarget = false;
    this.events.extracted = false;
    this.events.failed = false;

    if (!this.contract || this.phase === 'idle' || this.isFinished()) {
      return this.events;
    }

    this.beaconClock += dt;
    this.elapsedSec += dt;
    this.timeRemainingSec = Math.max(0, this.timeRemainingSec - dt);

    // Check failure conditions first (destroyed car or timeout)
    if (this.hp <= 0) {
      this.phase = 'failed';
      this.failReason = 'destroyed';
      this.earnedCredits = 0;
      this.targetBeacon.visible = false;
      this.extractBeacon.visible = false;
      this.events.failed = true;
      this.syncSnapshot(carX, carZ);
      return this.events;
    }

    if (this.timeRemainingSec <= 0) {
      this.phase = 'failed';
      this.failReason = 'timeout';
      this.earnedCredits = 0;
      this.targetBeacon.visible = false;
      this.extractBeacon.visible = false;
      this.events.failed = true;
      this.syncSnapshot(carX, carZ);
      return this.events;
    }

    if (this.phase === 'approach' || this.phase === 'uploading') {
      const tz = this.contract.targetZone;
      const dist = Math.hypot(carX - tz.x, carZ - tz.z);
      if (dist <= tz.radius) {
        this.phase = 'uploading';
        this.uploadTimer = Math.min(TARGET_HOLD_SEC, this.uploadTimer + dt);
        if (this.uploadTimer >= TARGET_HOLD_SEC) {
          this.phase = 'extract';
          this.targetBeacon.visible = false;
          this.extractBeacon.visible = true;
          this.events.capturedTarget = true;
        }
      } else {
        this.phase = 'approach';
        // Gentle decay if player leaves the zone early, so circling back stays fair
        this.uploadTimer = Math.max(0, this.uploadTimer - dt * 0.45);
      }
    } else if (this.phase === 'extract') {
      const ez = this.contract.extractionZone;
      const dist = Math.hypot(carX - ez.x, carZ - ez.z);
      if (dist <= ez.radius) {
        this.extractTimer = Math.min(EXTRACT_HOLD_SEC, this.extractTimer + dt);
        if (this.extractTimer >= EXTRACT_HOLD_SEC) {
          this.phase = 'extracted';
          const hpBonus = Math.round((this.hp / this.maxHp) * 2000 * this.contract.stars);
          this.earnedCredits = this.contract.rewardCredits + hpBonus;
          this.extractBeacon.visible = false;
          this.events.extracted = true;
        }
      } else {
        this.extractTimer = Math.max(0, this.extractTimer - dt * 0.8);
      }
    }

    this.syncSnapshot(carX, carZ);
    return this.events;
  }

  public syncVisuals(): void {
    const pulse = 1 + Math.sin(this.beaconClock * 4.5) * 0.06;
    if (this.targetBeacon.visible) {
      this.targetRingMesh.scale.set(pulse, pulse, 1);
      this.targetBeamMesh.rotation.y = this.beaconClock * 0.8;
      this.targetBeamMat.opacity = this.phase === 'uploading' ? 0.36 : 0.18;
    }
    if (this.extractBeacon.visible) {
      this.extractRingMesh.scale.set(pulse, pulse, 1);
      this.extractBeamMesh.rotation.y = -this.beaconClock * 1.1;
      this.extractBeamMat.opacity = this.extractTimer > 0 ? 0.42 : 0.24;
    }
  }

  public getSnapshot(): Readonly<ContractSnapshot> {
    return this.snapshot;
  }

  private syncSnapshot(carX: number, carZ: number): void {
    const s = this.snapshot;
    s.active = this.contract !== null && this.phase !== 'idle';
    s.contract = this.contract;
    s.phase = this.phase;
    s.timeRemainingSec = this.timeRemainingSec;
    s.elapsedSec = this.elapsedSec;
    s.uploadProgress = Math.min(1, this.uploadTimer / TARGET_HOLD_SEC);
    s.extractProgress = Math.min(1, this.extractTimer / EXTRACT_HOLD_SEC);
    s.hp = Math.round(this.hp);
    s.maxHp = this.maxHp;
    s.earnedCredits = this.earnedCredits;
    s.failReason = this.failReason;

    if (!this.contract) {
      s.objectiveText = '';
      s.subText = '';
      s.distanceMeters = 0;
      s.waypoint = null;
      return;
    }

    if (this.phase === 'approach') {
      const tz = this.contract.targetZone;
      s.distanceMeters = Math.round(Math.hypot(carX - tz.x, carZ - tz.z));
      s.waypoint = { x: tz.x, z: tz.z, kind: 'target' };
      s.objectiveText = `Доедьте до зоны цели: ${tz.label}`;
      s.subText = `Осталось ${s.distanceMeters} м • Удержите позицию 5 сек.`;
    } else if (this.phase === 'uploading') {
      const tz = this.contract.targetZone;
      const rem = Math.max(0, TARGET_HOLD_SEC - this.uploadTimer);
      s.distanceMeters = Math.round(Math.hypot(carX - tz.x, carZ - tz.z));
      s.waypoint = { x: tz.x, z: tz.z, kind: 'target' };
      s.objectiveText = `Загрузка данных: ${Math.round(s.uploadProgress * 100)}%`;
      s.subText = `Держитесь в радиусе маяка ещё ${rem.toFixed(1)} сек.`;
    } else if (this.phase === 'extract') {
      const ez = this.contract.extractionZone;
      s.distanceMeters = Math.round(Math.hypot(carX - ez.x, carZ - ez.z));
      s.waypoint = { x: ez.x, z: ez.z, kind: 'extract' };
      s.objectiveText =
        this.extractTimer > 0.05
          ? `ЭВАКУАЦИЯ... ${Math.round(s.extractProgress * 100)}%`
          : `ЭВАКУАЦИЯ: ${ez.label}`;
      s.subText = `Дистанция ${s.distanceMeters} м • Уйдите от полиции до конца таймера`;
    } else if (this.phase === 'extracted') {
      s.distanceMeters = 0;
      s.waypoint = null;
      s.objectiveText = 'Эвакуация завершена!';
      s.subText = `Начислено +${this.earnedCredits.toLocaleString('ru-RU')} ₵`;
    } else if (this.phase === 'failed') {
      s.distanceMeters = 0;
      s.waypoint = null;
      s.objectiveText = 'Рейд провален';
      s.subText =
        this.failReason === 'destroyed'
          ? 'Автомобиль выведен из строя — добыча потеряна'
          : 'Время вышло — добыча сгорела';
    }
  }

  public dispose(): void {
    this.disposableGeometries.forEach((g) => g.dispose());
    this.disposableMaterials.forEach((m) => m.dispose());
  }
}
