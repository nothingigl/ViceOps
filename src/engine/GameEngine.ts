import * as THREE from 'three';
import { SynthAudio } from '../audio';
import { GarageView } from '../garage';
import { SaveManager } from '../storage';
import {
  ContractEngine,
  formatDailyShareCard,
  TacticalMap,
  type TacticalContract,
} from '../tactics';
import type {
  DailyContractRecord,
  GraphicsQuality,
  VehicleClassId,
  VehicleSetup,
  WeatherMode,
} from '../types';
import {
  GarageUI,
  HUD,
  MainMenu,
  TouchControls,
  type TouchVisibilityMode,
} from '../ui';
import {
  CarMesh,
  CarPhysics,
  GADGET_SPECS,
  GadgetSystem,
  TIRE_LABELS,
  VEHICLE_CLASS_SPECS,
  type TransmissionMode,
} from '../vehicle';
import {
  buildCity,
  TrafficAndPoliceSystem,
  WEATHER_LABELS,
  WeatherSystem,
  type CityBuildResult,
} from '../world';
import { CAMERA_LABELS, CameraRig, type CameraMode } from './CameraRig';
import { InputManager } from './InputManager';
import { PWAManager } from './PWAManager';

export const FIXED_TIMESTEP_HZ = 60;
export const FIXED_TIMESTEP_SEC = 1 / FIXED_TIMESTEP_HZ;
export const MAX_PIXEL_RATIO = 2;
const MAX_FRAME_DELTA_SEC = 0.1;

export type AppScreen = 'menu' | 'garage' | 'tactical' | 'cruise';

const QUALITY_PIXEL_RATIO_CAP: Record<GraphicsQuality, number> = {
  low: 1.0,
  medium: 1.5,
  high: MAX_PIXEL_RATIO,
};

const QUALITY_TOAST_LABEL: Record<GraphicsQuality, string> = {
  low: 'Низкое (макс. FPS)',
  medium: 'Среднее (баланс)',
  high: 'Высокое (тени и огни)',
};

export class GameEngine {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly saveManager: SaveManager;
  private readonly pwaManager: PWAManager;
  private readonly unsubscribePWA: () => void;

  // Free Cruise & DMZ Contract world systems
  private readonly cruiseScene: THREE.Scene;
  private readonly city: CityBuildResult;
  private readonly weather: WeatherSystem;
  private readonly carPhysics: CarPhysics;
  private readonly carMesh: CarMesh;
  private readonly gadgets: GadgetSystem;
  private readonly trafficAndPolice: TrafficAndPoliceSystem;
  private readonly contractEngine: ContractEngine;
  private readonly cameraRig: CameraRig;
  private readonly audio: SynthAudio;
  private readonly input: InputManager;

  // 3D Garage showcase scene
  private readonly garageView: GarageView;

  // UI layers
  private readonly mainMenu: MainMenu;
  private readonly garageUI: GarageUI;
  private readonly tacticalMap: TacticalMap;
  private readonly touchControls: TouchControls;
  private readonly hud: HUD;
  private readonly transitionVeil: HTMLDivElement;

  private screen: AppScreen = 'menu';
  private garagePreviewClass: VehicleClassId = 'street_coupe';
  private pendingContract: TacticalContract | null = null;
  private activeContract: TacticalContract | null = null;
  private lastDailyRecordForShare: DailyContractRecord | null = null;
  private graphicsQuality: GraphicsQuality = 'high';
  private lastSirenProximity = 0;
  private lastWantedStars = 0;

  private transitioning = false;
  private transitionTimerId: number | null = null;

  private rafId: number | null = null;
  private lastTimeMs = 0;
  private accumulator = 0;
  private elapsedSec = 0;
  private paused = false;
  private disposed = false;

  private readonly onResizeBound: () => void;
  private readonly onVisibilityChangeBound: () => void;
  private readonly onWindowBlurBound: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.saveManager = new SaveManager();
    this.pwaManager = new PWAManager();
    this.graphicsQuality = this.saveManager.getGraphicsQuality();

    const activeSetup = this.saveManager.getActiveVehicle();
    this.garagePreviewClass = activeSetup.vehicleClass;

    // 1. Single shared mobile-optimized WebGLRenderer (DPR always capped <= 2)
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight,
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    // 2. 3D Garage Showroom scene
    this.garageView = new GarageView(this.renderer.domElement, activeSetup);

    // 3. City scene, Weather, Traffic & Police, Gadgets, DMZ Contract Engine
    this.cruiseScene = new THREE.Scene();
    this.city = buildCity();
    this.cruiseScene.add(this.city.group);
    this.weather = new WeatherSystem(this.cruiseScene, this.city, 'neon_night');

