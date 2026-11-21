import type { DailyContractRecord, GadgetId, VehicleSetup } from '../types';
import { GADGET_ORDER, GADGET_SPECS } from '../vehicle/Gadgets';
import { TIRE_LABELS, VEHICLE_CLASS_SPECS } from '../vehicle/VehicleSpecs';
import { WEATHER_LABELS } from '../world/WeatherSystem';
import {
  generateDailyContract,
  generateProceduralContracts,
  getTodayDateKey,
  type TacticalContract,
} from './ContractEngine';

export interface TacticalMapCallbacks {
  onBackToMenu: () => void;
  onOpenGarage: () => void;
  onStartFreeCruise: () => void;
  onLaunchContract: (contract: TacticalContract, gadgets: [GadgetId, GadgetId]) => void;
  onGadgetsChange: (gadgets: [GadgetId, GadgetId]) => void;
  onShareDailyResult: (record: DailyContractRecord) => void;
}

const ROAD_COORDS = [-320, -160, 0, 160, 320];
const BLOCK_CENTERS = [-240, -80, 80, 240];
const MAP_MIN = -360;
const MAP_MAX = 410;
const MAP_SPAN = MAP_MAX - MAP_MIN;

export class TacticalMap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly creditsEl: HTMLSpanElement;
  private readonly dailySlotEl: HTMLDivElement;
  private readonly contractListEl: HTMLDivElement;
  private readonly briefingTitleEl: HTMLDivElement;
  private readonly briefingDescEl: HTMLParagraphElement;
  private readonly tireAdviceEl: HTMLDivElement;
  private readonly gadgetGridEl: HTMLDivElement;
  private readonly vehicleSummaryEl: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;

  private readonly callbacks: TacticalMapCallbacks;
  private dailyContract: TacticalContract;
  private dailyRecord: DailyContractRecord | null = null;
  private contracts: TacticalContract[] = [];
  /** -1 = Daily Contract selected, 0..2 = standard procedural contract index */
  private selectedIndex = -1;
  private selectedGadgets: [GadgetId, GadgetId] = ['emp', 'smoke'];
  private activeSetup: VehicleSetup | null = null;
  private visible = false;
  private animClock = 0;
  private toastTimeoutId: number | null = null;

  constructor(container: HTMLElement, callbacks: TacticalMapCallbacks) {
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.className = 'tactical-map-screen';
    this.root.innerHTML = `
      <header class="tactical-top">
        <div class="tactical-top-left">
          <button type="button" class="hud-glass hud-action-btn" data-role="back-menu">
            ← Меню
          </button>
          <button type="button" class="hud-glass hud-action-btn" data-role="open-garage">
            3D-Гараж
          </button>
          <button type="button" class="hud-glass hud-action-btn" data-role="free-cruise">
            Свободный круиз
          </button>
        </div>

        <div class="tactical-top-right">
          <div class="hud-glass credits-pill">
            <span class="credits-label">КРЕДИТЫ</span>
            <span class="credits-value" data-role="credits">50 000 ₵</span>
          </div>
          <button type="button" class="hud-glass hud-action-btn" data-role="reroll">
            Обновить контракты
          </button>
        </div>
      </header>

      <div class="garage-toast" data-role="toast"></div>

      <div class="tactical-layout">
        <section class="hud-glass tactical-tablet">
          <div class="tactical-tablet-bar">
            <span class="tactical-kicker">ТАКТИЧЕСКИЙ ПЛАНШЕТ • СЕКТОР VICE COAST</span>
            <div class="tactical-legend">
              <span class="legend-dot legend-dot--start">Старт</span>
              <span class="legend-dot legend-dot--target">Цель (5 сек.)</span>
              <span class="legend-dot legend-dot--extract">Эвакуация</span>
              <span class="legend-dot legend-dot--patrol">Патрули</span>
            </div>
          </div>
          <div class="tactical-canvas-wrap">
            <canvas class="tactical-canvas" data-role="map-canvas" width="640" height="640"></canvas>
          </div>
        </section>

        <aside class="hud-glass tactical-sidebar">
          <div class="tactical-section">
            <div class="tactical-section-title">КОНТРАКТ ДНЯ (ОФЛАЙН-ЧЕЛЛЕНДЖ)</div>
            <div class="daily-slot" data-role="daily-slot"></div>
          </div>

          <div class="tactical-section">
            <div class="tactical-section-title">ДОСТУПНЫЕ DMZ-КОНТРАКТЫ</div>
            <div class="contract-list" data-role="contract-list"></div>
          </div>

          <div class="tactical-section tactical-briefing">
            <div class="briefing-title" data-role="briefing-title">Операция</div>
            <p class="briefing-desc" data-role="briefing-desc"></p>
            <div class="tire-advice" data-role="tire-advice"></div>
          </div>

          <div class="tactical-section">
            <div class="tactical-section-row">
              <span class="tactical-section-title">ВЫБОР 2 ГАДЖЕТОВ (КЛАВИШИ 1 / 2)</span>
              <span class="tactical-vehicle-mini" data-role="vehicle-summary"></span>
            </div>
            <div class="gadget-picker" data-role="gadget-grid"></div>
          </div>

          <button type="button" class="tactical-launch-btn" data-role="launch-op">
            НАЧАТЬ ОПЕРАЦИЮ →
          </button>
        </aside>
      </div>
    `;

    container.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => {
      const el = this.root.querySelector<T>(sel);
      if (!el) throw new Error(`TacticalMap element missing: ${sel}`);
      return el;
    };

    this.canvas = q<HTMLCanvasElement>('[data-role="map-canvas"]');
    this.ctx = this.canvas.getContext('2d')!;
    this.creditsEl = q('[data-role="credits"]');
    this.dailySlotEl = q('[data-role="daily-slot"]');
    this.contractListEl = q('[data-role="contract-list"]');
    this.briefingTitleEl = q('[data-role="briefing-title"]');
    this.briefingDescEl = q('[data-role="briefing-desc"]');
    this.tireAdviceEl = q('[data-role="tire-advice"]');
    this.gadgetGridEl = q('[data-role="gadget-grid"]');
    this.vehicleSummaryEl = q('[data-role="vehicle-summary"]');
    this.toastEl = q('[data-role="toast"]');

    q('[data-role="back-menu"]').addEventListener('click', () => callbacks.onBackToMenu());
    q('[data-role="open-garage"]').addEventListener('click', () => callbacks.onOpenGarage());
    q('[data-role="free-cruise"]').addEventListener('click', () => callbacks.onStartFreeCruise());
    q('[data-role="reroll"]').addEventListener('click', () => {
      this.rerollContracts();
    });
    q('[data-role="launch-op"]').addEventListener('click', () => {
      const chosen = this.getSelectedContract();
      if (chosen) {
        callbacks.onLaunchContract(chosen, [this.selectedGadgets[0], this.selectedGadgets[1]]);
      }
    });

    // Click directly on any contract marker (including Daily) on the 2D canvas
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
      const py = ((e.clientY - rect.top) / rect.height) * this.canvas.height;

      let bestIdx: number | null = null;
      let bestDist = 42;

      const checkMarker = (c: TacticalContract, idx: number) => {
        const tx = this.worldToCanvas(c.targetZone.x);
        const ty = this.worldToCanvas(c.targetZone.z);
        const d = Math.hypot(px - tx, py - ty);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = idx;
        }
      };

      checkMarker(this.dailyContract, -1);
      this.contracts.forEach((c, idx) => checkMarker(c, idx));

      if (bestIdx !== null) {
        this.selectedIndex = bestIdx;
        this.renderUI();
      }
    });

    this.dailyContract = generateDailyContract(getTodayDateKey());
    this.contracts = generateProceduralContracts(202611);
  }

  public getTodayKey(): string {
    return this.dailyContract.dailyDate ?? getTodayDateKey();
  }

  public rerollContracts(): void {
    this.contracts = generateProceduralContracts(Date.now() & 0xffffff);
    if (this.selectedIndex >= 0) {
      this.selectedIndex = 0;
    }
    this.renderUI();
  }

  public syncState(
    setup: VehicleSetup,
    credits: number,
    dailyRecord: DailyContractRecord | null,
  ): void {
    // Refresh daily contract automatically if calendar date rolled over
    const today = getTodayDateKey();
    if (this.dailyContract.dailyDate !== today) {
      this.dailyContract = generateDailyContract(today);
    }

    this.activeSetup = setup;
    this.dailyRecord = dailyRecord;
    this.creditsEl.textContent = `${credits.toLocaleString('ru-RU')} ₵`;

    const g0: GadgetId = setup.gadgets[0] ?? 'emp';
    const g1: GadgetId =
      setup.gadgets[1] && setup.gadgets[1] !== g0
        ? setup.gadgets[1]
        : g0 === 'smoke'
          ? 'emp'
          : 'smoke';
    this.selectedGadgets = [g0, g1];

    const spec = VEHICLE_CLASS_SPECS[setup.vehicleClass];
    this.vehicleSummaryEl.textContent = `${spec.displayName} • ${TIRE_LABELS[setup.tireType].name}`;
    this.renderUI();
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
    this.visible = visible;
    this.root.classList.toggle('is-visible', visible);
    this.root.setAttribute('aria-hidden', String(!visible));
    if (visible) {
      this.drawMap();
    }
  }

  public update(dt: number): void {
    if (!this.visible) return;
    this.animClock += dt;
    this.drawMap();
  }

  private getSelectedContract(): TacticalContract {
    if (this.selectedIndex === -1) return this.dailyContract;
    return this.contracts[this.selectedIndex] ?? this.dailyContract;
  }

  private toggleGadget(id: GadgetId): void {
    const [a, b] = this.selectedGadgets;
    if (id === a || id === b) {
      this.selectedGadgets = [b, a];
    } else {
      this.selectedGadgets = [a, id];
    }
    this.callbacks.onGadgetsChange([this.selectedGadgets[0], this.selectedGadgets[1]]);
    this.renderGadgetPicker();
  }

  private renderUI(): void {
    // 0. Dedicated Daily Contract Slot
    const dc = this.dailyContract;
    const dailySelected = this.selectedIndex === -1;
    const dailyStars = '★'.repeat(dc.stars) + '☆'.repeat(3 - dc.stars);
    const rec = this.dailyRecord;

    this.dailySlotEl.innerHTML = `
      <div class="daily-card ${dailySelected ? 'is-selected' : ''}" data-role="daily-select">
        <div class="contract-card-top">
          <span class="daily-date-badge">📅 ${dc.dailyDate ?? getTodayDateKey()} • ${dailyStars}</span>
          <span class="contract-weather contract-weather--${dc.weather}">${WEATHER_LABELS[dc.weather]}</span>
        </div>
        <div class="contract-card-title">${dc.title}</div>
        <div class="contract-card-meta">
          <span>${dc.district} → ${dc.extractionZone.label}</span>
          <span>⏱ ${dc.timeLimitSec} сек.</span>
          <span class="contract-reward">+${dc.rewardCredits.toLocaleString('ru-RU')} ₵</span>
        </div>
        <div class="daily-record-row">
          <span class="daily-best-text">
            ${
              rec
                ? `🏆 Лучшее время дня: <b>${rec.bestTimeSec.toFixed(1)} сек.</b> (${rec.vehicleName})`
                : 'Рекорд дня ещё не установлен — пройдите контракт!'
            }
          </span>
          ${
            rec
              ? `<button type="button" class="daily-share-btn" data-role="daily-share">Поделиться результатом</button>`
              : ''
          }
        </div>
      </div>
    `;

    this.dailySlotEl
      .querySelector<HTMLDivElement>('[data-role="daily-select"]')
      ?.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('[data-role="daily-share"]')) return;
        this.selectedIndex = -1;
        this.renderUI();
      });

    if (rec) {
      this.dailySlotEl
        .querySelector<HTMLButtonElement>('[data-role="daily-share"]')
        ?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.callbacks.onShareDailyResult(rec);
        });
    }

    // 1. Standard 3 procedural contract cards
    this.contractListEl.innerHTML = '';
    this.contracts.forEach((c, idx) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `contract-card ${idx === this.selectedIndex ? 'is-selected' : ''}`;
      const starsStr = '★'.repeat(c.stars) + '☆'.repeat(3 - c.stars);
      card.innerHTML = `
        <div class="contract-card-top">
          <span class="contract-stars contract-stars--${c.stars}">${starsStr}</span>
          <span class="contract-weather contract-weather--${c.weather}">${WEATHER_LABELS[c.weather]}</span>
        </div>
        <div class="contract-card-title">${c.title}</div>
        <div class="contract-card-meta">
          <span>${c.district}</span>
          <span>⏱ ${c.timeLimitSec} сек.</span>
          <span class="contract-reward">+${c.rewardCredits.toLocaleString('ru-RU')} ₵</span>
        </div>
      `;
      card.addEventListener('click', () => {
        this.selectedIndex = idx;
        this.renderUI();
      });
      this.contractListEl.appendChild(card);
    });

    // 2. Selected contract briefing & tire recommendation
    const selected = this.getSelectedContract();
    this.briefingTitleEl.textContent = `${selected.title} • Награда +${selected.rewardCredits.toLocaleString('ru-RU')} ₵`;
    this.briefingDescEl.textContent = selected.description;

    const recName = TIRE_LABELS[selected.recommendedTires].name;
    const curTire = this.activeSetup?.tireType ?? 'slick';
    const curName = TIRE_LABELS[curTire].name;
    const isMatch = curTire === selected.recommendedTires;

    this.tireAdviceEl.className = `tire-advice ${isMatch ? 'is-optimal' : 'is-warning'}`;
    this.tireAdviceEl.innerHTML = isMatch
      ? `<span>✓ Рекомендуемые шины под погоду «${WEATHER_LABELS[selected.weather]}»: <b>${recName}</b> (установлены)</span>`
      : `<span>⚠ Рекомендуются шины: <b>${recName}</b> (сейчас: ${curName})</span>
         <button type="button" class="tire-advice-btn" data-role="quick-garage">Сменить в гараже</button>`;

    const quickGarageBtn = this.tireAdviceEl.querySelector<HTMLButtonElement>(
      '[data-role="quick-garage"]',
    );
    quickGarageBtn?.addEventListener('click', () => this.callbacks.onOpenGarage());

    this.renderGadgetPicker();
    this.drawMap();
  }

  private renderGadgetPicker(): void {
    this.gadgetGridEl.innerHTML = '';
    GADGET_ORDER.forEach((id) => {
      const spec = GADGET_SPECS[id];
      const slotIdx = this.selectedGadgets.indexOf(id);
      const isEquipped = slotIdx >= 0;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `gadget-card ${isEquipped ? 'is-equipped' : ''}`;
      btn.innerHTML = `
        <div class="gadget-card-top">
          <span class="gadget-icon">${spec.icon}</span>
          <span class="gadget-slot-tag">${isEquipped ? `СЛОТ ${slotIdx + 1}` : 'ВЫБРАТЬ'}</span>
        </div>
        <div class="gadget-card-name">${spec.name}</div>
        <div class="gadget-card-desc">${spec.description}</div>
      `;
      btn.addEventListener('click', () => this.toggleGadget(id));
      this.gadgetGridEl.appendChild(btn);
    });
  }

  private worldToCanvas(coord: number): number {
    return ((coord - MAP_MIN) / MAP_SPAN) * this.canvas.width;
  }

  private drawMap(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = '#061121';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
    ctx.lineWidth = 1;
    const step = w / 12;
    for (let i = 1; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, h);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i * step);
      ctx.lineTo(w, i * step);
      ctx.stroke();
    }

    const sandStart = this.worldToCanvas(-340);
    const sandEnd = this.worldToCanvas(382);
    ctx.fillStyle = 'rgba(130, 102, 74, 0.28)';
    ctx.fillRect(sandStart, sandStart, sandEnd - sandStart, sandEnd - sandStart);

    const roadStart = this.worldToCanvas(-340);
    const roadEnd = this.worldToCanvas(334);
    ctx.fillStyle = '#0e192d';
    ctx.fillRect(roadStart, roadStart, roadEnd - roadStart, roadEnd - roadStart);

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
    ctx.lineWidth = 8;
    for (const rc of ROAD_COORDS) {
      const p = this.worldToCanvas(rc);
      ctx.beginPath();
      ctx.moveTo(p, roadStart);
      ctx.lineTo(p, roadEnd);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(roadStart, p);
      ctx.lineTo(roadEnd, p);
      ctx.stroke();
    }

    const blockSize = (124 / MAP_SPAN) * w;
    ctx.fillStyle = '#162540';
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.16)';
    ctx.lineWidth = 1.2;
    for (const bx of BLOCK_CENTERS) {
      for (const bz of BLOCK_CENTERS) {
        const cx = this.worldToCanvas(bx) - blockSize / 2;
        const cy = this.worldToCanvas(bz) - blockSize / 2;
        ctx.fillRect(cx, cy, blockSize, blockSize);
        ctx.strokeRect(cx, cy, blockSize, blockSize);
      }
    }

    const selected = this.getSelectedContract();
    const pulse = 0.5 + 0.5 * Math.sin(this.animClock * 3.8);

    // Patrol sectors for selected contract
    for (const sector of selected.patrolSectors) {
      const sx = this.worldToCanvas(sector.x);
      const sy = this.worldToCanvas(sector.z);
      const sr = (sector.radius / MAP_SPAN) * w;

      ctx.fillStyle = `rgba(255, 42, 109, ${0.12 + pulse * 0.08})`;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(255, 42, 109, ${0.48 + pulse * 0.28})`;
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Route lines
    const spX = this.worldToCanvas(selected.spawnPoint.x);
    const spY = this.worldToCanvas(selected.spawnPoint.z);
    const tgX = this.worldToCanvas(selected.targetZone.x);
    const tgY = this.worldToCanvas(selected.targetZone.z);
    const exX = this.worldToCanvas(selected.extractionZone.x);
    const exY = this.worldToCanvas(selected.extractionZone.z);

    ctx.strokeStyle = selected.isDaily ? 'rgba(255, 190, 74, 0.85)' : 'rgba(0, 240, 255, 0.72)';
    ctx.lineWidth = 2.4;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(spX, spY);
    ctx.lineTo(tgX, tgY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(57, 255, 136, 0.78)';
    ctx.beginPath();
    ctx.moveTo(tgX, tgY);
    ctx.lineTo(exX, exY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(spX, spY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillStyle = '#d4e8ff';
    ctx.fillText('СТАРТ', spX + 10, spY + 4);

    ctx.strokeStyle = '#39ff88';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(exX, exY, 13 + pulse * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#39ff88';
    ctx.beginPath();
    ctx.arc(exX, exY, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText('ЭВАКУАЦИЯ', exX - 34, exY - 18);

    // Draw all selectable target markers (Daily + 3 standard)
    const drawNode = (c: TacticalContract, isSelected: boolean) => {
      const tx = this.worldToCanvas(c.targetZone.x);
      const ty = this.worldToCanvas(c.targetZone.z);
      const col = c.isDaily ? '#ffbe4a' : '#00f0ff';

      if (isSelected) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.arc(tx, ty, 15 + pulse * 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = isSelected ? col : c.isDaily ? 'rgba(255, 190, 74, 0.65)' : 'rgba(0, 240, 255, 0.42)';
      ctx.beginPath();
      ctx.arc(tx, ty, isSelected ? 8.5 : 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = isSelected ? '700 12px system-ui, sans-serif' : '600 11px system-ui, sans-serif';
      ctx.fillStyle = isSelected ? col : 'rgba(200, 232, 255, 0.72)';
      const tag = c.isDaily ? `ДЕНЬ • ${c.district}` : `${'★'.repeat(c.stars)} ${c.district}`;
      ctx.fillText(tag, tx + 12, ty + 4);
    };

    this.contracts.forEach((c, idx) => drawNode(c, idx === this.selectedIndex));
    drawNode(this.dailyContract, this.selectedIndex === -1);

    // Subtle radar sweep beam
    const sweepAngle = (this.animClock * 0.55) % (Math.PI * 2);
    const cx = w * 0.5;
    const cy = h * 0.5;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.14)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepAngle) * w * 0.7, cy + Math.sin(sweepAngle) * h * 0.7);
    ctx.stroke();
  }

  public dispose(): void {
    if (this.toastTimeoutId !== null) {
      window.clearTimeout(this.toastTimeoutId);
    }
    this.root.remove();
  }
}
