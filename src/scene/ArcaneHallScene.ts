import * as THREE from 'three';
import {
  STUDY_CHAIR_SLOTS,
  type StudyChairSlot,
} from '@/scene/hallLayout';
import {
  makeWoodenSignTexture,
  TEX_AWNING_STRIPE,
  TEX_BAMBOO_FENCE,
  TEX_BATH_TILE_SLATE,
  TEX_BATH_TILE_TEAL,
  TEX_DARK_DECK,
  TEX_FOREST_MOSS,
  TEX_HINOKI_BENCH,
  TEX_HINOKI_WALL,
  TEX_PANORAMA_DAY,
  TEX_PANORAMA_NIGHT,
  TEX_ROCK_SURFACE,
  TEX_SKY_DAY,
  TEX_SKY_NIGHT,
  TEX_SKY_SUNSET,
  TEX_STEAM_PUFF,
  TEX_STONE_PAVING,
  TEX_VERTICAL_WOOD,
  TEX_WATER_RIPPLES,
  TEX_WATERFALL_STREAM,
  TEX_WOOD_FLOOR,
  tileTexture,
} from '@/scene/proceduralTextures';
import {
  ScholarAvatarMesh,
  type SnackItemId,
} from '@/scene/ScholarAvatarMesh';
import {
  type ScholarDynamicState,
  type ScholarVisitor,
  type WeatherMood,
  type WishCandle,
} from '@/types/protocol';

export type CameraPresetId =
  | 'follow'
  | 'overview'
  | 'main_bath'
  | 'pavilion'
  | 'hinoki_bath'
  | 'footbath';

interface BathSpotProps {
  slot: StudyChairSlot;
  spotHitMesh: THREE.Mesh;
  floatingTrayGroup: THREE.Group;
}

interface SteamSpriteParticle {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  vel: THREE.Vector3;
  s0: number;
  s1: number;
  maxOp: number;
  baseX: number;
  baseZ: number;
}

interface WishYuzuEntry {
  wish: WishCandle;
  group: THREE.Group;
  hitMesh: THREE.Mesh;
  phase: number;
}

interface OnsenCatRig {
  root: THREE.Group;
  head: THREE.Group;
  eyes: [THREE.Mesh, THREE.Mesh];
  tail: THREE.Group;
  hitMesh: THREE.Mesh;
  petTimer: number;
}

