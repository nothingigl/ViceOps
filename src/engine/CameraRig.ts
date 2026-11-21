import * as THREE from 'three';
import type { CarMesh } from '../vehicle/CarMesh';
import type { CarTelemetry, CarTransformSnapshot } from '../vehicle/CarPhysics';

export type CameraMode = 'chase' | 'hood';

export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'От 3-го лица',
  hood: 'С капота',
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export class CameraRig {
  public readonly camera: THREE.PerspectiveCamera;
  private mode: CameraMode = 'chase';

  private smoothYaw = Math.PI;
  private shakeStrength = 0;
  private currentFov = 62;

  // Pre-allocated vectors to keep zero GC allocations in the render loop
  private readonly desiredPos = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly hoodWorldPos = new THREE.Vector3();
  private readonly smoothPos = new THREE.Vector3();
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.25, 1900);
  }

  public getMode(): CameraMode {
    return this.mode;
  }

  public setMode(mode: CameraMode): void {
    this.mode = mode;
    this.initialized = false;
  }

  public toggleMode(): CameraMode {
    this.setMode(this.mode === 'chase' ? 'hood' : 'chase');
    return this.mode;
  }

  public resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  public snapToCar(transform: CarTransformSnapshot): void {
    this.smoothYaw = transform.heading;
    const fwdX = Math.sin(transform.heading);
    const fwdZ = Math.cos(transform.heading);
    this.smoothPos.set(transform.x - fwdX * 7.8, 3.05, transform.z - fwdZ * 7.8);
    this.camera.position.copy(this.smoothPos);
    this.lookTarget.set(transform.x + fwdX * 8, 1.25, transform.z + fwdZ * 8);
    this.camera.lookAt(this.lookTarget);
    this.initialized = true;
  }

  public update(
    dt: number,
    transform: CarTransformSnapshot,
    telemetry: Readonly<CarTelemetry>,
    carMesh: CarMesh,
  ): void {
    const speedRatio = clamp(telemetry.speedKmh / 250, 0, 1);

    // Impact shake decay
    if (telemetry.impactImpulse > 0.12) {
      this.shakeStrength = Math.max(this.shakeStrength, telemetry.impactImpulse * 0.45);
    }
    this.shakeStrength = Math.max(0, this.shakeStrength - dt * 2.2);

    const shakeX = (Math.random() - 0.5) * this.shakeStrength;
    const shakeY = (Math.random() - 0.5) * this.shakeStrength * 0.7;

    // Dynamic FOV widens smoothly at high speed for visceral highway feel
    const targetFov =
      this.mode === 'chase' ? 60 + speedRatio * 22 : 66 + speedRatio * 18;
    this.currentFov += (targetFov - this.currentFov) * clamp(dt * 6.5, 0, 1);
    if (Math.abs(this.camera.fov - this.currentFov) > 0.02) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    if (this.mode === 'hood') {
      carMesh.root.updateMatrixWorld(true);
      carMesh.hoodAnchor.getWorldPosition(this.hoodWorldPos);
      this.camera.position.set(
        this.hoodWorldPos.x + shakeX * 0.4,
        this.hoodWorldPos.y + shakeY * 0.4,
        this.hoodWorldPos.z,
      );

      const fwdX = Math.sin(transform.heading);
      const fwdZ = Math.cos(transform.heading);
      const pitchOffset = -transform.pitch * 9.5;
      this.lookTarget.set(
        this.hoodWorldPos.x + fwdX * 32,
        this.hoodWorldPos.y - 0.4 + pitchOffset,
        this.hoodWorldPos.z + fwdZ * 32,
      );
      this.camera.lookAt(this.lookTarget);
      return;
    }

    // Chase camera: gently blends between car heading and velocity direction so drifts look epic
    let followHeading = transform.heading;
    if (telemetry.speedMs > 8 && !telemetry.isReversing) {
      const velHeading = Math.atan2(telemetry.velocityX, telemetry.velocityZ);
      followHeading = lerpAngle(transform.heading, velHeading, 0.36);
    }

    const yawFollowRate = telemetry.isDrifting ? 4.4 : 6.4;
    this.smoothYaw = lerpAngle(this.smoothYaw, followHeading, clamp(dt * yawFollowRate, 0, 1));

    const camFwdX = Math.sin(this.smoothYaw);
    const camFwdZ = Math.cos(this.smoothYaw);

    const distance = 7.4 + speedRatio * 1.45;
    const height = 2.85 + speedRatio * 0.32;

    this.desiredPos.set(
      transform.x - camFwdX * distance,
      height,
      transform.z - camFwdZ * distance,
    );

    if (!this.initialized) {
      this.smoothPos.copy(this.desiredPos);
      this.initialized = true;
    } else {
      const posAlpha = 1 - Math.exp(-10.5 * dt);
      this.smoothPos.lerp(this.desiredPos, posAlpha);
    }

    this.camera.position.set(
      this.smoothPos.x + shakeX,
      this.smoothPos.y + shakeY,
      this.smoothPos.z,
    );

    const lookAhead = 7.5 + speedRatio * 5.0;
    this.lookTarget.set(
      transform.x + Math.sin(transform.heading) * lookAhead,
      1.22,
      transform.z + Math.cos(transform.heading) * lookAhead,
    );
    this.camera.lookAt(this.lookTarget);
  }
}
