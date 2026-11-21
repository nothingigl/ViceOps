import type { VehicleSetup, WeatherMode } from '../types';
import type { WorldCollider } from '../world/CityGenerator';
import {
  computeDerivedPhysics,
  createDefaultVehicleSetup,
  resolveSurfaceGrip,
  type DerivedVehiclePhysics,
  type SurfaceType,
} from './VehicleSpecs';

export type TransmissionMode = 'auto' | 'manual';

export interface VehicleControlInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (right) .. +1 (left) */
  steer: number;
  handbrake: boolean;
}

export interface CarTransformSnapshot {
  x: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
  steerAngle: number;
  wheelSpin: number;
}

export interface CarTelemetry {
  speedKmh: number;
  speedMs: number;
  rpm: number;
  redlineRpm: number;
  /** -1 = R, 0 = N, 1..5 = forward gears */
  gear: number;
  gearLabel: string;
  transmissionMode: TransmissionMode;
  throttle: number;
  brake: number;
  isBrakingLights: boolean;
  isReversing: boolean;
  isHandbrake: boolean;
  isDrifting: boolean;
  driftAngleDeg: number;
  /** 0..1 tire slip intensity for audio & visual feedback */
  slipIntensity: number;
  /** 0..1 turbo boost charge */
  turboBoost: number;
  /** Momentary impulse (0..1) when throttle lifts after high boost (for BOV whistle) */
  blowOffTrigger: number;
  /** Momentary impact strength (0..1) from wall collision */
  impactImpulse: number;
  /** Current driving surface for tire feedback */
  surface: SurfaceType;
  /** Current structural durability rating derived from class + armor */
  maxDurability: number;
  massKg: number;
  forwardX: number;
  forwardZ: number;
  velocityX: number;
  velocityZ: number;
}

const IDLE_RPM = 950;

/** 5-speed sport gearbox ratios scaled dynamically by finalDrive (Short / Balanced / Long) */
const GEAR_RATIOS = [
  -3.1, // R (index 0)
  0, // N (index 1)
  3.35, // 1st
  2.22, // 2nd
  1.56, // 3rd
  1.16, // 4th
  0.88, // 5th
];

const LF = 1.32; // CG to front axle (m)
const LR = 1.42; // CG to rear axle (m)

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/** Smooth normalized torque curve peaking in mid-high RPM band */
function engineTorqueCurve(rpm: number, redlineRpm: number): number {
  const n = clamp((rpm - IDLE_RPM) / Math.max(1000, redlineRpm - IDLE_RPM), 0, 1);
  return 0.56 + 0.56 * Math.sin(n * Math.PI * 0.86) - 0.14 * n * n;
}

export class CarPhysics {
  private derived: DerivedVehiclePhysics;

  private x = 0;
  private z = 0;
  private heading = 0;
  private vx = 0;
  private vz = 0;
  private yawRate = 0;

  private steerAngle = 0;
  private wheelSpin = 0;

  // Weight transfer spring-damper states
  private pitch = 0;
  private pitchVel = 0;
  private roll = 0;
  private rollVel = 0;

  // Powertrain
  private gear = 1; // -1 = R, 1..5
  private transmissionMode: TransmissionMode = 'auto';
  private shiftCooldown = 0;
  private shiftCutTimer = 0;
  private rpm = IDLE_RPM;
  private turboBoost = 0;
  private prevThrottle = 0;
  private blowOffTrigger = 0;
  private impactImpulse = 0;

  // Telemetry helpers
  private isDrifting = false;
  private driftAngleDeg = 0;
  private slipIntensity = 0;
  private lastThrottle = 0;
  private lastBrake = 0;
  private lastHandbrake = false;
  private currentSurface: SurfaceType = 'asphalt';

  // Previous state for smooth render interpolation
  private prev: CarTransformSnapshot = {
    x: 0,
    z: 0,
    heading: 0,
    pitch: 0,
    roll: 0,
    steerAngle: 0,
    wheelSpin: 0,
  };

  private readonly interpolated: CarTransformSnapshot = {
    x: 0,
    z: 0,
    heading: 0,
    pitch: 0,
    roll: 0,
    steerAngle: 0,
    wheelSpin: 0,
  };