export interface HallSceneCallbacks {
  onSelfStateChanged: (state: Omit<ScholarDynamicState, 'seat'>) => void;
  onWishCandleSelected: (wish: WishCandle) => void;
  onSeatChanged: (chairIndex: number, zoneName: string) => void;
  onToastMessage?: (msg: string) => void;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class ArcaneHallScene {
  private readonly container: HTMLElement;
  private readonly callbacks: HallSceneCallbacks;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();

  private readonly walkableMeshes: THREE.Mesh[] = [];
  private readonly scrolledTextures: Array<{
    tex: THREE.Texture;
    vx: number;
    vy: number;
  }> = [];
  private readonly bathSpots: BathSpotProps[] = [];
  private readonly spotHitMeshes: THREE.Mesh[] = [];
  private readonly steamSprites: SteamSpriteParticle[] = [];
  private readonly wishEntries = new Map<string, WishYuzuEntry>();
  private readonly wishHitMeshes: THREE.Mesh[] = [];
  private readonly avatarMeshes = new Map<number, ScholarAvatarMesh>();
  private readonly latestVisitors = new Map<number, ScholarVisitor>();
  private readonly treeFoliageMeshes: THREE.Mesh[] = [];
  private readonly campfireFlames: THREE.Mesh[] = [];
  private readonly lanternLights: THREE.PointLight[] = [];

  private skyDomeMesh!: THREE.Mesh;
  private panoramaMesh!: THREE.Mesh;
  private onsenCat: OnsenCatRig | null = null;

  private readonly ambientLight: THREE.AmbientLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly sunDirLight: THREE.DirectionalLight;
  private readonly campfireLight: THREE.PointLight;
  private readonly weatherParticles: THREE.Points;
  private readonly bambooSpoutGroup = new THREE.Group();

  // 사우나 고요(saunagoyo.com) 스타일 3인칭 밀착 카메라 (dist = 5.4, pitch = 0.42)
  private cameraPreset: CameraPresetId = 'follow';
  private customLookTarget: THREE.Vector3 | null = null;
  private cameraAzimuth = 0.18;
  private cameraElevation = 0.42;
  private cameraDistance = 5.4;
  private targetCameraDistance = 5.4;
  private readonly cameraTarget = new THREE.Vector3(0, 0.92, 0.5);
  private isPointerDragging = false;
  private pointerDownPos = { x: 0, y: 0 };
  private lastPointerPos = { x: 0, y: 0 };

  // 로컬 플레이어 상태
  private selfSeat = 99;
  private selfPose: ScholarDynamicState['pose'] = 'sitting';
  private selfChairIndex = 0;
  private selfX = STUDY_CHAIR_SLOTS[0].seatX;
  private selfZ = STUDY_CHAIR_SLOTS[0].seatZ;
  private selfYaw = STUDY_CHAIR_SLOTS[0].facingYaw;
  private selfLumosAt: number | null = null;
  private selfFocusUntil: number | null = null;

  private walkTarget: { x: number; z: number; sitChairIndex: number } | null =
    null;
  private readonly keysPressed = new Set<string>();
  private lastStateBroadcastTime = 0;
  private bellResonanceFlash = 0;
  private lastFrameTime = performance.now();

  constructor(container: HTMLElement, callbacks: HallSceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    // 눈부심이 전혀 없는 차분한 자연광 배경 & 안개 (saunagoyo 노천탕 톤)
    this.scene.background = new THREE.Color(0xdce6e8);
    this.scene.fog = new THREE.FogExp2(0xdce6e8, 0.0085);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.08,
      160
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.container.appendChild(this.renderer.domElement);

    // 사우나 고요(saunagoyo.com)와 동일한 밸런스의 라이팅 (화이트아웃 방지)
    this.hemiLight = new THREE.HemisphereLight(0xdfecf5, 0x5a5244, 0.65);
    this.hemiLight.position.set(0, 25, 0);
    this.scene.add(this.hemiLight);

    this.ambientLight = new THREE.AmbientLight(0xffe8d4, 0.18);
    this.scene.add(this.ambientLight);

    this.sunDirLight = new THREE.DirectionalLight(0xfff1cf, 0.95);
    this.sunDirLight.position.set(14, 20, -6);
    this.sunDirLight.castShadow = true;
    this.sunDirLight.shadow.mapSize.set(2048, 2048);
    const d = 20;
    this.sunDirLight.shadow.camera.left = -d;
    this.sunDirLight.shadow.camera.right = d;
    this.sunDirLight.shadow.camera.top = d;
    this.sunDirLight.shadow.camera.bottom = -d;
    this.scene.add(this.sunDirLight);

    this.campfireLight = new THREE.PointLight(0xff8c2b, 2.2, 9, 2);
    this.campfireLight.position.set(-10.2, 0.85, 3.2);
    this.scene.add(this.campfireLight);

    // 텍스처 기반 온천 마을 & 다중 구역 빌드
    this.buildTexturedOnsenWorld();
    this.buildBathSpotsAndFloatingTrays();
    this.buildSoftSteamSprites();
    this.weatherParticles = this.buildSeasonalParticles();

    // 초기 카메라 타겟을 내 캐릭터 위치에 즉시 맞춤
    this.cameraTarget.set(this.selfX, 0.85, this.selfZ);

    this.bindInputEvents();
    this.animate();
  }

  public setCameraPreset(preset: CameraPresetId): void {
    this.cameraPreset = preset;
    this.customLookTarget = null;
    if (preset === 'overview') {
      this.targetCameraDistance = 12.8;
      this.cameraElevation = 0.58;
    } else if (preset === 'main_bath') {
      this.targetCameraDistance = 6.8;
      this.cameraElevation = 0.46;
    } else if (preset === 'pavilion') {
      this.targetCameraDistance = 6.2;
      this.cameraElevation = 0.36;
    } else if (preset === 'hinoki_bath') {
      this.targetCameraDistance = 5.8;
      this.cameraElevation = 0.44;
    } else if (preset === 'footbath') {
      this.targetCameraDistance = 5.8;
      this.cameraElevation = 0.42;
    } else {
      this.targetCameraDistance = 5.4;
      this.cameraElevation = 0.42;
    }
  }

  public focusOnWorldPoint(x: number, y: number, z: number): void {
    this.cameraPreset = 'main_bath';
    this.customLookTarget = new THREE.Vector3(x, y + 0.45, z);
    this.targetCameraDistance = 4.5;
  }

  /**
   * 4가지 시간대·계절 분위기 전환 (낮 설경 / 노을빛 / 별밤 초롱불 / 봄 벚꽃)
   */
  public setWeatherMood(mood: WeatherMood): void {
    const pMat = this.weatherParticles.material as THREE.PointsMaterial;
    const skyMat = this.skyDomeMesh.material as THREE.MeshBasicMaterial;
    const panoMat = this.panoramaMesh.material as THREE.MeshBasicMaterial;

    if (mood === 'starlight') {
      // ☀️ 맑은 겨울 설경 노천탕 (기본)
      this.scene.background = new THREE.Color(0xdce6e8);
      this.scene.fog = new THREE.FogExp2(0xdce6e8, 0.0085);
      skyMat.map = TEX_SKY_DAY;
      panoMat.map = TEX_PANORAMA_DAY;
      this.hemiLight.color.setHex(0xdfecf5);
      this.hemiLight.groundColor.setHex(0x5a5244);
      this.hemiLight.intensity = 0.65;
      this.sunDirLight.color.setHex(0xfff1cf);
      this.sunDirLight.intensity = 0.95;
      pMat.color.setHex(0xffffff);
      this.updateTreeFoliageColor(0x2f5e3d);
      this.setLanternIntensity(0.9);
    } else if (mood === 'dawn') {
      // 🌸 봄 벚꽃 노천탕
      this.scene.background = new THREE.Color(0xeedce2);
      this.scene.fog = new THREE.FogExp2(0xeedce2, 0.0085);
      skyMat.map = TEX_SKY_SUNSET;
      panoMat.map = TEX_PANORAMA_DAY;
      this.hemiLight.color.setHex(0xffe8f0);
      this.hemiLight.groundColor.setHex(0x5e4c46);
      this.hemiLight.intensity = 0.65;
      this.sunDirLight.color.setHex(0xffd6e0);
      this.sunDirLight.intensity = 0.9;
      pMat.color.setHex(0xffb3c6);
      this.updateTreeFoliageColor(0xe598ad);
      this.setLanternIntensity(1.0);
    } else if (mood === 'rainstorm') {
      // 🍁 노을 단풍 노천탕
      this.scene.background = new THREE.Color(0xe8d4bc);
      this.scene.fog = new THREE.FogExp2(0xe8d4bc, 0.0085);
      skyMat.map = TEX_SKY_SUNSET;
      panoMat.map = TEX_PANORAMA_DAY;
      this.hemiLight.color.setHex(0xffe3c8);
      this.hemiLight.groundColor.setHex(0x594233);
      this.hemiLight.intensity = 0.62;
      this.sunDirLight.color.setHex(0xffb86c);
      this.sunDirLight.intensity = 0.95;
      pMat.color.setHex(0xf48c06);
      this.updateTreeFoliageColor(0xb84a27);
      this.setLanternIntensity(1.3);
    } else if (mood === 'aurora') {
      // 🏮 별밤 초롱불 노천탕 (saunagoyo 야간 모드와 동일)
      this.scene.background = new THREE.Color(0x111a2e);
      this.scene.fog = new THREE.FogExp2(0x121b30, 0.012);
      skyMat.map = TEX_SKY_NIGHT;
      panoMat.map = TEX_PANORAMA_NIGHT;
      this.hemiLight.color.setHex(0x3a4f7a);
      this.hemiLight.groundColor.setHex(0x1d1814);
      this.hemiLight.intensity = 0.42;
      this.sunDirLight.color.setHex(0x8fa8d6);
      this.sunDirLight.intensity = 0.45;
      pMat.color.setHex(0xffe66d);
      this.updateTreeFoliageColor(0x1f402b);
      this.setLanternIntensity(2.2);
    }
    skyMat.needsUpdate = true;
    panoMat.needsUpdate = true;
  }

  private setLanternIntensity(val: number): void {
    for (const light of this.lanternLights) {
      light.intensity = val;
    }
  }

  private updateTreeFoliageColor(hex: number): void {
    for (const mesh of this.treeFoliageMeshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(hex);
    }
  }

  public setSelfIdentity(seat: number): void {
    this.selfSeat = seat;
    if (seat >= 0 && seat < STUDY_CHAIR_SLOTS.length) {
      const slot = STUDY_CHAIR_SLOTS[seat];
      this.selfChairIndex = slot.index;
      this.selfX = slot.seatX;
      this.selfZ = slot.seatZ;
      this.selfYaw = slot.facingYaw;
      this.selfPose = 'sitting';
      this.cameraTarget.set(this.selfX, 0.85, this.selfZ);
      this.callbacks.onSeatChanged(slot.index, slot.zoneName);
    }
  }

  public setSelfFocusUntil(focusUntil: number | null): void {
    this.selfFocusUntil = focusUntil;
    this.broadcastSelfState(true);
  }

  public triggerSelfLumos(): void {
    this.selfLumosAt = Date.now();
    const selfMesh = this.avatarMeshes.get(this.selfSeat);
    if (selfMesh) {
      selfMesh.triggerLumosPulse();
    }
    this.broadcastSelfState(true);
  }

  public triggerSelfBow(): void {
    const selfMesh = this.avatarMeshes.get(this.selfSeat);
    if (selfMesh) {
      selfMesh.triggerBow();
    }
  }

  public getSelfPose(): ScholarDynamicState['pose'] {
    return this.selfPose;
  }

  /**
   * 오른손에 온천 매점 간식 들기 / 내려놓기
   */
  public setSelfSnack(itemId: SnackItemId): void {
    const selfMesh = this.avatarMeshes.get(this.selfSeat);
    if (selfMesh) {
      selfMesh.setHeldSnack(itemId);
    }
  }

  /**
   * 들고 있는 간식 한 모금 / 한 입 먹기
   */
  public triggerSelfUseSnack(): boolean {
    const selfMesh = this.avatarMeshes.get(this.selfSeat);
    if (selfMesh) {
      return selfMesh.triggerUseSnack();
    }
    return false;
  }

  /**
   * 특정 구역의 빈 좌석으로 즉시 이동/입수
   */
  public moveToZone(
    zoneId: 'main_bath' | 'hinoki_bath' | 'pavilion' | 'footbath'
  ): void {
    const candidates = STUDY_CHAIR_SLOTS.filter((s) => s.zone === zoneId);
    if (candidates.length === 0) return;
    const chosen =
      candidates[Math.floor(Math.random() * candidates.length)] ??
      candidates[0];
    this.walkTarget = null;
    this.selfChairIndex = chosen.index;
    this.selfX = chosen.seatX;
    this.selfZ = chosen.seatZ;
    this.selfYaw = chosen.facingYaw;
    this.selfPose = 'sitting';
    this.cameraPreset = 'follow';
    this.customLookTarget = null;
    this.targetCameraDistance = 5.2;
    this.callbacks.onSeatChanged(chosen.index, chosen.zoneName);
    this.broadcastSelfState(true);
  }

  /**
   * 현재 위치에서 앉기/입수하기 ↔ 일어서기 토글
   */
  public toggleSitOrStand(): string {
    if (this.selfPose === 'sitting') {
      this.selfPose = 'standing';
      this.broadcastSelfState(true);
      return '자리에서 일어났어요';
    }
    this.selfPose = 'sitting';
    this.broadcastSelfState(true);
    return '자리에 앉아 온천욕을 즐겨요';
  }

  public triggerBellResonanceWave(): void {
    this.bellResonanceFlash = 1.0;
  }

  public syncVisitors(visitors: ScholarVisitor[], selfSeat: number): void {
    this.selfSeat = selfSeat;
    const now = Date.now();
    const activeSeats = new Set<number>();

    for (const v of visitors) {
      activeSeats.add(v.seat);
      const isSelf = v.seat === selfSeat;

      if (isSelf) {
        const effectiveSelf: ScholarVisitor = {
          ...v,
          pose: this.selfPose,
          chairIndex: this.selfChairIndex,
          x: this.selfX,
          z: this.selfZ,
          yaw: this.selfYaw,
          lumosAt: this.selfLumosAt,
          focusUntil: this.selfFocusUntil,
        };
        let mesh = this.avatarMeshes.get(v.seat);
        if (!mesh) {
          mesh = new ScholarAvatarMesh(effectiveSelf, true);
          this.avatarMeshes.set(v.seat, mesh);
          this.scene.add(mesh.group);
        } else {
          mesh.syncAppearance(effectiveSelf, true, now);
        }
        this.latestVisitors.set(v.seat, effectiveSelf);
      } else {
        let mesh = this.avatarMeshes.get(v.seat);
        if (!mesh) {
          mesh = new ScholarAvatarMesh(v, false);
          this.avatarMeshes.set(v.seat, mesh);
          this.scene.add(mesh.group);
        } else {
          mesh.syncAppearance(v, false, now);
        }
        this.latestVisitors.set(v.seat, v);
      }
    }

    for (const [seat, mesh] of this.avatarMeshes.entries()) {
      if (!activeSeats.has(seat)) {
        this.scene.remove(mesh.group);
        mesh.dispose();
        this.avatarMeshes.delete(seat);
        this.latestVisitors.delete(seat);
      }
    }
  }

  public syncWishes(wishes: WishCandle[]): void {
    const incomingIds = new Set<string>();
    for (const w of wishes) {
      incomingIds.add(w.id);
      if (!this.wishEntries.has(w.id)) {
        this.addWishCandleMesh(w);
      }
    }

    for (const [id, entry] of this.wishEntries.entries()) {
      if (!incomingIds.has(id)) {
        this.scene.remove(entry.group);
        const hitIdx = this.wishHitMeshes.indexOf(entry.hitMesh);
        if (hitIdx >= 0) {
          this.wishHitMeshes.splice(hitIdx, 1);
        }
        this.wishEntries.delete(id);
      }
    }
  }

  public addWishCandleMesh(wish: WishCandle): void {
    if (this.wishEntries.has(wish.id)) return;

    const group = new THREE.Group();
    group.position.set(wish.x, -0.02, wish.z);

    // 물 위에 동동 떠 있는 편백나무 미니 쟁반 + 황금 소원 유자
    const tray = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.15, 0.04, 16),
      new THREE.MeshStandardMaterial({
        map: tileTexture(TEX_HINOKI_BENCH, 1, 1),
        roughness: 0.75,
      })
    );
    group.add(tray);

