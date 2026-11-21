import * as THREE from 'three';
import type { GraphicsQuality, WeatherMode } from '../types';
import type { CityBuildResult } from './CityGenerator';

interface WeatherPreset {
  topColor: number;
  midColor: number;
  horizonColor: number;
  sunColor: number;
  sunOpacity: number;
  sunDirection: [number, number, number];
  fogColor: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  keyLightColor: number;
  keyLightIntensity: number;
  rimLightColor: number;
  rimLightIntensity: number;
  roadRoughness: number;
  roadMetalness: number;
  roadTint: number;
  oceanColor: number;
  buildingEmissive: number;
  lightPoolOpacity: number;
  headlightStrength: number;
  gripMultiplier: number;
  rainActive: boolean;
}

const WEATHER_PRESETS: Record<WeatherMode, WeatherPreset> = {
  sunset: {
    topColor: 0x160c38,
    midColor: 0x5c1d6e,
    horizonColor: 0xff6b57,
    sunColor: 0xffbe55,
    sunOpacity: 0.95,
    sunDirection: [0.32, 0.14, -0.94],
    fogColor: 0x451d4a,
    fogDensity: 0.00145,
    hemiSky: 0xff9e7d,
    hemiGround: 0x1d1738,
    hemiIntensity: 1.05,
    keyLightColor: 0xff9966,
    keyLightIntensity: 1.65,
    rimLightColor: 0x00f0ff,
    rimLightIntensity: 0.55,
    roadRoughness: 0.42,
    roadMetalness: 0.25,
    roadTint: 0x262638,
    oceanColor: 0x1a264a,
    buildingEmissive: 0.65,
    lightPoolOpacity: 0.24,
    headlightStrength: 0.5,
    gripMultiplier: 1.0,
    rainActive: false,
  },
  neon_night: {
    topColor: 0x040712,
    midColor: 0x0c1330,
    horizonColor: 0x261245,
    sunColor: 0x00f0ff,
    sunOpacity: 0.28,
    sunDirection: [-0.25, 0.22, -0.94],
    fogColor: 0x090e20,
    fogDensity: 0.00185,
    hemiSky: 0x2e4a8f,
    hemiGround: 0x0a0d1c,
    hemiIntensity: 0.72,
    keyLightColor: 0x6ecbff,
    keyLightIntensity: 0.9,
    rimLightColor: 0xff2a6d,
    rimLightIntensity: 0.85,
    roadRoughness: 0.31,
    roadMetalness: 0.34,
    roadTint: 0x1b2236,
    oceanColor: 0x071a33,
    buildingEmissive: 1.15,
    lightPoolOpacity: 0.52,
    headlightStrength: 1.0,
    gripMultiplier: 0.98,
    rainActive: false,
  },
  rain: {
    topColor: 0x060b14,
    midColor: 0x102033,
    horizonColor: 0x1d3448,
    sunColor: 0x5bd9ff,
    sunOpacity: 0.08,
    sunDirection: [0.1, 0.35, -0.92],
    fogColor: 0x0d1b29,
    fogDensity: 0.0029,
    hemiSky: 0x4b7496,
    hemiGround: 0x0b121e,
    hemiIntensity: 0.78,
    keyLightColor: 0x89cfff,
    keyLightIntensity: 0.85,
    rimLightColor: 0x00f0ff,
    rimLightIntensity: 0.95,
    roadRoughness: 0.12,
    roadMetalness: 0.56,
    roadTint: 0x182334,
    oceanColor: 0x071826,
    buildingEmissive: 1.08,
    lightPoolOpacity: 0.68,
    headlightStrength: 1.2,
    gripMultiplier: 0.72,
    rainActive: true,
  },
};

export const WEATHER_LABELS: Record<WeatherMode, string> = {
  sunset: 'Закат',
  neon_night: 'Ночной неон',
  rain: 'Дождь',
};

const RAIN_COUNT = 460;
const RAIN_BOX_XZ = 68;
const RAIN_BOX_Y = 26;
const RAIN_STREAK_LEN = 1.45;

export class WeatherSystem {
  private readonly scene: THREE.Scene;
  private readonly city: CityBuildResult;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly fog: THREE.FogExp2;
  private readonly skyMesh: THREE.Mesh;
  private readonly skyUniforms: {
    uTopColor: { value: THREE.Color };
    uMidColor: { value: THREE.Color };
    uHorizonColor: { value: THREE.Color };
    uSunColor: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uSunOpacity: { value: number };
  };
  private readonly rainLines: THREE.LineSegments;
  private readonly rainPositions: Float32Array;
  private readonly rainSpeeds: Float32Array;
  private readonly rainGeo: THREE.BufferGeometry;
  private readonly rainMat: THREE.LineBasicMaterial;
  private readonly skyGeo: THREE.SphereGeometry;
  private readonly skyMat: THREE.ShaderMaterial;

