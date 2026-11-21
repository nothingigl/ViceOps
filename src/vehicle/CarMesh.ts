import * as THREE from 'three';
import type { TireType, VehicleClassId, VehicleSetup } from '../types';
import type { CarTelemetry, CarTransformSnapshot } from './CarPhysics';
import { createDefaultVehicleSetup } from './VehicleSpecs';

function createWhiteGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  grad.addColorStop(0.42, 'rgba(255, 255, 255, 0.36)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class CarMesh {
  public readonly root = new THREE.Group();
  public readonly chassisGroup = new THREE.Group();
  public readonly hoodAnchor = new THREE.Object3D();

  private readonly wheelContainer = new THREE.Group();
  private readonly frontLeftPivot = new THREE.Group();
  private readonly frontRightPivot = new THREE.Group();
  private wheelMeshes: THREE.Object3D[] = [];

  // Shared dynamic materials
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly bodySecondaryMat: THREE.MeshStandardMaterial;
  private readonly glassMat: THREE.MeshStandardMaterial;
  private readonly neonTrimMat: THREE.MeshBasicMaterial;
  private readonly headlightMat: THREE.MeshBasicMaterial;
  private readonly brakeLightMat: THREE.MeshStandardMaterial;
  private readonly exhaustMat: THREE.MeshStandardMaterial;
  private readonly armorMat: THREE.MeshStandardMaterial;
  private readonly tireMat: THREE.MeshStandardMaterial;
  private readonly rimMat: THREE.MeshStandardMaterial;
  private readonly wetGrooveMat: THREE.MeshBasicMaterial;
  private readonly brakeGlowMat: THREE.MeshBasicMaterial;
  private readonly headlightConeMat: THREE.MeshBasicMaterial;
  private readonly headlightSpot: THREE.SpotLight;
  private readonly spotTarget = new THREE.Object3D();
  private readonly underglowMat: THREE.MeshBasicMaterial;
  private readonly underglowPlane: THREE.Mesh;
  private readonly brakeGlowPlane: THREE.Mesh;

  private readonly sharedGeometries: THREE.BufferGeometry[] = [];
  private readonly sharedMaterials: THREE.Material[] = [];
  private readonly sharedTextures: THREE.Texture[] = [];
  private dynamicGeometries: THREE.BufferGeometry[] = [];

  private builtClass: VehicleClassId | null = null;
  private builtTire: TireType | null = null;
  private builtHeavyArmor = false;
  private showroomMode = false;

  constructor(initialSetup: VehicleSetup = createDefaultVehicleSetup('street_coupe')) {
    this.root.add(this.chassisGroup);
    this.root.add(this.wheelContainer);
    this.chassisGroup.add(this.hoodAnchor);

    const trackMat = <T extends THREE.Material>(m: T): T => {
      this.sharedMaterials.push(m);
      return m;
    };
    const trackTex = <T extends THREE.Texture>(t: T): T => {
      this.sharedTextures.push(t);
      return t;
    };
    const trackSharedGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.sharedGeometries.push(g);
      return g;
    };

    this.bodyMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x162238,
        roughness: 0.22,
        metalness: 0.72,
      }),
    );
    this.bodySecondaryMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x0c1322,
        roughness: 0.36,
        metalness: 0.56,
      }),
    );
    this.glassMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x060b14,
        roughness: 0.08,
        metalness: 0.92,
      }),
    );
    this.neonTrimMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x00f0ff }));
    this.headlightMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xe6fbff }));
    this.brakeLightMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xff1e56,
        emissive: new THREE.Color(0xff184c),
        emissiveIntensity: 0.9,
        roughness: 0.2,
      }),
    );
    this.exhaustMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x7a8ca8, roughness: 0.24, metalness: 0.9 }),
    );
    this.armorMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x222c3c, roughness: 0.45, metalness: 0.75 }),
    );
    this.tireMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x12151e, roughness: 0.86, metalness: 0.08 }),
    );
    this.rimMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x566885, roughness: 0.28, metalness: 0.85 }),
    );
    this.wetGrooveMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x3ec8ff }));
    this.headlightConeMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xa6f4ff,
        transparent: true,
        opacity: 0.11,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );

    // Single optimized SpotLight for road illumination
    this.headlightSpot = new THREE.SpotLight(0xd9faff, 46, 85, Math.PI / 4.4, 0.58, 1.45);
    this.headlightSpot.position.set(0, 0.72, 2.45);
    this.spotTarget.position.set(0, 0.05, 24);
    this.headlightSpot.target = this.spotTarget;

    // Shared white radial glow texture tinted dynamically by accentColor / crimson
    const whiteGlowTex = trackTex(createWhiteGlowTexture());

    const underglowGeo = trackSharedGeo(new THREE.PlaneGeometry(4.0, 6.4));
    underglowGeo.rotateX(-Math.PI / 2);
    this.underglowMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        map: whiteGlowTex,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.underglowPlane = new THREE.Mesh(underglowGeo, this.underglowMat);
    this.underglowPlane.position.set(0, 0.04, 0);
    this.root.add(this.underglowPlane);

    const brakeGlowGeo = trackSharedGeo(new THREE.PlaneGeometry(3.4, 3.6));
    brakeGlowGeo.rotateX(-Math.PI / 2);
    this.brakeGlowMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xff1e56,
        map: whiteGlowTex,
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.brakeGlowPlane = new THREE.Mesh(brakeGlowGeo, this.brakeGlowMat);
    this.brakeGlowPlane.position.set(0, 0.045, -3.35);
    this.root.add(this.brakeGlowPlane);

    this.applySetup(initialSetup);
  }

  public setGraphicsQuality(quality: 'low' | 'medium' | 'high'): void {
    const allowSpot = !this.showroomMode && quality !== 'low';
    this.headlightSpot.visible = allowSpot;
    const cast = quality === 'high';
    this.chassisGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = cast;
      }
    });
  }

  public setShowroomMode(enabled: boolean): void {
    this.showroomMode = enabled;
    this.headlightSpot.visible = !enabled;
    this.headlightConeMat.opacity = enabled ? 0.035 : 0.11;
    this.underglowMat.opacity = enabled ? 0.85 : 0.72;
    this.brakeGlowMat.opacity = enabled ? 0.24 : 0.16;
    this.brakeLightMat.emissiveIntensity = enabled ? 1.4 : 0.85;
  }

  public applySetup(setup: VehicleSetup): void {
    // Update live colors without rebuilding geometry
    this.bodyMat.color.set(setup.primaryColor);
    this.neonTrimMat.color.set(setup.accentColor);
    this.underglowMat.color.set(setup.accentColor);

    const heavyArmor = setup.armorLevel >= 3;
    const needsRebuild =
      this.builtClass !== setup.vehicleClass ||
      this.builtTire !== setup.tireType ||
      this.builtHeavyArmor !== heavyArmor;

    if (needsRebuild) {
      this.rebuildGeometry(setup.vehicleClass, setup.tireType, heavyArmor);
      this.builtClass = setup.vehicleClass;
      this.builtTire = setup.tireType;
      this.builtHeavyArmor = heavyArmor;
    }

    if (this.showroomMode) {
      this.setShowroomMode(true);
    }
  }

  private clearDynamicGeometry(): void {
    this.chassisGroup.clear();
    this.wheelContainer.clear();
    this.frontLeftPivot.clear();
    this.frontRightPivot.clear();
    this.wheelMeshes = [];

    for (let i = 0; i < this.dynamicGeometries.length; i++) {
      this.dynamicGeometries[i].dispose();
    }
    this.dynamicGeometries = [];

    // Re-attach persistent anchors & spotlight
    this.chassisGroup.add(this.hoodAnchor, this.headlightSpot, this.spotTarget);
  }

  private trackDynGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.dynamicGeometries.push(g);
    return g;
  }

  private rebuildGeometry(
    vehicleClass: VehicleClassId,
    tireType: TireType,
    heavyArmor: boolean,
  ): void {
    this.clearDynamicGeometry();

    if (vehicleClass === 'tactical_suv') {
      this.buildTacticalSuv(heavyArmor);
      this.buildWheels(tireType, 0.44, 0.34, 1.12, 1.46, -1.48);
      this.hoodAnchor.position.set(0, 1.72, 0.56);
      this.headlightSpot.position.set(0, 1.02, 2.38);
      this.underglowPlane.scale.set(1.16, 1, 1.06);
      this.brakeGlowPlane.position.set(0, 0.045, -3.45);
    } else if (vehicleClass === 'interceptor') {
      this.buildInterceptor(heavyArmor);
      this.buildWheels(tireType, 0.37, 0.31, 1.06, 1.44, -1.52);
      this.hoodAnchor.position.set(0, 1.14, 0.58);
      this.headlightSpot.position.set(0, 0.62, 2.75);
      this.underglowPlane.scale.set(1.08, 1, 1.14);
      this.brakeGlowPlane.position.set(0, 0.045, -3.6);
    } else {
      this.buildStreetCoupe(heavyArmor);
      this.buildWheels(tireType, 0.36, 0.29, 0.99, 1.34, -1.42);
      this.hoodAnchor.position.set(0, 1.28, 0.52);
      this.headlightSpot.position.set(0, 0.72, 2.45);
      this.underglowPlane.scale.set(1.0, 1, 1.0);
      this.brakeGlowPlane.position.set(0, 0.045, -3.35);
    }
  }

  private addHeadlightCones(xOffset: number, yPos: number, zPos: number): void {
    const coneGeo = this.trackDynGeo(new THREE.ConeGeometry(2.35, 13.5, 12, 1, true));
    coneGeo.translate(0, -6.75, 0);
    coneGeo.rotateX(-Math.PI / 2);
    for (const side of [-1, 1]) {
      const cone = new THREE.Mesh(coneGeo, this.headlightConeMat);
      cone.position.set(side * xOffset, yPos, zPos);
      cone.rotation.x = 0.055;
      this.chassisGroup.add(cone);
    }
  }

  private buildStreetCoupe(heavyArmor: boolean): void {
    const mainBody = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(2.02, 0.54, 4.46)),
      this.bodyMat,
    );
    mainBody.position.set(0, 0.56, 0);
    this.chassisGroup.add(mainBody);

    const nose = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(1.92, 0.34, 1.1)),
      this.bodyMat,
    );
    nose.position.set(0, 0.48, 2.02);
    nose.rotation.x = 0.14;
    this.chassisGroup.add(nose);

    const splitter = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(2.08, 0.09, 0.55)),
      this.bodySecondaryMat,
    );
    splitter.position.set(0, 0.24, 2.25);
    this.chassisGroup.add(splitter);

    const skirtGeo = this.trackDynGeo(new THREE.BoxGeometry(0.14, 0.16, 2.7));
    const neonTubeGeo = this.trackDynGeo(new THREE.BoxGeometry(0.06, 0.05, 2.55));
    const stripeGeo = this.trackDynGeo(new THREE.BoxGeometry(0.03, 0.04, 3.6));
    for (const side of [-1, 1]) {
      const skirt = new THREE.Mesh(skirtGeo, this.bodySecondaryMat);
      skirt.position.set(side * 1.03, 0.28, 0.02);
      this.chassisGroup.add(skirt);

      const tube = new THREE.Mesh(neonTubeGeo, this.neonTrimMat);
      tube.position.set(side * 1.01, 0.2, 0.02);
      this.chassisGroup.add(tube);

      const stripe = new THREE.Mesh(stripeGeo, this.neonTrimMat);
      stripe.position.set(side * 1.02, 0.62, -0.05);
      this.chassisGroup.add(stripe);
    }

    const rearDeck = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(1.96, 0.22, 1.35)),
      this.bodySecondaryMat,
    );
    rearDeck.position.set(0, 0.86, -1.42);
    rearDeck.rotation.x = -0.06;
    this.chassisGroup.add(rearDeck);

    const diffuser = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(1.84, 0.22, 0.38)),
      this.bodySecondaryMat,
    );
    diffuser.position.set(0, 0.28, -2.22);
    this.chassisGroup.add(diffuser);

    const exhaustGeo = this.trackDynGeo(new THREE.CylinderGeometry(0.075, 0.085, 0.28, 8));
    exhaustGeo.rotateX(Math.PI / 2);
    for (const ex of [-0.54, -0.36, 0.36, 0.54]) {
      const pipe = new THREE.Mesh(exhaustGeo, this.exhaustMat);
      pipe.position.set(ex, 0.27, -2.35);
      this.chassisGroup.add(pipe);
    }

    const cabin = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(1.62, 0.44, 1.85)),
      this.glassMat,
    );
    cabin.position.set(0, 1.01, -0.15);
    this.chassisGroup.add(cabin);

    const roof = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(1.52, 0.07, 1.24)),
      this.bodyMat,
    );
    roof.position.set(0, 1.24, -0.22);
    this.chassisGroup.add(roof);

    const windshield = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(1.58, 0.06, 0.92)),
      this.glassMat,
    );
    windshield.position.set(0, 1.02, 0.92);
    windshield.rotation.x = 0.52;
    this.chassisGroup.add(windshield);

    const mirrorGeo = this.trackDynGeo(new THREE.BoxGeometry(0.22, 0.1, 0.16));
    for (const side of [-1, 1]) {
      const mirror = new THREE.Mesh(mirrorGeo, this.bodyMat);
      mirror.position.set(side * 1.06, 0.92, 0.65);
      this.chassisGroup.add(mirror);
    }

    const wingBlade = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(2.06, 0.07, 0.36)),
      this.bodySecondaryMat,
    );
    wingBlade.position.set(0, 1.22, -2.06);
    wingBlade.rotation.x = 0.12;
    this.chassisGroup.add(wingBlade);

    const wingEdgeGeo = this.trackDynGeo(new THREE.BoxGeometry(0.05, 0.22, 0.42));
    const wingPillarGeo = this.trackDynGeo(new THREE.BoxGeometry(0.07, 0.34, 0.22));
    for (const side of [-1, 1]) {
      const endplate = new THREE.Mesh(wingEdgeGeo, this.neonTrimMat);
      endplate.position.set(side * 1.04, 1.22, -2.06);
      this.chassisGroup.add(endplate);

      const pillar = new THREE.Mesh(wingPillarGeo, this.bodySecondaryMat);
      pillar.position.set(side * 0.58, 1.02, -2.02);
      this.chassisGroup.add(pillar);
    }

    const headStripGeo = this.trackDynGeo(new THREE.BoxGeometry(0.56, 0.11, 0.08));
    for (const side of [-1, 1]) {
      const hl = new THREE.Mesh(headStripGeo, this.headlightMat);
      hl.position.set(side * 0.64, 0.54, 2.52);
      this.chassisGroup.add(hl);
    }
    this.addHeadlightCones(0.64, 0.52, 2.52);

    const tailBar = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(1.9, 0.13, 0.08)),
      this.brakeLightMat,
    );
    tailBar.position.set(0, 0.68, -2.24);
    this.chassisGroup.add(tailBar);

    if (heavyArmor) {
      this.addArmorBars(2.14, 2.6, 0.44);
    }
  }

  private buildTacticalSuv(heavyArmor: boolean): void {
    // High-clearance muscular armored chassis
    const lowerHull = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(2.26, 0.68, 4.72)),
      this.bodyMat,
    );
    lowerHull.position.set(0, 0.84, 0);
    this.chassisGroup.add(lowerHull);

    // Tall armored SUV cabin greenhouse
    const upperCabin = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(2.04, 0.66, 2.86)),
      this.glassMat,
    );
    upperCabin.position.set(0, 1.48, -0.34);
    this.chassisGroup.add(upperCabin);

    // Armored roof & side pillars
    const roof = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(2.08, 0.11, 2.94)),
      this.bodyMat,
    );
    roof.position.set(0, 1.84, -0.34);
    this.chassisGroup.add(roof);

    const pillarGeo = this.trackDynGeo(new THREE.BoxGeometry(0.14, 0.68, 0.22));
    for (const side of [-1, 1]) {
      for (const pz of [0.98, -0.25, -1.66]) {
        const p = new THREE.Mesh(pillarGeo, this.bodyMat);
        p.position.set(side * 0.99, 1.48, pz);
        this.chassisGroup.add(p);
      }
    }

    // Boxy raised hood & aggressive grille
    const hood = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(2.12, 0.22, 1.38)),
      this.bodyMat,
    );
    hood.position.set(0, 1.24, 1.62);
    this.chassisGroup.add(hood);

    const grille = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(1.52, 0.42, 0.14)),
      this.bodySecondaryMat,
    );
    grille.position.set(0, 0.9, 2.38);
    this.chassisGroup.add(grille);

    // Heavy front bullbar bumper
    const bullBarMain = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(2.3, 0.26, 0.34)),
      this.armorMat,
    );
    bullBarMain.position.set(0, 0.56, 2.48);
    this.chassisGroup.add(bullBarMain);

    const bullRail = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(1.75, 0.1, 0.12)),
      this.armorMat,
    );
    bullRail.position.set(0, 1.06, 2.52);
    this.chassisGroup.add(bullRail);

    // Flared wide wheel arches + neon side steps
    const archGeo = this.trackDynGeo(new THREE.BoxGeometry(0.24, 0.26, 1.22));
    const stepGeo = this.trackDynGeo(new THREE.BoxGeometry(0.22, 0.12, 2.05));
    const neonTubeGeo = this.trackDynGeo(new THREE.BoxGeometry(0.07, 0.06, 2.6));
    for (const side of [-1, 1]) {
      const fArch = new THREE.Mesh(archGeo, this.bodySecondaryMat);
      fArch.position.set(side * 1.18, 0.86, 1.46);
      this.chassisGroup.add(fArch);

      const rArch = new THREE.Mesh(archGeo, this.bodySecondaryMat);
      rArch.position.set(side * 1.18, 0.86, -1.48);
      this.chassisGroup.add(rArch);

      const step = new THREE.Mesh(stepGeo, this.armorMat);
      step.position.set(side * 1.18, 0.44, -0.02);
      this.chassisGroup.add(step);

      const tube = new THREE.Mesh(neonTubeGeo, this.neonTrimMat);
      tube.position.set(side * 1.16, 0.36, -0.02);
      this.chassisGroup.add(tube);
    }

    // Tactical roof rack + neon lightbar
    const rackGeo = this.trackDynGeo(new THREE.BoxGeometry(0.1, 0.12, 2.4));
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(rackGeo, this.armorMat);
      rail.position.set(side * 0.86, 1.94, -0.36);
      this.chassisGroup.add(rail);
    }
    const roofLightBar = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(1.56, 0.1, 0.14)),
      this.neonTrimMat,
    );
    roofLightBar.position.set(0, 1.96, 0.82);
    this.chassisGroup.add(roofLightBar);

    // Armored rear spare wheel pod
    const sparePod = new THREE.Mesh(
      this.trackDynGeo(new THREE.CylinderGeometry(0.42, 0.42, 0.26, 12)),
      this.bodySecondaryMat,
    );
    sparePod.rotation.x = Math.PI / 2;
    sparePod.position.set(0, 1.05, -2.44);
    this.chassisGroup.add(sparePod);

    const spareRing = new THREE.Mesh(
      this.trackDynGeo(new THREE.TorusGeometry(0.32, 0.025, 6, 14)),
      this.neonTrimMat,
    );
    spareRing.position.set(0, 1.05, -2.58);
    this.chassisGroup.add(spareRing);

    // Dual heavy exhausts
    const exhaustGeo = this.trackDynGeo(new THREE.CylinderGeometry(0.09, 0.095, 0.3, 8));
    exhaustGeo.rotateX(Math.PI / 2);
    for (const side of [-1, 1]) {
      const pipe = new THREE.Mesh(exhaustGeo, this.exhaustMat);
      pipe.position.set(side * 0.72, 0.45, -2.46);
      this.chassisGroup.add(pipe);
    }

    // Headlights + cones
    const headGeo = this.trackDynGeo(new THREE.BoxGeometry(0.46, 0.18, 0.1));
    for (const side of [-1, 1]) {
      const hl = new THREE.Mesh(headGeo, this.headlightMat);
      hl.position.set(side * 0.84, 0.94, 2.38);
      this.chassisGroup.add(hl);
    }
    this.addHeadlightCones(0.84, 0.92, 2.42);

    // Vertical tactical LED tail clusters
    const tailGeo = this.trackDynGeo(new THREE.BoxGeometry(0.22, 0.48, 0.1));
    for (const side of [-1, 1]) {
      const tl = new THREE.Mesh(tailGeo, this.brakeLightMat);
      tl.position.set(side * 0.98, 1.02, -2.38);
      this.chassisGroup.add(tl);
    }

    if (heavyArmor) {
      this.addArmorBars(2.38, 2.66, 0.72);
    }
  }

  private buildInterceptor(heavyArmor: boolean): void {
    // Ultra-low sculpted pursuit hypercar chassis
    const mainBody = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(2.14, 0.42, 4.92)),
      this.bodyMat,
    );
    mainBody.position.set(0, 0.46, 0);
    this.chassisGroup.add(mainBody);

    // Sharp wedge nose + aggressive aero splitter
    const wedgeNose = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(1.88, 0.24, 1.48)),
      this.bodyMat,
    );
    wedgeNose.position.set(0, 0.42, 2.22);
    wedgeNose.rotation.x = 0.16;
    this.chassisGroup.add(wedgeNose);

    const frontSplitter = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(2.24, 0.07, 0.72)),
      this.bodySecondaryMat,
    );
    frontSplitter.position.set(0, 0.2, 2.68);
    this.chassisGroup.add(frontSplitter);

    // Wide sculpted rear haunches & side intake blades
    const haunchGeo = this.trackDynGeo(new THREE.BoxGeometry(0.44, 0.34, 2.1));
    const neonBladeGeo = this.trackDynGeo(new THREE.BoxGeometry(0.05, 0.05, 3.1));
    for (const side of [-1, 1]) {
      const haunch = new THREE.Mesh(haunchGeo, this.bodyMat);
      haunch.position.set(side * 0.94, 0.62, -1.25);
      this.chassisGroup.add(haunch);

      const intake = new THREE.Mesh(
        this.trackDynGeo(new THREE.BoxGeometry(0.14, 0.26, 1.2)),
        this.bodySecondaryMat,
      );
      intake.position.set(side * 1.11, 0.44, -0.35);
      this.chassisGroup.add(intake);

      const tube = new THREE.Mesh(neonBladeGeo, this.neonTrimMat);
      tube.position.set(side * 1.1, 0.2, 0.0);
      this.chassisGroup.add(tube);

      const upperNeon = new THREE.Mesh(
        this.trackDynGeo(new THREE.BoxGeometry(0.03, 0.035, 2.3)),
        this.neonTrimMat,
      );
      upperNeon.position.set(side * 1.16, 0.7, -1.22);
      this.chassisGroup.add(upperNeon);
    }

    // Teardrop jet-fighter glass canopy
    const canopy = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(1.36, 0.36, 2.02)),
      this.glassMat,
    );
    canopy.position.set(0, 0.84, 0.02);
    this.chassisGroup.add(canopy);

    const frontScreen = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(1.32, 0.06, 1.1)),
      this.glassMat,
    );
    frontScreen.position.set(0, 0.82, 1.26);
    frontScreen.rotation.x = 0.44;
    this.chassisGroup.add(frontScreen);

    // Central aerodynamic shark-fin spine with neon edge
    const spine = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(0.08, 0.32, 1.75)),
      this.bodySecondaryMat,
    );
    spine.position.set(0, 0.94, -1.48);
    this.chassisGroup.add(spine);

    const spineNeon = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(0.09, 0.04, 1.78)),
      this.neonTrimMat,
    );
    spineNeon.position.set(0, 1.1, -1.48);
    this.chassisGroup.add(spineNeon);

    // Wide low-drag split GT wing
    const wing = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(2.26, 0.06, 0.4)),
      this.bodySecondaryMat,
    );
    wing.position.set(0, 1.06, -2.36);
    wing.rotation.x = 0.08;
    this.chassisGroup.add(wing);

    const endplateGeo = this.trackDynGeo(new THREE.BoxGeometry(0.05, 0.24, 0.48));
    for (const side of [-1, 1]) {
      const ep = new THREE.Mesh(endplateGeo, this.neonTrimMat);
      ep.position.set(side * 1.14, 1.06, -2.36);
      this.chassisGroup.add(ep);
    }

    // Aggressive rear diffuser + central twin turbo thrusters
    const diffuser = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(2.04, 0.22, 0.44)),
      this.bodySecondaryMat,
    );
    diffuser.position.set(0, 0.25, -2.44);
    this.chassisGroup.add(diffuser);

    const thrusterGeo = this.trackDynGeo(new THREE.CylinderGeometry(0.11, 0.13, 0.32, 10));
    thrusterGeo.rotateX(Math.PI / 2);
    for (const ex of [-0.2, 0.2]) {
      const thruster = new THREE.Mesh(thrusterGeo, this.exhaustMat);
      thruster.position.set(ex, 0.34, -2.56);
      this.chassisGroup.add(thruster);
    }

    // Razor LED headlights
    const headGeo = this.trackDynGeo(new THREE.BoxGeometry(0.68, 0.08, 0.1));
    for (const side of [-1, 1]) {
      const hl = new THREE.Mesh(headGeo, this.headlightMat);
      hl.position.set(side * 0.62, 0.46, 2.86);
      hl.rotation.y = side * -0.18;
      this.chassisGroup.add(hl);
    }
    this.addHeadlightCones(0.62, 0.45, 2.86);

    // Wide cyber brake light blade
    const tailBar = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(2.08, 0.11, 0.09)),
      this.brakeLightMat,
    );
    tailBar.position.set(0, 0.62, -2.48);
    this.chassisGroup.add(tailBar);

    if (heavyArmor) {
      this.addArmorBars(2.26, 2.94, 0.38);
    }
  }

  private addArmorBars(width: number, frontZ: number, yPos: number): void {
    const frontGuard = new THREE.Mesh(
      this.trackDynGeo(new THREE.BoxGeometry(width * 0.88, 0.14, 0.16)),
      this.armorMat,
    );
    frontGuard.position.set(0, yPos, frontZ);
    this.chassisGroup.add(frontGuard);

    const sideGuardGeo = this.trackDynGeo(new THREE.BoxGeometry(0.1, 0.12, 2.35));
    for (const side of [-1, 1]) {
      const bar = new THREE.Mesh(sideGuardGeo, this.armorMat);
      bar.position.set(side * (width * 0.51), yPos + 0.04, 0);
      this.chassisGroup.add(bar);
    }
  }

  private buildWheels(
    tireType: TireType,
    radius: number,
    width: number,
    trackHalf: number,
    frontZ: number,
    rearZ: number,
  ): void {
    const effectiveWidth = tireType === 'offroad' ? width * 1.18 : width;
    const effectiveRadius = tireType === 'offroad' ? radius * 1.04 : radius;

    const tireGeo = this.trackDynGeo(
      new THREE.CylinderGeometry(effectiveRadius, effectiveRadius, effectiveWidth, 16),
    );
    tireGeo.rotateZ(Math.PI / 2);

    const rimRadius = effectiveRadius * 0.62;
    const rimGeo = this.trackDynGeo(
      new THREE.CylinderGeometry(rimRadius, rimRadius, effectiveWidth + 0.015, 10),
    );
    rimGeo.rotateZ(Math.PI / 2);

    const spokeGeo = this.trackDynGeo(
      new THREE.BoxGeometry(effectiveWidth + 0.025, rimRadius * 1.65, 0.06),
    );
    const rimRingGeo = this.trackDynGeo(
      new THREE.TorusGeometry(rimRadius + 0.01, 0.02, 6, 16),
    );
    rimRingGeo.rotateY(Math.PI / 2);

    // Extra visual cues for tire type
    const wetGrooveGeo =
      tireType === 'wet'
        ? this.trackDynGeo(new THREE.TorusGeometry(effectiveRadius + 0.004, 0.012, 6, 16))
        : null;
    wetGrooveGeo?.rotateY(Math.PI / 2);

    const treadRingGeo =
      tireType === 'offroad'
        ? this.trackDynGeo(new THREE.TorusGeometry(effectiveRadius - 0.02, 0.032, 6, 10))
        : null;
    treadRingGeo?.rotateY(Math.PI / 2);

    const createWheel = (side: number): THREE.Group => {
      const wheel = new THREE.Group();
      wheel.add(new THREE.Mesh(tireGeo, this.tireMat));
      wheel.add(new THREE.Mesh(rimGeo, this.rimMat));

      const spoke1 = new THREE.Mesh(spokeGeo, this.bodySecondaryMat);
      const spoke2 = new THREE.Mesh(spokeGeo, this.bodySecondaryMat);
      spoke2.rotation.x = Math.PI / 2;
      wheel.add(spoke1, spoke2);

      const ring = new THREE.Mesh(rimRingGeo, this.neonTrimMat);
      ring.position.x = side * (effectiveWidth * 0.5 + 0.005);
      wheel.add(ring);

      if (wetGrooveGeo) {
        const g1 = new THREE.Mesh(wetGrooveGeo, this.wetGrooveMat);
        g1.position.x = -0.05;
        const g2 = new THREE.Mesh(wetGrooveGeo, this.wetGrooveMat);
        g2.position.x = 0.05;
        wheel.add(g1, g2);
      }

      if (treadRingGeo) {
        const t1 = new THREE.Mesh(treadRingGeo, this.armorMat);
        t1.position.x = -effectiveWidth * 0.34;
        const t2 = new THREE.Mesh(treadRingGeo, this.armorMat);
        t2.position.x = effectiveWidth * 0.34;
        wheel.add(t1, t2);
      }

      this.wheelMeshes.push(wheel);
      return wheel;
    };

    this.frontLeftPivot.position.set(trackHalf, effectiveRadius, frontZ);
    this.frontLeftPivot.add(createWheel(1));
    this.wheelContainer.add(this.frontLeftPivot);

    this.frontRightPivot.position.set(-trackHalf, effectiveRadius, frontZ);
    this.frontRightPivot.add(createWheel(-1));
    this.wheelContainer.add(this.frontRightPivot);

    const rearLeft = createWheel(1);
    rearLeft.position.set(trackHalf + 0.02, effectiveRadius, rearZ);
    this.wheelContainer.add(rearLeft);

    const rearRight = createWheel(-1);
    rearRight.position.set(-(trackHalf + 0.02), effectiveRadius, rearZ);
    this.wheelContainer.add(rearRight);
  }

  public sync(
    transform: CarTransformSnapshot,
    telemetry: Readonly<CarTelemetry>,
    headlightStrength: number,
  ): void {
    this.root.position.set(transform.x, 0, transform.z);
    this.root.rotation.y = transform.heading;

    this.chassisGroup.rotation.x = transform.pitch;
    this.chassisGroup.rotation.z = transform.roll;

    this.frontLeftPivot.rotation.y = transform.steerAngle;
    this.frontRightPivot.rotation.y = transform.steerAngle;

    for (let i = 0; i < this.wheelMeshes.length; i++) {
      this.wheelMeshes[i].rotation.x = transform.wheelSpin;
    }

    const braking = telemetry.isBrakingLights;
    this.brakeLightMat.emissiveIntensity = braking ? 3.2 : 0.75;
    this.brakeGlowMat.opacity = braking ? 0.78 : 0.16;

    this.headlightSpot.intensity = 46 * headlightStrength;
    this.headlightConeMat.opacity = 0.11 * headlightStrength;
    this.underglowMat.opacity = 0.45 + 0.35 * headlightStrength;
  }

  public dispose(): void {
    this.clearDynamicGeometry();
    this.sharedGeometries.forEach((g) => g.dispose());
    this.sharedMaterials.forEach((m) => m.dispose());
    this.sharedTextures.forEach((t) => t.dispose());
  }
}