  private readonly telemetry: CarTelemetry = {
    speedKmh: 0,
    speedMs: 0,
    rpm: IDLE_RPM,
    redlineRpm: 7800,
    gear: 1,
    gearLabel: '1',
    transmissionMode: 'auto',
    throttle: 0,
    brake: 0,
    isBrakingLights: false,
    isReversing: false,
    isHandbrake: false,
    isDrifting: false,
    driftAngleDeg: 0,
    slipIntensity: 0,
    turboBoost: 0,
    blowOffTrigger: 0,
    impactImpulse: 0,
    surface: 'asphalt',
    maxDurability: 100,
    massKg: 1260,
    forwardX: 0,
    forwardZ: 1,
    velocityX: 0,
    velocityZ: 0,
  };

  constructor(
    spawnX = 0,
    spawnZ = 0,
    spawnHeading = 0,
    setup: VehicleSetup = createDefaultVehicleSetup('street_coupe'),
  ) {
    this.derived = computeDerivedPhysics(setup);
    this.reset(spawnX, spawnZ, spawnHeading);
  }

  public applySetup(setup: VehicleSetup): void {
    this.derived = computeDerivedPhysics(setup);
    this.telemetry.redlineRpm = this.derived.redlineRpm;
    this.telemetry.maxDurability = this.derived.durability;
    this.telemetry.massKg = Math.round(this.derived.massKg);
  }

  public getPosition(): { x: number; z: number } {
    return { x: this.x, z: this.z };
  }

  public applyExternalImpulse(dvx: number, dvz: number, pushX = 0, pushZ = 0): void {
    const massFactor = 1350 / Math.max(900, this.derived.massKg);
    this.x += pushX;
    this.z += pushZ;
    this.vx += dvx * massFactor;
    this.vz += dvz * massFactor;
    const mag = Math.hypot(dvx, dvz);
    this.impactImpulse = Math.max(this.impactImpulse, clamp(mag / 20, 0, 1));
  }

  public reset(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.wheelSpin = 0;
    this.pitch = 0;
    this.pitchVel = 0;
    this.roll = 0;
    this.rollVel = 0;
    this.gear = 1;
    this.shiftCooldown = 0;
    this.shiftCutTimer = 0;
    this.rpm = IDLE_RPM;
    this.turboBoost = 0;
    this.blowOffTrigger = 0;
    this.impactImpulse = 0;
    this.isDrifting = false;
    this.driftAngleDeg = 0;
    this.slipIntensity = 0;
    this.currentSurface = 'asphalt';

    this.capturePrev();
    this.syncTelemetry();
  }

  public getTransmissionMode(): TransmissionMode {
    return this.transmissionMode;
  }

  public setTransmissionMode(mode: TransmissionMode): void {
    this.transmissionMode = mode;
    if (mode === 'auto' && this.gear === 0) {
      this.gear = 1;
    }
    this.telemetry.transmissionMode = mode;
  }

  public shiftUp(): boolean {
    if (this.gear >= 5) return false;
    if (this.gear === -1) {
      this.gear = 1;
    } else {
      this.gear += 1;
    }
    this.shiftCooldown = 0.22;
    this.shiftCutTimer = 0.1;
    this.telemetry.gear = this.gear;
    this.telemetry.gearLabel = this.formatGear(this.gear);
    return true;
  }

  public shiftDown(): boolean {
    if (this.gear <= -1) return false;
    const speedMs = Math.hypot(this.vx, this.vz);
    if (this.gear === 1) {
      if (speedMs < 5.5) {
        this.gear = -1;
      } else {
        return false;
      }
    } else {
      this.gear -= 1;
    }
    this.shiftCooldown = 0.22;
    this.shiftCutTimer = 0.08;
    this.telemetry.gear = this.gear;
    this.telemetry.gearLabel = this.formatGear(this.gear);
    return true;
  }