    const yuzuMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 16, 14),
      new THREE.MeshStandardMaterial({
        color: 0xffa200,
        emissive: 0xff7b00,
        emissiveIntensity: 0.25,
        roughness: 0.4,
      })
    );
    yuzuMesh.scale.set(1.12, 0.88, 1.12);
    yuzuMesh.position.y = 0.095;
    group.add(yuzuMesh);

    const leafMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.038, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x3b8f29, roughness: 0.65 })
    );
    leafMesh.scale.set(1.6, 0.35, 0.8);
    leafMesh.position.set(0.035, 0.18, 0);
    leafMesh.rotation.z = -0.35;
    group.add(leafMesh);

    const hitMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 8, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitMesh.position.y = 0.1;
    hitMesh.userData = { wishId: wish.id };
    group.add(hitMesh);

    this.scene.add(group);
    this.wishEntries.set(wish.id, {
      wish,
      group,
      hitMesh,
      phase: Math.random() * Math.PI * 2,
    });
    this.wishHitMeshes.push(hitMesh);
  }

  /**
   * 사우나 고요(saunagoyo.com)의 프로시저럴 텍스처 기법을 적용한 고해상도 온천 월드 구축
   */
  private buildTexturedOnsenWorld(): void {
    // 1. 하늘 돔 (Sky Dome) & 360도 병풍 산맥 파노라마 (Sn() in saunagoyo)
    const skyMat = new THREE.MeshBasicMaterial({
      map: TEX_SKY_DAY,
      side: THREE.BackSide,
      fog: false,
    });
    skyMat.toneMapped = false;
    this.skyDomeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(95, 32, 16),
      skyMat
    );
    this.scene.add(this.skyDomeMesh);

    const panoMat = new THREE.MeshBasicMaterial({
      map: TEX_PANORAMA_DAY,
      side: THREE.BackSide,
      transparent: true,
      fog: false,
    });
    panoMat.toneMapped = false;
    this.panoramaMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(72, 72, 28, 64, 1, true),
      panoMat
    );
    this.panoramaMesh.position.y = 8.5;
    this.scene.add(this.panoramaMesh);

    // 2. 외곽 이끼/숲 바닥 (TEX_FOREST_MOSS — 중앙 노천탕 수조 영역은 구멍을 뚫어 수조 타일이 선명히 보이게 함)
    const forestShape = new THREE.Shape();
    forestShape.moveTo(-80, -80);
    forestShape.lineTo(80, -80);
    forestShape.lineTo(80, 80);
    forestShape.lineTo(-80, 80);
    forestShape.lineTo(-80, -80);

    const innerCutout = new THREE.Path();
    innerCutout.moveTo(-14.2, -9.2);
    innerCutout.lineTo(-14.2, 8.2);
    innerCutout.lineTo(14.2, 8.2);
    innerCutout.lineTo(14.2, -9.2);
    innerCutout.lineTo(-14.2, -9.2);
    forestShape.holes.push(innerCutout);

    const forestGeo = new THREE.ShapeGeometry(forestShape);
    const fPos = forestGeo.attributes.position;
    const fUv = forestGeo.attributes.uv;
    for (let i = 0; i < fPos.count; i += 1) {
      fUv.setXY(i, fPos.getX(i) * 0.2, fPos.getY(i) * 0.2);
    }

    const outerForestFloor = new THREE.Mesh(
      forestGeo,
      new THREE.MeshStandardMaterial({
        map: tileTexture(TEX_FOREST_MOSS, 1, 1),
        roughness: 0.98,
      })
    );
    outerForestFloor.rotation.x = -Math.PI / 2;
    outerForestFloor.position.y = -0.02;
    outerForestFloor.receiveShadow = true;
    this.scene.add(outerForestFloor);

    // 3. 노천탕 메인 자연석 판석 마당 (_n() in saunagoyo: 중앙 대노천탕 구멍 타공!)
    const courtyardShape = new THREE.Shape();
    courtyardShape.moveTo(-15.5, -10.5);
    courtyardShape.lineTo(15.5, -10.5);
    courtyardShape.lineTo(15.5, 9.5);
    courtyardShape.lineTo(-15.5, 9.5);
    courtyardShape.lineTo(-15.5, -10.5);

    // 중앙 대노천탕 타원형 홀 타공 (cx = 0, cz = 0.5, rx = 5.7, rz = 4.4)
    const mainBathHole = new THREE.Path();
    mainBathHole.absellipse(0, -0.5, 5.7, 4.4, 0, Math.PI * 2, true, 0);
    courtyardShape.holes.push(mainBathHole);

    // 동쪽 편백탕 사각형 홀 타공 (x = 8.4..12.6, z = -2.9..0.9)
    const hinokiHole = new THREE.Path();
    hinokiHole.moveTo(8.4, 2.9);
    hinokiHole.lineTo(8.4, -0.9);
    hinokiHole.lineTo(12.6, -0.9);
    hinokiHole.lineTo(12.6, 2.9);
    hinokiHole.lineTo(8.4, 2.9);
    courtyardShape.holes.push(hinokiHole);

    const courtyardGeo = new THREE.ShapeGeometry(courtyardShape, 48);
    // ShapeGeometry UV 스케일 보정
    const posAttr = courtyardGeo.attributes.position;
    const uvAttr = courtyardGeo.attributes.uv;
    for (let i = 0; i < posAttr.count; i += 1) {
      uvAttr.setXY(i, posAttr.getX(i) * 0.22, posAttr.getY(i) * 0.22);
    }

    const courtyardMesh = new THREE.Mesh(
      courtyardGeo,
      new THREE.MeshStandardMaterial({
        map: tileTexture(TEX_STONE_PAVING, 1, 1),
        roughness: 0.92,
      })
    );
    courtyardMesh.rotation.x = -Math.PI / 2;
    courtyardMesh.receiveShadow = true;
    this.scene.add(courtyardMesh);
    this.walkableMeshes.push(courtyardMesh);

    // 4. 중앙 유자 대노천탕 수조 & 물결 (yn() & bn() in saunagoyo)
    this.buildMainRotenburoPool();

    // 5. 동쪽 히노끼 편백 노천탕 & 정자 (vn() in saunagoyo)
    this.buildEastHinokiBath();

    // 6. 북쪽 전통 목조 온천 본관 툇마루 & 고요 매점 카운터 (Ci() in saunagoyo)
    this.buildNorthPavilionAndCafe();

    // 7. 서남쪽 숲속 외기욕 리클라이너 & 모닥불 족욕탕 (Ii() in saunagoyo)
    this.buildWestForestRestAndCampfire();

    // 8. 대나무 울타리(TEX_BAMBOO_FENCE), 석등(tōrō), 소나무 숲 둘러싸기
    this.buildBambooFencesLanternsAndPines();
  }

  /**
   * 1) 중앙 유자 대노천탕 (깊이 있는 수조 + 윤슬 스크롤 수면 + 자연석 테두리 + 중앙 석등 바위섬)
   */
  private buildMainRotenburoPool(): void {
    const rx = 5.75;
    const rz = 4.45;
    const depth = 0.72;

    // 수조 내벽 (자연 암석 텍스처)
    const poolWallMat = new THREE.MeshStandardMaterial({
      map: tileTexture(TEX_ROCK_SURFACE, 8, 1),
      color: 0xd8d0c5,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    const poolWall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, depth, 48, 1, true),
      poolWallMat
    );
    poolWall.scale.set(rx, 1, rz);
    poolWall.position.set(0, -depth / 2, 0.5);
    this.scene.add(poolWall);

    // 수조 바닥 (청록 온천 타일)
    const poolBottom = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshStandardMaterial({
        map: tileTexture(TEX_BATH_TILE_TEAL, 5, 5),
        roughness: 0.6,
      })
    );
    poolBottom.rotation.x = -Math.PI / 2;
    poolBottom.scale.set(rx, rz, 1);
    poolBottom.position.set(0, -depth, 0.5);
    this.scene.add(poolBottom);

    // 물결 윤슬이 흐르는 반투명 수면 (Ct() in saunagoyo)
    const waterTex = tileTexture(TEX_WATER_RIPPLES, 4, 3);
    this.scrolledTextures.push({ tex: waterTex, vx: 0.014, vy: 0.009 });

    const mainWater = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshStandardMaterial({
        color: 0x68c4c0,
        map: waterTex,
        transparent: true,
        opacity: 0.68,
        roughness: 0.08,
        metalness: 0.15,
        depthWrite: false,
      })
    );
    mainWater.rotation.x = -Math.PI / 2;
    mainWater.scale.set(rx, rz, 1);
    mainWater.position.set(0, -0.05, 0.5);
    this.scene.add(mainWater);
    this.walkableMeshes.push(mainWater);

    // 노천탕 테두리 자연석 바위 44개 (bn() in saunagoyo)
    const rockMat = new THREE.MeshStandardMaterial({
      map: tileTexture(TEX_ROCK_SURFACE, 1, 1),
      color: 0xe8e2d8,
      roughness: 0.88,
    });
    for (let i = 0; i < 44; i += 1) {
      const angle = (i / 44) * Math.PI * 2 + rand(-0.04, 0.04);
      const rSize = rand(0.28, 0.52);
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rSize, 1),
        rockMat
      );
      rock.position.set(
        Math.cos(angle) * (rx + rSize * 0.35),
        rSize * 0.32,
        0.5 + Math.sin(angle) * (rz + rSize * 0.35)
      );
      rock.scale.set(1.35, 0.68, 1.05);
      rock.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);
    }

    // 중앙 바위섬 + 전통 석등 + 대나무 온천수 낙수대 (시시오도시)
    const islandGroup = new THREE.Group();
    islandGroup.position.set(0, 0, 0.5);

    const islandBase = new THREE.Mesh(
      new THREE.CylinderGeometry(1.45, 1.75, 0.55, 16),
      rockMat
    );
    islandBase.position.y = -0.05;
    islandGroup.add(islandBase);

    for (let i = 0; i < 8; i += 1) {
      const ang = (i / 8) * Math.PI * 2;
      const subRock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.38, 0),
        rockMat
      );
      subRock.scale.set(1.2, 0.65, 1.1);
      subRock.position.set(Math.cos(ang) * 1.35, 0.12, Math.sin(ang) * 1.15);
      islandGroup.add(subRock);
    }

    // 바위섬 위 전통 석등 (tōrō)
    this.buildStoneLantern(islandGroup, 0, 0.22, 0);

    // 대나무 온천수 수구 + 떨어지는 물줄기 (TEX_WATERFALL_STREAM)
    const bambooMat = new THREE.MeshStandardMaterial({
      color: 0x6b8e4e,
      roughness: 0.65,
    });
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.09, 0.85, 10),
      bambooMat
    );
    post.position.set(0.75, 0.45, 0.45);
    islandGroup.add(post);

    this.bambooSpoutGroup.position.set(0.75, 0.78, 0.65);
    const spoutPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.65, 10),
      bambooMat
    );
    spoutPipe.rotation.x = Math.PI / 2.6;
    this.bambooSpoutGroup.add(spoutPipe);
    islandGroup.add(this.bambooSpoutGroup);

    const streamTex = tileTexture(TEX_WATERFALL_STREAM, 1, 1);
    this.scrolledTextures.push({ tex: streamTex, vx: 0, vy: 1.5 });
    const waterStream = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.72),
      new THREE.MeshBasicMaterial({
        map: streamTex,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    waterStream.position.set(0.75, 0.36, 0.92);
    islandGroup.add(waterStream);

    // 탕 속에 동동 떠 있는 작은 장식 유자 14개
    const yuzuMat = new THREE.MeshStandardMaterial({
      color: 0xffa600,
      roughness: 0.45,
    });
    for (let i = 0; i < 14; i += 1) {
      const ang = (i / 14) * Math.PI * 2 + 0.2;
      const dist = 2.6 + (i % 3) * 0.85;
      const yuzu = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 12, 10),
        yuzuMat
      );
      yuzu.scale.set(1.1, 0.85, 1.1);
      yuzu.position.set(
        Math.cos(ang) * dist,
        -0.02,
        0.5 + Math.sin(ang) * (dist * 0.76)
      );
      this.scene.add(yuzu);
    }

    this.scene.add(islandGroup);
  }

  /**
   * 2) 동쪽 히노끼 편백 노천탕 (x = 10.5, z = -1.0)
   */
  private buildEastHinokiBath(): void {
    const cx = 10.5;
    const cz = -1.0;
    const w = 4.2;
    const d = 3.8;
    const depth = 0.65;

    const hinokiFrameMat = new THREE.MeshStandardMaterial({
      map: tileTexture(TEX_HINOKI_BENCH, 2, 1),
      roughness: 0.72,
    });
    const hinokiWallMat = new THREE.MeshStandardMaterial({
      map: tileTexture(TEX_VERTICAL_WOOD, 3, 1),
      roughness: 0.8,
    });

    // 수조 바닥 & 내벽
    const bottom = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({
        map: tileTexture(TEX_BATH_TILE_SLATE, 3, 3),
        roughness: 0.55,
      })
    );
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(cx, -depth, cz);
    this.scene.add(bottom);

    // 편백나무 욕조 턱 (4면)
    const rimTop = [
      { w: w + 0.4, d: 0.26, x: cx, z: cz - d / 2 - 0.1 },
      { w: w + 0.4, d: 0.26, x: cx, z: cz + d / 2 + 0.1 },
      { w: 0.26, d: d + 0.4, x: cx - w / 2 - 0.1, z: cz },
      { w: 0.26, d: d + 0.4, x: cx + w / 2 + 0.1, z: cz },
    ];
    for (const r of rimTop) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(r.w, 0.24, r.d),
        hinokiFrameMat
      );
      mesh.position.set(r.x, 0.08, r.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    // 히노끼탕 수면
    const hinokiWaterTex = tileTexture(TEX_WATER_RIPPLES, 2.5, 2.5);
    this.scrolledTextures.push({
      tex: hinokiWaterTex,
      vx: -0.011,
      vy: 0.008,
    });
    const hinokiWater = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({
        color: 0x62b6cb,
        map: hinokiWaterTex,
        transparent: true,
        opacity: 0.66,
        roughness: 0.08,
        depthWrite: false,
      })
    );
    hinokiWater.rotation.x = -Math.PI / 2;
    hinokiWater.position.set(cx, -0.05, cz);
    this.scene.add(hinokiWater);
    this.walkableMeshes.push(hinokiWater);

    // 편백 정자 기둥 4개 & 지붕 & 현판
    const pillarOffsets = [
      [-2.1, -1.9],
      [2.1, -1.9],
      [-2.1, 1.9],
      [2.1, 1.9],
    ];
    for (const [px, pz] of pillarOffsets) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.12, 2.8, 12),
        hinokiWallMat
      );
      pillar.position.set(cx + px, 1.4, cz + pz);
      pillar.castShadow = true;
      this.scene.add(pillar);
    }

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(3.6, 1.15, 4),
      new THREE.MeshStandardMaterial({
        map: tileTexture(TEX_DARK_DECK, 3, 2),
        roughness: 0.85,
      })
    );
    roof.position.set(cx, 3.25, cz);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    this.scene.add(roof);

    // 나무 현판 ("편백 히노끼탕 · 40.5°C")
    const signMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.48),
      new THREE.MeshStandardMaterial({
        map: makeWoodenSignTexture('편백 히노끼탕', '40.5°C 솔향기 노천욕'),
        roughness: 0.7,
      })
    );
    signMesh.position.set(cx - 2.12, 2.38, cz);
    signMesh.rotation.y = -Math.PI / 2;
    this.scene.add(signMesh);

    // 편백 나무통(오케) 소품 3개 쌓기
    for (let i = 0; i < 3; i += 1) {
      const bucket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.14, 0.22, 16),
        hinokiFrameMat
      );
      bucket.position.set(cx + 1.8, 0.3 + i * 0.21, cz - 1.7);
      this.scene.add(bucket);
    }
  }

  /**
   * 3) 북쪽 전통 온천 본관 툇마루 & 고요 매점 카운터 (z = -7.5 .. -10.2)
   */
  private buildNorthPavilionAndCafe(): void {
    const g = new THREE.Group();
    g.position.set(0, 0, -9.2);

    const wallMat = new THREE.MeshStandardMaterial({
      map: tileTexture(TEX_HINOKI_WALL, 4, 2),
      roughness: 0.82,
    });
    const deckMat = new THREE.MeshStandardMaterial({
      map: tileTexture(TEX_WOOD_FLOOR, 5, 2),
      roughness: 0.85,
    });
    const pillarMat = new THREE.MeshStandardMaterial({
      map: tileTexture(TEX_VERTICAL_WOOD, 1, 2),
      roughness: 0.8,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x2b303a,
      roughness: 0.75,
    });

    // 툇마루 목조 데크 (x = -6.5..6.5, z = -9.8..-6.6)
    const verandaDeck = new THREE.Mesh(
      new THREE.BoxGeometry(13.2, 0.38, 3.2),
      deckMat
    );
    verandaDeck.position.set(0, 0.19, 1.1);
    verandaDeck.receiveShadow = true;
    g.add(verandaDeck);

    // 본관 1층 벽체
    const mainWall = new THREE.Mesh(
      new THREE.BoxGeometry(12.4, 3.2, 2.2),
      wallMat
    );
    mainWall.position.set(0, 1.95, -0.3);
    mainWall.castShadow = true;
    mainWall.receiveShadow = true;
    g.add(mainWall);

    // 기둥 6개
    for (const px of [-5.8, -3.5, -1.2, 1.2, 3.5, 5.8]) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.15, 3.2, 12),
        pillarMat
      );
      col.position.set(px, 1.95, 0.9);
      col.castShadow = true;
      g.add(col);
    }

    // 따뜻한 불빛이 새어 나오는 장지문(Shoji) 창문 3개
    const shojiMat = new THREE.MeshBasicMaterial({
      color: 0xffe4b5,
    });
    shojiMat.toneMapped = false;
    for (const wx of [-4.6, 0, 4.6]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.9), shojiMat);
      win.position.set(wx, 1.85, 0.82);
      g.add(win);

      // 창살 격자
      for (const gx of [-0.45, 0, 0.45]) {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 1.9, 0.04),
          pillarMat
        );
        bar.position.set(wx + gx, 1.85, 0.84);
        g.add(bar);
      }
    }

    // 1층 처마 지붕 & 2층 누각 지붕
    const roof1 = new THREE.Mesh(
      new THREE.BoxGeometry(14.4, 0.36, 4.4),
      roofMat
    );
    roof1.position.set(0, 3.65, 0.3);
    roof1.rotation.x = 0.08;
    roof1.castShadow = true;
    g.add(roof1);

    const upperWall = new THREE.Mesh(
      new THREE.BoxGeometry(8.2, 1.8, 1.8),
      wallMat
    );
    upperWall.position.set(0, 4.6, -0.3);
    g.add(upperWall);

    const roof2 = new THREE.Mesh(
      new THREE.BoxGeometry(10.2, 0.42, 3.4),
      roofMat
    );
    roof2.position.set(0, 5.6, -0.2);
    roof2.rotation.x = 0.06;
    g.add(roof2);

    // 본관 정면 중앙 대현판 ("유자 노천탕 · 41.2°C")
    const mainSign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.82),
      new THREE.MeshStandardMaterial({
        map: makeWoodenSignTexture('유자 노천탕', '수온 41.2°C · 카피바라 온천'),
        roughness: 0.65,
      })
    );
    mainSign.position.set(0, 3.95, 2.52);
    g.add(mainSign);

    // 본관 툇마루 동쪽 끝에 아기자기한 온천 매점 가판대 (saunagoyo Ci() 스타일)
    const cafeGroup = new THREE.Group();
    cafeGroup.position.set(2.3, 0.38, 1.45);

    const counterBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.72, 0.58),
      new THREE.MeshStandardMaterial({ color: 0xf4ebd9, roughness: 0.8 })
    );
    counterBody.position.y = 0.36;
    cafeGroup.add(counterBody);

    const counterTop = new THREE.Mesh(
      new THREE.BoxGeometry(2.56, 0.06, 0.68),
      new THREE.MeshStandardMaterial({
        map: tileTexture(TEX_HINOKI_BENCH, 2, 1),
        roughness: 0.6,
      })
    );
    counterTop.position.y = 0.75;
    cafeGroup.add(counterTop);

    // 줄무늬 어닝 차양막
    const awningMat = new THREE.MeshStandardMaterial({
      map: tileTexture(TEX_AWNING_STRIPE, 5, 1),
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    const awning = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.9),
      awningMat
    );
    awning.position.set(0, 1.95, 0.15);
    awning.rotation.x = -Math.PI / 2.8;
    cafeGroup.add(awning);

    // 카운터 위 유자 바구니 & 식혜/보리차 디스펜서
    const basket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.14, 0.12, 16),
      new THREE.MeshStandardMaterial({ color: 0xb98b56, roughness: 0.95 })
    );
    basket.position.set(-0.75, 0.84, 0);
    cafeGroup.add(basket);

    for (const [dx, col] of [
      [-0.2, 0xf1e6c8],
      [0.25, 0xffd166],
      [0.68, 0xc08a4a],
    ] as const) {
      const jar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.28, 16),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.3 })
      );
      jar.position.set(dx, 0.92, 0);
      cafeGroup.add(jar);
    }

    g.add(cafeGroup);

    // 툇마루 위에서 낮잠 자는 귀여운 치즈 고양이 (클릭하면 쓰다듬기 반응!)
    this.onsenCat = this.buildOnsenCat();
    this.onsenCat.root.position.set(-2.3, 0.38, -7.2);
    this.onsenCat.root.rotation.y = 0.35;
    this.scene.add(this.onsenCat.root);

    this.scene.add(g);
  }

  /**
   * 사우나 고요(saunagoyo.com) ei() 스타일 치즈태비 온천 고양이
   */
  private buildOnsenCat(): OnsenCatRig {
    const root = new THREE.Group();
    const furMat = new THREE.MeshStandardMaterial({
      color: 0xe8862e,
      roughness: 0.9,
    });
    const creamMat = new THREE.MeshStandardMaterial({
      color: 0xf7ebd2,
      roughness: 0.9,
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x3a2416 });

    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 12),
      furMat
    );
    body.scale.set(1, 1.1, 1.15);
    body.position.set(0, 0.16, -0.02);
    root.add(body);

    const chest = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 14, 10),
      creamMat
    );
    chest.scale.set(1, 1.15, 0.65);
    chest.position.set(0, 0.17, 0.09);
    root.add(chest);

    const head = new THREE.Group();
    head.position.set(0, 0.38, 0.04);
    root.add(head);

    const headSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.135, 16, 12),
      furMat
    );
    headSphere.scale.set(1.12, 0.95, 1);
    head.add(headSphere);

    const leftEye = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 10, 8),
      eyeMat
    );
    leftEye.position.set(-0.052, 0.018, 0.12);
    leftEye.scale.set(1, 1.2, 0.5);
    head.add(leftEye);

    const rightEye = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 10, 8),
      eyeMat
    );
    rightEye.position.set(0.052, 0.018, 0.12);
    rightEye.scale.set(1, 1.2, 0.5);
    head.add(rightEye);

    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(
        new THREE.ConeGeometry(0.052, 0.095, 4),
        furMat
      );
      ear.position.set(side * 0.08, 0.12, 0);
      ear.rotation.set(0, Math.PI / 4, -side * 0.32);
      head.add(ear);
    }

    const tail = new THREE.Group();
    tail.position.set(0.04, 0.06, -0.15);
    const tailMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.028, 0.24, 8),
      furMat
    );
    tailMesh.rotation.x = Math.PI / 3;
    tailMesh.position.set(0, 0.06, -0.08);
    tail.add(tailMesh);
    root.add(tail);

    const hitMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.6, 0.55),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitMesh.position.y = 0.25;
    hitMesh.userData = { kind: 'cat' };
    root.add(hitMesh);

    return {
      root,
      head,
      eyes: [leftEye, rightEye],
      tail,
      hitMesh,
      petTimer: -1,
    };
  }

  /**
   * 4) 서남쪽 외기욕 리클라이너 & 모닥불 족욕탕 (x = -10.2, z = 3.2)
   */
  private buildWestForestRestAndCampfire(): void {
    const cx = -10.2;
    const cz = 3.2;

    const deckMat = new THREE.MeshStandardMaterial({
      map: tileTexture(TEX_DARK_DECK, 3, 3),
      roughness: 0.88,
    });
    const benchMat = new THREE.MeshStandardMaterial({
      map: tileTexture(TEX_HINOKI_BENCH, 2, 1),
      roughness: 0.75,
    });

    // 목재 데크 바닥
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 5.2), deckMat);
    deck.position.set(cx, 0.08, cz);
    deck.receiveShadow = true;
    this.scene.add(deck);

    // 모닥불 화로 & 장작 & 불꽃
    const fireRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.14, 10, 20),
      new THREE.MeshStandardMaterial({
        map: tileTexture(TEX_ROCK_SURFACE, 2, 1),
        roughness: 0.95,
      })
    );
    fireRing.rotation.x = Math.PI / 2;
    fireRing.position.set(cx, 0.22, cz);
    this.scene.add(fireRing);

    const logMat = new THREE.MeshStandardMaterial({
      color: 0x4a2e1b,
      roughness: 0.95,
    });
    for (let i = 0; i < 4; i += 1) {
      const log = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.09, 0.85, 8),
        logMat
      );
      log.position.set(cx, 0.26, cz);
      log.rotation.z = Math.PI / 2.3;
      log.rotation.y = (i / 4) * Math.PI;
      this.scene.add(log);
    }

    const flameColors = [0xff5400, 0xff9e00, 0xffd166];
    for (let i = 0; i < 3; i += 1) {
      const flameMat = new THREE.MeshBasicMaterial({
        color: flameColors[i],
      });
      flameMat.toneMapped = false;
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.24 - i * 0.05, 0.65 + i * 0.12, 10),
        flameMat
      );
      flame.position.set(
        cx + (i - 1) * 0.06,
        0.52 + i * 0.06,
        cz + (i % 2 === 0 ? 0.04 : -0.04)
      );
      this.campfireFlames.push(flame);
      this.scene.add(flame);
    }

    // 사우나 고요 Ii() 스타일 원목 리클라이너 선베드 4개 배치
    const reclinerCoords: ReadonlyArray<[number, number, number]> = [
      [cx - 1.5, cz - 1.3, Math.PI / 4],
      [cx + 1.5, cz - 1.3, -Math.PI / 4],
      [cx + 1.5, cz + 1.3, (-3 * Math.PI) / 4],
      [cx - 1.5, cz + 1.3, (3 * Math.PI) / 4],
    ];
    const cushionMat = new THREE.MeshStandardMaterial({
      color: 0xe9dfd0,
      roughness: 0.95,
    });
    for (const [rx, rz, ry] of reclinerCoords) {
      const chairGroup = new THREE.Group();
      chairGroup.position.set(rx, 0.17, rz);
      chairGroup.rotation.y = ry;

      const bed = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.08, 1.45),
        benchMat
      );
      bed.rotation.x = 0.32;
      bed.position.y = 0.42;
      chairGroup.add(bed);

      const pillow = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.05, 0.36),
        cushionMat
      );
      pillow.rotation.x = 0.32;
      pillow.position.set(0, 0.58, -0.42);
      chairGroup.add(pillow);

      this.scene.add(chairGroup);
    }

    // 외기욕 나무 현판
    const restSign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.46),
      new THREE.MeshStandardMaterial({
        map: makeWoodenSignTexture('외기욕 · 모닥불', '숲속 리클라이너 쉼터'),
        roughness: 0.7,
      })
    );
    restSign.position.set(cx, 1.85, cz - 2.55);
    this.scene.add(restSign);
  }

  /**
   * 5) 대나무 울타리(TEX_BAMBOO_FENCE), 전통 석등, 소나무 숲 배치
   */
  private buildBambooFencesLanternsAndPines(): void {
    const bambooFenceMat = new THREE.MeshStandardMaterial({
      map: tileTexture(TEX_BAMBOO_FENCE, 7, 1),
      roughness: 0.9,
      side: THREE.DoubleSide,
    });

    // 동·서·남 외곽 대나무 울타리
    const leftFence = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 2.2),
      bambooFenceMat
    );
    leftFence.position.set(-14.8, 1.1, 0);
    leftFence.rotation.y = Math.PI / 2;
    this.scene.add(leftFence);

    const rightFence = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 2.2),
      bambooFenceMat
    );
    rightFence.position.set(14.8, 1.1, 0);
    rightFence.rotation.y = -Math.PI / 2;
    this.scene.add(rightFence);

    // 석등 6기 배치
    const lanternPositions: ReadonlyArray<[number, number]> = [
      [-6.2, -4.6],
      [6.2, -4.6],
      [-6.8, 4.2],
      [6.8, 4.2],
      [8.2, -3.4],
      [-7.8, -1.2],
    ];
    for (const [lx, lz] of lanternPositions) {
      this.buildStoneLantern(this.scene, lx, 0, lz);
    }

    // 외곽 소나무 & 정원수 48그루 (Cn() in saunagoyo)
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x4a3525,
      roughness: 0.98,
    });
    for (let i = 0; i < 48; i += 1) {
      const ang = (i / 48) * Math.PI * 2 + rand(-0.04, 0.04);
      const radius = 16.2 + (i % 3) * 3.8;
      const tx = Math.cos(ang) * radius;
      const tz = Math.sin(ang) * (radius * 0.82);

      // 남쪽 정면 카메라 시야 통로는 살짝 비워둠
      if (tz > 10 && Math.abs(tx) < 5.5) continue;

      const scale = rand(1.1, 2.1);
      const treeGroup = new THREE.Group();
      treeGroup.position.set(tx, 0, tz);

      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.12 * scale,
          0.17 * scale,
          1.4 * scale,
          7
        ),
        trunkMat
      );
      trunk.position.y = 0.7 * scale;
      treeGroup.add(trunk);

      const foliageMat = new THREE.MeshStandardMaterial({
        color: 0x2f5e3d,
        roughness: 0.92,
      });
      for (let tier = 0; tier < 3; tier += 1) {
        const coneH = scale * (1.45 - tier * 0.32);
        const coneR = scale * (0.95 - tier * 0.22);
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(coneR, coneH, 8),
          foliageMat
        );
        cone.position.y =
          scale * 1.1 + tier * scale * 0.8 + coneH / 2;
        cone.castShadow = true;
        this.treeFoliageMeshes.push(cone);
        treeGroup.add(cone);
      }

      this.scene.add(treeGroup);
    }
  }

  private buildStoneLantern(
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number
  ): void {
    const rockMat = new THREE.MeshStandardMaterial({
      map: tileTexture(TEX_ROCK_SURFACE, 1, 1),
      color: 0xe6dfd3,
      roughness: 0.88,
    });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffdf8e });
    glowMat.toneMapped = false;

    const g = new THREE.Group();
    g.position.set(x, y, z);

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 0.85, 8),
      rockMat
    );
    post.position.y = 0.42;
    g.add(post);

    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.3, 0.38),
      rockMat
    );
    box.position.y = 0.98;
    g.add(box);

    const lightCore = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.22, 0.4),
      glowMat
    );
    lightCore.position.y = 0.98;
    g.add(lightCore);

    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(0.44, 0.24, 6),
      rockMat
    );
    cap.position.y = 1.24;
    g.add(cap);

    const ptLight = new THREE.PointLight(0xffae42, 0.9, 5.5, 2);
    ptLight.position.set(0, 1.0, 0);
    g.add(ptLight);
    this.lanternLights.push(ptLight);

    parent.add(g);
  }

  /**
   * 42석 온천 좌석 히트 메쉬 & 미니 트레이 배치
   */
  private buildBathSpotsAndFloatingTrays(): void {
    const cushionMat = new THREE.MeshStandardMaterial({
      color: 0xd9a05b,
      roughness: 0.85,
    });
    const trayWoodMat = new THREE.MeshStandardMaterial({
      map: tileTexture(TEX_HINOKI_BENCH, 1, 1),
      roughness: 0.72,
    });

    for (const slot of STUDY_CHAIR_SLOTS) {
      // 본관 툇마루 좌석에는 방석 배치
      if (slot.zone === 'pavilion') {
        const cushion = new THREE.Mesh(
          new THREE.BoxGeometry(0.52, 0.07, 0.48),
          cushionMat
        );
        cushion.position.set(slot.seatX, 0.41, slot.seatZ);
        this.scene.add(cushion);
      }

      const hitMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.45, 0.5, 10),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hitMesh.position.set(slot.seatX, 0.2, slot.seatZ);
      hitMesh.userData = { chairIndex: slot.index };
      this.scene.add(hitMesh);
      this.spotHitMeshes.push(hitMesh);

      // 집중 모드일 때만 물 위에 뜨는 귀여운 히노끼 미니 트레이 (기본 숨김으로 시야 깔끔하게 유지)
      const floatingTrayGroup = new THREE.Group();
      floatingTrayGroup.position.set(
        slot.deskX,
        slot.isWater ? -0.02 : slot.seatY + 0.38,
        slot.deskZ
      );
      floatingTrayGroup.rotation.y = slot.facingYaw;
      floatingTrayGroup.visible = false;

      const trayBoard = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.035, 0.26),
        trayWoodMat
      );
      floatingTrayGroup.add(trayBoard);

      // 트레이 위 미니 유자 1개
      const miniYuzu = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xffa200, roughness: 0.45 })
      );
      miniYuzu.position.set(-0.08, 0.055, 0);
      floatingTrayGroup.add(miniYuzu);

      this.scene.add(floatingTrayGroup);

      this.bathSpots.push({
        slot,
        spotHitMesh: hitMesh,
        floatingTrayGroup,
      });
    }
  }

  /**
   * 사우나 고요(saunagoyo.com) Ar/Mr 방식의 부드러운 방사형 수증기 스프라이트
   */
  private buildSoftSteamSprites(): void {
    for (let i = 0; i < 36; i += 1) {
      const isHinoki = i >= 28;
      const ang = rand(0, Math.PI * 2);
      const r = isHinoki ? rand(0.3, 1.6) : rand(1.6, 5.1);
      const bx = isHinoki ? 10.5 + Math.cos(ang) * r : Math.cos(ang) * r;
      const bz = isHinoki
        ? -1.0 + Math.sin(ang) * r
        : 0.5 + Math.sin(ang) * (r * 0.76);

      const mat = new THREE.SpriteMaterial({
        map: TEX_STEAM_PUFF,
        color: 0xfffdf8,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(bx, 0.05, bz);
      this.scene.add(sprite);

      this.steamSprites.push({
        sprite,
        age: rand(0, 4.2),
        life: rand(3.8, 5.2),
        vel: new THREE.Vector3(rand(-0.04, 0.08), rand(0.18, 0.3), rand(-0.04, 0.04)),
        s0: 0.45,
        s1: rand(1.4, 2.1),
        maxOp: rand(0.1, 0.16),
        baseX: bx,
        baseZ: bz,
      });
    }
  }

  private buildSeasonalParticles(): THREE.Points {
    const count = 420;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 34;
      positions[i * 3 + 1] = Math.random() * 14 + 0.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 28;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.14,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    return points;
  }

  private bindInputEvents(): void {
    const dom = this.renderer.domElement;

    dom.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.isPointerDragging = true;
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      this.lastPointerPos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.isPointerDragging) return;
      const dx = e.clientX - this.lastPointerPos.x;
      const dy = e.clientY - this.lastPointerPos.y;
      this.lastPointerPos = { x: e.clientX, y: e.clientY };

      this.cameraAzimuth -= dx * 0.006;
      this.cameraElevation = Math.max(
        0.1,
        Math.min(1.15, this.cameraElevation + dy * 0.0045)
      );
    });

    window.addEventListener('pointerup', (e: PointerEvent) => {
      if (!this.isPointerDragging) return;
      this.isPointerDragging = false;

      const moveDist = Math.hypot(
        e.clientX - this.pointerDownPos.x,
        e.clientY - this.pointerDownPos.y
      );
      if (moveDist < 6) {
        this.handleSceneClick(e.clientX, e.clientY);
      }
    });

    dom.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        this.targetCameraDistance = Math.max(
          2.0,
          Math.min(15.0, this.targetCameraDistance * (1 + e.deltaY * 0.0012))
        );
      },
      { passive: false }
    );

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      this.keysPressed.add(e.code);
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.keysPressed.delete(e.code);
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.fov = this.camera.aspect < 1 ? 70 : 60;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private handleSceneClick(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    // 1. 온천 고양이 클릭 시 쓰다듬기 반응!
    if (this.onsenCat) {
      const catHits = this.raycaster.intersectObject(
        this.onsenCat.hitMesh,
        false
      );
      if (catHits.length > 0) {
        this.onsenCat.petTimer = 0;
        const selfMesh = this.avatarMeshes.get(this.selfSeat);
        if (selfMesh) {
          selfMesh.triggerBow();
        }
        this.callbacks.onToastMessage?.(
          '온천 고양이를 쓰다듬었어요. 골골송을 부르며 눈을 감아요 🐱'
        );
        return;
      }
    }

    // 2. 물 위 소원 유자 클릭 검사
    const wishHits = this.raycaster.intersectObjects(this.wishHitMeshes, false);
    if (wishHits.length > 0) {
      const wishId = wishHits[0].object.userData.wishId as string | undefined;
      if (wishId) {
        const entry = this.wishEntries.get(wishId);
        if (entry) {
          this.callbacks.onWishCandleSelected(entry.wish);
          return;
        }
      }
    }

    // 3. 온천 명당 좌석 클릭 검사
    const chairHits = this.raycaster.intersectObjects(
      this.spotHitMeshes,
      false
    );
    if (chairHits.length > 0) {
      const chairIndex = chairHits[0].object.userData.chairIndex as
        | number
        | undefined;
      if (chairIndex !== undefined) {
        const slot = STUDY_CHAIR_SLOTS[chairIndex];
        if (slot) {
          this.customLookTarget = null;
          this.walkTarget = {
            x: slot.seatX,
            z: slot.seatZ,
            sitChairIndex: slot.index,
          };
          return;
        }
      }
    }

    // 4. 바닥/수면 클릭 시 해당 지점으로 걸어가기
    const floorHits = this.raycaster.intersectObjects(
      this.walkableMeshes,
      false
    );
    if (floorHits.length > 0) {
      const pt = floorHits[0].point;
      this.customLookTarget = null;
      this.walkTarget = {
        x: Math.max(-13.8, Math.min(13.8, pt.x)),
        z: Math.max(-8.2, Math.min(8.2, pt.z)),
        sitChairIndex: -1,
      };
    }
  }

  private updateSelfMovement(dt: number): void {
    // 카메라 바라보는 방향 기준 WASD 이동 (saunagoyo ja() 방식)
    let forwardInput = 0;
    let rightInput = 0;
    if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp'))
      forwardInput += 1;
    if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown'))
      forwardInput -= 1;
    if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight'))
      rightInput += 1;
    if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft'))
      rightInput -= 1;

    const speed = 2.4;

    if (forwardInput !== 0 || rightInput !== 0) {
      this.walkTarget = null;
      this.customLookTarget = null;
      this.cameraPreset = 'follow';

      const fx = -Math.sin(this.cameraAzimuth);
      const fz = -Math.cos(this.cameraAzimuth);
      const rx = Math.cos(this.cameraAzimuth);
      const rz = -Math.sin(this.cameraAzimuth);

      let moveX = fx * forwardInput + rx * rightInput;
      let moveZ = fz * forwardInput + rz * rightInput;
      const len = Math.hypot(moveX, moveZ) || 1;
      moveX /= len;
      moveZ /= len;

      this.selfX = Math.max(
        -13.8,
        Math.min(13.8, this.selfX + moveX * speed * dt)
      );
      this.selfZ = Math.max(
        -8.2,
        Math.min(8.2, this.selfZ + moveZ * speed * dt)
      );
      this.selfYaw = Math.atan2(moveX, moveZ);
      this.selfPose = 'walking';
      this.selfChairIndex = -1;
      this.broadcastSelfState(false);
      return;
    }

    if (this.walkTarget) {
      const dx = this.walkTarget.x - this.selfX;
      const dz = this.walkTarget.z - this.selfZ;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.12) {
        this.selfX = this.walkTarget.x;
        this.selfZ = this.walkTarget.z;
        if (this.walkTarget.sitChairIndex >= 0) {
          const slot = STUDY_CHAIR_SLOTS[this.walkTarget.sitChairIndex];
          this.selfChairIndex = slot.index;
          this.selfYaw = slot.facingYaw;
          this.selfPose = 'sitting';
          this.callbacks.onSeatChanged(slot.index, slot.zoneName);
        } else {
          this.selfPose = 'standing';
          this.selfChairIndex = -1;
        }
        this.walkTarget = null;
        this.broadcastSelfState(true);
      } else {
        const step = Math.min(dist, speed * dt);
        this.selfX += (dx / dist) * step;
        this.selfZ += (dz / dist) * step;
        this.selfYaw = Math.atan2(dx, dz);
        this.selfPose = 'walking';
        this.selfChairIndex = -1;
        this.broadcastSelfState(false);
      }
      return;
    }

    if (this.selfPose === 'walking') {
      this.selfPose = 'standing';
      this.broadcastSelfState(true);
    }
  }

  private broadcastSelfState(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastStateBroadcastTime < 90) return;
    this.lastStateBroadcastTime = now;

    this.callbacks.onSelfStateChanged({
      pose: this.selfPose,
      chairIndex: this.selfChairIndex,
      x: Number(this.selfX.toFixed(2)),
      z: Number(this.selfZ.toFixed(2)),
      yaw: Number(this.selfYaw.toFixed(2)),
      lumosAt: this.selfLumosAt,
      focusUntil: this.selfFocusUntil,
    });
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    const elapsed = now * 0.001;
    const wallNow = Date.now();

    this.updateSelfMovement(dt);

    // 1. 물결 윤슬 및 폭포 텍스처 스크롤 애니메이션
    for (const item of this.scrolledTextures) {
      item.tex.offset.x = (item.tex.offset.x + item.vx * dt) % 1;
      item.tex.offset.y = (item.tex.offset.y + item.vy * dt) % 1;
    }

    // 2. 대나무 시시오도시(낙수대) 까딱거림
    this.bambooSpoutGroup.rotation.x = Math.sin(elapsed * 1.4) * 0.08;

    // 3. 모닥불 불꽃 일렁임
    this.campfireFlames.forEach((flame, idx) => {
      const s = 0.92 + Math.sin(elapsed * 8.5 + idx * 2.1) * 0.14;
      flame.scale.set(s, 0.9 + Math.cos(elapsed * 10 + idx) * 0.16, s);
    });
    this.campfireLight.intensity = 2.0 + Math.sin(elapsed * 9) * 0.35;

    // 4. 온천 고양이 쓰다듬기 애니메이션 (ai() in saunagoyo)
    if (this.onsenCat && this.onsenCat.petTimer >= 0) {
      this.onsenCat.petTimer += dt;
      const t = this.onsenCat.petTimer;
      if (t >= 2.6) {
        this.onsenCat.eyes.forEach((e) => (e.scale.y = 1.2));
        this.onsenCat.head.rotation.set(0, 0, 0);
        this.onsenCat.tail.rotation.set(0, 0, 0);
        this.onsenCat.petTimer = -1;
      } else {
        const squint = Math.sin(Math.min(1, t / 2.6) * Math.PI);
        this.onsenCat.eyes.forEach(
          (e) => (e.scale.y = Math.max(0.15, 1.2 - squint * 1.05))
        );
        this.onsenCat.head.rotation.z = 0.16 * squint;
        this.onsenCat.tail.rotation.y = Math.sin(t * 7) * 0.28 * squint;
      }
    }

    // 5. 아바타 업데이트 (실제 프로필과 모자·좌석 상태를 유지하며 프레임 보간)
    for (const [seat, mesh] of this.avatarMeshes.entries()) {
      const stored = this.latestVisitors.get(seat);
      if (!stored) continue;

      if (seat === this.selfSeat) {
        stored.pose = this.selfPose;
        stored.chairIndex = this.selfChairIndex;
        stored.x = this.selfX;
        stored.z = this.selfZ;
        stored.yaw = this.selfYaw;
        stored.lumosAt = this.selfLumosAt;
        stored.focusUntil = this.selfFocusUntil;
        mesh.syncAppearance(stored, true, wallNow);
      }
      mesh.updateFrame(dt, elapsed, stored);
    }

    // 집중 중인 좌석에만 히노끼 미니 트레이 표시
    for (const spot of this.bathSpots) {
      const isSelfSeatedHere =
        this.selfPose === 'sitting' && this.selfChairIndex === spot.slot.index;
      spot.floatingTrayGroup.visible = isSelfSeatedHere;
      if (isSelfSeatedHere && spot.slot.isWater) {
        spot.floatingTrayGroup.position.y =
          -0.02 + Math.sin(elapsed * 2.2 + spot.slot.index) * 0.015;
      }
    }

    // 6. 부드러운 방사형 수증기 스프라이트 상승 (Mr() in saunagoyo)
    for (const p of this.steamSprites) {
      p.age += dt;
      const progress = p.age / p.life;
      if (progress >= 1) {
        p.age = 0;
        p.sprite.position.set(
          p.baseX + rand(-0.25, 0.25),
          0.02,
          p.baseZ + rand(-0.25, 0.25)
        );
        p.sprite.material.opacity = 0;
        continue;
      }
      p.sprite.position.addScaledVector(p.vel, dt);
      const scale = p.s0 + (p.s1 - p.s0) * progress;
      p.sprite.scale.set(scale, scale, 1);
      p.sprite.material.opacity = p.maxOp * Math.sin(Math.PI * progress);
    }

    // 7. 물 위 소원 유자 둥실둥실 애니메이션
    for (const entry of this.wishEntries.values()) {
      entry.group.position.y =
        -0.02 + Math.sin(elapsed * 2.3 + entry.phase) * 0.022;
      entry.group.rotation.y += dt * 0.35;
    }

    // 8. 눈송이/꽃잎 파티클 낙하
    const posAttr = this.weatherParticles.geometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i += 1) {
      let y = posAttr.getY(i) - dt * 0.85;
      let x = posAttr.getX(i) + Math.sin(elapsed + i) * dt * 0.22;
      if (y < 0.1) {
        y = 14.0;
        x = (Math.random() - 0.5) * 34;
      }
      posAttr.setXY(i, x, y);
    }
    posAttr.needsUpdate = true;

    // 9. 죽통 물소리 파동 효과
    if (this.bellResonanceFlash > 0) {
      this.bellResonanceFlash = Math.max(
        0,
        this.bellResonanceFlash - dt * 0.45
      );
    }

    // 10. 카메라 부드러운 추적 (saunagoyo Jr() 방식: 캐릭터가 화면 중앙에 큼직하고 선명하게!)
    let desiredTargetX = this.selfX;
    let desiredTargetY = 0.85;
    let desiredTargetZ = this.selfZ;

    if (this.customLookTarget) {
      desiredTargetX = this.customLookTarget.x;
      desiredTargetY = this.customLookTarget.y;
      desiredTargetZ = this.customLookTarget.z;
    } else if (this.cameraPreset === 'overview') {
      desiredTargetX = 0;
      desiredTargetY = 1.1;
      desiredTargetZ = -0.8;
    } else if (this.cameraPreset === 'main_bath') {
      desiredTargetX = 0;
      desiredTargetY = 0.65;
      desiredTargetZ = 0.5;
    } else if (this.cameraPreset === 'pavilion') {
      desiredTargetX = 0;
      desiredTargetY = 1.35;
      desiredTargetZ = -7.6;
    } else if (this.cameraPreset === 'hinoki_bath') {
      desiredTargetX = 10.5;
      desiredTargetY = 0.75;
      desiredTargetZ = -1.0;
    } else if (this.cameraPreset === 'footbath') {
      desiredTargetX = -10.2;
      desiredTargetY = 0.75;
      desiredTargetZ = 3.2;
    }

    const camLerp = Math.min(1, dt * 7);
    this.cameraTarget.x += (desiredTargetX - this.cameraTarget.x) * camLerp;
    this.cameraTarget.y += (desiredTargetY - this.cameraTarget.y) * camLerp;
    this.cameraTarget.z += (desiredTargetZ - this.cameraTarget.z) * camLerp;
    this.cameraDistance +=
      (this.targetCameraDistance - this.cameraDistance) * camLerp;

    const horizDist = this.cameraDistance * Math.cos(this.cameraElevation);
    const camX =
      this.cameraTarget.x + Math.sin(this.cameraAzimuth) * horizDist;
    const camY = Math.max(
      0.45,
      this.cameraTarget.y + Math.sin(this.cameraElevation) * this.cameraDistance
    );
    const camZ =
      this.cameraTarget.z + Math.cos(this.cameraAzimuth) * horizDist;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.cameraTarget);

    this.renderer.render(this.scene, this.camera);
  };
}
