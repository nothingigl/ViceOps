import type {
  DailyContractRecord,
  GadgetId,
  GearRatioPreset,
  GraphicsQuality,
  SaveState,
  TireType,
  VehicleClassId,
  VehicleSetup,
} from '../types';
import {
  createDefaultVehicleSetup,
  VEHICLE_CLASS_ORDER,
  VEHICLE_CLASS_SPECS,
} from '../vehicle/VehicleSpecs';

const STORAGE_KEY = 'vice_ops_save_v1';
const SETUP_CODE_PREFIX = 'VO1-';
const SAVE_SCHEMA_VERSION = 3;

const VALID_CLASSES = new Set<VehicleClassId>(['street_coupe', 'tactical_suv', 'interceptor']);
const VALID_TIRES = new Set<TireType>(['slick', 'wet', 'offroad']);
const VALID_GEARS = new Set<GearRatioPreset>(['short', 'balanced', 'long']);
const VALID_GADGETS = new Set<GadgetId>(['emp', 'smoke', 'jammer']);
const VALID_QUALITIES = new Set<GraphicsQuality>(['low', 'medium', 'high']);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function sanitizeColor(color: unknown, fallback: string): string {
  return typeof color === 'string' && HEX_COLOR_RE.test(color) ? color.toLowerCase() : fallback;
}

function sanitizeGadgets(raw: unknown): GadgetId[] {
  const result: GadgetId[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (VALID_GADGETS.has(item as GadgetId) && !result.includes(item as GadgetId)) {
        result.push(item as GadgetId);
      }
      if (result.length === 2) break;
    }
  }
  const defaults: GadgetId[] = ['emp', 'smoke', 'jammer'];
  for (const d of defaults) {
    if (result.length === 2) break;
    if (!result.includes(d)) result.push(d);
  }
  return result;
}

function sanitizeVehicleSetup(
  raw: Partial<VehicleSetup>,
  fallbackClass: VehicleClassId = 'street_coupe',
): VehicleSetup {
  const vehicleClass: VehicleClassId =
    raw.vehicleClass && VALID_CLASSES.has(raw.vehicleClass) ? raw.vehicleClass : fallbackClass;
  const base = createDefaultVehicleSetup(vehicleClass);

  const engineLevel = clamp(
    Math.round(typeof raw.engineLevel === 'number' ? raw.engineLevel : base.engineLevel),
    0,
    5,
  );
  const armorLevel = clamp(
    Math.round(typeof raw.armorLevel === 'number' ? raw.armorLevel : base.armorLevel),
    0,
    5,
  );
  const suspensionStiffness = clamp(
    typeof raw.suspensionStiffness === 'number'
      ? raw.suspensionStiffness
      : base.suspensionStiffness,
    0,
    1,
  );
  const tireType: TireType =
    raw.tireType && VALID_TIRES.has(raw.tireType) ? raw.tireType : base.tireType;
  const gearRatioPreset: GearRatioPreset =
    raw.gearRatioPreset && VALID_GEARS.has(raw.gearRatioPreset)
      ? raw.gearRatioPreset
      : base.gearRatioPreset;

  return {
    ...base,
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : base.id,
    vehicleClass,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : base.name,
    tireType,
    engineLevel,
    enginePower: Number((1 + engineLevel * 0.095).toFixed(3)),
    suspensionStiffness: Number(suspensionStiffness.toFixed(2)),
    gearRatioPreset,
    armorLevel,
    gadgets: sanitizeGadgets(raw.gadgets),
    primaryColor: sanitizeColor(raw.primaryColor, base.primaryColor),
    accentColor: sanitizeColor(raw.accentColor, base.accentColor),
  };
}

