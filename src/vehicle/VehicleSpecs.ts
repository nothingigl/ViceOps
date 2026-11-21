import type {
  GearRatioPreset,
  TireType,
  VehicleClassId,
  VehicleSetup,
  WeatherMode,
} from '../types';

export type SurfaceType = 'asphalt' | 'offroad';

export interface VehicleClassSpec {
  id: VehicleClassId;
  displayName: string;
  ruSubtitle: string;
  description: string;
  unlockCost: number;
  baseMassKg: number;
  baseTorqueNm: number;
  baseDurability: number;
  aeroDragCoeff: number;
  baseFinalDrive: number;
  redlineRpm: number;
  wheelRadius: number;
  baseGrip: number;
  rearDriftBias: number;
  wetStabilityBonus: number;
  offroadBonus: number;
  defaultSuspension: number;
  defaultTire: TireType;
  defaultGearPreset: GearRatioPreset;
  defaultPrimaryColor: string;
  defaultAccentColor: string;
  collisionRadius: number;
}

export interface DerivedVehiclePhysics {
  massKg: number;
  inertiaY: number;
  maxTorqueNm: number;
  finalDrive: number;
  aeroDragCoeff: number;
  redlineRpm: number;
  revLimitRpm: number;
  wheelRadius: number;
  durability: number;
  collisionRadius: number;
  baseGrip: number;
  rearDriftBias: number;
  frontStiffness: number;
  rearStiffness: number;
  pitchSpring: number;
  pitchDamp: number;
  rollSpring: number;
  rollDamp: number;
  pitchScale: number;
  rollScale: number;
  steerResponsiveness: number;
  dryAsphaltGrip: number;
  rainAsphaltGrip: number;
  offroadGrip: number;
  offroadDragCoeff: number;
  impactDamping: number;
}

export interface VehicleDisplayRatings {
  topSpeedScore: number;
  accelScore: number;
  handlingScore: number;
  durabilityScore: number;
  massKg: number;
  durabilityHp: number;
  estimatedTopKmh: number;
}

export const VEHICLE_CLASS_ORDER: VehicleClassId[] = [
  'street_coupe',
  'tactical_suv',
  'interceptor',
];

export const VEHICLE_CLASS_SPECS: Record<VehicleClassId, VehicleClassSpec> = {
  street_coupe: {
    id: 'street_coupe',
    displayName: 'Street Coupe',
    ruSubtitle: 'Уличное купе',
    description: 'Лёгкое маневренное купе с живой кормой — идеально для заносов и городских виражей.',
    unlockCost: 0,
    baseMassKg: 1260,
    baseTorqueNm: 455,
    baseDurability: 100,
    aeroDragCoeff: 0.34,
    baseFinalDrive: 3.58,
    redlineRpm: 7800,
    wheelRadius: 0.36,
    baseGrip: 1.0,
    rearDriftBias: 0.92,
    wetStabilityBonus: 0,
    offroadBonus: 0,
    defaultSuspension: 0.52,
    defaultTire: 'slick',
    defaultGearPreset: 'balanced',
    defaultPrimaryColor: '#162238',
    defaultAccentColor: '#00f0ff',
    collisionRadius: 1.62,
  },
  tactical_suv: {
    id: 'tactical_suv',
    displayName: 'Tactical SUV',
    ruSubtitle: 'Тактический внедорожник',
    description: 'Тяжёлый бронированный внедорожник с высокой прочностью — уверенно держит дождь и грунт.',
    unlockCost: 15000,
    baseMassKg: 2140,
    baseTorqueNm: 615,
    baseDurability: 190,
    aeroDragCoeff: 0.49,
    baseFinalDrive: 3.72,
    redlineRpm: 6800,
    wheelRadius: 0.44,
    baseGrip: 0.96,
    rearDriftBias: 1.05,
    wetStabilityBonus: 0.14,
    offroadBonus: 0.22,
    defaultSuspension: 0.34,
    defaultTire: 'offroad',
    defaultGearPreset: 'short',
    defaultPrimaryColor: '#1f2933',
    defaultAccentColor: '#ffae42',
    collisionRadius: 1.9,
  },
  interceptor: {
    id: 'interceptor',
    displayName: 'Interceptor',
    ruSubtitle: 'Перехватчик',
    description: 'Сверхнизкий высокоскоростной перехватчик с жёсткой подвеской и огромной максималкой.',
    unlockCost: 20000,
    baseMassKg: 1460,
    baseTorqueNm: 545,
    baseDurability: 130,
    aeroDragCoeff: 0.255,
    baseFinalDrive: 3.32,
    redlineRpm: 8400,
    wheelRadius: 0.37,
    baseGrip: 1.08,
    rearDriftBias: 1.02,
    wetStabilityBonus: 0.03,
    offroadBonus: -0.06,
    defaultSuspension: 0.82,
    defaultTire: 'slick',
    defaultGearPreset: 'long',
    defaultPrimaryColor: '#1a112b',
    defaultAccentColor: '#ff2a6d',
    collisionRadius: 1.72,
  },
};

