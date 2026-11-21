import type { VehicleControlInput } from '../vehicle/CarPhysics';

export interface InputActionCallbacks {
  onToggleCamera?: () => void;
  onShiftUp?: () => void;
  onShiftDown?: () => void;
  onTogglePause?: () => void;
  onToggleMute?: () => void;
  onTriggerGadget?: (slotIndex: 0 | 1) => void;
  onFirstInteraction?: () => void;
}

export interface TouchInputState {
  throttle: number;
  brake: number;
  steerLeft: number;
  steerRight: number;
  handbrake: boolean;
}

export type GyroStatus = 'off' | 'active' | 'unsupported' | 'denied';

interface DeviceOrientationEventWithPermission extends DeviceOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export class InputManager {
  private readonly keys = new Set<string>();
  private readonly callbacks: InputActionCallbacks;
  private readonly touch: TouchInputState = {
    throttle: 0,
    brake: 0,
    steerLeft: 0,
    steerRight: 0,
    handbrake: false,
  };

  private readonly controlOutput: VehicleControlInput = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
  };

  private gyroEnabled = false;
  private gyroSteer = 0;
  private gyroStatus: GyroStatus = 'off';
  private hasInteracted = false;

  private readonly onKeyDownBound: (e: KeyboardEvent) => void;
  private readonly onKeyUpBound: (e: KeyboardEvent) => void;
  private readonly onBlurBound: () => void;
  private readonly onPointerDownBound: () => void;
  private readonly onDeviceOrientationBound: (e: DeviceOrientationEvent) => void;

  constructor(callbacks: InputActionCallbacks = {}) {
    this.callbacks = callbacks;

    this.onKeyDownBound = (e) => this.handleKeyDown(e);
    this.onKeyUpBound = (e) => this.handleKeyUp(e);
    this.onBlurBound = () => this.clearAllInputs();
    this.onPointerDownBound = () => this.notifyFirstInteraction();
    this.onDeviceOrientationBound = (e) => this.handleDeviceOrientation(e);

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('blur', this.onBlurBound);
    window.addEventListener('pointerdown', this.onPointerDownBound, { passive: true });
    window.addEventListener('touchstart', this.onPointerDownBound, { passive: true });
  }

  public static isTouchDevice(): boolean {
    if (typeof window === 'undefined') return false;
    return (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches
    );
  }

  public getGyroStatus(): GyroStatus {
    return this.gyroStatus;
  }

  public isGyroEnabled(): boolean {
    return this.gyroEnabled;
  }

  public async setGyroEnabled(enabled: boolean): Promise<GyroStatus> {
    if (!enabled) {
      this.gyroEnabled = false;
      this.gyroSteer = 0;
      this.gyroStatus = 'off';
      window.removeEventListener('deviceorientation', this.onDeviceOrientationBound);
      return this.gyroStatus;
    }

    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      this.gyroEnabled = false;
      this.gyroStatus = 'unsupported';
      return this.gyroStatus;
    }

    const DOE = window.DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission;
    if (typeof DOE.requestPermission === 'function') {
      try {
        const result = await DOE.requestPermission();
        if (result !== 'granted') {
          this.gyroEnabled = false;
          this.gyroStatus = 'denied';
          return this.gyroStatus;
        }
      } catch {
        this.gyroEnabled = false;
        this.gyroStatus = 'denied';
        return this.gyroStatus;
      }
    }

    this.gyroEnabled = true;
    this.gyroStatus = 'active';
    window.addEventListener('deviceorientation', this.onDeviceOrientationBound, { passive: true });
    return this.gyroStatus;
  }

  public setTouchValue<K extends keyof TouchInputState>(key: K, value: TouchInputState[K]): void {
    this.touch[key] = value;
  }

  public clearAllInputs(): void {
    this.keys.clear();
    this.touch.throttle = 0;
    this.touch.brake = 0;
    this.touch.steerLeft = 0;
    this.touch.steerRight = 0;
    this.touch.handbrake = false;
    this.gyroSteer = 0;
  }

  public sample(): Readonly<VehicleControlInput> {
    const keyThrottle = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
    const keyBrake = this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0;
    const keyLeft = this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0;
    const keyRight = this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0;
    const keyHandbrake = this.keys.has('Space');

    const throttle = Math.max(keyThrottle, this.touch.throttle);
    const brake = Math.max(keyBrake, this.touch.brake);
    const keySteer = keyLeft - keyRight;
    const touchSteer = this.touch.steerLeft - this.touch.steerRight;

    // Priority: keyboard -> touch buttons -> gyroscope tilt
    let steer = 0;
    if (keySteer !== 0) {
      steer = keySteer;
    } else if (touchSteer !== 0) {
      steer = touchSteer;
    } else if (this.gyroEnabled) {
      steer = this.gyroSteer;
    }

    this.controlOutput.throttle = throttle;
    this.controlOutput.brake = brake;
    this.controlOutput.steer = Math.max(-1, Math.min(1, steer));
    this.controlOutput.handbrake = keyHandbrake || this.touch.handbrake;
    return this.controlOutput;
  }

  private notifyFirstInteraction(): void {
    if (this.hasInteracted) return;
    this.hasInteracted = true;
    this.callbacks.onFirstInteraction?.();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    this.notifyFirstInteraction();

    if (
      e.code === 'Space' ||
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    if (!e.repeat) {
      if (e.code === 'KeyC') {
        this.callbacks.onToggleCamera?.();
      } else if (e.code === 'KeyE') {
        this.callbacks.onShiftUp?.();
      } else if (e.code === 'KeyQ') {
        this.callbacks.onShiftDown?.();
      } else if (e.code === 'Escape' || e.code === 'KeyP') {
        this.callbacks.onTogglePause?.();
      } else if (e.code === 'KeyM') {
        this.callbacks.onToggleMute?.();
      } else if (e.code === 'Digit1' || e.code === 'Numpad1') {
        this.callbacks.onTriggerGadget?.(0);
      } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
        this.callbacks.onTriggerGadget?.(1);
      }
    }

    this.keys.add(e.code);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
  }

  private handleDeviceOrientation(e: DeviceOrientationEvent): void {
    if (!this.gyroEnabled) return;

    const screenAngle =
      typeof window.screen?.orientation?.angle === 'number'
        ? window.screen.orientation.angle
        : 0;

    // Adapt tilt axis cleanly between landscape and portrait orientations
    let tiltDeg = 0;
    if (screenAngle === 90) {
      tiltDeg = -(e.beta ?? 0);
    } else if (screenAngle === 270 || screenAngle === -90) {
      tiltDeg = e.beta ?? 0;
    } else {
      tiltDeg = -(e.gamma ?? 0);
    }

    // Apply small deadzone (3 deg) and saturate smoothly around 28 deg
    const deadzone = 3;
    const maxTilt = 28;
    const absTilt = Math.abs(tiltDeg);
    if (absTilt < deadzone) {
      this.gyroSteer = 0;
    } else {
      const normalized = Math.min(1, (absTilt - deadzone) / (maxTilt - deadzone));
      this.gyroSteer = Math.sign(tiltDeg) * normalized;
    }
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    window.removeEventListener('blur', this.onBlurBound);
    window.removeEventListener('pointerdown', this.onPointerDownBound);
    window.removeEventListener('touchstart', this.onPointerDownBound);
    window.removeEventListener('deviceorientation', this.onDeviceOrientationBound);
  }
}
