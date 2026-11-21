import * as THREE from 'three';
import type { GadgetSystem } from '../vehicle/Gadgets';
import type { WorldCollider } from './CityGenerator';

const ROAD_COORDS = [-320, -160, 0, 160, 320];
const TRAFFIC_COUNT = 18;
const MAX_POLICE = 5;
const MAX_ROADBLOCKS = 4;

export interface RadarPoint {
  x: number;
  z: number;
  disabled?: boolean;
}

export interface TrafficStepResult {
  playerDamage: number;
  impulseX: number;
  impulseZ: number;
  pushX: number;
  pushZ: number;
  impactStrength: number;
  empDisabledCount: number;
  smokeEscapedCount: number;
  sirenProximity: number;
  wantedStars: number;
  heatProgress: number;
}

interface TrafficAgent {
  x: number;
  z: number;
  axis: 'x' | 'z';
  dir: 1 | -1;
  roadCoord: number;
  laneOffset: number;
  speed: number;
  heading: number;
  hitCooldown: number;
}

interface PoliceAgent {
  active: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  flankSide: number;
  disabledTimer: number;
  confusedTimer: number;
  hitCooldown: number;
  group: THREE.Group;
  redBarMat: THREE.MeshBasicMaterial;
  blueBarMat: THREE.MeshBasicMaterial;
  glowMat: THREE.MeshBasicMaterial;
  empRingMesh: THREE.Mesh;
}

interface RoadblockUnit {
  active: boolean;
  x: number;
  z: number;
  axis: 'x' | 'z'; // road direction blocked partially
  blockOffset: number; // shifts barricade to one side, leaving a clean bypass lane on the other!
  halfW: number;
  halfD: number;
  hitCooldown: number;
  group: THREE.Group;
  beaconMat: THREE.MeshBasicMaterial;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function createGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class TrafficAndPoliceSystem {
  public readonly group = new THREE.Group();

  private readonly traffic: TrafficAgent[] = [];
  private readonly trafficBodyInst: THREE.InstancedMesh;
  private readonly trafficCabinInst: THREE.InstancedMesh;
  private readonly trafficHeadInst: THREE.InstancedMesh;
  private readonly trafficTailInst: THREE.InstancedMesh;

  private readonly police: PoliceAgent[] = [];
  private readonly roadblocks: RoadblockUnit[] = [];

  private readonly dummy = new THREE.Object3D();
  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];
  private readonly disposableTextures: THREE.Texture[] = [];

  private wantedActive = false;
  private heatValue = 0; // 0..3.0 -> 0..3 stars
  private flashClock = 0;