  public step(
    dt: number,
    input: VehicleControlInput,
    weatherMode: WeatherMode,
    surface: SurfaceType,
    colliders: readonly WorldCollider[],
    worldBounds: WorldCollider,
  ): void {
    this.capturePrev();
    this.blowOffTrigger = 0;
    this.impactImpulse = 0;
    this.currentSurface = surface;

    const d = this.derived;
    const { grip: effectiveGrip, extraRollingDrag } = resolveSurfaceGrip(d, weatherMode, surface);

    const throttle = clamp(input.throttle, 0, 1);
    const brake = clamp(input.brake, 0, 1);
    const steerInput = clamp(input.steer, -1, 1);
    const handbrake = input.handbrake;

    this.lastThrottle = throttle;
    this.lastBrake = brake;
    this.lastHandbrake = handbrake;

    if (this.shiftCooldown > 0) this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    if (this.shiftCutTimer > 0) this.shiftCutTimer = Math.max(0, this.shiftCutTimer - dt);

    const fwdX = Math.sin(this.heading);
    const fwdZ = Math.cos(this.heading);
    const leftX = Math.cos(this.heading);
    const leftZ = -Math.sin(this.heading);

    // Local velocities
    let vLong = this.vx * fwdX + this.vz * fwdZ;
    let vLat = this.vx * leftX + this.vz * leftZ;
    const absSpeed = Math.hypot(vLong, vLat);

    // Automatic transmission & intuitive reverse handling
    let effectiveThrottle = throttle;
    let effectiveBrake = brake;

    if (this.transmissionMode === 'auto') {
      if (brake > 0.1 && vLong <= 0.8 && throttle < 0.05) {
        this.gear = -1;
        effectiveThrottle = brake;
        effectiveBrake = 0;
      } else if (this.gear === -1 && throttle > 0.1 && vLong >= -1.2) {
        this.gear = 1;
      } else if (this.gear === -1 && brake > 0.05 && vLong < -0.2) {
        effectiveThrottle = brake;
        effectiveBrake = throttle;
      } else if (this.gear === -1 && throttle > 0.1 && vLong < -1.2) {
        effectiveThrottle = 0;
        effectiveBrake = throttle;
      }

      if (this.gear >= 1 && this.shiftCooldown <= 0) {
        const wheelRpm = (Math.max(0, vLong) / (2 * Math.PI * d.wheelRadius)) * 60;
        const ratio = GEAR_RATIOS[this.gear + 1] * d.finalDrive;
        const drivenRpm = wheelRpm * ratio;

        const upshiftRpm = d.redlineRpm * 0.915;
        const downshiftRpm = d.redlineRpm * 0.36;

        if (this.gear < 5 && drivenRpm > upshiftRpm && effectiveThrottle > 0.25) {
          this.gear += 1;
          this.shiftCooldown = 0.34;
          this.shiftCutTimer = 0.11;
        } else if (this.gear > 1 && drivenRpm < downshiftRpm) {
          this.gear -= 1;
          this.shiftCooldown = 0.32;
          this.shiftCutTimer = 0.06;
        }
      }
    } else if (this.gear === -1) {
      effectiveThrottle = throttle;
      effectiveBrake = brake;
    }

    // Speed-sensitive steering limit + suspension-driven responsiveness
    const maxSteer = lerp(0.56, 0.17, clamp(absSpeed / 70, 0, 1));
    const targetSteer = steerInput * maxSteer;
    const steerRate =
      Math.abs(targetSteer) > Math.abs(this.steerAngle)
        ? d.steerResponsiveness
        : d.steerResponsiveness * 1.32;
    this.steerAngle = lerp(this.steerAngle, targetSteer, clamp(steerRate * dt, 0, 1));

    // Engine RPM & torque calculation
    const gearRatio = GEAR_RATIOS[this.gear + 1] ?? 0;
    const totalRatio = Math.abs(gearRatio) * d.finalDrive;
    const signedWheelSpeed = this.gear === -1 ? Math.max(0, -vLong) : Math.max(0, vLong);
    const wheelRpm = (signedWheelSpeed / (2 * Math.PI * d.wheelRadius)) * 60;
    const coupledRpm = wheelRpm * totalRatio;

    const freeRevTarget = IDLE_RPM + effectiveThrottle * (d.redlineRpm - IDLE_RPM) * 0.78;
    const clutchBlend = clamp(absSpeed / 3.5, 0, 1);
    const targetRpm =
      this.gear === 0
        ? freeRevTarget
        : lerp(Math.max(freeRevTarget * 0.72, coupledRpm), coupledRpm, clutchBlend);

    const rpmResponsiveness = targetRpm > this.rpm ? 10.5 : 6.2;
    this.rpm = clamp(
      lerp(this.rpm, Math.max(IDLE_RPM, targetRpm), clamp(rpmResponsiveness * dt, 0, 1)),
      IDLE_RPM,
      d.revLimitRpm,
    );

    // Turbo boost & blow-off valve whistle trigger
    const boostThresholdRpm = d.redlineRpm * 0.4;
    const boostDemand =
      effectiveThrottle > 0.45 && this.rpm > boostThresholdRpm && this.shiftCutTimer <= 0
        ? clamp(
            ((this.rpm - boostThresholdRpm) / (d.redlineRpm - boostThresholdRpm)) *
              effectiveThrottle,
            0,
            1,
          )
        : 0;
    if (boostDemand > this.turboBoost) {
      this.turboBoost = lerp(this.turboBoost, boostDemand, clamp(3.6 * dt, 0, 1));
    } else {
      const liftedThrottle =
        this.prevThrottle - effectiveThrottle > 0.35 || this.shiftCutTimer > 0.08;
      if (liftedThrottle && this.turboBoost > 0.42) {
        this.blowOffTrigger = clamp(this.turboBoost, 0.4, 1);
        this.turboBoost *= 0.25;
      } else {
        this.turboBoost = lerp(this.turboBoost, 0, clamp(5.2 * dt, 0, 1));
      }
    }
    this.prevThrottle = effectiveThrottle;

    // Longitudinal forces (real mass from class + armor directly scales acceleration!)
    const revLimiterCut = this.rpm >= d.redlineRpm + 160 ? 0.12 : 1;
    const shiftCut = this.shiftCutTimer > 0 ? 0.15 : 1;
    const turboBonus = 1 + this.turboBoost * 0.16;
    const engineTorque =
      d.maxTorqueNm *
      engineTorqueCurve(this.rpm, d.redlineRpm) *
      effectiveThrottle *
      turboBonus *
      revLimiterCut *
      shiftCut;

    let driveForce = (engineTorque * totalRatio) / d.wheelRadius;
    if (this.gear === -1) {
      driveForce = -driveForce * 0.72;
    } else if (this.gear === 0) {
      driveForce = 0;
    }

    const maxDriveTraction = d.massKg * 9.81 * 1.18 * effectiveGrip;
    driveForce = clamp(driveForce, -maxDriveTraction, maxDriveTraction);

    let brakeForce = 0;
    const maxBrakeDecel = 19.5 * effectiveGrip;
    if (effectiveBrake > 0.01) {
      if (Math.abs(vLong) > 0.25) {
        brakeForce = -Math.sign(vLong) * d.massKg * maxBrakeDecel * effectiveBrake;
      } else {
        vLong = 0;
      }
    }
    if (handbrake && Math.abs(vLong) > 0.4) {
      brakeForce += -Math.sign(vLong) * d.massKg * 5.2 * effectiveGrip;
    }

    // Aero drag + asphalt/offroad rolling resistance (offroad tires lose virtually no speed on sand!)
    const aeroDrag = -d.aeroDragCoeff * vLong * Math.abs(vLong);
    const rollingDrag = -(16 + extraRollingDrag) * vLong;
    const totalLongForce = driveForce + brakeForce + aeroDrag + rollingDrag;
    const aLong = totalLongForce / d.massKg;

    // Lateral forces (tire grip + class balance + suspension stiffness)
    const grip = clamp(effectiveGrip, 0.45, 1.38);
    const rearGripFactor = handbrake ? 0.34 : d.rearDriftBias;
    const frontCorneringStiffness = d.frontStiffness * grip;
    const rearCorneringStiffness = d.rearStiffness * grip * (handbrake ? 0.36 : 1);
    const maxFrontLat = 11.4 * grip * d.massKg;
    const maxRearLat = 11.8 * grip * rearGripFactor * d.massKg;

    let aLat = 0;
    let yawAccel = 0;

    if (absSpeed > 0.45) {
      const speedRef = Math.max(Math.abs(vLong), 3.0);
      const forwardSign = vLong >= -0.2 ? 1 : -1;

      const alphaFront =
        this.steerAngle * forwardSign - Math.atan2(vLat + this.yawRate * LF, speedRef);
      const alphaRear = -Math.atan2(vLat - this.yawRate * LR, speedRef);

      const fFrontLat =
        Math.tanh(alphaFront * (frontCorneringStiffness / 3.4)) * maxFrontLat;
      const fRearLat =
        Math.tanh(alphaRear * (rearCorneringStiffness / 3.2)) * maxRearLat;

      aLat = (fFrontLat + fRearLat) / d.massKg;

      const driftKick =
        handbrake && vLong > 6
          ? this.steerAngle * clamp(vLong / 22, 0.2, 1.15) * (d.massKg * 3.15)
          : 0;

      const yawDamp = -this.yawRate * (handbrake ? d.massKg * 0.82 : d.massKg * 1.52);
      yawAccel = (fFrontLat * LF - fRearLat * LR + driftKick + yawDamp) / d.inertiaY;
    } else {
      vLat *= 0.82;
      this.yawRate *= 0.78;
    }

    const nextVLong = vLong + (aLong + vLat * this.yawRate) * dt;
    const nextVLat = vLat + (aLat - vLong * this.yawRate) * dt;

    if (Math.abs(nextVLong) < 0.08 && effectiveThrottle < 0.05 && Math.abs(nextVLat) < 0.08) {
      vLong = 0;
      vLat = 0;
      this.yawRate = 0;
    } else {
      vLong = nextVLong;
      vLat = nextVLat * (absSpeed < 3.5 ? 0.92 : 0.994);
      this.yawRate = clamp(this.yawRate + yawAccel * dt, -3.2, 3.2);
    }

    this.heading += this.yawRate * dt;
    const newFwdX = Math.sin(this.heading);
    const newFwdZ = Math.cos(this.heading);
    const newLeftX = Math.cos(this.heading);
    const newLeftZ = -Math.sin(this.heading);

    this.vx = newFwdX * vLong + newLeftX * vLat;
    this.vz = newFwdZ * vLong + newLeftZ * vLat;

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.resolveCollisions(colliders, worldBounds);

    this.wheelSpin += (vLong / d.wheelRadius) * dt;

    // Weight transfer driven directly by suspension stiffness!
    const targetPitch = clamp(-aLong * d.pitchScale, -0.075, 0.095);
    const targetRoll = clamp(aLat * d.rollScale, -0.11, 0.11);

    this.pitchVel +=
      ((targetPitch - this.pitch) * d.pitchSpring - this.pitchVel * d.pitchDamp) * dt;
    this.pitch += this.pitchVel * dt;

    this.rollVel +=
      ((targetRoll - this.roll) * d.rollSpring - this.rollVel * d.rollDamp) * dt;
    this.roll += this.rollVel * dt;

    // Drift detection & tire slip telemetry
    const speedAfter = Math.hypot(this.vx, this.vz);
    const slipAngleRad =
      speedAfter > 5.5 ? Math.abs(Math.atan2(vLat, Math.max(Math.abs(vLong), 1))) : 0;
    this.driftAngleDeg = (slipAngleRad * 180) / Math.PI;
    this.isDrifting = speedAfter > 8.5 && this.driftAngleDeg > 11.5;

    const driftSlip = clamp((this.driftAngleDeg - 8) / 30, 0, 1);
    const brakeSlip =
      effectiveBrake > 0.65 && speedAfter > 10 ? clamp((effectiveBrake - 0.5) * 0.7, 0, 0.5) : 0;
    const handbrakeSlip = handbrake && speedAfter > 6 ? 0.65 : 0;
    const targetSlip = clamp(Math.max(driftSlip, brakeSlip, handbrakeSlip), 0, 1);
    this.slipIntensity = lerp(this.slipIntensity, targetSlip, clamp(10 * dt, 0, 1));

    this.syncTelemetry();
  }