export function createInitialSaveState(): SaveState {
  const vehicles = VEHICLE_CLASS_ORDER.map((cls) =>
    sanitizeVehicleSetup(createDefaultVehicleSetup(cls), cls),
  );
  const isCoarsePointer =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  return {
    version: SAVE_SCHEMA_VERSION,
    credits: 50000,
    reputation: 0,
    activeVehicleId: vehicles[0].id,
    unlockedVehicleClasses: ['street_coupe'],
    vehicles,
    completedContractIds: [],
    bestTimesSec: {},
    dailyRecords: {},
    unlockedGadgets: ['emp', 'smoke', 'jammer'],
    unlockedTires: ['slick', 'wet', 'offroad'],
    settings: {
      masterVolume: 0.85,
      sfxVolume: 0.9,
      hapticsEnabled: true,
      showFps: false,
      graphicsQuality: isCoarsePointer ? 'medium' : 'high',
    },
    updatedAt: new Date().toISOString(),
  };
}

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Encodes a VehicleSetup into a short, offline-shareable Base64 tuning code (`VO1-...`).
 */
export function encodeSetupCode(setup: VehicleSetup): string {
  const compact = [
    setup.vehicleClass === 'street_coupe' ? 0 : setup.vehicleClass === 'tactical_suv' ? 1 : 2,
    setup.tireType === 'slick' ? 0 : setup.tireType === 'wet' ? 1 : 2,
    clamp(Math.round(setup.engineLevel), 0, 5),
    clamp(Math.round(setup.armorLevel), 0, 5),
    Math.round(clamp(setup.suspensionStiffness, 0, 1) * 100),
    setup.gearRatioPreset === 'short' ? 0 : setup.gearRatioPreset === 'balanced' ? 1 : 2,
    setup.primaryColor.replace('#', ''),
    setup.accentColor.replace('#', ''),
  ];
  return SETUP_CODE_PREFIX + toBase64Url(JSON.stringify(compact));
}

/**
 * Decodes and validates a Base64 tuning code (`VO1-...`) into a sanitized VehicleSetup.
 */
export function decodeSetupCode(rawCode: string): VehicleSetup | null {
  const trimmed = rawCode.trim();
  if (!trimmed.startsWith(SETUP_CODE_PREFIX)) return null;

  try {
    const json = fromBase64Url(trimmed.slice(SETUP_CODE_PREFIX.length));
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length < 8) return null;

    const [clsIdx, tireIdx, engineLvl, armorLvl, suspPct, gearIdx, primaryHex, accentHex] = parsed;

    const classMap: VehicleClassId[] = ['street_coupe', 'tactical_suv', 'interceptor'];
    const tireMap: TireType[] = ['slick', 'wet', 'offroad'];
    const gearMap: GearRatioPreset[] = ['short', 'balanced', 'long'];

    if (
      typeof clsIdx !== 'number' ||
      typeof tireIdx !== 'number' ||
      typeof engineLvl !== 'number' ||
      typeof armorLvl !== 'number' ||
      typeof suspPct !== 'number' ||
      typeof gearIdx !== 'number' ||
      typeof primaryHex !== 'string' ||
      typeof accentHex !== 'string'
    ) {
      return null;
    }

    const vehicleClass = classMap[clsIdx];
    const tireType = tireMap[tireIdx];
    const gearRatioPreset = gearMap[gearIdx];
    if (!vehicleClass || !tireType || !gearRatioPreset) return null;

    return sanitizeVehicleSetup(
      {
        vehicleClass,
        tireType,
        engineLevel: engineLvl,
        armorLevel: armorLvl,
        suspensionStiffness: suspPct / 100,
        gearRatioPreset,
        primaryColor: `#${primaryHex}`,
        accentColor: `#${accentHex}`,
      },
      vehicleClass,
    );
  } catch {
    return null;
  }
}

export class SaveManager {
  private state: SaveState;

  constructor() {
    this.state = this.load();
  }

  public getState(): Readonly<SaveState> {
    return this.state;
  }

  public getCredits(): number {
    return this.state.credits;
  }

  public isClassUnlocked(cls: VehicleClassId): boolean {
    return this.state.unlockedVehicleClasses.includes(cls);
  }