    this.gadgets = new GadgetSystem();
    this.gadgets.setEquipped(activeSetup.gadgets);
    this.cruiseScene.add(this.gadgets.group);

    this.trafficAndPolice = new TrafficAndPoliceSystem();
    this.cruiseScene.add(this.trafficAndPolice.group);

    this.contractEngine = new ContractEngine();
    this.cruiseScene.add(this.contractEngine.group);

    // 4. Decoupled fixed-timestep CarPhysics + procedural 3D CarMesh
    const { x, z, heading } = this.city.spawnPoint;
    this.carPhysics = new CarPhysics(x, z, heading, activeSetup);
    this.carMesh = new CarMesh(activeSetup);
    this.cruiseScene.add(this.carMesh.root);

    // 5. Cinematic camera rig
    const aspect =
      (container.clientWidth || window.innerWidth) /
      Math.max(1, container.clientHeight || window.innerHeight);
    this.cameraRig = new CameraRig(aspect);
    const initialTransform = this.carPhysics.getInterpolatedTransform(1);
    this.carMesh.sync(
      initialTransform,
      this.carPhysics.getTelemetry(),
      this.weather.getHeadlightStrength(),
    );
    this.cameraRig.snapToCar(initialTransform);

    // 6. Procedural Web Audio synthesizer
    this.audio = new SynthAudio();
    this.audio.setPaused(true);

    // 7. Input manager (PC keyboard + touch + gyroscope + keys 1/2 gadgets)
    this.input = new InputManager({
      onFirstInteraction: () => this.unlockAudio(),
      onToggleCamera: () => {
        if (this.screen === 'cruise') this.toggleCamera();
      },
      onShiftUp: () => {
        if (this.screen === 'cruise') this.handleManualShift('up');
      },
      onShiftDown: () => {
        if (this.screen === 'cruise') this.handleManualShift('down');
      },
      onTogglePause: () => this.handleEscapeAction(),
      onToggleMute: () => this.toggleMute(),
      onTriggerGadget: (slotIndex) => this.handleTriggerGadget(slotIndex),
    });

    // 8. UI Views: MainMenu, GarageUI, TacticalMap, TouchControls, HUD
    this.mainMenu = new MainMenu(container, {
      onOpenTacticalMap: () => this.navigateTo('tactical'),
      onOpenGarage: () => this.navigateTo('garage'),
      onStartCruise: () => {
        this.pendingContract = null;
        this.navigateTo('cruise');
      },
      onInstallApp: () => {
        void this.pwaManager.promptInstall();
      },
      onGraphicsQualityChange: (quality) => this.setGraphicsQuality(quality, false),
    });

    this.garageUI = new GarageUI(container, {
      onBackToMenu: () => this.navigateTo('menu'),
      onOpenTacticalMap: () => this.navigateTo('tactical'),
      onLaunchCruise: () => {
        this.pendingContract = null;
        this.navigateTo('cruise');
      },
      onSelectClass: (cls) => this.handleSelectGarageClass(cls),
      onUnlockClass: (cls) => this.handleUnlockGarageClass(cls),
      onSetupChange: (setup) => this.handleSetupChange(setup),
      onCopyCode: (setup) => {
        void this.handleCopySetupCode(setup);
      },
      onImportCode: (code) => this.handleImportSetupCode(code),
    });

    this.tacticalMap = new TacticalMap(container, {
      onBackToMenu: () => this.navigateTo('menu'),
      onOpenGarage: () => this.navigateTo('garage'),
      onStartFreeCruise: () => {
        this.pendingContract = null;
        this.navigateTo('cruise');
      },
      onGadgetsChange: (selected) => {
        this.saveManager.setActiveGadgets(selected);
        this.gadgets.setEquipped(selected);
      },
      onLaunchContract: (contract, selectedGadgets) => {
        this.saveManager.setActiveGadgets(selectedGadgets);
        this.gadgets.setEquipped(selectedGadgets);
        this.pendingContract = contract;
        this.navigateTo('cruise');
      },
      onShareDailyResult: (record) => {
        void this.handleShareDailyRecord(record, 'tactical');
      },
    });

    this.touchControls = new TouchControls(container, this.input, {
      onShiftUp: () => this.handleManualShift('up'),
      onShiftDown: () => this.handleManualShift('down'),
      onAnyTouch: () => this.unlockAudio(),
    });