  private readonly policeRadarPoints: RadarPoint[] = [];
  private readonly roadblockRadarPoints: RadarPoint[] = [];
  private readonly stepResult: TrafficStepResult = {
    playerDamage: 0,
    impulseX: 0,
    impulseZ: 0,
    pushX: 0,
    pushZ: 0,
    impactStrength: 0,
    empDisabledCount: 0,
    smokeEscapedCount: 0,
    sirenProximity: 0,
    wantedStars: 0,
    heatProgress: 0,
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
    const trackTex = <T extends THREE.Texture>(t: T): T => {
      this.disposableTextures.push(t);
      return t;
    };

    // 1. Civilian Traffic (4 InstancedMeshes total for all 18 cars!)
    const civBodyGeo = trackGeo(new THREE.BoxGeometry(1.92, 0.62, 4.15));
    const civBodyMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.55 }),
    );
    const civCabinGeo = trackGeo(new THREE.BoxGeometry(1.6, 0.48, 2.05));
    const civCabinMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x0b101d, roughness: 0.14, metalness: 0.85 }),
    );
    const civLightGeo = trackGeo(new THREE.BoxGeometry(1.62, 0.14, 0.08));
    const civHeadMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xfff3d4 }));
    const civTailMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xff2b55 }));

    this.trafficBodyInst = new THREE.InstancedMesh(civBodyGeo, civBodyMat, TRAFFIC_COUNT);
    this.trafficCabinInst = new THREE.InstancedMesh(civCabinGeo, civCabinMat, TRAFFIC_COUNT);
    this.trafficHeadInst = new THREE.InstancedMesh(civLightGeo, civHeadMat, TRAFFIC_COUNT);
    this.trafficTailInst = new THREE.InstancedMesh(civLightGeo, civTailMat, TRAFFIC_COUNT);

    const civColors = [0x3d5478, 0x56436e, 0x2c6870, 0x733a55, 0x4b5c6b, 0x87674b];
    const tmpColor = new THREE.Color();
    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      tmpColor.setHex(civColors[i % civColors.length]);
      this.trafficBodyInst.setColorAt(i, tmpColor);
    }
    if (this.trafficBodyInst.instanceColor) this.trafficBodyInst.instanceColor.needsUpdate = true;

    this.group.add(
      this.trafficBodyInst,
      this.trafficCabinInst,
      this.trafficHeadInst,
      this.trafficTailInst,
    );

    // 2. Pooled Police Interceptor Cruisers with flashing Red/Blue lightbars + EMP static ring
    const polBodyGeo = trackGeo(new THREE.BoxGeometry(2.04, 0.58, 4.55));
    const polHoodGeo = trackGeo(new THREE.BoxGeometry(1.94, 0.14, 1.55));
    const polCabinGeo = trackGeo(new THREE.BoxGeometry(1.66, 0.46, 1.9));
    const polBarGeo = trackGeo(new THREE.BoxGeometry(0.68, 0.14, 0.24));
    const polGlowGeo = trackGeo(new THREE.PlaneGeometry(5.5, 5.5));
    polGlowGeo.rotateX(-Math.PI / 2);
    const empRingGeo = trackGeo(new THREE.TorusGeometry(2.6, 0.08, 6, 24));
    empRingGeo.rotateX(Math.PI / 2);

    const polBodyMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x0c1324, roughness: 0.26, metalness: 0.72 }),
    );
    const polWhiteMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xdce8f8, roughness: 0.3, metalness: 0.35 }),
    );
    const empRingMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.85,
      }),
    );
    const glowTex = trackTex(createGlowTexture());

    for (let i = 0; i < MAX_POLICE; i++) {
      const pGroup = new THREE.Group();
      const body = new THREE.Mesh(polBodyGeo, polBodyMat);
      body.position.set(0, 0.54, 0);
      pGroup.add(body);

      const whiteDeck = new THREE.Mesh(polHoodGeo, polWhiteMat);
      whiteDeck.position.set(0, 0.86, 0.05);
      pGroup.add(whiteDeck);

      const cabin = new THREE.Mesh(polCabinGeo, civCabinMat);
      cabin.position.set(0, 1.05, -0.15);
      pGroup.add(cabin);

      const head = new THREE.Mesh(civLightGeo, civHeadMat);
      head.position.set(0, 0.56, 2.29);
      pGroup.add(head);

      const tail = new THREE.Mesh(civLightGeo, civTailMat);
      tail.position.set(0, 0.62, -2.29);
      pGroup.add(tail);

      const redBarMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xff1e56 }));
      const blueBarMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x00b4ff }));
      const redBar = new THREE.Mesh(polBarGeo, redBarMat);
      redBar.position.set(0.36, 1.34, -0.08);
      const blueBar = new THREE.Mesh(polBarGeo, blueBarMat);
      blueBar.position.set(-0.36, 1.34, -0.08);
      pGroup.add(redBar, blueBar);

      const glowMat = trackMat(
        new THREE.MeshBasicMaterial({
          color: 0x00b4ff,
          map: glowTex,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const glow = new THREE.Mesh(polGlowGeo, glowMat);
      glow.position.y = 0.05;
      pGroup.add(glow);

      const empRingMesh = new THREE.Mesh(empRingGeo, empRingMat);
      empRingMesh.position.y = 0.6;
      empRingMesh.visible = false;
      pGroup.add(empRingMesh);

      pGroup.visible = false;
      this.group.add(pGroup);

      this.police.push({
        active: false,
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
        heading: 0,
        flankSide: i % 2 === 0 ? 1 : -1,
        disabledTimer: 0,
        confusedTimer: 0,
        hitCooldown: 0,
        group: pGroup,
        redBarMat,
        blueBarMat,
        glowMat,
        empRingMesh,
      });
    }

    // 3. Pooled Bypassable Police Roadblocks (occupy ~55% of road width, always leaving open bypass lane)
    const barrierGeo = trackGeo(new THREE.BoxGeometry(8.4, 1.05, 1.15));
    const barrierMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x22293a, roughness: 0.5, metalness: 0.55 }),
    );
    const stripeGeo = trackGeo(new THREE.BoxGeometry(8.5, 0.24, 1.22));
    const beaconGeo = trackGeo(new THREE.CylinderGeometry(0.24, 0.28, 0.35, 8));

    for (let i = 0; i < MAX_ROADBLOCKS; i++) {
      const rbGroup = new THREE.Group();
      const barrier = new THREE.Mesh(barrierGeo, barrierMat);
      barrier.position.set(0, 0.54, 0);
      rbGroup.add(barrier);

      const beaconMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xff2a6d }));
      const stripe = new THREE.Mesh(stripeGeo, beaconMat);
      stripe.position.set(0, 0.78, 0);
      rbGroup.add(stripe);

      for (const ox of [-3.6, 0, 3.6]) {
        const b = new THREE.Mesh(beaconGeo, beaconMat);
        b.position.set(ox, 1.22, 0);
        rbGroup.add(b);
      }

      rbGroup.visible = false;
      this.group.add(rbGroup);

      this.roadblocks.push({
        active: false,
        x: 0,
        z: 0,
        axis: 'z',
        blockOffset: 3.4,
        halfW: 4.3,
        halfD: 0.9,
        hitCooldown: 0,
        group: rbGroup,
        beaconMat,
      });
    }

    this.initTraffic();
  }

  public initTraffic(): void {
    this.traffic.length = 0;
    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const axis: 'x' | 'z' = i % 2 === 0 ? 'z' : 'x';
      const roadCoord = ROAD_COORDS[i % ROAD_COORDS.length];
      const dir: 1 | -1 = i % 4 < 2 ? 1 : -1;
      const laneOffset = dir === 1 ? -4.2 : 4.2;
      const along = -280 + ((i * 83) % 560);
      const x = axis === 'z' ? roadCoord + laneOffset : along;
      const z = axis === 'z' ? along : roadCoord + laneOffset;
      const heading =
        axis === 'z' ? (dir === 1 ? 0 : Math.PI) : dir === 1 ? Math.PI / 2 : -Math.PI / 2;

      this.traffic.push({
        x,
        z,
        axis,
        dir,
        roadCoord,
        laneOffset,
        speed: 13 + (i % 5) * 1.9,
        heading,
        hitCooldown: 0,
      });
    }
    this.syncTrafficVisuals();
  }

  public resetAll(): void {
    this.wantedActive = false;
    this.heatValue = 0;
    for (let i = 0; i < this.police.length; i++) {
      this.police[i].active = false;
      this.police[i].disabledTimer = 0;
      this.police[i].confusedTimer = 0;
      this.police[i].group.visible = false;
    }
    for (let i = 0; i < this.roadblocks.length; i++) {
      this.roadblocks[i].active = false;
      this.roadblocks[i].group.visible = false;
    }
    this.initTraffic();
  }

  public activateWanted(
    initialStars: number,
    playerX: number,
    playerZ: number,
    extractX: number,
    extractZ: number,
  ): void {
    this.wantedActive = true;
    this.heatValue = clamp(initialStars, 1, 3);
    const targetCount = this.desiredPoliceCount();
    for (let i = 0; i < targetCount; i++) {
      if (!this.police[i].active) {
        this.spawnPoliceNear(this.police[i], playerX, playerZ, i);
      }
    }
    this.deployRoadblocks(playerX, playerZ, extractX, extractZ);
  }

  public getWantedStars(): number {
    return this.wantedActive ? Math.max(1, Math.min(3, Math.floor(this.heatValue))) : 0;
  }

  public getPoliceRadarPoints(): readonly RadarPoint[] {
    this.policeRadarPoints.length = 0;
    for (let i = 0; i < this.police.length; i++) {
      const p = this.police[i];
      if (!p.active) continue;
      this.policeRadarPoints.push({ x: p.x, z: p.z, disabled: p.disabledTimer > 0 });
    }
    return this.policeRadarPoints;
  }

  public getRoadblockRadarPoints(): readonly RadarPoint[] {
    this.roadblockRadarPoints.length = 0;
    for (let i = 0; i < this.roadblocks.length; i++) {
      const rb = this.roadblocks[i];
      if (!rb.active) continue;
      this.roadblockRadarPoints.push({ x: rb.x, z: rb.z });
    }
    return this.roadblockRadarPoints;
  }

  public step(
    dt: number,
    playerX: number,
    playerZ: number,
    playerVx: number,
    playerVz: number,
    colliders: readonly WorldCollider[],
    gadgets: GadgetSystem,
  ): Readonly<TrafficStepResult> {
    const out = this.stepResult;
    out.playerDamage = 0;
    out.impulseX = 0;
    out.impulseZ = 0;
    out.pushX = 0;
    out.pushZ = 0;
    out.impactStrength = 0;
    out.empDisabledCount = 0;
    out.smokeEscapedCount = 0;
    out.sirenProximity = 0;

    this.flashClock += dt;

    // 1. Update Civilian Traffic along lanes
    for (let i = 0; i < this.traffic.length; i++) {
      const t = this.traffic[i];
      if (t.hitCooldown > 0) t.hitCooldown = Math.max(0, t.hitCooldown - dt);

      if (t.axis === 'z') {
        t.z += t.dir * t.speed * dt;
        if (t.z > 325 || t.z < -325) {
          t.dir = t.z > 325 ? -1 : 1;
          t.laneOffset = t.dir === 1 ? -4.2 : 4.2;
          t.x = t.roadCoord + t.laneOffset;
          t.heading = t.dir === 1 ? 0 : Math.PI;
        }
      } else {
        t.x += t.dir * t.speed * dt;
        if (t.x > 325 || t.x < -325) {
          t.dir = t.x > 325 ? -1 : 1;
          t.laneOffset = t.dir === 1 ? -4.2 : 4.2;
          t.z = t.roadCoord + t.laneOffset;
          t.heading = t.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
        }
      }

      // Check collision with player
      const dx = playerX - t.x;
      const dz = playerZ - t.z;
      const distSq = dx * dx + dz * dz;
      const minDist = 3.25;
      if (distSq < minDist * minDist && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const nz = dz / dist;
        const pen = minDist - dist;
        out.pushX += nx * pen * 0.7;
        out.pushZ += nz * pen * 0.7;

        const tvx = Math.sin(t.heading) * t.speed;
        const tvz = Math.cos(t.heading) * t.speed;
        const relVx = playerVx - tvx;
        const relVz = playerVz - tvz;
        const approach = -(relVx * nx + relVz * nz);
        if (approach > 1.2 && t.hitCooldown <= 0) {
          t.hitCooldown = 0.45;
          const strength = clamp(approach / 26, 0.15, 1);
          out.impulseX += nx * approach * 0.65;
          out.impulseZ += nz * approach * 0.65;
          out.impactStrength = Math.max(out.impactStrength, strength);
          out.playerDamage += 6 + strength * 16;
        }
      }
    }

    // 2. Consume EMP Blast & affect police units
    const emp = gadgets.consumeEmpBlast();
    if (emp) {
      for (let i = 0; i < this.police.length; i++) {
        const p = this.police[i];
        if (!p.active) continue;
        const d = Math.hypot(p.x - emp.x, p.z - emp.z);
        if (d <= emp.radius) {
          p.disabledTimer = emp.disableSec;
          out.empDisabledCount += 1;
        }
      }
    }

    // 3. Wanted Heat escalation & Police Chase AI
    if (this.wantedActive) {
      const heatRate = 0.045 * gadgets.getHeatRateMultiplier();
      this.heatValue = clamp(this.heatValue + heatRate * dt, 1, 3);

      const desired = this.desiredPoliceCount();
      let activeCount = 0;
      for (let i = 0; i < this.police.length; i++) {
        if (this.police[i].active) activeCount++;
      }
      if (activeCount < desired) {
        for (let i = 0; i < this.police.length && activeCount < desired; i++) {
          if (!this.police[i].active) {
            this.spawnPoliceNear(this.police[i], playerX, playerZ, i);
            activeCount++;
          }
        }
      }

      const sightScale = gadgets.getStealthDetectionMultiplier();
      let nearestActiveDist = Infinity;

      for (let i = 0; i < this.police.length; i++) {
        const p = this.police[i];
        if (!p.active) continue;

        if (p.hitCooldown > 0) p.hitCooldown = Math.max(0, p.hitCooldown - dt);

        if (p.disabledTimer > 0) {
          // Disabled by EMP: coast to a halt!
          p.disabledTimer = Math.max(0, p.disabledTimer - dt);
          p.vx *= Math.exp(-3.4 * dt);
          p.vz *= Math.exp(-3.4 * dt);
          p.x += p.vx * dt;
          p.z += p.vz * dt;
          this.resolveAgentBlocks(p, colliders);
          continue;
        }

        // Check smoke cloud blind/confusion
        const inSmoke = gadgets.isPointInSmoke(p.x, p.z);
        const midX = (p.x + playerX) * 0.5;
        const midZ = (p.z + playerZ) * 0.5;
        const blockedBySmoke = gadgets.isPointInSmoke(midX, midZ);
        if ((inSmoke || blockedBySmoke) && p.confusedTimer <= 0.2) {
          p.confusedTimer = 3.4;
          out.smokeEscapedCount += 1;
        }

        if (p.confusedTimer > 0) {
          p.confusedTimer = Math.max(0, p.confusedTimer - dt);
        }

        const distToPlayer = Math.hypot(playerX - p.x, playerZ - p.z);
        if (distToPlayer < nearestActiveDist) nearestActiveDist = distToPlayer;

        // Respawn overly distant cruiser ahead on an avenue to keep pursuit tense
        if (distToPlayer > 240 && !gadgets.isJammerPulseActive()) {
          this.spawnPoliceNear(p, playerX, playerZ, i);
          continue;
        }

        // Compute intercept target (lead + flank cut-off offset)
        let targetX = playerX;
        let targetZ = playerZ;
        let targetSpeed = 32 + this.getWantedStars() * 5.2;

        if (p.confusedTimer > 0 || (gadgets.isJammerPulseActive() && distToPlayer > 42)) {
          // Lost lock: slow down and veer slightly off course
          const wanderAngle = p.heading + p.flankSide * 0.75;
          targetX = p.x + Math.sin(wanderAngle) * 28;
          targetZ = p.z + Math.cos(wanderAngle) * 28;
          targetSpeed = 14;
        } else if (distToPlayer < 170 * sightScale) {
          const lead = clamp(distToPlayer / 45, 0.2, 1.35);
          const flankDist = distToPlayer > 14 ? 5.5 * p.flankSide : 0;
          const pHeading = Math.atan2(playerVx, playerVz);
          targetX = playerX + playerVx * lead + Math.cos(pHeading) * flankDist;
          targetZ = playerZ + playerVz * lead - Math.sin(pHeading) * flankDist;
        } else {
          targetSpeed = 20;
        }

        // Steer smoothly toward target + obstacle avoidance around city blocks
        let desiredAngle = Math.atan2(targetX - p.x, targetZ - p.z);
        const lookX = p.x + Math.sin(p.heading) * 14;
        const lookZ = p.z + Math.cos(p.heading) * 14;
        if (this.isInsideAnyCollider(lookX, lookZ, colliders, 3.2)) {
          const leftAngle = p.heading + 0.9;
          const rightAngle = p.heading - 0.9;
          const leftBlocked = this.isInsideAnyCollider(
            p.x + Math.sin(leftAngle) * 14,
            p.z + Math.cos(leftAngle) * 14,
            colliders,
            2.6,
          );
          desiredAngle = leftBlocked ? rightAngle : leftAngle;
        }

        const diff = wrapAngle(desiredAngle - p.heading);
        const turnRate = 3.1;
        p.heading += clamp(diff, -turnRate * dt, turnRate * dt);

        const fwdX = Math.sin(p.heading);
        const fwdZ = Math.cos(p.heading);
        const curSpeed = Math.hypot(p.vx, p.vz);
        const nextSpeed = curSpeed + clamp(targetSpeed - curSpeed, -24 * dt, 22 * dt);

        p.vx = fwdX * nextSpeed;
        p.vz = fwdZ * nextSpeed;
        p.x += p.vx * dt;
        p.z += p.vz * dt;

        this.resolveAgentBlocks(p, colliders);

        // Police ramming collision vs player
        const dx = playerX - p.x;
        const dz = playerZ - p.z;
        const distSq = dx * dx + dz * dz;
        const minDist = 3.4;
        if (distSq < minDist * minDist && distSq > 0.0001) {
          const dist = Math.sqrt(distSq);
          const nx = dx / dist;
          const nz = dz / dist;
          const pen = minDist - dist;
          out.pushX += nx * pen * 0.65;
          out.pushZ += nz * pen * 0.65;
          p.x -= nx * pen * 0.4;
          p.z -= nz * pen * 0.4;

          const relVx = playerVx - p.vx;
          const relVz = playerVz - p.vz;
          const approach = -(relVx * nx + relVz * nz);
          if (p.hitCooldown <= 0) {
            p.hitCooldown = 0.55;
            const impactSpeed = Math.max(8, approach);
            const strength = clamp(impactSpeed / 24, 0.25, 1);
            out.impulseX += nx * impactSpeed * 0.72;
            out.impulseZ += nz * impactSpeed * 0.72;
            out.impactStrength = Math.max(out.impactStrength, strength);
            out.playerDamage += 9 + strength * 15;
            p.vx *= 0.65;
            p.vz *= 0.65;
          }
        }
      }

      if (nearestActiveDist < 120) {
        out.sirenProximity = clamp(1 - nearestActiveDist / 120, 0, 1);
      }
    }

    // 4. Bypassable Roadblock collisions
    for (let i = 0; i < this.roadblocks.length; i++) {
      const rb = this.roadblocks[i];
      if (!rb.active) continue;
      if (rb.hitCooldown > 0) rb.hitCooldown = Math.max(0, rb.hitCooldown - dt);

      const minX = rb.x - rb.halfW;
      const maxX = rb.x + rb.halfW;
      const minZ = rb.z - rb.halfD;
      const maxZ = rb.z + rb.halfD;
      const cx = clamp(playerX, minX, maxX);
      const cz = clamp(playerZ, minZ, maxZ);
      const dx = playerX - cx;
      const dz = playerZ - cz;
      const distSq = dx * dx + dz * dz;
      const r = 1.7;
      if (distSq < r * r) {
        const dist = Math.max(0.01, Math.sqrt(distSq));
        const nx = dx / dist;
        const nz = dz / dist;
        out.pushX += nx * (r - dist);
        out.pushZ += nz * (r - dist);
        if (rb.hitCooldown <= 0) {
          rb.hitCooldown = 0.55;
          const spd = Math.hypot(playerVx, playerVz);
          const strength = clamp(spd / 28, 0.3, 1);
          out.impulseX += nx * Math.max(10, spd * 0.55);
          out.impulseZ += nz * Math.max(10, spd * 0.55);
          out.impactStrength = Math.max(out.impactStrength, strength);
          out.playerDamage += 12 + strength * 18;
        }
      }
    }

    out.wantedStars = this.getWantedStars();
    out.heatProgress = this.wantedActive ? clamp((this.heatValue - 1) / 2, 0, 1) : 0;
    return out;
  }

  public syncVisuals(): void {
    this.syncTrafficVisuals();

    const flashToggle = Math.floor(this.flashClock * 9) % 2 === 0;
    for (let i = 0; i < this.police.length; i++) {
      const p = this.police[i];
      p.group.visible = p.active;
      if (!p.active) continue;

      p.group.position.set(p.x, 0, p.z);
      p.group.rotation.y = p.heading;

      const disabled = p.disabledTimer > 0;
      p.empRingMesh.visible = disabled;
      if (disabled) {
        p.empRingMesh.rotation.z = this.flashClock * 4;
        p.redBarMat.color.setHex(0x283244);
        p.blueBarMat.color.setHex(0x283244);
        p.glowMat.opacity = 0.08;
      } else {
        const alt = (i % 2 === 0 ? flashToggle : !flashToggle);
        p.redBarMat.color.setHex(alt ? 0xff1e56 : 0x3b0d1b);
        p.blueBarMat.color.setHex(alt ? 0x0b2540 : 0x00c8ff);
        p.glowMat.color.setHex(alt ? 0xff1e56 : 0x00c8ff);
        p.glowMat.opacity = 0.52;
      }
    }

    for (let i = 0; i < this.roadblocks.length; i++) {
      const rb = this.roadblocks[i];
      rb.group.visible = rb.active;
      if (!rb.active) continue;
      rb.beaconMat.color.setHex(flashToggle ? 0xff2a6d : 0xff9a3d);
    }
  }

  private syncTrafficVisuals(): void {
    for (let i = 0; i < this.traffic.length; i++) {
      const t = this.traffic[i];
      const sin = Math.sin(t.heading);
      const cos = Math.cos(t.heading);

      this.dummy.position.set(t.x, 0.55, t.z);
      this.dummy.rotation.set(0, t.heading, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.trafficBodyInst.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(t.x - sin * 0.15, 1.04, t.z - cos * 0.15);
      this.dummy.updateMatrix();
      this.trafficCabinInst.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(t.x + sin * 2.1, 0.56, t.z + cos * 2.1);
      this.dummy.updateMatrix();
      this.trafficHeadInst.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(t.x - sin * 2.1, 0.6, t.z - cos * 2.1);
      this.dummy.updateMatrix();
      this.trafficTailInst.setMatrixAt(i, this.dummy.matrix);
    }
    this.trafficBodyInst.instanceMatrix.needsUpdate = true;
    this.trafficCabinInst.instanceMatrix.needsUpdate = true;
    this.trafficHeadInst.instanceMatrix.needsUpdate = true;
    this.trafficTailInst.instanceMatrix.needsUpdate = true;
  }

  private desiredPoliceCount(): number {
    const stars = this.getWantedStars();
    if (stars <= 0) return 0;
    if (stars === 1) return 2;
    if (stars === 2) return 4;
    return MAX_POLICE;
  }

  private spawnPoliceNear(p: PoliceAgent, playerX: number, playerZ: number, index: number): void {
    // Pick nearest road coordinate at a safe chase offset (70..115m away on an open avenue)
    const nearestRoadX = ROAD_COORDS.reduce((best, r) =>
      Math.abs(r - playerX) < Math.abs(best - playerX) ? r : best,
    );
    const nearestRoadZ = ROAD_COORDS.reduce((best, r) =>
      Math.abs(r - playerZ) < Math.abs(best - playerZ) ? r : best,
    );

    const useVertical = index % 2 === 0;
    const offset = (index % 4 < 2 ? 1 : -1) * (78 + index * 14);
    if (useVertical) {
      p.x = nearestRoadX + (index % 2 === 0 ? 4 : -4);
      p.z = clamp(playerZ + offset, -310, 310);
    } else {
      p.x = clamp(playerX + offset, -310, 310);
      p.z = nearestRoadZ + (index % 2 === 0 ? 4 : -4);
    }

    p.heading = Math.atan2(playerX - p.x, playerZ - p.z);
    p.vx = Math.sin(p.heading) * 18;
    p.vz = Math.cos(p.heading) * 18;
    p.disabledTimer = 0;
    p.confusedTimer = 0;
    p.hitCooldown = 0;
    p.active = true;
    p.group.visible = true;
  }

  private deployRoadblocks(
    playerX: number,
    playerZ: number,
    extractX: number,
    extractZ: number,
  ): void {
    // Candidate avenue chokepoints near intersections between city center & extraction
    const candidates: Array<{ x: number; z: number; axis: 'x' | 'z'; side: number }> = [
      { x: 0, z: -136, axis: 'z', side: 4.5 },
      { x: 0, z: 136, axis: 'z', side: -4.5 },
      { x: 160, z: -24, axis: 'z', side: 4.5 },
      { x: -160, z: 24, axis: 'z', side: -4.5 },
      { x: -24, z: 160, axis: 'x', side: 4.5 },
      { x: 24, z: -160, axis: 'x', side: -4.5 },
      { x: 320, z: 24, axis: 'z', side: -4.5 },
      { x: -320, z: -24, axis: 'z', side: 4.5 },
    ];

    // Prefer roadblocks closer to the corridor toward extraction, but never right on top of player/extract
    const filtered = candidates
      .filter(
        (c) =>
          Math.hypot(c.x - playerX, c.z - playerZ) > 55 &&
          Math.hypot(c.x - extractX, c.z - extractZ) > 55,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - extractX, a.z - extractZ) -
          Math.hypot(b.x - extractX, b.z - extractZ),
      );

    for (let i = 0; i < this.roadblocks.length; i++) {
      const rb = this.roadblocks[i];
      const pick = filtered[i];
      if (!pick) {
        rb.active = false;
        rb.group.visible = false;
        continue;
      }
      rb.active = true;
      rb.axis = pick.axis;
      rb.blockOffset = pick.side;
      if (pick.axis === 'z') {
        rb.x = pick.x + pick.side;
        rb.z = pick.z;
        rb.halfW = 4.3;
        rb.halfD = 0.85;
        rb.group.rotation.y = 0;
      } else {
        rb.x = pick.x;
        rb.z = pick.z + pick.side;
        rb.halfW = 0.85;
        rb.halfD = 4.3;
        rb.group.rotation.y = Math.PI / 2;
      }
      rb.group.position.set(rb.x, 0, rb.z);
      rb.group.visible = true;
    }
  }

  private isInsideAnyCollider(
    x: number,
    z: number,
    colliders: readonly WorldCollider[],
    pad: number,
  ): boolean {
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) {
        return true;
      }
    }
    return false;
  }

  private resolveAgentBlocks(p: PoliceAgent, colliders: readonly WorldCollider[]): void {
    const r = 1.75;
    p.x = clamp(p.x, -334, 372);
    p.z = clamp(p.z, -334, 372);

    for (let i = 0; i < colliders.length; i++) {
      const box = colliders[i];
      const cx = clamp(p.x, box.minX, box.maxX);
      const cz = clamp(p.z, box.minZ, box.maxZ);
      const dx = p.x - cx;
      const dz = p.z - cz;
      const distSq = dx * dx + dz * dz;
      if (distSq < r * r && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const nz = dz / dist;
        p.x += nx * (r - dist);
        p.z += nz * (r - dist);
        const vn = p.vx * nx + p.vz * nz;
        if (vn < 0) {
          p.vx -= vn * nx * 1.1;
          p.vz -= vn * nz * 1.1;
        }
      }
    }
  }

  public dispose(): void {
    this.disposableGeometries.forEach((g) => g.dispose());
    this.disposableMaterials.forEach((m) => m.dispose());
    this.disposableTextures.forEach((t) => t.dispose());
  }
}