  public getVehicleByClass(cls: VehicleClassId): VehicleSetup {
    const found = this.state.vehicles.find((v) => v.vehicleClass === cls);
    if (found) return found;
    const created = createDefaultVehicleSetup(cls);
    this.state.vehicles.push(created);
    this.persist();
    return created;
  }

  public getActiveVehicle(): VehicleSetup {
    const found = this.state.vehicles.find((v) => v.id === this.state.activeVehicleId);
    if (found && this.isClassUnlocked(found.vehicleClass)) {
      return found;
    }
    const fallback = this.getVehicleByClass('street_coupe');
    this.state.activeVehicleId = fallback.id;
    this.persist();
    return fallback;
  }

  public setActiveVehicleClass(cls: VehicleClassId): VehicleSetup | null {
    if (!this.isClassUnlocked(cls)) return null;
    const veh = this.getVehicleByClass(cls);
    this.state.activeVehicleId = veh.id;
    this.persist();
    return veh;
  }

  public unlockVehicleClass(cls: VehicleClassId): { ok: boolean; reason?: string } {
    if (this.isClassUnlocked(cls)) return { ok: true };
    const cost = VEHICLE_CLASS_SPECS[cls].unlockCost;
    if (this.state.credits < cost) {
      return { ok: false, reason: 'Недостаточно кредитов' };
    }
    this.state.credits -= cost;
    this.state.unlockedVehicleClasses.push(cls);
    const veh = this.getVehicleByClass(cls);
    this.state.activeVehicleId = veh.id;
    this.persist();
    return { ok: true };
  }

  public updateVehicleSetup(updated: VehicleSetup): VehicleSetup {
    const sanitized = sanitizeVehicleSetup(updated, updated.vehicleClass);
    const idx = this.state.vehicles.findIndex((v) => v.vehicleClass === sanitized.vehicleClass);
    if (idx >= 0) {
      this.state.vehicles[idx] = sanitized;
    } else {
      this.state.vehicles.push(sanitized);
    }
    if (this.isClassUnlocked(sanitized.vehicleClass)) {
      this.state.activeVehicleId = sanitized.id;
    }
    this.persist();
    return sanitized;
  }

  public importSetupCode(code: string): {
    ok: boolean;
    setup?: VehicleSetup;
    unlockedNow?: boolean;
    error?: string;
  } {
    const decoded = decodeSetupCode(code);
    if (!decoded) {
      return { ok: false, error: 'Неверный код тюнинга. Проверьте формат VO1-...' };
    }

    let unlockedNow = false;
    if (!this.isClassUnlocked(decoded.vehicleClass)) {
      const unlockAttempt = this.unlockVehicleClass(decoded.vehicleClass);
      if (!unlockAttempt.ok) {
        return {
          ok: false,
          error: `Класс ${VEHICLE_CLASS_SPECS[decoded.vehicleClass].displayName} закрыт и не хватает кредитов для открытия.`,
        };
      }
      unlockedNow = true;
    }

    const saved = this.updateVehicleSetup(decoded);
    return { ok: true, setup: saved, unlockedNow };
  }

  public exportSetupCode(setup: VehicleSetup): string {
    return encodeSetupCode(setup);
  }

  public setActiveGadgets(gadgets: GadgetId[]): VehicleSetup {
    const active = this.getActiveVehicle();
    const updated: VehicleSetup = {
      ...active,
      gadgets: sanitizeGadgets(gadgets),
    };
    return this.updateVehicleSetup(updated);
  }

  public recordContractReward(contractId: string, creditsEarned: number, timeSec: number): number {
    const cleanReward = Math.max(0, Math.round(creditsEarned));
    this.state.credits += cleanReward;
    this.state.reputation += Math.max(10, Math.round(cleanReward / 250));
    if (!this.state.completedContractIds.includes(contractId)) {
      this.state.completedContractIds.push(contractId);
    }
    const prevBest = this.state.bestTimesSec[contractId];
    if (typeof prevBest !== 'number' || timeSec < prevBest) {
      this.state.bestTimesSec[contractId] = Number(timeSec.toFixed(1));
    }
    this.persist();
    return this.state.credits;
  }

