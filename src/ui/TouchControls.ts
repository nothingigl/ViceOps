import { InputManager } from '../engine/InputManager';
import type { TransmissionMode } from '../vehicle/CarPhysics';

export type TouchVisibilityMode = 'auto' | 'on' | 'off';

export interface TouchControlsCallbacks {
  onShiftUp: () => void;
  onShiftDown: () => void;
  onAnyTouch?: () => void;
}

export class TouchControls {
  private readonly root: HTMLDivElement;
  private readonly steerCluster: HTMLDivElement;
  private readonly gyroBadge: HTMLDivElement;
  private readonly gearRow: HTMLDivElement;
  private readonly input: InputManager;
  private readonly callbacks: TouchControlsCallbacks;

  private visibilityMode: TouchVisibilityMode = 'auto';
  private isTouchDevice: boolean;
  private isPaused = false;
  private active = false;

  constructor(
    container: HTMLElement,
    input: InputManager,
    callbacks: TouchControlsCallbacks,
  ) {
    this.input = input;
    this.callbacks = callbacks;
    this.isTouchDevice = InputManager.isTouchDevice();

    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.setAttribute('aria-label', 'Сенсорное управление');

    // Left zone: steering pads + gyroscope status pill
    const leftZone = document.createElement('div');
    leftZone.className = 'touch-zone touch-zone--left';

    this.steerCluster = document.createElement('div');
    this.steerCluster.className = 'touch-steer-cluster';

    const leftBtn = this.createHoldButton('◀', 'Влево', 'touch-btn touch-btn--steer', (pressed) => {
      this.input.setTouchValue('steerLeft', pressed ? 1 : 0);
    });
    const rightBtn = this.createHoldButton(
      '▶',
      'Вправо',
      'touch-btn touch-btn--steer',
      (pressed) => {
        this.input.setTouchValue('steerRight', pressed ? 1 : 0);
      },
    );
    this.steerCluster.append(leftBtn, rightBtn);

    this.gyroBadge = document.createElement('div');
    this.gyroBadge.className = 'touch-gyro-badge';
    this.gyroBadge.textContent = 'ГИРОСКОП АКТИВЕН';
    this.gyroBadge.hidden = true;

    leftZone.append(this.steerCluster, this.gyroBadge);

    // Right zone: optional manual gear row + drift/brake/gas pedals
    const rightZone = document.createElement('div');
    rightZone.className = 'touch-zone touch-zone--right';

    this.gearRow = document.createElement('div');
    this.gearRow.className = 'touch-gear-row';
    this.gearRow.hidden = true;

    const shiftDownBtn = this.createTapButton('КПП −', 'Понизить передачу', () => {
      this.callbacks.onShiftDown();
    });
    const shiftUpBtn = this.createTapButton('КПП +', 'Повысить передачу', () => {
      this.callbacks.onShiftUp();
    });
    this.gearRow.append(shiftDownBtn, shiftUpBtn);

    const pedalCluster = document.createElement('div');
    pedalCluster.className = 'touch-pedal-cluster';

    const driftBtn = this.createHoldButton(
      'ДРИФТ',
      'Ручной тормоз',
      'touch-btn touch-btn--drift',
      (pressed) => {
        this.input.setTouchValue('handbrake', pressed);
      },
    );
    const brakeBtn = this.createHoldButton(
      'ТОРМОЗ',
      'Тормоз / Задний ход',
      'touch-btn touch-btn--brake',
      (pressed) => {
        this.input.setTouchValue('brake', pressed ? 1 : 0);
      },
    );
    const gasBtn = this.createHoldButton(
      'ГАЗ',
      'Ускорение',
      'touch-btn touch-btn--gas',
      (pressed) => {
        this.input.setTouchValue('throttle', pressed ? 1 : 0);
      },
    );

    pedalCluster.append(driftBtn, brakeBtn, gasBtn);
    rightZone.append(this.gearRow, pedalCluster);

    this.root.append(leftZone, rightZone);
    container.appendChild(this.root);

    this.updateVisibility();
  }

  private createHoldButton(
    label: string,
    ariaLabel: string,
    className: string,
    onChange: (pressed: boolean) => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.setAttribute('aria-label', ariaLabel);

    const activePointers = new Set<number>();

    const setPressed = () => {
      const pressed = activePointers.size > 0;
      btn.classList.toggle('is-pressed', pressed);
      onChange(pressed);
    };

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.callbacks.onAnyTouch?.();
      activePointers.add(e.pointerId);
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture is unsupported
      }
      setPressed();
    });

    const release = (e: PointerEvent) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.delete(e.pointerId);
      setPressed();
    };

    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());

    return btn;
  }

  private createTapButton(
    label: string,
    ariaLabel: string,
    onTap: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'touch-btn touch-btn--gear';
    btn.textContent = label;
    btn.setAttribute('aria-label', ariaLabel);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.callbacks.onAnyTouch?.();
      btn.classList.add('is-pressed');
      onTap();
    });
    const clear = () => btn.classList.remove('is-pressed');
    btn.addEventListener('pointerup', clear);
    btn.addEventListener('pointercancel', clear);
    return btn;
  }

  public getVisibilityMode(): TouchVisibilityMode {
    return this.visibilityMode;
  }

  public isVisible(): boolean {
    return this.active;
  }

  public setVisibilityMode(mode: TouchVisibilityMode): void {
    this.visibilityMode = mode;
    this.updateVisibility();
  }

  public setGyroActive(active: boolean): void {
    this.steerCluster.hidden = active;
    this.gyroBadge.hidden = !active;
  }

  public setTransmissionMode(mode: TransmissionMode): void {
    this.gearRow.hidden = mode !== 'manual';
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
    this.updateVisibility();
  }

  private updateVisibility(): void {
    const shouldShow =
      !this.isPaused &&
      (this.visibilityMode === 'on' || (this.visibilityMode === 'auto' && this.isTouchDevice));
    this.active = shouldShow;
    this.root.classList.toggle('is-visible', shouldShow);
  }

  public dispose(): void {
    this.root.remove();
  }
}
