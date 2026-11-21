import type {
  GearRatioPreset,
  TireType,
  VehicleClassId,
  VehicleSetup,
} from '../types';
import {
  BODY_COLOR_SWATCHES,
  computeDisplayRatings,
  GEAR_PRESET_LABELS,
  NEON_COLOR_SWATCHES,
  TIRE_LABELS,
  VEHICLE_CLASS_ORDER,
  VEHICLE_CLASS_SPECS,
} from '../vehicle/VehicleSpecs';

export interface GarageUICallbacks {
  onBackToMenu: () => void;
  onOpenTacticalMap: () => void;
  onLaunchCruise: () => void;
  onSelectClass: (cls: VehicleClassId) => void;
  onUnlockClass: (cls: VehicleClassId) => void;
  onSetupChange: (setup: VehicleSetup) => void;
  onCopyCode: (setup: VehicleSetup) => void;
  onImportCode: (rawCode: string) => void;
}

export class GarageUI {
  private readonly root: HTMLDivElement;
  private readonly creditsEl: HTMLSpanElement;
  private readonly launchBtnEl: HTMLButtonElement;
  private readonly classDescEl: HTMLParagraphElement;
  private readonly unlockBannerEl: HTMLDivElement;
  private readonly unlockTextEl: HTMLSpanElement;
  private readonly unlockBtnEl: HTMLButtonElement;
  private readonly tuningFieldsEl: HTMLDivElement;
  private readonly tireHintEl: HTMLDivElement;
  private readonly gearHintEl: HTMLDivElement;
  private readonly suspValEl: HTMLSpanElement;
  private readonly suspSliderEl: HTMLInputElement;
  private readonly bodyPickerEl: HTMLInputElement;
  private readonly neonPickerEl: HTMLInputElement;
  private readonly importRowEl: HTMLDivElement;
  private readonly importInputEl: HTMLInputElement;
  private readonly toastEl: HTMLDivElement;

  private readonly statSpeedBar: HTMLDivElement;
  private readonly statSpeedVal: HTMLSpanElement;
  private readonly statAccelBar: HTMLDivElement;
  private readonly statHandlingBar: HTMLDivElement;
  private readonly statDurBar: HTMLDivElement;
  private readonly statDurVal: HTMLSpanElement;
  private readonly statMassVal: HTMLSpanElement;

  private readonly classButtons = new Map<VehicleClassId, HTMLButtonElement>();
  private readonly tireButtons = new Map<TireType, HTMLButtonElement>();
  private readonly gearButtons = new Map<GearRatioPreset, HTMLButtonElement>();
  private readonly engineButtons: HTMLButtonElement[] = [];
  private readonly armorButtons: HTMLButtonElement[] = [];
  private readonly bodySwatchBtns = new Map<string, HTMLButtonElement>();
  private readonly neonSwatchBtns = new Map<string, HTMLButtonElement>();

  private currentSetup: VehicleSetup | null = null;
  private currentUnlocked = true;
  private toastTimeoutId: number | null = null;