  public getDailyRecord(dateKey: string): DailyContractRecord | null {
    return this.state.dailyRecords[dateKey] ?? null;
  }

  public recordDailyContractResult(record: DailyContractRecord): {
    isNewRecord: boolean;
    bestRecord: DailyContractRecord;
  } {
    const cleanRecord: DailyContractRecord = {
      ...record,
      bestTimeSec: Number(record.bestTimeSec.toFixed(1)),
    };
    const existing = this.state.dailyRecords[record.dateKey];
    if (!existing || cleanRecord.bestTimeSec < existing.bestTimeSec) {
      this.state.dailyRecords[record.dateKey] = cleanRecord;
      this.persist();
      return { isNewRecord: true, bestRecord: cleanRecord };
    }
    return { isNewRecord: false, bestRecord: existing };
  }

  public getGraphicsQuality(): GraphicsQuality {
    return this.state.settings.graphicsQuality;
  }

  public setGraphicsQuality(quality: GraphicsQuality): void {
    if (!VALID_QUALITIES.has(quality)) return;
    this.state.settings.graphicsQuality = quality;
    this.persist();
  }

  private load(): SaveState {
    const fallback = createInitialSaveState();
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<SaveState>;

      const unlocked: VehicleClassId[] = Array.isArray(parsed.unlockedVehicleClasses)
        ? parsed.unlockedVehicleClasses.filter((c): c is VehicleClassId => VALID_CLASSES.has(c))
        : ['street_coupe'];
      if (!unlocked.includes('street_coupe')) unlocked.unshift('street_coupe');

      const parsedVehicles = Array.isArray(parsed.vehicles) ? parsed.vehicles : [];
      const vehicles = VEHICLE_CLASS_ORDER.map((cls) => {
        const match = parsedVehicles.find((v) => v?.vehicleClass === cls);
        return match ? sanitizeVehicleSetup(match, cls) : createDefaultVehicleSetup(cls);
      });

      const activeId =
        typeof parsed.activeVehicleId === 'string' &&
        vehicles.some((v) => v.id === parsed.activeVehicleId)
          ? parsed.activeVehicleId
          : vehicles[0].id;

      const parsedQuality = parsed.settings?.graphicsQuality;
      const graphicsQuality: GraphicsQuality =
        parsedQuality && VALID_QUALITIES.has(parsedQuality)
          ? parsedQuality
          : fallback.settings.graphicsQuality;

      return {
        ...fallback,
        version: SAVE_SCHEMA_VERSION,
        credits:
          typeof parsed.credits === 'number' && Number.isFinite(parsed.credits)
            ? Math.max(0, Math.round(parsed.credits))
            : fallback.credits,
        reputation:
          typeof parsed.reputation === 'number' && Number.isFinite(parsed.reputation)
            ? Math.max(0, Math.round(parsed.reputation))
            : 0,
        activeVehicleId: activeId,
        unlockedVehicleClasses: unlocked,
        vehicles,
        completedContractIds: Array.isArray(parsed.completedContractIds)
          ? parsed.completedContractIds
          : [],
        bestTimesSec:
          parsed.bestTimesSec && typeof parsed.bestTimesSec === 'object'
            ? parsed.bestTimesSec
            : {},
        dailyRecords:
          parsed.dailyRecords && typeof parsed.dailyRecords === 'object'
            ? parsed.dailyRecords
            : {},
        settings: {
          ...fallback.settings,
          ...(parsed.settings ?? {}),
          graphicsQuality,
        },
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : fallback.updatedAt,
      };
    } catch {
      return fallback;
    }
  }

  private persist(): void {
    this.state.updatedAt = new Date().toISOString();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore storage quota or private-mode errors gracefully
    }
  }
}
