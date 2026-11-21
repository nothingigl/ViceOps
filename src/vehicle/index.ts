export { CarMesh } from './CarMesh';
export { CarPhysics } from './CarPhysics';
export type {
  CarTelemetry,
  CarTransformSnapshot,
  TransmissionMode,
  VehicleControlInput,
} from './CarPhysics';
export {
  BODY_COLOR_SWATCHES,
  computeDerivedPhysics,
  computeDisplayRatings,
  createDefaultVehicleSetup,
  GEAR_PRESET_LABELS,
  NEON_COLOR_SWATCHES,
  resolveSurfaceGrip,
  TIRE_LABELS,
  VEHICLE_CLASS_ORDER,
  VEHICLE_CLASS_SPECS,
} from './VehicleSpecs';
export type {
  DerivedVehiclePhysics,
  SurfaceType,
  VehicleClassSpec,
  VehicleDisplayRatings,
} from './VehicleSpecs';
export { GADGET_ORDER, GADGET_SPECS, GadgetSystem } from './Gadgets';
export type {
  EmpBlastEvent,
  GadgetSlotSnapshot,
  GadgetSpec,
  SmokeZone,
} from './Gadgets';