export const TIRE_LABELS: Record<TireType, { name: string; hint: string }> = {
  slick: {
    name: 'Слики',
    hint: 'Макс. держак на сухом асфальте, сильно скользят в дождь и на грунте',
  },
  wet: {
    name: 'Дождевые',
    hint: 'Стабильное сцепление на мокрой дороге, сбалансированы в сухую погоду',
  },
  offroad: {
    name: 'Внедорожные',
    hint: 'Не теряют скорость и держак на песчаной обочине и грунте',
  },
};

export const GEAR_PRESET_LABELS: Record<GearRatioPreset, { name: string; hint: string }> = {
  short: {
    name: 'Короткие',
    hint: 'Взрывной старт и ускорение, ниже максимальная скорость',
  },
  balanced: {
    name: 'Баланс',
    hint: 'Универсальный баланс разгона и скорости на шоссе',
  },
  long: {
    name: 'Длинные',
    hint: 'Высокая максимальная скорость на прямых, плавнее старт',
  },
};

export const BODY_COLOR_SWATCHES: Array<{ name: string; hex: string }> = [
  { name: 'Ночной сапфир', hex: '#162238' },
  { name: 'Карбон графит', hex: '#1b2029' },
  { name: 'Ультрафиолет', hex: '#24143e' },
  { name: 'Малиновый неон', hex: '#6e1036' },
  { name: 'Бирюзовый металлик', hex: '#0d3d4d' },
  { name: 'Закатный янтарь', hex: '#6d321c' },
  { name: 'Арктический белый', hex: '#cedbe8' },
  { name: 'Тактический олив', hex: '#26332c' },
];

export const NEON_COLOR_SWATCHES: Array<{ name: string; hex: string }> = [
  { name: 'Бирюзовый', hex: '#00f0ff' },
  { name: 'Малиновый', hex: '#ff2a6d' },
  { name: 'Электрик фиолет', hex: '#b44cff' },
  { name: 'Янтарный', hex: '#ffae42' },
  { name: 'Кислотный лайм', hex: '#39ff88' },
  { name: 'Ледяной белый', hex: '#e0f7ff' },
];