  constructor(container: HTMLElement, callbacks: GarageUICallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'garage-ui';

    const classTabsHtml = VEHICLE_CLASS_ORDER.map((cls) => {
      const spec = VEHICLE_CLASS_SPECS[cls];
      return `
        <button type="button" class="garage-class-tab" data-class="${cls}">
          <span class="garage-class-name">${spec.displayName}</span>
          <span class="garage-class-sub">${spec.ruSubtitle}</span>
        </button>
      `;
    }).join('');

    const levelBtns = (kind: 'engine' | 'armor') =>
      [0, 1, 2, 3, 4, 5]
        .map(
          (lvl) =>
            `<button type="button" class="garage-lvl-btn" data-lvl-kind="${kind}" data-lvl="${lvl}">${lvl}</button>`,
        )
        .join('');

    const bodySwatchesHtml = BODY_COLOR_SWATCHES.map(
      (s) =>
        `<button type="button" class="color-swatch" data-body-color="${s.hex}" title="${s.name}" style="--swatch:${s.hex}"></button>`,
    ).join('');

    const neonSwatchesHtml = NEON_COLOR_SWATCHES.map(
      (s) =>
        `<button type="button" class="color-swatch color-swatch--neon" data-neon-color="${s.hex}" title="${s.name}" style="--swatch:${s.hex}"></button>`,
    ).join('');

    this.root.innerHTML = `
      <header class="garage-top">
        <div class="garage-top-left">
          <button type="button" class="hud-glass hud-action-btn" data-role="back-menu">
            ← Меню
          </button>
          <div class="hud-glass garage-orbit-hint">
            Вращайте камеру мышью или свайпом
          </div>
        </div>

        <div class="garage-top-right">
          <div class="hud-glass credits-pill">
            <span class="credits-label">КРЕДИТЫ</span>
            <span class="credits-value" data-role="credits">50 000 ₵</span>
          </div>
          <button type="button" class="hud-glass hud-action-btn" data-role="free-cruise">
            Круиз
          </button>
          <button type="button" class="garage-launch-btn" data-role="launch-cruise">
            Тактическая карта →
          </button>
        </div>
      </header>

      <div class="garage-toast" data-role="toast"></div>

      <aside class="hud-glass garage-panel" aria-label="Тюнинг автомобиля">
        <div class="garage-panel-header">
          <div class="garage-kicker">3D-ГАРАЖ • ТАКТИЧЕСКИЙ ТЮНИНГ</div>
          <div class="garage-class-tabs">${classTabsHtml}</div>
          <p class="garage-class-desc" data-role="class-desc"></p>
        </div>

        <div class="garage-unlock-banner" data-role="unlock-banner" hidden>
          <span data-role="unlock-text">Класс закрыт</span>
          <button type="button" class="garage-unlock-btn" data-role="unlock-btn">
            Открыть
          </button>
        </div>

        <div class="garage-stats">
          <div class="stat-row">
            <span class="stat-label">Макс. скорость</span>
            <div class="stat-bar"><div class="stat-fill" data-role="stat-speed"></div></div>
            <span class="stat-num" data-role="stat-speed-val">260 км/ч</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Разгон</span>
            <div class="stat-bar"><div class="stat-fill" data-role="stat-accel"></div></div>
            <span class="stat-num" data-role="stat-mass-val">1260 кг</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Управляемость</span>
            <div class="stat-bar"><div class="stat-fill" data-role="stat-handling"></div></div>
            <span class="stat-num">60 Гц</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Прочность</span>
            <div class="stat-bar"><div class="stat-fill stat-fill--crimson" data-role="stat-dur"></div></div>
            <span class="stat-num" data-role="stat-dur-val">100 HP</span>
          </div>
        </div>

        <div class="garage-tuning-fields" data-role="tuning-fields">
          <div class="tuning-group">
            <div class="tuning-label">Шины</div>
            <div class="tuning-seg-row">
              <button type="button" class="tuning-seg-btn" data-tire="slick">Слики</button>
              <button type="button" class="tuning-seg-btn" data-tire="wet">Дождевые</button>
              <button type="button" class="tuning-seg-btn" data-tire="offroad">Внедорожные</button>
            </div>
            <div class="tuning-hint" data-role="tire-hint"></div>
          </div>

          <div class="tuning-group">
            <div class="tuning-label-row">
              <span class="tuning-label">Двигатель</span>
              <span class="tuning-sub">Уровень 0–5 (+тяга и разгон)</span>
            </div>
            <div class="garage-lvl-row">${levelBtns('engine')}</div>
          </div>

          <div class="tuning-group">
            <div class="tuning-label-row">
              <span class="tuning-label">Броня</span>
              <span class="tuning-sub">Уровень 0–5 (+прочность, +90 кг/ур.)</span>
            </div>
            <div class="garage-lvl-row">${levelBtns('armor')}</div>
          </div>

          <div class="tuning-group">
            <div class="tuning-label-row">
              <span class="tuning-label">Жёсткость подвески</span>
              <span class="tuning-val" data-role="susp-val">52%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value="52"
              class="tuning-slider"
              data-role="susp-slider"
            />
            <div class="tuning-slider-scale">
              <span>Мягкая (крен и плавность)</span>
              <span>Жёсткая (трек)</span>
            </div>
          </div>

          <div class="tuning-group">
            <div class="tuning-label">Передаточные числа КПП</div>
            <div class="tuning-seg-row">
              <button type="button" class="tuning-seg-btn" data-gear="short">Короткие</button>
              <button type="button" class="tuning-seg-btn" data-gear="balanced">Баланс</button>
              <button type="button" class="tuning-seg-btn" data-gear="long">Длинные</button>
            </div>
            <div class="tuning-hint" data-role="gear-hint"></div>
          </div>

          <div class="tuning-group">
            <div class="tuning-label-row">
              <span class="tuning-label">Цвет кузова</span>
              <label class="color-picker-wrap">
                Свой
                <input type="color" data-role="body-picker" value="#162238" />
              </label>
            </div>
            <div class="swatch-row">${bodySwatchesHtml}</div>
          </div>

          <div class="tuning-group">
            <div class="tuning-label-row">
              <span class="tuning-label">Цвет неона</span>
              <label class="color-picker-wrap">
                Свой
                <input type="color" data-role="neon-picker" value="#00f0ff" />
              </label>
            </div>
            <div class="swatch-row">${neonSwatchesHtml}</div>
          </div>

          <div class="tuning-group tuning-share">
            <div class="tuning-label">Обмен конфигурацией (Base64)</div>
            <div class="tuning-share-btns">
              <button type="button" class="tuning-share-btn" data-role="copy-code">
                Скопировать код тюнинга
              </button>
              <button type="button" class="tuning-share-btn tuning-share-btn--alt" data-role="toggle-import">
                Импортировать код
              </button>
            </div>
            <div class="tuning-import-row" data-role="import-row" hidden>
              <input
                type="text"
                class="tuning-import-input"
                data-role="import-input"
                placeholder="Вставьте код вида VO1-..."
                spellcheck="false"
                autocomplete="off"
              />
              <button type="button" class="tuning-apply-btn" data-role="apply-import">
                Применить
              </button>
            </div>
          </div>
        </div>
      </aside>
    `;

    container.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => {
      const el = this.root.querySelector<T>(sel);
      if (!el) throw new Error(`GarageUI element missing: ${sel}`);
      return el;
    };

    this.creditsEl = q('[data-role="credits"]');
    this.launchBtnEl = q('[data-role="launch-cruise"]');
    this.classDescEl = q('[data-role="class-desc"]');
    this.unlockBannerEl = q('[data-role="unlock-banner"]');
    this.unlockTextEl = q('[data-role="unlock-text"]');
    this.unlockBtnEl = q('[data-role="unlock-btn"]');
    this.tuningFieldsEl = q('[data-role="tuning-fields"]');
    this.tireHintEl = q('[data-role="tire-hint"]');
    this.gearHintEl = q('[data-role="gear-hint"]');
    this.suspValEl = q('[data-role="susp-val"]');
    this.suspSliderEl = q('[data-role="susp-slider"]');
    this.bodyPickerEl = q('[data-role="body-picker"]');
    this.neonPickerEl = q('[data-role="neon-picker"]');
    this.importRowEl = q('[data-role="import-row"]');
    this.importInputEl = q('[data-role="import-input"]');
    this.toastEl = q('[data-role="toast"]');

    this.statSpeedBar = q('[data-role="stat-speed"]');
    this.statSpeedVal = q('[data-role="stat-speed-val"]');
    this.statAccelBar = q('[data-role="stat-accel"]');
    this.statHandlingBar = q('[data-role="stat-handling"]');
    this.statDurBar = q('[data-role="stat-dur"]');
    this.statDurVal = q('[data-role="stat-dur-val"]');
    this.statMassVal = q('[data-role="stat-mass-val"]');

    // Top bar
    q('[data-role="back-menu"]').addEventListener('click', () => callbacks.onBackToMenu());
    this.launchBtnEl.addEventListener('click', () => {
      if (!this.currentUnlocked && this.currentSetup) {
        callbacks.onUnlockClass(this.currentSetup.vehicleClass);
        return;
      }
      callbacks.onLaunchCruise();
    });

    this.unlockBtnEl.addEventListener('click', () => {
      if (this.currentSetup) callbacks.onUnlockClass(this.currentSetup.vehicleClass);
    });

    // Class tabs
    VEHICLE_CLASS_ORDER.forEach((cls) => {
      const btn = q<HTMLButtonElement>(`[data-class="${cls}"]`);
      this.classButtons.set(cls, btn);
      btn.addEventListener('click', () => callbacks.onSelectClass(cls));
    });

    const emitPatch = (patch: Partial<VehicleSetup>) => {
      if (!this.currentSetup || !this.currentUnlocked) return;
      const next: VehicleSetup = { ...this.currentSetup, ...patch };
      if (typeof patch.engineLevel === 'number') {
        next.enginePower = Number((1 + patch.engineLevel * 0.095).toFixed(3));
      }
      this.currentSetup = next;
      callbacks.onSetupChange(next);
    };

    // Tire buttons
    (['slick', 'wet', 'offroad'] as TireType[]).forEach((tire) => {
      const btn = q<HTMLButtonElement>(`[data-tire="${tire}"]`);
      this.tireButtons.set(tire, btn);
      btn.addEventListener('click', () => emitPatch({ tireType: tire }));
    });

    // Gear ratio preset buttons
    (['short', 'balanced', 'long'] as GearRatioPreset[]).forEach((gear) => {
      const btn = q<HTMLButtonElement>(`[data-gear="${gear}"]`);
      this.gearButtons.set(gear, btn);
      btn.addEventListener('click', () => emitPatch({ gearRatioPreset: gear }));
    });

    // Engine & Armor 0..5 level buttons
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-lvl-kind="engine"]')
      .forEach((btn) => {
        this.engineButtons.push(btn);
        btn.addEventListener('click', () => {
          emitPatch({ engineLevel: Number(btn.dataset.lvl) });
        });
      });

