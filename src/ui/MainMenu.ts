import type { PWAStatus } from '../engine/PWAManager';
import type { GraphicsQuality, VehicleSetup } from '../types';
import {
  computeDisplayRatings,
  TIRE_LABELS,
  VEHICLE_CLASS_SPECS,
} from '../vehicle/VehicleSpecs';

export interface MainMenuCallbacks {
  onOpenTacticalMap: () => void;
  onStartCruise: () => void;
  onOpenGarage: () => void;
  onInstallApp: () => void;
  onGraphicsQualityChange: (quality: GraphicsQuality) => void;
}

const QUALITY_LABELS: Record<GraphicsQuality, string> = {
  low: 'Низкое',
  medium: 'Среднее',
  high: 'Высокое',
};

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly creditsEl: HTMLSpanElement;
  private readonly carNameEl: HTMLDivElement;
  private readonly carMetaEl: HTMLDivElement;
  private readonly offlineBadgeEl: HTMLDivElement;
  private readonly installBannerEl: HTMLDivElement;
  private readonly qualityBtnEl: HTMLButtonElement;
  private currentQuality: GraphicsQuality = 'high';

  constructor(container: HTMLElement, callbacks: MainMenuCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'main-menu';
    this.root.innerHTML = `
      <div class="main-menu-top">
        <div class="main-menu-status-group">
          <div class="hud-glass pwa-offline-badge" data-role="offline-badge">
            <span class="pwa-dot"></span>
            <span data-role="offline-text">Кэширование офлайн...</span>
          </div>
          <div class="hud-glass pwa-install-banner" data-role="install-banner" hidden>
            <span class="pwa-install-text">Установите PWA для запуска без интернета</span>
            <button type="button" class="pwa-install-btn" data-role="install-btn">
              Установить игру
            </button>
          </div>
        </div>

        <div class="main-menu-top-right">
          <button type="button" class="hud-glass hud-action-btn" data-role="quality-cycle" title="Переключить качество 3D-графики">
            Графика: Высокое
          </button>
          <div class="hud-glass credits-pill">
            <span class="credits-label">КРЕДИТЫ</span>
            <span class="credits-value" data-role="credits">50 000 ₵</span>
          </div>
        </div>
      </div>

      <section class="hud-glass main-menu-card">
        <div class="main-menu-tag">ОФЛАЙН-PWA • ТАКТИЧЕСКИЙ СИМУЛЯТОР</div>
        <h1 class="main-menu-title">VICE OPS: <span>TACTICAL DRIVE</span></h1>
        <p class="main-menu-desc">
          DMZ-контракты с эвакуацией, «Контракт дня», полиция, тактические гаджеты и 3D-гараж — работает полностью офлайн.
        </p>

        <div class="main-menu-vehicle">
          <div class="main-menu-vehicle-label">АКТИВНЫЙ АВТОМОБИЛЬ</div>
          <div class="main-menu-vehicle-name" data-role="car-name">Street Coupe</div>
          <div class="main-menu-vehicle-meta" data-role="car-meta"></div>
        </div>

        <div class="main-menu-actions">
          <button type="button" class="menu-btn menu-btn--primary" data-role="open-tactical">
            Тактическая карта — DMZ и Контракт дня
          </button>
          <button type="button" class="menu-btn menu-btn--accent" data-role="open-garage">
            3D-Гараж и тюнинг
          </button>
          <button type="button" class="menu-btn menu-btn--secondary" data-role="start-cruise">
            Свободный круиз (Free Cruise)
          </button>
        </div>
      </section>
    `;

    container.appendChild(this.root);

    this.creditsEl = this.root.querySelector<HTMLSpanElement>('[data-role="credits"]')!;
    this.carNameEl = this.root.querySelector<HTMLDivElement>('[data-role="car-name"]')!;
    this.carMetaEl = this.root.querySelector<HTMLDivElement>('[data-role="car-meta"]')!;
    this.offlineBadgeEl = this.root.querySelector<HTMLDivElement>('[data-role="offline-badge"]')!;
    this.installBannerEl = this.root.querySelector<HTMLDivElement>('[data-role="install-banner"]')!;
    this.qualityBtnEl = this.root.querySelector<HTMLButtonElement>('[data-role="quality-cycle"]')!;

    this.root
      .querySelector<HTMLButtonElement>('[data-role="open-tactical"]')!
      .addEventListener('click', () => callbacks.onOpenTacticalMap());
    this.root
      .querySelector<HTMLButtonElement>('[data-role="open-garage"]')!
      .addEventListener('click', () => callbacks.onOpenGarage());
    this.root
      .querySelector<HTMLButtonElement>('[data-role="start-cruise"]')!
      .addEventListener('click', () => callbacks.onStartCruise());
    this.root
      .querySelector<HTMLButtonElement>('[data-role="install-btn"]')!
      .addEventListener('click', () => callbacks.onInstallApp());

    this.qualityBtnEl.addEventListener('click', () => {
      const order: GraphicsQuality[] = ['low', 'medium', 'high'];
      const next = order[(order.indexOf(this.currentQuality) + 1) % order.length];
      callbacks.onGraphicsQualityChange(next);
    });
  }

  public updatePWAStatus(status: PWAStatus): void {
    const textEl = this.offlineBadgeEl.querySelector<HTMLSpanElement>('[data-role="offline-text"]')!;
    this.offlineBadgeEl.classList.toggle('is-ready', status.offlineReady);
    textEl.textContent = status.offlineReady
      ? 'Офлайн-режим готов'
      : 'Подготовка офлайн-кэша...';

    this.installBannerEl.hidden = !status.canInstall;
  }

  public setGraphicsQuality(quality: GraphicsQuality): void {
    this.currentQuality = quality;
    this.qualityBtnEl.textContent = `Графика: ${QUALITY_LABELS[quality]}`;
  }

  public updateSummary(setup: VehicleSetup, credits: number): void {
    const spec = VEHICLE_CLASS_SPECS[setup.vehicleClass];
    const ratings = computeDisplayRatings(setup);
    this.creditsEl.textContent = `${credits.toLocaleString('ru-RU')} ₵`;
    this.carNameEl.textContent = `${spec.displayName} — ${spec.ruSubtitle}`;
    this.carMetaEl.innerHTML = `
      <span>Шины: <b>${TIRE_LABELS[setup.tireType].name}</b></span>
      <span>Двиг.: <b>${setup.engineLevel}/5</b></span>
      <span>Броня: <b>${setup.armorLevel}/5</b></span>
      <span>Масса: <b>${ratings.massKg} кг</b></span>
      <span>Прочность: <b>${ratings.durabilityHp} HP</b></span>
    `;
  }

  public setVisible(visible: boolean): void {
    this.root.classList.toggle('is-visible', visible);
    this.root.setAttribute('aria-hidden', String(!visible));
  }

  public dispose(): void {
    this.root.remove();
  }
}
