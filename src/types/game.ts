export type TireType = 'slick' | 'wet' | 'offroad';

export type WeatherMode = 'sunset' | 'neon_night' | 'rain';

export type GadgetId = 'emp' | 'smoke' | 'jammer';

export type VehicleClassId = 'street_coupe' | 'tactical_suv' | 'interceptor';

export type GearRatioPreset = 'short' | 'balanced' | 'long';

export type ContractDifficulty = 'low' | 'medium' | 'high' | 'extreme';

export interface VehicleSetup {
  /** Уникальный идентификатор конфигурации автомобиля */
  id: string;
  /** Класс автомобиля (определяет геометрию и базовую физику) */
  vehicleClass: VehicleClassId;
  /** Название конфигурации на русском языке */
  name: string;
  /** Тип установленных шин */
  tireType: TireType;
  /** Уровень прокачки двигателя (0..5) */
  engineLevel: number;
  /** Мощность двигателя (нормированный множитель, 1.0 — базовый) */
  enginePower: number;
  /** Жёсткость подвески (0..1) */
  suspensionStiffness: number;
  /** Профиль передаточных чисел КПП */
  gearRatioPreset: GearRatioPreset;
  /** Дорожный просвет (0..1) */
  rideHeight: number;
  /** Баланс тормозов: 0 — задняя ось, 1 — передняя ось */
  brakeBias: number;
  /** Уровень бронирования кузова (0..5) */
  armorLevel: number;
  /** Установленные тактические гаджеты */
  gadgets: GadgetId[];
  /** Основной цвет кузова в формате HEX */
  primaryColor: string;
  /** Неоновый акцентный цвет в формате HEX */
  accentColor: string;
}

export interface Contract {
  /** Уникальный идентификатор контракта */
  id: string;
  /** Название операции на русском языке */
  title: string;
  /** Краткий тактический брифинг */
  description: string;
  /** Район города для выполнения контракта */
  district: string;
  /** Погодные условия и время суток */
  weather: WeatherMode;
  /** Уровень сложности контракта */
  difficulty: ContractDifficulty;
  /** Лимит времени на выполнение (в секундах) */
  timeLimitSec: number;
  /** Награда в кредитах за успешное выполнение */
  rewardCredits: number;
  /** Уровень розыска / интенсивность перехвата (1..5) */
  heatLevel: number;
  /** Рекомендуемый тип шин */
  recommendedTires: TireType;
  /** Рекомендуемые гаджеты для контракта */
  recommendedGadgets: GadgetId[];
}

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface DailyContractRecord {
  /** Календарная дата в формате YYYY-MM-DD */
  dateKey: string;
  /** Лучшее время эвакуации за день (в секундах) */
  bestTimeSec: number;
  /** Название автомобиля, на котором поставлен рекорд */
  vehicleName: string;
  /** Тип шин на момент рекорда */
  tireName: string;
  /** Погодный режим контракта дня */
  weather: WeatherMode;
  /** Оставшаяся прочность авто */
  hpRemaining: number;
  /** Максимальная прочность авто */
  maxHp: number;
  /** Начисленная награда в кредитах */
  rewardCredits: number;
}

export interface GameSettings {
  /** Общая громкость процедурного аудио (0..1) */
  masterVolume: number;
  /** Громкость эффектов и двигателя (0..1) */
  sfxVolume: number;
  /** Включена ли тактильная вибрация на мобильных устройствах */
  hapticsEnabled: boolean;
  /** Отображать ли диагностику производительности (FPS) */
  showFps: boolean;
  /** Качество 3D-графики (управляет тенями, огнями и pixelRatio) */
  graphicsQuality: GraphicsQuality;
}

export interface SaveState {
  /** Версия схемы сохранения для безопасных миграций */
  version: number;
  /** Баланс кредитов игрока */
  credits: number;
  /** Уровень тактической репутации */
  reputation: number;
  /** Идентификатор активной конфигурации автомобиля */
  activeVehicleId: string;
  /** Открытые классы автомобилей */
  unlockedVehicleClasses: VehicleClassId[];
  /** Сохранённые конфигурации автомобилей в гараже */
  vehicles: VehicleSetup[];
  /** Список идентификаторов завершённых контрактов */
  completedContractIds: string[];
  /** Лучшее время прохождения по идентификатору контракта (в секундах) */
  bestTimesSec: Record<string, number>;
  /** Рекорды «Контракта дня» по дате (YYYY-MM-DD) */
  dailyRecords: Record<string, DailyContractRecord>;
  /** Открытые игроком тактические гаджеты */
  unlockedGadgets: GadgetId[];
  /** Открытые типы шин */
  unlockedTires: TireType[];
  /** Пользовательские настройки */
  settings: GameSettings;
  /** Временная метка последнего сохранения (ISO 8601) */
  updatedAt: string;
}