    this.root
      .querySelectorAll<HTMLButtonElement>('[data-lvl-kind="armor"]')
      .forEach((btn) => {
        this.armorButtons.push(btn);
        btn.addEventListener('click', () => {
          emitPatch({ armorLevel: Number(btn.dataset.lvl) });
        });
      });

    // Suspension stiffness slider
    this.suspSliderEl.addEventListener('input', () => {
      const pct = Number(this.suspSliderEl.value);
      this.suspValEl.textContent = `${pct}%`;
      emitPatch({ suspensionStiffness: pct / 100 });
    });

    // Body color swatches + native picker
    BODY_COLOR_SWATCHES.forEach((s) => {
      const btn = q<HTMLButtonElement>(`[data-body-color="${s.hex}"]`);
      this.bodySwatchBtns.set(s.hex.toLowerCase(), btn);
      btn.addEventListener('click', () => emitPatch({ primaryColor: s.hex }));
    });
    this.bodyPickerEl.addEventListener('input', () => {
      emitPatch({ primaryColor: this.bodyPickerEl.value });
    });

    // Neon color swatches + native picker
    NEON_COLOR_SWATCHES.forEach((s) => {
      const btn = q<HTMLButtonElement>(`[data-neon-color="${s.hex}"]`);
      this.neonSwatchBtns.set(s.hex.toLowerCase(), btn);
      btn.addEventListener('click', () => emitPatch({ accentColor: s.hex }));
    });
    this.neonPickerEl.addEventListener('input', () => {
      emitPatch({ accentColor: this.neonPickerEl.value });
    });