const GEAR_FINAL_DRIVE_MULT: Record<GearRatioPreset, number> = {
  short: 1.18,
  balanced: 1.0,
  long: 0.85,
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function createDefaultVehicleSetup(vehicleClass: VehicleClassId): VehicleSetup {
  const spec = VEHICLE_CLASS_SPECS[vehicleClass];
  return {
    id: `veh_${vehicleClass}`,
    vehicleClass,
    name: `${spec.displayName} (${spec.ruSubtitle})`,
    tireType: spec.defaultTire,
    engineLevel: 1,
    enginePower: 1.09,
    suspensionStiffness: spec.defaultSuspension,
    gearRatioPreset: spec.defaultGearPreset,
    rideHeight: vehicleClass === 'tactical_suv' ? 0.82 : vehicleClass === 'interceptor' ? 0.25 : 0.45,
    brakeBias: 0.58,
    armorLevel: vehicleClass === 'tactical_suv' ? 2 : 0,
    gadgets: [],
    primaryColor: spec.defaultPrimaryColor,
    accentColor: spec.defaultAccentColor,
  };
}

export function computeDerivedPhysics(setup: VehicleSetup): DerivedVehiclePhysics {
  const spec = VEHICLE_CLASS_SPECS[setup.vehicleClass] ?? VEHICLE_CLASS_SPECS.street_coupe;
  const engineLevel = clamp(Math.round(setup.engineLevel), 0, 5);
  const armorLevel = clamp(Math.round(setup.armorLevel), 0, 5);
  const stiff = clamp(setup.suspensionStiffness, 0, 1);

  // Armor adds real structural durability AND noticeable physical mass (+90 kg per level)
  const massKg = spec.baseMassKg + armorLevel * 90;
  const durability = Math.round(spec.baseDurability * (1 + armorLevel * 0.22));
  const inertiaY = massKg * 1.72;

  // Engine level boosts torque (+9.5% per level)
  const enginePowerMult = 1 + engineLevel * 0.095;
  const maxTorqueNm = spec.baseTorqueNm * enginePowerMult;

  // Gear ratio preset scales final drive directly
  const finalDrive = spec.baseFinalDrive * (GEAR_FINAL_DRIVE_MULT[setup.gearRatioPreset] ?? 1);

  // Tire characteristics across dry asphalt, rain asphalt, and sandy/dirt shoulders
  let tireDry = 1.0;
  let tireRain = 0.72;
  let tireOffroad = 0.7;
  let offroadDragCoeff = 68;

  if (setup.tireType === 'slick') {
    tireDry = 1.18;
    tireRain = 0.56;
    tireOffroad = 0.6;
    offroadDragCoeff = 95;
  } else if (setup.tireType === 'wet') {
    tireDry = 0.99;
    tireRain = 0.97;
    tireOffroad = 0.78;
    offroadDragCoeff = 54;
  } else if (setup.tireType === 'offroad') {
    tireDry = 0.89;
    tireRain = 0.86;
    tireOffroad = 1.05;
    offroadDragCoeff = 6; // Virtually zero speed loss on coastal sand/dirt shoulders!
  }

  const dryAsphaltGrip = clamp(spec.baseGrip * tireDry, 0.72, 1.38);
  const rainAsphaltGrip = clamp(
    spec.baseGrip * (tireRain + spec.wetStabilityBonus),
    0.48,
    1.22,
  );
  const offroadGrip = clamp(
    spec.baseGrip * (tireOffroad + spec.offroadBonus),
    0.5,
    1.28,
  );

  // Suspension stiffness controls body roll/pitch spring rate, tilt amplitude, and turn-in sharpness
  const pitchSpring = 26 + stiff * 52;
  const pitchDamp = 6.2 + stiff * 6.4;
  const rollSpring = 24 + stiff * 48;
  const rollDamp = 5.8 + stiff * 5.8;
  const pitchScale = 0.0068 - stiff * 0.0042;
  const rollScale = 0.0086 - stiff * 0.0056;
  const steerResponsiveness = 6.4 + stiff * 3.8;

  return {
    massKg,
    inertiaY,
    maxTorqueNm,
    finalDrive,
    aeroDragCoeff: spec.aeroDragCoeff,
    redlineRpm: spec.redlineRpm,
    revLimitRpm: spec.redlineRpm + 300,
    wheelRadius: spec.wheelRadius,
    durability,
    collisionRadius: spec.collisionRadius,
    baseGrip: spec.baseGrip,
    rearDriftBias: spec.rearDriftBias,
    frontStiffness: 9.8 + stiff * 3.2,
    rearStiffness: (10.6 + stiff * 2.8) * spec.rearDriftBias,
    pitchSpring,
    pitchDamp,
    rollSpring,
    rollDamp,
    pitchScale,
    rollScale,
    steerResponsiveness,
    dryAsphaltGrip,
    rainAsphaltGrip,
    offroadGrip,
    offroadDragCoeff,
    impactDamping: clamp(0.86 + armorLevel * 0.02, 0.86, 0.96),
  };
}

export function resolveSurfaceGrip(
  derived: DerivedVehiclePhysics,
  weather: WeatherMode,
  surface: SurfaceType,
): { grip: number; extraRollingDrag: number } {
  if (surface === 'offroad') {
    const rainPenalty = weather === 'rain' ? 0.92 : 1.0;
    return {
      grip: derived.offroadGrip * rainPenalty,
      extraRollingDrag: derived.offroadDragCoeff,
    };
  }
  if (weather === 'rain') {
    return {
      grip: derived.rainAsphaltGrip,
      extraRollingDrag: 0,
    };
  }
  return {
    grip: derived.dryAsphaltGrip * (weather === 'neon_night' ? 0.98 : 1.0),
    extraRollingDrag: 0,
  };
}

export function computeDisplayRatings(setup: VehicleSetup): VehicleDisplayRatings {
  const d = computeDerivedPhysics(setup);
  // Estimate top speed from 5th gear RPM cap vs aero power balance
  const fifthGearTotal = 0.88 * d.finalDrive;
  const gearLimitedMs = ((d.redlineRpm / 60) / fifthGearTotal) * (2 * Math.PI * d.wheelRadius);
  const wheelForce5th = (d.maxTorqueNm * 0.82 * fifthGearTotal) / d.wheelRadius;
  const aeroLimitedMs = Math.sqrt(Math.max(100, wheelForce5th / d.aeroDragCoeff));
  const estTopMs = Math.min(gearLimitedMs, aeroLimitedMs);
  const estimatedTopKmh = Math.round(estTopMs * 3.6);

  // Power-to-weight + gearing determines acceleration score
  const accelMetric = (d.maxTorqueNm * d.finalDrive) / d.massKg;
  const accelScore = Math.round(clamp(((accelMetric - 0.85) / 1.15) * 100, 22, 100));
  const topSpeedScore = Math.round(clamp(((estimatedTopKmh - 175) / 165) * 100, 24, 100));
  const handlingMetric = d.dryAsphaltGrip * 0.55 + d.rainAsphaltGrip * 0.25 + setup.suspensionStiffness * 0.2;
  const handlingScore = Math.round(clamp(((handlingMetric - 0.65) / 0.62) * 100, 25, 100));
  const durabilityScore = Math.round(clamp((d.durability / 390) * 100, 24, 100));

  return {
    topSpeedScore,
    accelScore,
    handlingScore,
    durabilityScore,
    massKg: Math.round(d.massKg),
    durabilityHp: d.durability,
    estimatedTopKmh,
  };
}