    this.hud = new HUD(container, {
      onWeatherChange: (mode) => this.setWeather(mode),
      onCameraToggle: () => this.toggleCamera(),
      onCameraSelect: (mode) => this.setCameraMode(mode),
      onMuteToggle: () => this.toggleMute(),
      onPauseToggle: () => this.togglePause(),
      onTransmissionToggle: (mode) => this.setTransmissionMode(mode),
      onGyroToggle: (enabled) => {
        void this.setGyroEnabled(enabled);
      },
      onTouchVisibilityChange: (mode) => this.setTouchVisibility(mode),
      onGraphicsQualityChange: (quality) => this.setGraphicsQuality(quality, true),
      onResetCar: () => this.resetCar(),
      onOpenGarage: () => this.navigateTo('garage'),
      onOpenTacticalMap: () => this.navigateTo('tactical'),
      onOpenMenu: () => this.navigateTo('menu'),
      onRetryContract: () => this.retryActiveContract(),
      onShareDailyResult: () => {
        if (this.lastDailyRecordForShare) {
          void this.handleShareDailyRecord(this.lastDailyRecordForShare, 'hud');
        }
      },
      onTriggerGadget: (slotIndex) => this.handleTriggerGadget(slotIndex),
      onAudioUnlockPrompt: () => this.unlockAudio(),
    });

    this.transitionVeil = document.createElement('div');
    this.transitionVeil.className = 'screen-transition-veil';
    container.appendChild(this.transitionVeil);

    // Subscribe to PWA install prompt & offline-ready indicator
    this.unsubscribePWA = this.pwaManager.subscribe((status) => {
      this.mainMenu.updatePWAStatus(status);
    });

    // Initial HUD & quality sync
    this.hud.setWeather(this.weather.getMode());
    this.hud.setCameraMode(this.cameraRig.getMode());
    this.hud.setTransmissionMode(this.carPhysics.getTransmissionMode());
    this.hud.setAudioState(this.audio.isUnlocked(), this.audio.isMuted());
    this.hud.setGyroStatus(this.input.getGyroStatus());
    this.hud.setVehicleSetup(activeSetup);
    this.hud.updateGadgets(this.gadgets.getSlotSnapshots());
    this.setGraphicsQuality(this.graphicsQuality, false);

    this.applyScreenImmediate('menu');

