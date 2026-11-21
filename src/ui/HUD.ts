import { CAMERA_LABELS, type CameraMode } from '../engine/CameraRig';
import type { GyroStatus } from '../engine/InputManager';
import type { ContractSnapshot } from '../tactics/ContractEngine';
import type { GraphicsQuality, VehicleSetup, WeatherMode } from '../types';
import type { CarTelemetry, TransmissionMode } from '../vehicle/CarPhysics';
import type { GadgetSlotSnapshot, SmokeZone } from '../vehicle/Gadgets';
import { TIRE_LABELS, VEHICLE_CLASS_SPECS } from '../vehicle/VehicleSpecs';
import type { RadarPoint } from '../world/TrafficAndPolice';
import { WEATHER_LABELS } from '../world/WeatherSystem';
import type { TouchVisibilityMode } from './TouchControls';

export interface HUDCallbacks {
  onWeatherChange: (mode: WeatherMode) => void;
  onCameraToggle: () => void;
  onCameraSelect: (mode: CameraMode) => void;
  onMuteToggle: () => void;
  onPauseToggle: () => void;
  onTransmissionToggle: (mode: TransmissionMode) => void;
  onGyroToggle: (enabled: boolean) => void;
  onTouchVisibilityChange: (mode: TouchVisibilityMode) => void;
  onGraphicsQualityChange: (quality: GraphicsQuality) => void;
  onResetCar: () => void;
  onOpenGarage: () => void;
  onOpenTacticalMap: () => void;
  onOpenMenu: () => void;
  onRetryContract: () => void;
  onShareDailyResult: () => void;
  onTriggerGadget: (slotIndex: 0 | 1) => void;
  onAudioUnlockPrompt: () => void;
}

export interface MinimapInput {
  playerX: number;
  playerZ: number;
  playerHeading: number;
  waypoint: { x: number; z: number; kind: 'target' | 'extract' } | null;
  patrols: readonly RadarPoint[];
  roadblocks: readonly RadarPoint[];
  smokes: readonly SmokeZone[];
  clockSec: number;
}

const GYRO_STATUS_TEXT: Record<GyroStatus, string> = {
  off: 'Отключён',
  active: 'Активен (наклоняйте устройство)',
  unsupported: 'Датчик не поддерживается',
  denied: 'Доступ запрещён браузером',
};

const ROAD_COORDS = [-320, -160, 0, 160, 320];
const BLOCK_CENTERS = [-240, -80, 80, 240];