  private mode: WeatherMode = 'neon_night';

  constructor(scene: THREE.Scene, city: CityBuildResult, initialMode: WeatherMode = 'neon_night') {
    this.scene = scene;
    this.city = city;

    this.fog = new THREE.FogExp2(0x090e20, 0.00185);
    this.scene.fog = this.fog;

    this.hemiLight = new THREE.HemisphereLight(0x2e4a8f, 0x0a0d1c, 0.75);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0x6ecbff, 0.9);
    this.keyLight.position.set(120, 140, -240);
    this.scene.add(this.keyLight, this.keyLight.target);

    this.rimLight = new THREE.DirectionalLight(0xff2a6d, 0.85);
    this.rimLight.position.set(-160, 75, 190);
    this.scene.add(this.rimLight);

    // Procedural synthwave/coastal gradient sky dome (1 draw call)
    this.skyUniforms = {
      uTopColor: { value: new THREE.Color(0x040712) },
      uMidColor: { value: new THREE.Color(0x0c1330) },
      uHorizonColor: { value: new THREE.Color(0x261245) },
      uSunColor: { value: new THREE.Color(0x00f0ff) },
      uSunDir: { value: new THREE.Vector3(0.32, 0.14, -0.94).normalize() },
      uSunOpacity: { value: 0.3 },
    };