    this.onResizeBound = () => this.handleResize();
    this.onVisibilityChangeBound = () => this.handleVisibilityChange();
    this.onWindowBlurBound = () => this.handleFocusLoss();
    window.addEventListener('resize', this.onResizeBound);
    document.addEventListener('visibilitychange', this.onVisibilityChangeBound);
    window.addEventListener('blur', this.onWindowBlurBound);
  }

  public start(): void {
    if (this.rafId !== null || this.disposed) return;
    this.lastTimeMs = performance.now();
    const tick = (nowMs: number) => {
      if (this.disposed) return;
      this.rafId = requestAnimationFrame(tick);
      this.frame(nowMs);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private setGraphicsQuality(quality: GraphicsQuality, notifyToast: boolean): void {
    this.graphicsQuality = quality;
    this.saveManager.setGraphicsQuality(quality);

    const cap = QUALITY_PIXEL_RATIO_CAP[quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.needsUpdate = true;

    this.weather.setGraphicsQuality(quality);
    this.carMesh.setGraphicsQuality(quality);
    this.garageView.setGraphicsQuality(quality);
    this.mainMenu.setGraphicsQuality(quality);
    this.hud.setGraphicsQuality(quality);

    if (notifyToast) {
      this.hud.showToast(`Качество графики: ${QUALITY_TOAST_LABEL[quality]}`);
    }
  }

  private frame(nowMs: number): void {
    const rawDelta = Math.max(0, (nowMs - this.lastTimeMs) / 1000);
    this.lastTimeMs = nowMs;
    const frameDelta = Math.min(rawDelta, MAX_FRAME_DELTA_SEC);

    if (this.screen === 'tactical') {
      this.tacticalMap.update(frameDelta);
      this.garageView.update(frameDelta);
      this.renderer.render(this.garageView.scene, this.garageView.camera);
      return;
    }

    if (this.screen !== 'cruise') {
      this.garageView.update(frameDelta);
      this.renderer.render(this.garageView.scene, this.garageView.camera);
      return;
    }

    const simulationActive = !this.paused && !this.contractEngine.isFinished();

    if (simulationActive) {
      this.accumulator += frameDelta;
      const weatherMode = this.weather.getMode();

      // Strictly fixed 60 Hz physics & tactical simulation loop
      while (this.accumulator >= FIXED_TIMESTEP_SEC) {
        const controlInput = this.input.sample();
        const posBefore = this.carPhysics.getPosition();
        const surface = this.city.getSurfaceType(posBefore.x, posBefore.z);
        this.carPhysics.step(
          FIXED_TIMESTEP_SEC,
          controlInput,
          weatherMode,
          surface,
          this.city.colliders,
          this.city.worldBounds,
        );

        const pos = this.carPhysics.getPosition();
        const tel = this.carPhysics.getTelemetry();
        const snapNow = this.carPhysics.getInterpolatedTransform(1);

        if (tel.impactImpulse > 0.25 && this.contractEngine.isActive()) {
          this.contractEngine.applyDamage(tel.impactImpulse * 16);
        }

        this.gadgets.step(FIXED_TIMESTEP_SEC, pos.x, pos.z, snapNow.heading);

        const trafficRes = this.trafficAndPolice.step(
          FIXED_TIMESTEP_SEC,
          pos.x,
          pos.z,
          tel.velocityX,
          tel.velocityZ,
          this.city.colliders,
          this.gadgets,
        );
        this.lastSirenProximity = trafficRes.sirenProximity;
        this.lastWantedStars = trafficRes.wantedStars;

        if (trafficRes.impactStrength > 0.05 || trafficRes.pushX !== 0 || trafficRes.pushZ !== 0) {
          this.carPhysics.applyExternalImpulse(
            trafficRes.impulseX,
            trafficRes.impulseZ,
            trafficRes.pushX,
            trafficRes.pushZ,
          );
          if (trafficRes.impactStrength > 0.14) {
            this.audio.playCollisionImpact(trafficRes.impactStrength);
          }
        }

        if (trafficRes.playerDamage > 0 && this.contractEngine.isActive()) {
          this.contractEngine.applyDamage(trafficRes.playerDamage);
        }

        if (trafficRes.empDisabledCount > 0) {
          this.hud.showToast(
            `ЭМИ-импульс: отключено патрулей — ${trafficRes.empDisabledCount} (4 сек.)`,
          );
        } else if (trafficRes.smokeEscapedCount > 0) {
          this.hud.showToast('Дымовая завеса сбила прицел полиции!');
        }

        const contractEvents = this.contractEngine.step(FIXED_TIMESTEP_SEC, pos.x, pos.z);
        if (contractEvents.capturedTarget && this.activeContract) {
          const ez = this.activeContract.extractionZone;
          this.trafficAndPolice.activateWanted(
            this.activeContract.heatLevel,
            pos.x,
            pos.z,
            ez.x,
            ez.z,
          );
          this.audio.playMissionCue('upload_complete');
          this.audio.playMissionCue('wanted');
          this.hud.showToast('ДАННЫЕ ЗАГРУЖЕНЫ! РОЗЫСК АКТИВИРОВАН — К ЭВАКУАЦИИ!');
        } else if (contractEvents.extracted) {
          this.handleContractSuccess();
          break;
        } else if (contractEvents.failed) {
          this.handleContractFailure();
          break;
        }

        this.accumulator -= FIXED_TIMESTEP_SEC;
        this.elapsedSec += FIXED_TIMESTEP_SEC;
      }
    }

    const alpha = simulationActive ? this.accumulator / FIXED_TIMESTEP_SEC : 1;
    const transform = this.carPhysics.getInterpolatedTransform(alpha);
    const telemetry = this.carPhysics.getTelemetry();

    this.carMesh.sync(transform, telemetry, this.weather.getHeadlightStrength());
    this.gadgets.syncVisuals(transform.x, transform.z);
    this.trafficAndPolice.syncVisuals();
    this.contractEngine.syncVisuals();
    this.city.update(this.elapsedSec);
    this.weather.update(simulationActive ? frameDelta : 0, transform.x, transform.z);

    if (simulationActive) {
      this.cameraRig.update(frameDelta, transform, telemetry, this.carMesh);
      this.audio.update(telemetry, this.weather.getMode(), this.lastSirenProximity, frameDelta);
    }

    const contractSnap = this.contractEngine.getSnapshot();
    this.hud.updateTelemetry(telemetry, frameDelta);
    this.hud.updateContract(contractSnap, this.lastWantedStars);
    this.hud.updateGadgets(this.gadgets.getSlotSnapshots());
    this.hud.updateMinimap({
      playerX: transform.x,
      playerZ: transform.z,
      playerHeading: transform.heading,
      waypoint: contractSnap.waypoint,
      patrols: this.trafficAndPolice.getPoliceRadarPoints(),
      roadblocks: this.trafficAndPolice.getRoadblockRadarPoints(),
      smokes: this.gadgets.getActiveSmokeZones(),
      clockSec: this.elapsedSec,
    });

    this.renderer.render(this.cruiseScene, this.cameraRig.camera);
  }

  private handleContractSuccess(): void {
    const snap = this.contractEngine.getSnapshot();
    if (!snap.contract) return;

    this.input.clearAllInputs();
    this.touchControls.setPaused(true);
    this.audio.playMissionCue('extracted');
    this.lastSirenProximity = 0;

    const newBalance = this.saveManager.recordContractReward(
      snap.contract.id,
      snap.earnedCredits,
      snap.elapsedSec,
    );

    let dailyExtra = '';
    let showShare = false;
    this.lastDailyRecordForShare = null;

    if (snap.contract.isDaily && snap.contract.dailyDate) {
      const activeSetup = this.saveManager.getActiveVehicle();
      const spec = VEHICLE_CLASS_SPECS[activeSetup.vehicleClass];
      const dailyRun: DailyContractRecord = {
        dateKey: snap.contract.dailyDate,
        bestTimeSec: snap.elapsedSec,
        vehicleName: spec.displayName,
        tireName: TIRE_LABELS[activeSetup.tireType].name,
        weather: snap.contract.weather,
        hpRemaining: snap.hp,
        maxHp: snap.maxHp,
        rewardCredits: snap.earnedCredits,
      };
      const { isNewRecord, bestRecord } = this.saveManager.recordDailyContractResult(dailyRun);
      this.lastDailyRecordForShare = bestRecord;
      showShare = true;
      dailyExtra = isNewRecord
        ? ` 🏆 Новый рекорд дня (${snap.contract.dailyDate})!`
        : ` Лучшее время дня: ${bestRecord.bestTimeSec.toFixed(1)} сек.`;
    }

    this.hud.showMissionResult(
      true,
      snap.contract.isDaily ? 'КОНТРАКТ ДНЯ ВЫПОЛНЕН' : 'ЭВАКУАЦИЯ УСПЕШНА',
      `Контракт «${snap.contract.title}» выполнен за ${snap.elapsedSec.toFixed(1)} сек. (прочность ${snap.hp}/${snap.maxHp} HP).${dailyExtra} Баланс: ${newBalance.toLocaleString('ru-RU')} ₵.`,
      `+${snap.earnedCredits.toLocaleString('ru-RU')} ₵`,
      false,
      showShare,
    );
  }

  private handleContractFailure(): void {
    const snap = this.contractEngine.getSnapshot();
    this.input.clearAllInputs();
    this.touchControls.setPaused(true);
    this.audio.playMissionCue('failed');
    this.lastSirenProximity = 0;
    this.lastDailyRecordForShare = null;

    const reasonText =
      snap.failReason === 'destroyed'
        ? 'Прочность автомобиля упала до 0 — добыча и награда сгорели.'
        : 'Таймер эвакуации истёк — канал эвакуации закрыт, добыча потеряна.';

    this.hud.showMissionResult(
      false,
      'РЕЙД ПРОВАЛЕН',
      reasonText,
      '0 ₵ (ДОБЫЧА ПОТЕРЯНА)',
      true,
      false,
    );
  }

  private async handleShareDailyRecord(
    record: DailyContractRecord,
    source: 'tactical' | 'hud',
  ): Promise<void> {
    const card = formatDailyShareCard(record);
    const copied = await this.copyTextToClipboard(card);
    const msg = copied
      ? 'Карточка «Контракта дня» скопирована в буфер обмена!'
      : 'Скопируйте результат вручную';

    if (source === 'tactical') {
      this.tacticalMap.showToast(msg);
    } else {
      this.hud.showToast(msg);
    }

    if (!copied) {
      window.prompt('Результат Контракта дня:', card);
    }
  }

  private async copyTextToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fallback below
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    textarea.remove();
    return ok;
  }

  private retryActiveContract(): void {
    if (!this.activeContract) {
      this.navigateTo('tactical');
      return;
    }
    this.pendingContract = this.activeContract;
    this.applyScreenImmediate('cruise');
  }

  private handleTriggerGadget(slotIndex: 0 | 1): void {
    if (this.screen !== 'cruise' || this.paused || this.contractEngine.isFinished()) return;
    this.unlockAudio();
    const pos = this.carPhysics.getPosition();
    const snap = this.carPhysics.getInterpolatedTransform(1);
    const activated = this.gadgets.triggerSlot(slotIndex, pos.x, pos.z, snap.heading);
    if (!activated) return;

    if (activated === 'emp') {
      this.audio.playEmpPulse();
      this.hud.showToast(`${GADGET_SPECS.emp.icon} ЭМИ-импульс активирован!`);
    } else if (activated === 'smoke') {
      this.audio.playSmokeDeploy();
      this.hud.showToast(`${GADGET_SPECS.smoke.icon} Дымовая завеса сброшена!`);
    } else if (activated === 'jammer') {
      this.audio.playJammerPulse();
      this.hud.showToast(`${GADGET_SPECS.jammer.icon} Глушилка радаров: скрытность 6 сек.`);
    }
  }

  private navigateTo(next: AppScreen): void {
    if (this.transitioning || this.screen === next) return;
    this.transitioning = true;
    this.transitionVeil.classList.add('is-active');

    this.transitionTimerId = window.setTimeout(() => {
      this.applyScreenImmediate(next);
      this.transitionVeil.classList.remove('is-active');
      this.transitioning = false;
      this.transitionTimerId = null;
    }, 170);
  }

  private applyScreenImmediate(next: AppScreen): void {
    this.screen = next;
    this.paused = false;
    this.input.clearAllInputs();
    this.lastTimeMs = performance.now();
    this.accumulator = 0;
    this.lastSirenProximity = 0;
    this.lastWantedStars = 0;

    const save = this.saveManager.getState();
    const activeSetup = this.saveManager.getActiveVehicle();

    this.hud.hideMissionResult();

    if (next === 'menu') {
      this.activeContract = null;
      this.contractEngine.clearContract();
      this.trafficAndPolice.resetAll();

      this.garagePreviewClass = activeSetup.vehicleClass;
      this.garageView.setFraming('menu');
      this.garageView.setInteractive(false);
      this.garageView.applySetup(activeSetup, false);

      this.mainMenu.updateSummary(activeSetup, save.credits);
      this.mainMenu.setVisible(true);
      this.garageUI.setVisible(false);
      this.tacticalMap.setVisible(false);
      this.hud.setVisible(false);
      this.hud.setPaused(false);
      this.touchControls.setPaused(true);
      this.audio.setPaused(true);
      return;
    }

    if (next === 'garage') {
      this.activeContract = null;
      this.contractEngine.clearContract();
      this.trafficAndPolice.resetAll();

      this.garagePreviewClass = activeSetup.vehicleClass;
      const previewSetup = this.saveManager.getVehicleByClass(this.garagePreviewClass);
      this.garageView.setFraming('garage');
      this.garageView.setInteractive(true);
      this.garageView.applySetup(previewSetup, false);

      this.garageUI.renderState(previewSetup, save.unlockedVehicleClasses, save.credits);
      this.mainMenu.setVisible(false);
      this.garageUI.setVisible(true);
      this.tacticalMap.setVisible(false);
      this.hud.setVisible(false);
      this.hud.setPaused(false);
      this.touchControls.setPaused(true);
      this.audio.setPaused(true);
      return;
    }

    if (next === 'tactical') {
      this.activeContract = null;
      this.contractEngine.clearContract();
      this.trafficAndPolice.resetAll();

      this.garageView.setFraming('menu');
      this.garageView.setInteractive(false);
      this.garageView.applySetup(activeSetup, false);

      const todayRecord = this.saveManager.getDailyRecord(this.tacticalMap.getTodayKey());
      this.tacticalMap.syncState(activeSetup, save.credits, todayRecord);
      this.tacticalMap.setVisible(true);
      this.mainMenu.setVisible(false);
      this.garageUI.setVisible(false);
      this.hud.setVisible(false);
      this.hud.setPaused(false);
      this.touchControls.setPaused(true);
      this.audio.setPaused(true);
      return;
    }

    // Entering Drive (DMZ Contract, Daily Contract, or Free Cruise)
    this.activeContract = this.pendingContract;
    this.pendingContract = null;

    this.carPhysics.applySetup(activeSetup);
    this.carMesh.applySetup(activeSetup);
    this.carMesh.setGraphicsQuality(this.graphicsQuality);
    this.gadgets.setEquipped(activeSetup.gadgets);
    this.trafficAndPolice.resetAll();

    const spawn = this.activeContract ? this.activeContract.spawnPoint : this.city.spawnPoint;
    this.carPhysics.reset(spawn.x, spawn.z, spawn.heading);

    if (this.activeContract) {
      this.weather.setMode(this.activeContract.weather);
      this.hud.setWeather(this.activeContract.weather);
      this.contractEngine.startContract(
        this.activeContract,
        this.carPhysics.getTelemetry().maxDurability,
      );
    } else {
      this.contractEngine.clearContract();
    }

    const snap = this.carPhysics.getInterpolatedTransform(1);
    this.carMesh.sync(snap, this.carPhysics.getTelemetry(), this.weather.getHeadlightStrength());
    this.cameraRig.snapToCar(snap);

    this.hud.setVehicleSetup(activeSetup);
    this.hud.updateContract(this.contractEngine.getSnapshot(), 0);
    this.hud.updateGadgets(this.gadgets.getSlotSnapshots());
    this.hud.setPaused(false);
    this.hud.setVisible(true);
    this.mainMenu.setVisible(false);
    this.garageUI.setVisible(false);
    this.tacticalMap.setVisible(false);
    this.garageView.setInteractive(false);

    this.touchControls.setPaused(false);
    this.hud.setTouchVisibility(
      this.touchControls.getVisibilityMode(),
      this.touchControls.isVisible(),
    );

    this.unlockAudio();
    this.audio.setPaused(false);
    if (this.activeContract) {
      this.hud.showToast(`Операция «${this.activeContract.title}» — следуйте к маяку цели!`);
    } else {
      const spec = VEHICLE_CLASS_SPECS[activeSetup.vehicleClass];
      this.hud.showToast(`Свободный круиз: ${spec.displayName}`);
    }
  }

  private handleSelectGarageClass(cls: VehicleClassId): void {
    this.garagePreviewClass = cls;
    if (this.saveManager.isClassUnlocked(cls)) {
      this.saveManager.setActiveVehicleClass(cls);
    }
    const setup = this.saveManager.getVehicleByClass(cls);
    const save = this.saveManager.getState();
    this.garageView.applySetup(setup, true);
    this.garageUI.renderState(setup, save.unlockedVehicleClasses, save.credits);
  }

  private handleUnlockGarageClass(cls: VehicleClassId): void {
    const res = this.saveManager.unlockVehicleClass(cls);
    if (!res.ok) {
      this.garageUI.showToast(res.reason ?? 'Не удалось открыть класс');
      return;
    }
    const setup = this.saveManager.getVehicleByClass(cls);
    const save = this.saveManager.getState();
    this.garageView.applySetup(setup, true);
    this.garageUI.renderState(setup, save.unlockedVehicleClasses, save.credits);
    this.garageUI.showToast(`Класс ${VEHICLE_CLASS_SPECS[cls].displayName} разблокирован!`);
  }

  private handleSetupChange(setup: VehicleSetup): void {
    const saved = this.saveManager.updateVehicleSetup(setup);
    const save = this.saveManager.getState();
    this.garageView.applySetup(saved, false);
    this.garageUI.renderState(saved, save.unlockedVehicleClasses, save.credits);
  }

  private async handleCopySetupCode(setup: VehicleSetup): Promise<void> {
    const code = this.saveManager.exportSetupCode(setup);
    const copied = await this.copyTextToClipboard(code);
    if (copied) {
      this.garageUI.showToast(`Код тюнинга скопирован: ${code}`);
    } else {
      window.prompt('Скопируйте код тюнинга:', code);
    }
  }

  private handleImportSetupCode(rawCode: string): void {
    const result = this.saveManager.importSetupCode(rawCode);
    if (!result.ok || !result.setup) {
      this.garageUI.showToast(result.error ?? 'Ошибка импорта кода');
      return;
    }
    this.garagePreviewClass = result.setup.vehicleClass;
    const save = this.saveManager.getState();
    this.garageView.applySetup(result.setup, true);
    this.garageUI.renderState(result.setup, save.unlockedVehicleClasses, save.credits);
    this.garageUI.clearImportInput();
    const extra = result.unlockedNow ? ' (класс открыт автоматически)' : '';
    this.garageUI.showToast(
      `Тюнинг загружен: ${VEHICLE_CLASS_SPECS[result.setup.vehicleClass].displayName}${extra}`,
    );
  }

  private handleEscapeAction(): void {
    if (this.screen === 'cruise' && !this.contractEngine.isFinished()) {
      this.togglePause();
    } else if (this.screen === 'garage' || this.screen === 'tactical') {
      this.navigateTo('menu');
    }
  }

  private unlockAudio(): void {
    this.audio.unlock();
    this.hud.setAudioState(this.audio.isUnlocked(), this.audio.isMuted());
  }

  private toggleMute(): void {
    if (!this.audio.isUnlocked()) {
      this.audio.unlock();
      this.audio.setMuted(false);
    } else {
      this.audio.toggleMute();
    }
    this.hud.setAudioState(this.audio.isUnlocked(), this.audio.isMuted());
  }

  private setWeather(mode: WeatherMode): void {
    this.weather.setMode(mode);
    this.hud.setWeather(mode);
    const suffix = mode === 'rain' ? ' — мокрый асфальт' : '';
    this.hud.showToast(`Атмосфера: ${WEATHER_LABELS[mode]}${suffix}`);
  }

  private setCameraMode(mode: CameraMode): void {
    this.cameraRig.setMode(mode);
    this.hud.setCameraMode(mode);
    this.hud.showToast(`Камера: ${CAMERA_LABELS[mode]}`);
  }

  private toggleCamera(): void {
    const next = this.cameraRig.toggleMode();
    this.hud.setCameraMode(next);
    this.hud.showToast(`Камера: ${CAMERA_LABELS[next]}`);
  }

  private setTransmissionMode(mode: TransmissionMode): void {
    this.carPhysics.setTransmissionMode(mode);
    this.hud.setTransmissionMode(mode);
    this.touchControls.setTransmissionMode(mode);
    this.hud.showToast(mode === 'auto' ? 'КПП: Автомат (АКПП)' : 'КПП: Ручная (Q / E)');
  }

  private handleManualShift(dir: 'up' | 'down'): void {
    if (this.paused || this.screen !== 'cruise') return;
    if (this.carPhysics.getTransmissionMode() === 'auto') {
      this.setTransmissionMode('manual');
    }
    if (dir === 'up') {
      this.carPhysics.shiftUp();
    } else {
      this.carPhysics.shiftDown();
    }
  }

  private async setGyroEnabled(enabled: boolean): Promise<void> {
    const status = await this.input.setGyroEnabled(enabled);
    this.hud.setGyroStatus(status);
    this.touchControls.setGyroActive(status === 'active');
    if (status === 'active') {
      this.hud.showToast('Гироскоп включён: наклоняйте экран для руления');
    } else if (status === 'denied') {
      this.hud.showToast('Нет доступа к гироскопу');
    } else if (status === 'unsupported') {
      this.hud.showToast('Гироскоп не поддерживается на этом устройстве');
    }
  }

  private setTouchVisibility(mode: TouchVisibilityMode): void {
    this.touchControls.setVisibilityMode(mode);
    this.hud.setTouchVisibility(mode, this.touchControls.isVisible());
  }

  private togglePause(): void {
    if (this.screen !== 'cruise' || this.contractEngine.isFinished()) return;
    this.paused = !this.paused;
    this.hud.setPaused(this.paused);
    this.touchControls.setPaused(this.paused);
    this.hud.setTouchVisibility(
      this.touchControls.getVisibilityMode(),
      this.touchControls.isVisible(),
    );
    this.audio.setPaused(this.paused);
    if (this.paused) {
      this.input.clearAllInputs();
    } else {
      this.lastTimeMs = performance.now();
      this.accumulator = 0;
    }
  }

  private resetCar(): void {
    const spawn = this.activeContract ? this.activeContract.spawnPoint : this.city.spawnPoint;
    this.carPhysics.reset(spawn.x, spawn.z, spawn.heading);
    const snap = this.carPhysics.getInterpolatedTransform(1);
    this.carMesh.sync(snap, this.carPhysics.getTelemetry(), this.weather.getHeadlightStrength());
    this.cameraRig.snapToCar(snap);
    if (this.paused) {
      this.togglePause();
    }
    this.hud.showToast('Автомобиль возвращён на трассу');
  }

  private handleResize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    const cap = QUALITY_PIXEL_RATIO_CAP[this.graphicsQuality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.renderer.setSize(width, height);
    this.cameraRig.resize(width / height);
    this.garageView.resize(width, height);
  }

  private handleFocusLoss(): void {
    this.input.clearAllInputs();
    this.audio.setPaused(true);
    if (this.screen === 'cruise' && !this.paused && !this.contractEngine.isFinished()) {
      this.paused = true;
      this.hud.setPaused(true);
      this.touchControls.setPaused(true);
      this.hud.setTouchVisibility(
        this.touchControls.getVisibilityMode(),
        this.touchControls.isVisible(),
      );
    }
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      this.handleFocusLoss();
    } else {
      this.lastTimeMs = performance.now();
      this.accumulator = 0;
      this.audio.setPaused(this.paused || this.screen !== 'cruise');
    }
  }

  public dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.transitionTimerId !== null) {
      window.clearTimeout(this.transitionTimerId);
    }
    window.removeEventListener('resize', this.onResizeBound);
    document.removeEventListener('visibilitychange', this.onVisibilityChangeBound);
    window.removeEventListener('blur', this.onWindowBlurBound);

    this.unsubscribePWA();
    this.pwaManager.dispose();
    this.input.dispose();
    this.mainMenu.dispose();
    this.garageUI.dispose();
    this.tacticalMap.dispose();
    this.touchControls.dispose();
    this.hud.dispose();
    this.transitionVeil.remove();
    this.audio.dispose();
    this.gadgets.dispose();
    this.trafficAndPolice.dispose();
    this.contractEngine.dispose();
    this.garageView.dispose();
    this.carMesh.dispose();
    this.weather.dispose();
    this.city.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