function formatTimer(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export class HUD {
  private readonly root: HTMLDivElement;
  private readonly modeTagEl: HTMLSpanElement;
  private readonly speedValueEl: HTMLSpanElement;
  private readonly gearValueEl: HTMLSpanElement;
  private readonly transBadgeEl: HTMLButtonElement;
  private readonly rpmFillEl: HTMLDivElement;
  private readonly rpmTextEl: HTMLSpanElement;
  private readonly driftBannerEl: HTMLDivElement;
  private readonly driftAngleEl: HTMLSpanElement;
  private readonly driftBarFillEl: HTMLDivElement;
  private readonly surfacePillEl: HTMLDivElement;
  private readonly weatherPillEl: HTMLSpanElement;
  private readonly vehiclePillEl: HTMLSpanElement;
  private readonly cameraBtnEl: HTMLButtonElement;
  private readonly muteBtnEl: HTMLButtonElement;
  private readonly audioPromptBtnEl: HTMLButtonElement;
  private readonly toastEl: HTMLDivElement;
  private readonly pauseOverlayEl: HTMLDivElement;
  private readonly telemetryClusterEl: HTMLDivElement;

  // DMZ Contract HUD elements
  private readonly missionPanelEl: HTMLDivElement;
  private readonly missionObjEl: HTMLDivElement;
  private readonly missionSubEl: HTMLDivElement;
  private readonly missionTimerEl: HTMLSpanElement;
  private readonly missionRewardEl: HTMLSpanElement;
  private readonly missionWantedEl: HTMLSpanElement;
  private readonly missionProgressWrapEl: HTMLDivElement;
  private readonly missionProgressFillEl: HTMLDivElement;
  private readonly hpFillEl: HTMLDivElement;
  private readonly hpTextEl: HTMLSpanElement;

  // Minimap & Gadget bar
  private readonly minimapWrapEl: HTMLDivElement;
  private readonly minimapCanvas: HTMLCanvasElement;
  private readonly minimapCtx: CanvasRenderingContext2D;
  private readonly gadgetBarEl: HTMLDivElement;
  private readonly gadgetBtnEls: [HTMLButtonElement, HTMLButtonElement];

  // Mission Result Overlay
  private readonly resultOverlayEl: HTMLDivElement;
  private readonly resultKickerEl: HTMLDivElement;
  private readonly resultTitleEl: HTMLHeadingElement;
  private readonly resultDescEl: HTMLParagraphElement;
  private readonly resultRewardEl: HTMLDivElement;
  private readonly resultRetryBtnEl: HTMLButtonElement;
  private readonly resultShareBtnEl: HTMLButtonElement;

  private readonly weatherButtons = new Map<WeatherMode, HTMLButtonElement>();
  private readonly transButtons = new Map<TransmissionMode, HTMLButtonElement>();
  private readonly cameraButtons = new Map<CameraMode, HTMLButtonElement>();
  private readonly touchModeButtons = new Map<TouchVisibilityMode, HTMLButtonElement>();
  private readonly qualityButtons = new Map<GraphicsQuality, HTMLButtonElement>();
  private readonly gyroToggleBtnEl: HTMLButtonElement;
  private readonly gyroStatusEl: HTMLSpanElement;
  private readonly pauseMuteBtnEl: HTMLButtonElement;

  private toastTimer = 0;

  constructor(container: HTMLElement, callbacks: HUDCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'hud-root';

    this.root.innerHTML = `
      <header class="hud-top">
        <div class="hud-top-left">
          <div class="hud-glass hud-title-card">
            <span class="hud-mode-tag" data-role="mode-tag">СВОБОДНЫЙ КРУИЗ</span>
            <span class="hud-weather-pill" data-role="weather-pill">Ночной неон</span>
            <span class="hud-vehicle-pill" data-role="vehicle-pill">Street Coupe • Слики</span>
          </div>
          <div class="hud-glass hud-hints">
            <span><b>WASD</b> Езда</span>
            <span><b>Пробел</b> Дрифт</span>
            <span><b>1 / 2</b> Гаджеты</span>
            <span><b>C</b> Камера</span>
            <span><b>Q/E</b> КПП</span>
            <span><b>Esc</b> Пауза</span>
          </div>
          <div class="hud-glass hud-mission-panel" data-role="mission-panel" hidden>
            <div class="mission-top-row">
              <span class="mission-timer" data-role="mission-timer">02:00</span>
              <span class="mission-wanted" data-role="mission-wanted">РОЗЫСК: НЕТ</span>
              <span class="mission-reward" data-role="mission-reward">+12 500 ₵</span>
            </div>
            <div class="mission-objective" data-role="mission-obj">Доедьте до зоны цели</div>
            <div class="mission-sub" data-role="mission-sub">Дистанция 320 м</div>
            <div class="mission-progress-track" data-role="mission-progress-wrap" hidden>
              <div class="mission-progress-fill" data-role="mission-progress-fill"></div>
            </div>
            <div class="mission-hp-row">
              <span class="mission-hp-label">ПРОЧНОСТЬ</span>
              <div class="mission-hp-track">
                <div class="mission-hp-fill" data-role="hp-fill"></div>
              </div>
              <span class="mission-hp-text" data-role="hp-text">100 / 100</span>
            </div>
          </div>
        </div>

        <div class="hud-top-right">
          <button type="button" class="hud-glass hud-action-btn hud-audio-prompt" data-role="audio-prompt">
            Включить звук
          </button>
          <button type="button" class="hud-glass hud-action-btn" data-role="camera-btn">
            Камера: От 3-го лица
          </button>
          <button type="button" class="hud-glass hud-action-btn" data-role="mute-btn">
            Звук: Вкл
          </button>
          <button type="button" class="hud-glass hud-action-btn hud-action-btn--accent" data-role="pause-btn">
            Пауза
          </button>
        </div>
      </header>

      <div class="hud-center-stack">
        <div class="hud-drift-banner" data-role="drift-banner">
          <div class="hud-drift-header">
            <span class="hud-drift-label">ДРИФТ</span>
            <span class="hud-drift-angle" data-role="drift-angle">0°</span>
          </div>
          <div class="hud-drift-bar">
            <div class="hud-drift-bar-fill" data-role="drift-bar-fill"></div>
          </div>
        </div>
        <div class="hud-surface-pill" data-role="surface-pill">ОБОЧИНА / ГРУНТ</div>
        <div class="hud-toast" data-role="toast"></div>
      </div>

      <div class="hud-glass hud-minimap" data-role="minimap-wrap">
        <canvas class="hud-minimap-canvas" data-role="minimap-canvas" width="160" height="160"></canvas>
      </div>

      <div class="hud-gadget-bar" data-role="gadget-bar">
        <button type="button" class="hud-glass hud-gadget-btn" data-role="gadget-0">
          <span class="gadget-key">1</span>
          <span class="gadget-btn-icon">⚡</span>
          <span class="gadget-btn-name">ЭМИ</span>
          <span class="gadget-btn-cd">ГОТОВ</span>
        </button>
        <button type="button" class="hud-glass hud-gadget-btn" data-role="gadget-1">
          <span class="gadget-key">2</span>
          <span class="gadget-btn-icon">☁</span>
          <span class="gadget-btn-name">ДЫМ</span>
          <span class="gadget-btn-cd">ГОТОВ</span>
        </button>
      </div>

      <section class="hud-glass hud-telemetry" data-role="telemetry">
        <div class="hud-telemetry-top">
          <div class="hud-speed-block">
            <span class="hud-speed-value" data-role="speed-value">0</span>
            <span class="hud-speed-unit">км/ч</span>
          </div>
          <div class="hud-gear-block">
            <span class="hud-gear-value" data-role="gear-value">1</span>
            <button type="button" class="hud-trans-badge" data-role="trans-badge" title="Переключить АКПП / МКПП">
              АКПП
            </button>
          </div>
        </div>
        <div class="hud-rpm-track">
          <div class="hud-rpm-fill" data-role="rpm-fill"></div>
        </div>
        <div class="hud-rpm-meta">
          <span>ОБ/МИН</span>
          <span data-role="rpm-text">950</span>
        </div>
      </section>

      <div class="pause-overlay" data-role="pause-overlay" aria-hidden="true">
        <div class="hud-glass pause-modal" role="dialog" aria-modal="true" aria-label="Меню паузы">
          <div class="pause-header">
            <div>
              <div class="pause-kicker">VICE OPS: TACTICAL DRIVE</div>
              <h2 class="pause-title">ПАУЗА</h2>
            </div>
            <button type="button" class="pause-close-btn" data-role="pause-close" aria-label="Закрыть меню">
              ✕
            </button>
          </div>

          <div class="pause-section">
            <div class="pause-label">Атмосфера и погода</div>
            <div class="pause-segment-group" data-role="weather-group">
              <button type="button" class="pause-seg-btn" data-weather="sunset">Закат</button>
              <button type="button" class="pause-seg-btn" data-weather="neon_night">Ночной неон</button>
              <button type="button" class="pause-seg-btn" data-weather="rain">Дождь</button>
            </div>
            <div class="pause-hint">В режиме «Дождь» активируются осадки и снижается сцепление шин (кроме «Дождевых»).</div>
          </div>

          <div class="pause-grid">
            <div class="pause-section">
              <div class="pause-label">Коробка передач (5 ступ.)</div>
              <div class="pause-segment-group">
                <button type="button" class="pause-seg-btn" data-trans="auto">Автомат (АКПП)</button>
                <button type="button" class="pause-seg-btn" data-trans="manual">Ручная (Q / E)</button>
              </div>
            </div>

            <div class="pause-section">
              <div class="pause-label">Камера (C)</div>
              <div class="pause-segment-group">
                <button type="button" class="pause-seg-btn" data-cam="chase">От 3-го лица</button>
                <button type="button" class="pause-seg-btn" data-cam="hood">С капота</button>
              </div>
            </div>
          </div>

          <div class="pause-grid">
            <div class="pause-section">
              <div class="pause-label">Руление наклоном (гироскоп)</div>
              <div class="pause-inline-row">
                <button type="button" class="pause-seg-btn pause-toggle-btn" data-role="gyro-toggle">
                  Включить гироскоп
                </button>
                <span class="pause-status" data-role="gyro-status">Отключён</span>
              </div>
            </div>

            <div class="pause-section">
              <div class="pause-label">Сенсорные кнопки</div>
              <div class="pause-segment-group">
                <button type="button" class="pause-seg-btn" data-touch="auto">Авто</button>
                <button type="button" class="pause-seg-btn" data-touch="on">Вкл</button>
                <button type="button" class="pause-seg-btn" data-touch="off">Выкл</button>
              </div>
            </div>
          </div>

          <div class="pause-section">
            <div class="pause-label">Качество графики (оптимизация)</div>
            <div class="pause-segment-group">
              <button type="button" class="pause-seg-btn" data-quality="low">Низкое</button>
              <button type="button" class="pause-seg-btn" data-quality="medium">Среднее</button>
              <button type="button" class="pause-seg-btn" data-quality="high">Высокое</button>
            </div>
            <div class="pause-hint">Управляет динамическими тенями, количеством огней, дождём и pixelRatio (≤ 2).</div>
          </div>

          <div class="pause-footer">
            <button type="button" class="pause-btn pause-btn--secondary" data-role="open-menu">
              Меню
            </button>
            <button type="button" class="pause-btn pause-btn--secondary" data-role="open-tactical">
              Карта контрактов
            </button>
            <button type="button" class="pause-btn pause-btn--accent" data-role="open-garage">
              В гараж
            </button>
            <button type="button" class="pause-btn pause-btn--secondary" data-role="pause-mute">
              Звук: Вкл
            </button>
            <button type="button" class="pause-btn pause-btn--secondary" data-role="reset-car">
              На шоссе
            </button>
            <button type="button" class="pause-btn pause-btn--primary" data-role="resume-btn">
              Продолжить
            </button>
          </div>
        </div>
      </div>

      <div class="result-overlay" data-role="result-overlay" aria-hidden="true">
        <div class="hud-glass result-modal" role="dialog" aria-modal="true">
          <div class="result-kicker" data-role="result-kicker">DMZ ОПЕРАЦИЯ</div>
          <h2 class="result-title" data-role="result-title">ЭВАКУАЦИЯ УСПЕШНА</h2>
          <p class="result-desc" data-role="result-desc"></p>
          <div class="result-reward" data-role="result-reward">+21 000 ₵</div>
          <div class="result-actions">
            <button type="button" class="pause-btn pause-btn--accent" data-role="res-share" hidden>
              Поделиться результатом
            </button>
            <button type="button" class="pause-btn pause-btn--secondary" data-role="res-retry">
              Повторить контракт
            </button>
            <button type="button" class="pause-btn pause-btn--secondary" data-role="res-map">
              К тактической карте
            </button>
            <button type="button" class="pause-btn pause-btn--primary" data-role="res-garage">
              В гараж (потратить награду)
            </button>
          </div>
        </div>
      </div>
    `;

    container.appendChild(this.root);

    const q = <T extends HTMLElement>(selector: string): T => {
      const el = this.root.querySelector<T>(selector);
      if (!el) throw new Error(`HUD element missing: ${selector}`);
      return el;
    };

    this.modeTagEl = q('[data-role="mode-tag"]');
    this.speedValueEl = q('[data-role="speed-value"]');
    this.gearValueEl = q('[data-role="gear-value"]');
    this.transBadgeEl = q('[data-role="trans-badge"]');
    this.rpmFillEl = q('[data-role="rpm-fill"]');
    this.rpmTextEl = q('[data-role="rpm-text"]');
    this.driftBannerEl = q('[data-role="drift-banner"]');
    this.driftAngleEl = q('[data-role="drift-angle"]');
    this.driftBarFillEl = q('[data-role="drift-bar-fill"]');
    this.surfacePillEl = q('[data-role="surface-pill"]');
    this.weatherPillEl = q('[data-role="weather-pill"]');
    this.vehiclePillEl = q('[data-role="vehicle-pill"]');
    this.cameraBtnEl = q('[data-role="camera-btn"]');
    this.muteBtnEl = q('[data-role="mute-btn"]');
    this.audioPromptBtnEl = q('[data-role="audio-prompt"]');
    this.toastEl = q('[data-role="toast"]');
    this.pauseOverlayEl = q('[data-role="pause-overlay"]');
    this.telemetryClusterEl = q('[data-role="telemetry"]');
    this.gyroToggleBtnEl = q('[data-role="gyro-toggle"]');
    this.gyroStatusEl = q('[data-role="gyro-status"]');
    this.pauseMuteBtnEl = q('[data-role="pause-mute"]');

    this.missionPanelEl = q('[data-role="mission-panel"]');
    this.missionObjEl = q('[data-role="mission-obj"]');
    this.missionSubEl = q('[data-role="mission-sub"]');
    this.missionTimerEl = q('[data-role="mission-timer"]');
    this.missionRewardEl = q('[data-role="mission-reward"]');
    this.missionWantedEl = q('[data-role="mission-wanted"]');
    this.missionProgressWrapEl = q('[data-role="mission-progress-wrap"]');
    this.missionProgressFillEl = q('[data-role="mission-progress-fill"]');
    this.hpFillEl = q('[data-role="hp-fill"]');
    this.hpTextEl = q('[data-role="hp-text"]');

    this.minimapWrapEl = q('[data-role="minimap-wrap"]');
    this.minimapCanvas = q<HTMLCanvasElement>('[data-role="minimap-canvas"]');
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;
    this.gadgetBarEl = q('[data-role="gadget-bar"]');
    this.gadgetBtnEls = [
      q<HTMLButtonElement>('[data-role="gadget-0"]'),
      q<HTMLButtonElement>('[data-role="gadget-1"]'),
    ];

    this.resultOverlayEl = q('[data-role="result-overlay"]');
    this.resultKickerEl = q('[data-role="result-kicker"]');
    this.resultTitleEl = q('[data-role="result-title"]');
    this.resultDescEl = q('[data-role="result-desc"]');
    this.resultRewardEl = q('[data-role="result-reward"]');
    this.resultRetryBtnEl = q('[data-role="res-retry"]');
    this.resultShareBtnEl = q('[data-role="res-share"]');

    // Bind controls
    this.cameraBtnEl.addEventListener('click', () => callbacks.onCameraToggle());
    this.muteBtnEl.addEventListener('click', () => callbacks.onMuteToggle());
    this.audioPromptBtnEl.addEventListener('click', () => callbacks.onAudioUnlockPrompt());
    q('[data-role="pause-btn"]').addEventListener('click', () => callbacks.onPauseToggle());
    q('[data-role="pause-close"]').addEventListener('click', () => callbacks.onPauseToggle());
    q('[data-role="resume-btn"]').addEventListener('click', () => callbacks.onPauseToggle());
    q('[data-role="reset-car"]').addEventListener('click', () => callbacks.onResetCar());
    q('[data-role="open-garage"]').addEventListener('click', () => callbacks.onOpenGarage());
    q('[data-role="open-tactical"]').addEventListener('click', () => callbacks.onOpenTacticalMap());
    q('[data-role="open-menu"]').addEventListener('click', () => callbacks.onOpenMenu());
    this.pauseMuteBtnEl.addEventListener('click', () => callbacks.onMuteToggle());

    this.gadgetBtnEls[0].addEventListener('pointerdown', (e) => {
      e.preventDefault();
      callbacks.onTriggerGadget(0);
    });
    this.gadgetBtnEls[1].addEventListener('pointerdown', (e) => {
      e.preventDefault();
      callbacks.onTriggerGadget(1);
    });

    this.resultShareBtnEl.addEventListener('click', () => callbacks.onShareDailyResult());
    this.resultRetryBtnEl.addEventListener('click', () => callbacks.onRetryContract());
    q('[data-role="res-map"]').addEventListener('click', () => callbacks.onOpenTacticalMap());
    q('[data-role="res-garage"]').addEventListener('click', () => callbacks.onOpenGarage());

    this.pauseOverlayEl.addEventListener('click', (e) => {
      if (e.target === this.pauseOverlayEl) callbacks.onPauseToggle();
    });

    this.transBadgeEl.addEventListener('click', () => {
      const next: TransmissionMode =
        this.transBadgeEl.dataset.mode === 'manual' ? 'auto' : 'manual';
      callbacks.onTransmissionToggle(next);
    });

    (['sunset', 'neon_night', 'rain'] as WeatherMode[]).forEach((mode) => {
      const btn = q<HTMLButtonElement>(`[data-weather="${mode}"]`);
      this.weatherButtons.set(mode, btn);
      btn.addEventListener('click', () => callbacks.onWeatherChange(mode));
    });

    (['auto', 'manual'] as TransmissionMode[]).forEach((mode) => {
      const btn = q<HTMLButtonElement>(`[data-trans="${mode}"]`);
      this.transButtons.set(mode, btn);
      btn.addEventListener('click', () => callbacks.onTransmissionToggle(mode));
    });

    (['chase', 'hood'] as CameraMode[]).forEach((mode) => {
      const btn = q<HTMLButtonElement>(`[data-cam="${mode}"]`);
      this.cameraButtons.set(mode, btn);
      btn.addEventListener('click', () => callbacks.onCameraSelect(mode));
    });

    (['auto', 'on', 'off'] as TouchVisibilityMode[]).forEach((mode) => {
      const btn = q<HTMLButtonElement>(`[data-touch="${mode}"]`);
      this.touchModeButtons.set(mode, btn);
      btn.addEventListener('click', () => callbacks.onTouchVisibilityChange(mode));
    });

    (['low', 'medium', 'high'] as GraphicsQuality[]).forEach((qMode) => {
      const btn = q<HTMLButtonElement>(`[data-quality="${qMode}"]`);
      this.qualityButtons.set(qMode, btn);
      btn.addEventListener('click', () => callbacks.onGraphicsQualityChange(qMode));
    });

    this.gyroToggleBtnEl.addEventListener('click', () => {
      const currentlyOn = this.gyroToggleBtnEl.classList.contains('is-active');
      callbacks.onGyroToggle(!currentlyOn);
    });
  }

  public setVisible(visible: boolean): void {
    this.root.classList.toggle('is-hidden', !visible);
  }

  public setVehicleSetup(setup: VehicleSetup): void {
    const spec = VEHICLE_CLASS_SPECS[setup.vehicleClass];
    this.vehiclePillEl.textContent = `${spec.displayName} • ${TIRE_LABELS[setup.tireType].name}`;
  }

  public updateTelemetry(telemetry: Readonly<CarTelemetry>, dt: number): void {
    this.speedValueEl.textContent = String(Math.round(telemetry.speedKmh));
    this.gearValueEl.textContent = telemetry.gearLabel;
    this.gearValueEl.classList.toggle('is-reverse', telemetry.gear === -1);

    const rpmRatio = Math.max(0, Math.min(1, telemetry.rpm / telemetry.redlineRpm));
    this.rpmFillEl.style.transform = `scaleX(${rpmRatio.toFixed(3)})`;
    this.rpmFillEl.classList.toggle('is-redline', rpmRatio > 0.86);
    this.rpmTextEl.textContent = String(Math.round(telemetry.rpm / 50) * 50);

    const drifting = telemetry.isDrifting;
    this.driftBannerEl.classList.toggle('is-active', drifting);
    if (drifting) {
      this.driftAngleEl.textContent = `${Math.round(telemetry.driftAngleDeg)}°`;
      const fill = Math.min(1, telemetry.driftAngleDeg / 45);
      this.driftBarFillEl.style.transform = `scaleX(${fill.toFixed(3)})`;
    }

    this.surfacePillEl.classList.toggle('is-active', telemetry.surface === 'offroad');

    if (this.toastTimer > 0) {
      this.toastTimer = Math.max(0, this.toastTimer - dt);
      if (this.toastTimer === 0) {
        this.toastEl.classList.remove('is-visible');
      }
    }
  }

  public updateContract(snapshot: Readonly<ContractSnapshot>, wantedStars: number): void {
    const active = snapshot.active && snapshot.contract !== null;
    this.missionPanelEl.hidden = !active;
    this.modeTagEl.textContent = active ? 'DMZ КОНТРАКТ' : 'СВОБОДНЫЙ КРУИЗ';

    if (!active || !snapshot.contract) return;

    this.missionTimerEl.textContent = formatTimer(snapshot.timeRemainingSec);
    this.missionTimerEl.classList.toggle('is-urgent', snapshot.timeRemainingSec < 20);
    this.missionRewardEl.textContent = `+${snapshot.contract.rewardCredits.toLocaleString('ru-RU')} ₵`;

    if (wantedStars > 0) {
      this.missionWantedEl.textContent = `РОЗЫСК ${'★'.repeat(wantedStars)}${'☆'.repeat(3 - wantedStars)}`;
      this.missionWantedEl.classList.add('is-wanted');
    } else {
      this.missionWantedEl.textContent = 'СКРЫТНО';
      this.missionWantedEl.classList.remove('is-wanted');
    }

    this.missionObjEl.textContent = snapshot.objectiveText;
    this.missionSubEl.textContent = snapshot.subText;

    const showBar =
      snapshot.phase === 'uploading' ||
      (snapshot.phase === 'extract' && snapshot.extractProgress > 0.02);
    this.missionProgressWrapEl.hidden = !showBar;
    if (showBar) {
      const p = snapshot.phase === 'uploading' ? snapshot.uploadProgress : snapshot.extractProgress;
      this.missionProgressFillEl.style.transform = `scaleX(${p.toFixed(3)})`;
      this.missionProgressFillEl.classList.toggle('is-extract', snapshot.phase === 'extract');
    }

    const hpPct = Math.max(0, Math.min(1, snapshot.hp / Math.max(1, snapshot.maxHp)));
    this.hpFillEl.style.transform = `scaleX(${hpPct.toFixed(3)})`;
    this.hpFillEl.classList.toggle('is-low', hpPct < 0.32);
    this.hpTextEl.textContent = `${snapshot.hp} / ${snapshot.maxHp}`;
  }

  public updateGadgets(slots: readonly [GadgetSlotSnapshot, GadgetSlotSnapshot]): void {
    for (let i = 0; i < 2; i++) {
      const snap = slots[i];
      const btn = this.gadgetBtnEls[i];
      const iconEl = btn.querySelector<HTMLSpanElement>('.gadget-btn-icon')!;
      const nameEl = btn.querySelector<HTMLSpanElement>('.gadget-btn-name')!;
      const cdEl = btn.querySelector<HTMLSpanElement>('.gadget-btn-cd')!;

      iconEl.textContent = snap.icon;
      nameEl.textContent = snap.shortName;

      const isActive = snap.activeRemaining > 0.05;
      btn.classList.toggle('is-ready', snap.ready);
      btn.classList.toggle('is-active', isActive);
      btn.classList.toggle('is-cooling', !snap.ready && !isActive);

      if (isActive) {
        cdEl.textContent = `АКТ. ${snap.activeRemaining.toFixed(1)}с`;
      } else if (!snap.ready) {
        cdEl.textContent = `${Math.ceil(snap.cooldownRemaining)}с`;
      } else {
        cdEl.textContent = 'ГОТОВ';
      }
    }
  }

  public updateMinimap(input: MinimapInput): void {
    const ctx = this.minimapCtx;
    const size = this.minimapCanvas.width;
    const half = size * 0.5;
    const radarRange = 210; // meters visible from center to edge
    const scale = half / radarRange;

    ctx.clearRect(0, 0, size, size);

    // Dark tactical radar backdrop
    ctx.fillStyle = 'rgba(6, 14, 28, 0.92)';
    ctx.fillRect(0, 0, size, size);

    const toX = (wx: number) => half + (wx - input.playerX) * scale;
    const toY = (wz: number) => half + (wz - input.playerZ) * scale;

    // Sandy beach shoulder indicator
    const sandX = toX(333);
    if (sandX < size) {
      ctx.fillStyle = 'rgba(135, 106, 76, 0.25)';
      ctx.fillRect(Math.max(0, sandX), 0, size - Math.max(0, sandX), size);
    }
    const sandY = toY(333);
    if (sandY < size) {
      ctx.fillStyle = 'rgba(135, 106, 76, 0.25)';
      ctx.fillRect(0, Math.max(0, sandY), size, size - Math.max(0, sandY));
    }

    // Road grid lines
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.28)';
    ctx.lineWidth = 4;
    for (const rc of ROAD_COORDS) {
      const rx = toX(rc);
      if (rx >= -10 && rx <= size + 10) {
        ctx.beginPath();
        ctx.moveTo(rx, 0);
        ctx.lineTo(rx, size);
        ctx.stroke();
      }
      const ry = toY(rc);
      if (ry >= -10 && ry <= size + 10) {
        ctx.beginPath();
        ctx.moveTo(0, ry);
        ctx.lineTo(size, ry);
        ctx.stroke();
      }
    }

    // City blocks
    const blockPx = 124 * scale;
    ctx.fillStyle = 'rgba(22, 36, 62, 0.9)';
    for (const bx of BLOCK_CENTERS) {
      for (const bz of BLOCK_CENTERS) {
        const px = toX(bx) - blockPx * 0.5;
        const py = toY(bz) - blockPx * 0.5;
        if (px + blockPx < 0 || px > size || py + blockPx < 0 || py > size) continue;
        ctx.fillRect(px, py, blockPx, blockPx);
      }
    }

    // Smoke clouds
    for (let i = 0; i < input.smokes.length; i++) {
      const s = input.smokes[i];
      ctx.fillStyle = 'rgba(180, 210, 230, 0.45)';
      ctx.beginPath();
      ctx.arc(toX(s.x), toY(s.z), Math.max(4, s.radius * scale), 0, Math.PI * 2);
      ctx.fill();
    }

    // Roadblocks (amber warning diamonds)
    ctx.fillStyle = '#ffae42';
    for (let i = 0; i < input.roadblocks.length; i++) {
      const rb = input.roadblocks[i];
      ctx.fillRect(toX(rb.x) - 3, toY(rb.z) - 3, 6, 6);
    }

    // Police patrols (flashing red/blue dots, cyan when EMP-disabled)
    const flash = Math.floor(input.clockSec * 7) % 2 === 0;
    for (let i = 0; i < input.patrols.length; i++) {
      const p = input.patrols[i];
      const px = toX(p.x);
      const py = toY(p.z);
      ctx.fillStyle = p.disabled ? '#00f0ff' : flash ? '#ff2a6d' : '#2ea8ff';
      ctx.beginPath();
      ctx.arc(px, py, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Active Target / Extraction Waypoint + perimeter directional arrow
    if (input.waypoint) {
      const wp = input.waypoint;
      const wpColor = wp.kind === 'extract' ? '#39ff88' : '#00f0ff';
      const wx = toX(wp.x);
      const wy = toY(wp.z);
      const dx = wx - half;
      const dy = wy - half;
      const distPx = Math.hypot(dx, dy);

      if (distPx < half - 10) {
        const pulse = 6 + 3 * Math.sin(input.clockSec * 5);
        ctx.strokeStyle = wpColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(wx, wy, pulse, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = wpColor;
        ctx.beginPath();
        ctx.arc(wx, wy, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Clamp direction pointer cleanly to minimap perimeter
        const angle = Math.atan2(dy, dx);
        const edgeR = half - 11;
        const ex = half + Math.cos(angle) * edgeR;
        const ey = half + Math.sin(angle) * edgeR;

        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(angle);
        ctx.fillStyle = wpColor;
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(-5, -5);
        ctx.lineTo(-5, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // Player arrow at center (points along heading: +Z is down on north-up map, +X is right)
    ctx.save();
    ctx.translate(half, half);
    const canvasAngle = Math.atan2(Math.cos(input.playerHeading), Math.sin(input.playerHeading));
    ctx.rotate(canvasAngle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -4.5);
    ctx.lineTo(-2.5, 0);
    ctx.lineTo(-5, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  public showMissionResult(
    success: boolean,
    title: string,
    description: string,
    rewardText: string,
    showRetry: boolean,
    showShare = false,
  ): void {
    this.resultOverlayEl.classList.add('is-open');
    this.resultOverlayEl.classList.toggle('is-success', success);
    this.resultOverlayEl.classList.toggle('is-fail', !success);
    this.resultOverlayEl.setAttribute('aria-hidden', 'false');
    this.resultKickerEl.textContent = success ? 'ОПЕРАЦИЯ ВЫПОЛНЕНА' : 'ПРОВАЛ ОПЕРАЦИИ';
    this.resultTitleEl.textContent = title;
    this.resultDescEl.textContent = description;
    this.resultRewardEl.textContent = rewardText;
    this.resultRetryBtnEl.hidden = !showRetry;
    this.resultShareBtnEl.hidden = !showShare;
  }

  public setGraphicsQuality(quality: GraphicsQuality): void {
    this.qualityButtons.forEach((btn, key) => {
      btn.classList.toggle('is-active', key === quality);
    });
  }

  public hideMissionResult(): void {
    this.resultOverlayEl.classList.remove('is-open', 'is-success', 'is-fail');
    this.resultOverlayEl.setAttribute('aria-hidden', 'true');
  }

  public setWeather(mode: WeatherMode): void {
    this.weatherPillEl.textContent = WEATHER_LABELS[mode];
    this.weatherPillEl.dataset.weather = mode;
    this.weatherButtons.forEach((btn, key) => {
      btn.classList.toggle('is-active', key === mode);
    });
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraBtnEl.textContent = `Камера: ${CAMERA_LABELS[mode]}`;
    this.cameraButtons.forEach((btn, key) => {
      btn.classList.toggle('is-active', key === mode);
    });
  }

  public setTransmissionMode(mode: TransmissionMode): void {
    this.transBadgeEl.textContent = mode === 'auto' ? 'АКПП' : 'МКПП';
    this.transBadgeEl.dataset.mode = mode;
    this.transBadgeEl.classList.toggle('is-manual', mode === 'manual');
    this.transButtons.forEach((btn, key) => {
      btn.classList.toggle('is-active', key === mode);
    });
  }

  public setAudioState(unlocked: boolean, muted: boolean): void {
    this.audioPromptBtnEl.hidden = unlocked;
    const label = muted ? 'Звук: Выкл' : 'Звук: Вкл';
    this.muteBtnEl.textContent = label;
    this.muteBtnEl.classList.toggle('is-muted', muted);
    this.pauseMuteBtnEl.textContent = label;
  }

  public setGyroStatus(status: GyroStatus): void {
    const active = status === 'active';
    this.gyroToggleBtnEl.classList.toggle('is-active', active);
    this.gyroToggleBtnEl.textContent = active ? 'Отключить гироскоп' : 'Включить гироскоп';
    this.gyroStatusEl.textContent = GYRO_STATUS_TEXT[status];
  }

  public setTouchVisibility(mode: TouchVisibilityMode, touchControlsShown: boolean): void {
    this.touchModeButtons.forEach((btn, key) => {
      btn.classList.toggle('is-active', key === mode);
    });
    this.telemetryClusterEl.classList.toggle('is-touch-layout', touchControlsShown);
    this.minimapWrapEl.classList.toggle('is-touch-layout', touchControlsShown);
    this.gadgetBarEl.classList.toggle('is-touch-layout', touchControlsShown);
  }

  public setPaused(paused: boolean): void {
    this.pauseOverlayEl.classList.toggle('is-open', paused);
    this.pauseOverlayEl.setAttribute('aria-hidden', String(!paused));
  }

  public showToast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('is-visible');
    this.toastTimer = 2.6;
  }

  public dispose(): void {
    this.root.remove();
  }
}