    this.skyGeo = new THREE.SphereGeometry(1450, 24, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.skyUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTopColor;
        uniform vec3 uMidColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        uniform float uSunOpacity;
        varying vec3 vWorldDir;

        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 col = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.24, h));
          col = mix(col, uTopColor, smoothstep(0.22, 0.78, h));

          // Stylized retro coastal sun disc + soft halo
          float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
          float halo = pow(sunDot, 18.0) * 0.45 * uSunOpacity;
          float disc = smoothstep(0.9945, 0.9965, sunDot) * uSunOpacity;
          // Synthwave horizontal scan slices on lower half of sun disc
          float stripe = step(0.35, fract(dir.y * 55.0));
          float lowerSun = smoothstep(0.16, 0.04, dir.y);
          disc *= mix(1.0, stripe, lowerSun * 0.75);

          col += uSunColor * (halo + disc * 1.15);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.skyMesh = new THREE.Mesh(this.skyGeo, this.skyMat);
    this.scene.add(this.skyMesh);

    // Lightweight GPU-friendly rain streak system (1 LineSegments draw call, zero per-frame allocations)
    this.rainPositions = new Float32Array(RAIN_COUNT * 2 * 3);
    this.rainSpeeds = new Float32Array(RAIN_COUNT);

    for (let i = 0; i < RAIN_COUNT; i++) {
      const rx = (Math.random() - 0.5) * RAIN_BOX_XZ;
      const ry = Math.random() * RAIN_BOX_Y;
      const rz = (Math.random() - 0.5) * RAIN_BOX_XZ;
      this.rainSpeeds[i] = 28 + Math.random() * 14;
      const base = i * 6;
      this.rainPositions[base] = rx;
      this.rainPositions[base + 1] = ry;
      this.rainPositions[base + 2] = rz;
      this.rainPositions[base + 3] = rx - 0.16;
      this.rainPositions[base + 4] = ry - RAIN_STREAK_LEN;
      this.rainPositions[base + 5] = rz - 0.08;
    }

    this.rainGeo = new THREE.BufferGeometry();
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    this.rainMat = new THREE.LineBasicMaterial({
      color: 0x99e6ff,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    });
    this.rainLines = new THREE.LineSegments(this.rainGeo, this.rainMat);
    this.rainLines.frustumCulled = false;
    this.scene.add(this.rainLines);

    this.setMode(initialMode);
  }

  private quality: GraphicsQuality = 'high';
  private activeRainCount = RAIN_COUNT;

  public setGraphicsQuality(quality: GraphicsQuality): void {
    this.quality = quality;
    const isHigh = quality === 'high';
    const isLow = quality === 'low';

    this.rimLight.visible = !isLow;
    this.city.lightPoolMaterial.visible = !isLow;
    this.activeRainCount = isLow ? 160 : quality === 'medium' ? 300 : RAIN_COUNT;
    this.rainGeo.setDrawRange(0, this.activeRainCount * 2);

    this.keyLight.castShadow = isHigh;
    if (isHigh) {
      this.keyLight.shadow.mapSize.set(1024, 1024);
      this.keyLight.shadow.camera.near = 10;
      this.keyLight.shadow.camera.far = 220;
      const d = 26;
      this.keyLight.shadow.camera.left = -d;
      this.keyLight.shadow.camera.right = d;
      this.keyLight.shadow.camera.top = d;
      this.keyLight.shadow.camera.bottom = -d;
      this.keyLight.shadow.bias = -0.0008;
      this.keyLight.shadow.camera.updateProjectionMatrix();
    }

    // Re-apply fog density scaling for low quality
    const p = WEATHER_PRESETS[this.mode];
    this.fog.density = isLow ? p.fogDensity * 1.18 : p.fogDensity;
  }

  public getMode(): WeatherMode {
    return this.mode;
  }

  public getGripMultiplier(): number {
    return WEATHER_PRESETS[this.mode].gripMultiplier;
  }

  public getHeadlightStrength(): number {
    return WEATHER_PRESETS[this.mode].headlightStrength;
  }

  public setMode(mode: WeatherMode): void {
    this.mode = mode;
    const p = WEATHER_PRESETS[mode];

    this.skyUniforms.uTopColor.value.setHex(p.topColor);
    this.skyUniforms.uMidColor.value.setHex(p.midColor);
    this.skyUniforms.uHorizonColor.value.setHex(p.horizonColor);
    this.skyUniforms.uSunColor.value.setHex(p.sunColor);
    this.skyUniforms.uSunDir.value.set(...p.sunDirection).normalize();
    this.skyUniforms.uSunOpacity.value = p.sunOpacity;

    this.fog.color.setHex(p.fogColor);
    this.fog.density = this.quality === 'low' ? p.fogDensity * 1.18 : p.fogDensity;

    this.hemiLight.color.setHex(p.hemiSky);
    this.hemiLight.groundColor.setHex(p.hemiGround);
    this.hemiLight.intensity = p.hemiIntensity;

    this.keyLight.color.setHex(p.keyLightColor);
    this.keyLight.intensity = p.keyLightIntensity;
    this.keyLight.position.set(
      p.sunDirection[0] * 110,
      Math.max(p.sunDirection[1] * 110, 48),
      p.sunDirection[2] * 110,
    );

    this.rimLight.color.setHex(p.rimLightColor);
    this.rimLight.intensity = p.rimLightIntensity;

    this.city.roadMaterial.roughness = p.roadRoughness;
    this.city.roadMaterial.metalness = p.roadMetalness;
    this.city.roadMaterial.color.setHex(p.roadTint);
    this.city.oceanMaterial.color.setHex(p.oceanColor);
    this.city.buildingMaterial.emissiveIntensity = p.buildingEmissive;
    this.city.lightPoolMaterial.opacity = p.lightPoolOpacity;

    this.rainLines.visible = p.rainActive;
  }

  public update(dt: number, focusX: number, focusZ: number): void {
    // Keep sky dome centered on camera/car so horizon never shifts
    this.skyMesh.position.set(focusX, 0, focusZ);

    // Keep shadow frustum anchored around player car in High quality
    if (this.keyLight.castShadow) {
      const p = WEATHER_PRESETS[this.mode];
      this.keyLight.target.position.set(focusX, 0, focusZ);
      this.keyLight.target.updateMatrixWorld();
      this.keyLight.position.set(
        focusX + p.sunDirection[0] * 85,
        Math.max(p.sunDirection[1] * 85, 42),
        focusZ + p.sunDirection[2] * 85,
      );
    }

    if (!this.rainLines.visible) return;

    this.rainLines.position.set(focusX, 0, focusZ);
    const pos = this.rainPositions;
    const speeds = this.rainSpeeds;

    for (let i = 0; i < this.activeRainCount; i++) {
      const base = i * 6;
      let y = pos[base + 1] - speeds[i] * dt;
      if (y < 0.2) {
        y += RAIN_BOX_Y;
        const nx = (Math.random() - 0.5) * RAIN_BOX_XZ;
        const nz = (Math.random() - 0.5) * RAIN_BOX_XZ;
        pos[base] = nx;
        pos[base + 2] = nz;
        pos[base + 3] = nx - 0.16;
        pos[base + 5] = nz - 0.08;
      }
      pos[base + 1] = y;
      pos[base + 4] = y - RAIN_STREAK_LEN;
    }

    const attr = this.rainGeo.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }

  public dispose(): void {
    this.scene.remove(this.skyMesh, this.rainLines, this.hemiLight, this.keyLight, this.rimLight);
    this.skyGeo.dispose();
    this.skyMat.dispose();
    this.rainGeo.dispose();
    this.rainMat.dispose();
  }
}