  private resolveCollisions(
    colliders: readonly WorldCollider[],
    bounds: WorldCollider,
  ): void {
    const r = this.derived.collisionRadius;
    const minX = bounds.minX + r;
    const maxX = bounds.maxX - r;
    const minZ = bounds.minZ + r;
    const maxZ = bounds.maxZ - r;

    if (this.x < minX) {
      this.x = minX;
      this.applyWallBounce(1, 0);
    } else if (this.x > maxX) {
      this.x = maxX;
      this.applyWallBounce(-1, 0);
    }

    if (this.z < minZ) {
      this.z = minZ;
      this.applyWallBounce(0, 1);
    } else if (this.z > maxZ) {
      this.z = maxZ;
      this.applyWallBounce(0, -1);
    }

    for (let i = 0; i < colliders.length; i++) {
      const box = colliders[i];
      const closestX = clamp(this.x, box.minX, box.maxX);
      const closestZ = clamp(this.z, box.minZ, box.maxZ);
      const dx = this.x - closestX;
      const dz = this.z - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < r * r) {
        if (distSq > 0.00001) {
          const dist = Math.sqrt(distSq);
          const nx = dx / dist;
          const nz = dz / dist;
          const pen = r - dist;
          this.x += nx * pen;
          this.z += nz * pen;
          this.applyWallBounce(nx, nz);
        } else {
          const dLeft = Math.abs(this.x - box.minX);
          const dRight = Math.abs(box.maxX - this.x);
          const dTop = Math.abs(this.z - box.minZ);
          const dBottom = Math.abs(box.maxZ - this.z);
          const m = Math.min(dLeft, dRight, dTop, dBottom);
          if (m === dLeft) {
            this.x = box.minX - r;
            this.applyWallBounce(-1, 0);
          } else if (m === dRight) {
            this.x = box.maxX + r;
            this.applyWallBounce(1, 0);
          } else if (m === dTop) {
            this.z = box.minZ - r;
            this.applyWallBounce(0, -1);
          } else {
            this.z = box.maxZ + r;
            this.applyWallBounce(0, 1);
          }
        }
      }
    }
  }

  private applyWallBounce(nx: number, nz: number): void {
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) {
      const impact = clamp(-vn / 24, 0, 1);
      if (impact > this.impactImpulse) this.impactImpulse = impact;
      const restitution = 0.2;
      this.vx -= (1 + restitution) * vn * nx;
      this.vz -= (1 + restitution) * vn * nz;
      const damp = this.derived.impactDamping;
      this.vx *= damp;
      this.vz *= damp;
      this.yawRate *= 0.55;
    }
  }

  private capturePrev(): void {
    this.prev.x = this.x;
    this.prev.z = this.z;
    this.prev.heading = this.heading;
    this.prev.pitch = this.pitch;
    this.prev.roll = this.roll;
    this.prev.steerAngle = this.steerAngle;
    this.prev.wheelSpin = this.wheelSpin;
  }

  private formatGear(gear: number): string {
    if (gear === -1) return 'R';
    if (gear === 0) return 'N';
    return String(gear);
  }

  private syncTelemetry(): void {
    const speedMs = Math.hypot(this.vx, this.vz);
    const t = this.telemetry;
    t.speedMs = speedMs;
    t.speedKmh = speedMs * 3.6;
    t.rpm = this.rpm;
    t.redlineRpm = this.derived.redlineRpm;
    t.gear = this.gear;
    t.gearLabel = this.formatGear(this.gear);
    t.transmissionMode = this.transmissionMode;
    t.throttle = this.lastThrottle;
    t.brake = this.lastBrake;
    t.isReversing = this.gear === -1 && speedMs > 0.3;
    t.isHandbrake = this.lastHandbrake;
    t.isBrakingLights =
      this.lastHandbrake || (this.lastBrake > 0.08 && !t.isReversing);
    t.isDrifting = this.isDrifting;
    t.driftAngleDeg = this.driftAngleDeg;
    t.slipIntensity = this.slipIntensity;
    t.turboBoost = this.turboBoost;
    t.blowOffTrigger = this.blowOffTrigger;
    t.impactImpulse = this.impactImpulse;
    t.surface = this.currentSurface;
    t.maxDurability = this.derived.durability;
    t.massKg = Math.round(this.derived.massKg);
    t.forwardX = Math.sin(this.heading);
    t.forwardZ = Math.cos(this.heading);
    t.velocityX = this.vx;
    t.velocityZ = this.vz;
  }

  public getInterpolatedTransform(alpha: number): CarTransformSnapshot {
    const t = clamp(alpha, 0, 1);
    const out = this.interpolated;
    out.x = lerp(this.prev.x, this.x, t);
    out.z = lerp(this.prev.z, this.z, t);
    out.heading = lerpAngle(this.prev.heading, this.heading, t);
    out.pitch = lerp(this.prev.pitch, this.pitch, t);
    out.roll = lerp(this.prev.roll, this.roll, t);
    out.steerAngle = lerp(this.prev.steerAngle, this.steerAngle, t);
    out.wheelSpin = lerp(this.prev.wheelSpin, this.wheelSpin, t);
    return out;
  }

  public getTelemetry(): Readonly<CarTelemetry> {
    return this.telemetry;
  }
}