    // Share / import buttons
    q('[data-role="copy-code"]').addEventListener('click', () => {
      if (this.currentSetup) callbacks.onCopyCode(this.currentSetup);
    });
    q('[data-role="toggle-import"]').addEventListener('click', () => {
      this.importRowEl.hidden = !this.importRowEl.hidden;
      if (!this.importRowEl.hidden) {
        this.importInputEl.focus();
      }
    });
    q('[data-role="apply-import"]').addEventListener('click', () => {
      const val = this.importInputEl.value.trim();
      if (!val) {
        this.showToast('Вставьте код тюнинга перед применением');
        return;
      }
      callbacks.onImportCode(val);
    });
    this.importInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        callbacks.onImportCode(this.importInputEl.value.trim());
      }
    });
  }

  public renderState(
    setup: VehicleSetup,
    unlockedClasses: readonly VehicleClassId[],
    credits: number,
  ): void {
    this.currentSetup = setup;
    this.currentUnlocked = unlockedClasses.includes(setup.vehicleClass);
    const spec = VEHICLE_CLASS_SPECS[setup.vehicleClass];
    const ratings = computeDisplayRatings(setup);

    this.creditsEl.textContent = `${credits.toLocaleString('ru-RU')} ₵`;
    this.classDescEl.textContent = spec.description;

    // Class tabs active + lock styling
    this.classButtons.forEach((btn, cls) => {
      btn.classList.toggle('is-active', cls === setup.vehicleClass);
      btn.classList.toggle('is-locked', !unlockedClasses.includes(cls));
    });

    // Unlock banner vs editable tuning fields
    this.unlockBannerEl.hidden = this.currentUnlocked;
    this.tuningFieldsEl.classList.toggle('is-locked', !this.currentUnlocked);
    if (!this.currentUnlocked) {
      this.unlockTextEl.textContent = `Требуется разблокировка класса (${spec.unlockCost.toLocaleString('ru-RU')} ₵)`;
      this.unlockBtnEl.textContent = `Открыть за ${spec.unlockCost.toLocaleString('ru-RU')} ₵`;
      this.unlockBtnEl.disabled = credits < spec.unlockCost;
      this.launchBtnEl.textContent = `Открыть (${spec.unlockCost.toLocaleString('ru-RU')} ₵)`;
    } else {
      this.launchBtnEl.textContent = 'Тактическая карта →';
    }

    // Live stat bars
    this.statSpeedBar.style.transform = `scaleX(${(ratings.topSpeedScore / 100).toFixed(2)})`;
    this.statSpeedVal.textContent = `~${ratings.estimatedTopKmh} км/ч`;
    this.statAccelBar.style.transform = `scaleX(${(ratings.accelScore / 100).toFixed(2)})`;
    this.statMassVal.textContent = `${ratings.massKg} кг`;
    this.statHandlingBar.style.transform = `scaleX(${(ratings.handlingScore / 100).toFixed(2)})`;
    this.statDurBar.style.transform = `scaleX(${(ratings.durabilityScore / 100).toFixed(2)})`;
    this.statDurVal.textContent = `${ratings.durabilityHp} HP`;

    // Tires
    this.tireButtons.forEach((btn, tire) => {
      btn.classList.toggle('is-active', tire === setup.tireType);
    });
    this.tireHintEl.textContent = TIRE_LABELS[setup.tireType].hint;

    // Engine & armor levels
    this.engineButtons.forEach((btn) => {
      const lvl = Number(btn.dataset.lvl);
      btn.classList.toggle('is-active', lvl === setup.engineLevel);
      btn.classList.toggle('is-filled', lvl <= setup.engineLevel && lvl > 0);
    });
    this.armorButtons.forEach((btn) => {
      const lvl = Number(btn.dataset.lvl);
      btn.classList.toggle('is-active', lvl === setup.armorLevel);
      btn.classList.toggle('is-filled', lvl <= setup.armorLevel && lvl > 0);
    });

    // Suspension
    const suspPct = Math.round(setup.suspensionStiffness * 100);
    this.suspSliderEl.value = String(suspPct);
    this.suspValEl.textContent = `${suspPct}%`;

    // Gears
    this.gearButtons.forEach((btn, preset) => {
      btn.classList.toggle('is-active', preset === setup.gearRatioPreset);
    });
    this.gearHintEl.textContent = GEAR_PRESET_LABELS[setup.gearRatioPreset].hint;

    // Colors
    const pCol = setup.primaryColor.toLowerCase();
    const aCol = setup.accentColor.toLowerCase();
    this.bodyPickerEl.value = pCol;
    this.neonPickerEl.value = aCol;
    this.bodySwatchBtns.forEach((btn, hex) => {
      btn.classList.toggle('is-active', hex === pCol);
    });
    this.neonSwatchBtns.forEach((btn, hex) => {
      btn.classList.toggle('is-active', hex === aCol);
    });
  }

  public clearImportInput(): void {
    this.importInputEl.value = '';
    this.importRowEl.hidden = true;
  }

  public showToast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('is-visible');
    if (this.toastTimeoutId !== null) {
      window.clearTimeout(this.toastTimeoutId);
    }
    this.toastTimeoutId = window.setTimeout(() => {
      this.toastEl.classList.remove('is-visible');
      this.toastTimeoutId = null;
    }, 2800);
  }

  public setVisible(visible: boolean): void {
    this.root.classList.toggle('is-visible', visible);
    this.root.setAttribute('aria-hidden', String(!visible));
  }

  public dispose(): void {
    if (this.toastTimeoutId !== null) {
      window.clearTimeout(this.toastTimeoutId);
    }
    this.root.remove();
  }
}
