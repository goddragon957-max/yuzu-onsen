import * as THREE from 'three';
import {
  makeCanvasTexture,
  TEX_FOLDED_TOWEL,
  TEX_SOFT_SHADOW,
} from '@/scene/proceduralTextures';
import {
  type ArcaneHouseId,
  type ScholarVisitor,
} from '@/types/protocol';

export type SnackItemId =
  | 'none'
  | 'sikhye'
  | 'banana_milk'
  | 'egg'
  | 'yuzu_tea';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function placeOnSphere(
  parent: THREE.Object3D,
  mesh: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  radius = 0.262,
  rotZ = 0
): THREE.Object3D {
  const pos = new THREE.Vector3(x, y, z).normalize().multiplyScalar(radius);
  mesh.position.copy(pos);
  mesh.lookAt(pos.clone().multiplyScalar(2));
  if (rotZ !== 0) {
    mesh.rotateZ(rotZ);
  }
  parent.add(mesh);
  return mesh;
}

const SKIN_MAT = new THREE.MeshStandardMaterial({
  color: 0xe39a62,
  roughness: 0.7,
});

const EYE_MAT = new THREE.MeshBasicMaterial({
  color: 0x3a2416,
});

const TOWEL_WHITE_MAT = new THREE.MeshStandardMaterial({
  color: 0xf5ecdc,
  roughness: 0.95,
});

const FELT_HAT_MAT = new THREE.MeshStandardMaterial({
  color: 0x8a9e7b,
  roughness: 0.95,
  side: THREE.DoubleSide,
});

const FOLDED_TOWEL_MAT = new THREE.MeshStandardMaterial({
  map: TEX_FOLDED_TOWEL,
  roughness: 0.95,
});

const SHADOW_MAT = new THREE.MeshBasicMaterial({
  map: TEX_SOFT_SHADOW,
  transparent: true,
  depthWrite: false,
});

const OUTFIT_PALETTES: Record<
  ArcaneHouseId,
  { shirt: number; shorts: number; trim: number }
> = {
  ignis: { shirt: 0xe2624c, shorts: 0x6a3829, trim: 0x7a3d2a }, // 사우나 고요 시그니처 코랄/브라운 찜질복
  astra: { shirt: 0x5c8d89, shorts: 0x35524f, trim: 0x2c4442 }, // 솔잎 청록 유카타
  sylph: { shirt: 0xe6a145, shorts: 0x6e4a26, trim: 0x7c542b }, // 유자 앰버 찜질복
  terra: { shirt: 0x6b7b8c, shorts: 0x3d4854, trim: 0x2e3740 }, // 온천지기 남색 유카타
};

const nameTagCache = new Map<string, THREE.CanvasTexture>();

function getNameTagTexture(
  name: string,
  role: 'self' | 'resident' | 'guest',
  focusBadge: string
): THREE.CanvasTexture {
  const displayText = focusBadge ? `${name} · ${focusBadge}` : name;
  const key = `${role}:${displayText}`;
  const cached = nameTagCache.get(key);
  if (cached) return cached;

  const isResident = role === 'resident';
  const isSelf = role === 'self';

  const tex = makeCanvasTexture(
    512,
    76,
    (ctx, w, h) => {
      ctx.font =
        (isResident || isSelf ? '600 34px' : '500 31px') +
        ' "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
      const textWidth = ctx.measureText(displayText).width;
      const pillW = Math.min(w - 10, textWidth + 44);
      const pillX = (w - pillW) / 2;
      const r = h / 2 - 4;

      ctx.fillStyle = isResident
        ? 'rgba(28, 16, 8, 0.78)'
        : isSelf
          ? 'rgba(255, 245, 224, 0.94)'
          : 'rgba(255, 246, 232, 0.85)';

      ctx.beginPath();
      ctx.moveTo(pillX + r, 4);
      ctx.lineTo(pillX + pillW - r, 4);
      ctx.arc(pillX + pillW - r, h / 2, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(pillX + r, h - 4);
      ctx.arc(pillX + r, h / 2, r, Math.PI / 2, Math.PI * 1.5);
      ctx.fill();

      if (!isResident) {
        ctx.strokeStyle = isSelf
          ? 'rgba(232, 120, 31, 0.75)'
          : 'rgba(120, 70, 30, 0.35)';
        ctx.lineWidth = isSelf ? 3 : 2;
        ctx.stroke();
      }

      ctx.fillStyle = isResident ? '#fbeedd' : '#3a2416';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(displayText, w / 2, h / 2 + 1);
    },
    false,
    true
  );

  nameTagCache.set(key, tex);
  return tex;
}

export class ScholarAvatarMesh {
  public readonly group = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly hatAnchor = new THREE.Group();
  private readonly arms: [THREE.Group, THREE.Group];
  private readonly legs: [THREE.Group, THREE.Group];
  private readonly cheekMat: THREE.MeshBasicMaterial;
  private readonly shadowMesh: THREE.Mesh;
  private readonly labelSprite: THREE.Sprite;
  private readonly rippleRing: THREE.Mesh;
  private heldSnackMesh: THREE.Object3D | null = null;
  private heldSnackId: SnackItemId = 'none';

  // 애니메이션 블렌드 상태 (saunagoyo It() 메커니즘)
  private currentX = 0;
  private currentY = 0;
  private currentZ = 0;
  private currentYaw = 0;
  private targetX = 0;
  private targetZ = 0;
  private targetYaw = 0;

  private walkAmp = 0;
  private walkPhase = Math.random() * 6.28;
  private breathePhase = Math.random() * 6.28;
  private sitBlend = 0;
  private sitTarget = 0;
  private floorBlend = 0;
  private floorTarget = 0;
  private lieBlend = 0;
  private lieTarget = 0;

  private bowTimer = -1;
  private useSnackTimer = -1;
  private useSnackAct: 'sip' | 'bite' = 'sip';
  private lumosBoost = 0;

  private lastLabelSignature = '';
  private currentHouse: ArcaneHouseId = 'ignis';
  private readonly isResidentCapybara: boolean;

  constructor(visitor: ScholarVisitor, isSelf: boolean) {
    this.group.rotation.order = 'YXZ';
    this.currentX = visitor.x;
    this.currentZ = visitor.z;
    this.currentYaw = visitor.yaw;
    this.targetX = visitor.x;
    this.targetZ = visitor.z;
    this.targetYaw = visitor.yaw;
    this.currentHouse = visitor.house;
    this.isResidentCapybara = visitor.isResident;

    this.cheekMat = new THREE.MeshBasicMaterial({
      color: 0xe0787a,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });

    this.arms = [new THREE.Group(), new THREE.Group()];
    this.legs = [new THREE.Group(), new THREE.Group()];

    if (this.isResidentCapybara && visitor.seat <= 2) {
      // 카피바라 대장 & 아기 카피바라는 통통한 카피바라 마스코트로 생성
      this.buildArticulatedCapybara();
    } else {
      // 유저 및 온천지기 NPC는 사우나 고요 스타일 관절 인형 캐릭터로 생성
      this.buildArticulatedDoll(visitor.house, visitor.isResident);
    }

    // 발밑 부드러운 그림자 데칼
    this.shadowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.78),
      SHADOW_MAT
    );
    this.shadowMesh.rotation.x = -Math.PI / 2;
    this.shadowMesh.position.y = 0.012;
    this.group.add(this.shadowMesh);

    // 입수 시 수면에 뜨는 잔물결 링
    this.rippleRing = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.4, 28),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.rippleRing.rotation.x = -Math.PI / 2;
    this.rippleRing.position.y = 0.02;
    this.rippleRing.visible = false;
    this.group.add(this.rippleRing);

    // 깔끔한 캡슐형 이름표 스프라이트
    const spriteMat = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    spriteMat.toneMapped = false;
    this.labelSprite = new THREE.Sprite(spriteMat);
    this.labelSprite.renderOrder = 10;
    this.labelSprite.scale.set(1.36, 0.2, 1);
    this.labelSprite.position.set(0, 1.78, 0);
    this.group.add(this.labelSprite);

    this.group.position.set(this.currentX, 0, this.currentZ);
    this.group.rotation.y = this.currentYaw;
    this.syncAppearance(visitor, isSelf, Date.now());
  }

  /**
   * 사우나 고요(saunagoyo.com) Dt() 구조와 100% 동일한 비율의 관절 인형 캐릭터
   */
  private buildArticulatedDoll(
    house: ArcaneHouseId,
    isStaffGoyo: boolean
  ): void {
    const palette = OUTFIT_PALETTES[house] ?? OUTFIT_PALETTES.ignis;

    const shirtMat = new THREE.MeshStandardMaterial({
      color: isStaffGoyo ? 0x264653 : palette.shirt,
      roughness: 0.88,
    });
    const shortsMat = new THREE.MeshStandardMaterial({
      color: isStaffGoyo ? 0x1d3557 : palette.shorts,
      roughness: 0.9,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: isStaffGoyo ? 0x14213d : palette.trim,
      roughness: 0.85,
    });

    this.hips.position.y = 0.4;
    this.group.add(this.hips);
    this.hips.add(this.upper);

    // 반바지
    const shorts = new THREE.Mesh(
      new THREE.CylinderGeometry(0.215, 0.235, 0.17, 18),
      shortsMat
    );
    shorts.position.y = 0.02;
    this.hips.add(shorts);

    // 상의 몸통
    const shirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.225, 0.36, 18),
      shirtMat
    );
    shirt.position.y = 0.26;
    this.upper.add(shirt);

    // 둥근 어깨 돔
    const shoulderDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      shirtMat
    );
    shoulderDome.position.y = 0.44;
    shoulderDome.scale.y = 0.45;
    this.upper.add(shoulderDome);

    // 상의 밑단 & 목 둘레 파이핑 마감(Trim)
    const hemTrim = new THREE.Mesh(
      new THREE.TorusGeometry(0.222, 0.016, 6, 26),
      trimMat
    );
    hemTrim.rotation.x = Math.PI / 2;
    hemTrim.position.y = 0.09;
    this.upper.add(hemTrim);

    const collarTrim = new THREE.Mesh(
      new THREE.TorusGeometry(0.085, 0.02, 6, 20),
      trimMat
    );
    collarTrim.rotation.x = Math.PI / 2;
      collarTrim.position.y = 0.525;
    this.upper.add(collarTrim);

    // 온천지기 NPC일 경우 허리띠(Sash) 장식 추가
    if (isStaffGoyo) {
      const sashMat = new THREE.MeshStandardMaterial({
        color: 0xd9be76,
        roughness: 0.9,
      });
      const belt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.229, 0.232, 0.06, 22, 1, true),
        sashMat
      );
      belt.position.y = 0.125;
      this.upper.add(belt);
    }

    // 목
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.07, 0.08, 12),
      SKIN_MAT
    );
    neck.position.y = 0.54;
    this.upper.add(neck);

    // 머리 (y = 0.79, 반지름 0.26)
    this.head.position.y = 0.79;
    this.upper.add(this.head);
    this.head.add(
      new THREE.Mesh(new THREE.SphereGeometry(0.26, 28, 20), SKIN_MAT)
    );

    // 구면 좌표 투영 방식의 눈, 볼터치, 입체 코
    for (const side of [-1, 1]) {
      const eye = placeOnSphere(
        this.head,
        new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), EYE_MAT),
        side * 0.082,
        0.018,
        0.25,
        0.252
      );
      eye.scale.set(1, 1.1, 0.45);

      placeOnSphere(
        this.head,
        new THREE.Mesh(new THREE.CircleGeometry(0.028, 14), this.cheekMat),
        side * 0.15,
        -0.06,
        0.2,
        0.264
      );
    }

    // 귀여운 동그란 입체 코
    placeOnSphere(
      this.head,
      new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), SKIN_MAT),
      0,
      -0.025,
      0.26,
      0.255
    );

    this.head.add(this.hatAnchor);
    this.rebuildHeadgear(house);

    // 양팔 (반팔 소매 + 소매단 + 팔뚝 + 둥근 손)
    [1, -1].forEach((side, idx) => {
      const arm = this.arms[idx];
      arm.position.set(side * 0.22, 0.43, 0);
      arm.rotation.z = side * 0.18;
      this.upper.add(arm);

      const sleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.078, 0.088, 0.15, 12),
        shirtMat
      );
      sleeve.position.y = -0.05;
      arm.add(sleeve);

      const cuff = new THREE.Mesh(
        new THREE.TorusGeometry(0.086, 0.014, 6, 16),
        trimMat
      );
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = -0.125;
      arm.add(cuff);

      const forearm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.048, 0.18, 10),
        SKIN_MAT
      );
      forearm.position.y = -0.21;
      arm.add(forearm);

      const hand = new THREE.Mesh(
        new THREE.SphereGeometry(0.058, 12, 10),
        SKIN_MAT
      );
      hand.position.y = -0.31;
      arm.add(hand);
    });

    // 양다리 (종아리 + 통통한 발)
    [1, -1].forEach((side, idx) => {
      const leg = this.legs[idx];
      leg.position.set(side * 0.1, 0, 0);
      this.hips.add(leg);

      const shin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.068, 0.06, 0.3, 10),
        SKIN_MAT
      );
      shin.position.y = -0.17;
      leg.add(shin);

      const foot = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 12, 8),
        SKIN_MAT
      );
      foot.scale.set(1, 0.6, 1.4);
      foot.position.set(0, -0.34, 0.03);
      leg.add(foot);
    });
  }

  /**
   * 상주 마스코트: 머리에 유자를 올린 통통하고 귀여운 카피바라
   */
  private buildArticulatedCapybara(): void {
    const furMat = new THREE.MeshStandardMaterial({
      color: 0xa66e44,
      roughness: 0.9,
    });
    const snoutMat = new THREE.MeshStandardMaterial({
      color: 0x7d4e2d,
      roughness: 0.9,
    });

    this.hips.position.y = 0.4;
    this.group.add(this.hips);
    this.hips.add(this.upper);

    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 20, 16),
      furMat
    );
    body.scale.set(1.05, 1.08, 1.25);
    body.position.set(0, 0.18, -0.03);
    this.upper.add(body);

    this.head.position.set(0, 0.62, 0.06);
    this.upper.add(this.head);

    const headMain = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 20, 16),
      furMat
    );
    headMain.scale.set(0.96, 0.92, 1.22);
    this.head.add(headMain);

    const muzzle = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 12),
      snoutMat
    );
    muzzle.scale.set(0.95, 0.85, 0.9);
    muzzle.position.set(0, -0.02, 0.21);
    this.head.add(muzzle);

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.BoxGeometry(0.065, 0.018, 0.018),
        EYE_MAT
      );
      eye.position.set(side * 0.19, 0.04, 0.11);
      eye.rotation.y = side * 0.42;
      this.head.add(eye);

      const ear = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 10, 8),
        snoutMat
      );
      ear.scale.set(0.7, 1.0, 0.6);
      ear.position.set(side * 0.16, 0.2, -0.1);
      this.head.add(ear);
    }

    this.hatAnchor.position.set(0, -0.04, 0);
    this.head.add(this.hatAnchor);
    this.rebuildHeadgear('ignis');

    // 앞발/뒷발 더미 연결
    [1, -1].forEach((side, idx) => {
      const arm = this.arms[idx];
      arm.position.set(side * 0.16, 0.22, 0.12);
      this.upper.add(arm);
      const leg = this.legs[idx];
      leg.position.set(side * 0.14, 0, -0.05);
      this.hips.add(leg);
    });
  }

  /**
   * 사우나 고요 스타일 모자 4종 (양머리 수건 / 유자 수건 / 사우나 모자 & 오리 / 접은 온천 수건)
   */
  private rebuildHeadgear(house: ArcaneHouseId): void {
    this.hatAnchor.clear();
    const g = new THREE.Group();

    if (house === 'astra') {
      // 🐑 사우나 고요 순정 양머리 수건 (sheep)
      g.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(
            0.275,
            24,
            14,
            0,
            Math.PI * 2,
            0,
            Math.PI * 0.42
          ),
          TOWEL_WHITE_MAT
        )
      );
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.255, 0.04, 8, 30),
        TOWEL_WHITE_MAT
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.08;
      g.add(rim);

      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(
          new THREE.TorusGeometry(0.085, 0.052, 10, 22),
          TOWEL_WHITE_MAT
        );
        horn.position.set(side * 0.205, 0.17, 0);
        horn.rotation.y = Math.PI / 2;
        g.add(horn);

        const cap = new THREE.Mesh(
          new THREE.CircleGeometry(0.05, 14),
          TOWEL_WHITE_MAT
        );
        cap.position.set(side * 0.205, 0.17, 0);
        cap.rotation.y = side * (Math.PI / 2);
        g.add(cap);
      }
    } else if (house === 'ignis') {
      // 🍊 접은 수건 위에 올라간 통통한 노란 유자
      const baseTowel = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.038, 0.22),
        FOLDED_TOWEL_MAT
      );
      baseTowel.position.y = 0.26;
      g.add(baseTowel);

      const yuzuFruit = new THREE.Mesh(
        new THREE.SphereGeometry(0.095, 16, 14),
        new THREE.MeshStandardMaterial({
          color: 0xffa200,
          roughness: 0.45,
        })
      );
      yuzuFruit.scale.set(1.12, 0.88, 1.12);
      yuzuFruit.position.y = 0.345;
      g.add(yuzuFruit);

      const leaf = new THREE.Mesh(
        new THREE.SphereGeometry(0.034, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x4d9038, roughness: 0.7 })
      );
      leaf.scale.set(1.6, 0.35, 0.8);
      leaf.position.set(0.035, 0.43, 0);
      leaf.rotation.z = -0.35;
      g.add(leaf);
    } else if (house === 'sylph') {
      // 🐤 사우나 펠트 모자 + 노란 아기 오리
      const lathePoints = [
        [0, 0.36],
        [0.08, 0.355],
        [0.15, 0.33],
        [0.21, 0.27],
        [0.25, 0.18],
        [0.27, 0.08],
        [0.29, 0],
        [0.35, -0.05],
        [0.39, -0.075],
      ].map(([x, y]) => new THREE.Vector2(x, y));

      const feltHat = new THREE.Mesh(
        new THREE.LatheGeometry(lathePoints, 32),
        FELT_HAT_MAT
      );
      feltHat.position.y = 0.13;
      feltHat.rotation.z = 0.05;
      g.add(feltHat);

      const duckMat = new THREE.MeshStandardMaterial({
        color: 0xffcf40,
        roughness: 0.4,
      });
      const duckBody = new THREE.Mesh(
        new THREE.SphereGeometry(0.068, 12, 10),
        duckMat
      );
      duckBody.scale.set(1, 0.82, 1.25);
      duckBody.position.set(0, 0.52, 0);
      g.add(duckBody);

      const duckHead = new THREE.Mesh(
        new THREE.SphereGeometry(0.048, 12, 10),
        duckMat
      );
      duckHead.position.set(0, 0.58, 0.04);
      g.add(duckHead);
    } else {
      // 🧖 사우나 고요 시그니처 2단 접은 수건 (goyo towel)
      const bottomFold = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.045, 0.25),
        FOLDED_TOWEL_MAT
      );
      bottomFold.position.y = 0.262;
      g.add(bottomFold);

      const topGroup = new THREE.Group();
      topGroup.position.y = 0.262 + 0.0225 + 0.021;
      topGroup.rotation.y = 0.14;
      g.add(topGroup);
      topGroup.add(
        new THREE.Mesh(
          new THREE.BoxGeometry(0.34, 0.042, 0.21),
          FOLDED_TOWEL_MAT
        )
      );
      const rollEdge = new THREE.Mesh(
        new THREE.CylinderGeometry(0.021, 0.021, 0.21, 14),
        FOLDED_TOWEL_MAT
      );
      rollEdge.rotation.x = Math.PI / 2;
      rollEdge.position.x = 0.17;
      topGroup.add(rollEdge);
    }

    this.hatAnchor.add(g);
  }

  /**
   * 오른손에 온천 간식(식혜 / 뚱바 바나나우유 / 맥반석 구운란 / 유자차) 들기
   */
  public setHeldSnack(itemId: SnackItemId): void {
    if (this.heldSnackMesh) {
      this.arms[1].remove(this.heldSnackMesh);
      this.heldSnackMesh = null;
    }
    this.heldSnackId = itemId;
    if (itemId === 'none') return;

    const prop = new THREE.Group();
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.32,
      roughness: 0.08,
      depthWrite: false,
    });

    if (itemId === 'sikhye') {
      // 살얼음 동동 식혜 컵
      const liq = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.035, 0.09, 18),
        new THREE.MeshStandardMaterial({ color: 0xf1e6c8, roughness: 0.35 })
      );
      liq.position.y = -0.01;
      prop.add(liq);

      const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.044, 0.038, 0.115, 20, 1, true),
        glassMat
      );
      cup.renderOrder = 2;
      prop.add(cup);
    } else if (itemId === 'banana_milk') {
      // 단지형 뚱바 바나나우유
      const jarBottom = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048, 0.036, 0.06, 18),
        new THREE.MeshStandardMaterial({ color: 0xfff1a8, roughness: 0.35 })
      );
      jarBottom.position.y = -0.02;
      prop.add(jarBottom);

      const jarTop = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.048, 0.05, 18),
        new THREE.MeshStandardMaterial({ color: 0xffe97d, roughness: 0.35 })
      );
      jarTop.position.y = 0.032;
      prop.add(jarTop);

      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.014, 18),
        new THREE.MeshStandardMaterial({ color: 0x2ec4b6, roughness: 0.4 })
      );
      cap.position.y = 0.062;
      prop.add(cap);
    } else if (itemId === 'egg') {
      // 맥반석 구운란
      const egg = new THREE.Mesh(
        new THREE.SphereGeometry(0.046, 14, 10),
        new THREE.MeshStandardMaterial({ color: 0xb07a4a, roughness: 0.55 })
      );
      egg.scale.set(0.85, 1.15, 0.85);
      prop.add(egg);
    } else if (itemId === 'yuzu_tea') {
      // 따뜻한 유자차 머그잔
      const mug = new THREE.Mesh(
        new THREE.CylinderGeometry(0.043, 0.038, 0.095, 18),
        new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.5 })
      );
      prop.add(mug);
      const teaTop = new THREE.Mesh(
        new THREE.CircleGeometry(0.039, 16),
        new THREE.MeshStandardMaterial({ color: 0xffb703, roughness: 0.25 })
      );
      teaTop.rotation.x = -Math.PI / 2;
      teaTop.position.y = 0.046;
      prop.add(teaTop);
    }

    prop.position.set(0, -0.35, 0.06);
    this.arms[1].add(prop);
    this.heldSnackMesh = prop;
  }

  public getHeldSnack(): SnackItemId {
    return this.heldSnackId;
  }

  /**
   * 들고 있는 음료/구운란 한 모금 마시기 / 한 입 먹기 모션
   */
  public triggerUseSnack(): boolean {
    if (this.heldSnackId === 'none' || this.useSnackTimer >= 0) return false;
    this.useSnackAct = this.heldSnackId === 'egg' ? 'bite' : 'sip';
    this.useSnackTimer = 0;
    return true;
  }

  /**
   * 꾸벅 인사하기 모션 (saunagoyo bowT 애니메이션)
   */
  public triggerBow(): void {
    if (this.bowTimer < 0) {
      this.bowTimer = 0;
    }
  }

  public triggerLumosPulse(): void {
    this.lumosBoost = 1.0;
    this.triggerBow();
  }

  public syncAppearance(
    visitor: ScholarVisitor,
    isSelf: boolean,
    now: number
  ): void {
    this.targetX = visitor.x;
    this.targetZ = visitor.z;
    this.targetYaw = visitor.yaw;

    if (!this.isResidentCapybara && visitor.house !== this.currentHouse) {
      this.currentHouse = visitor.house;
      this.rebuildHeadgear(visitor.house);
    }

    if (visitor.lumosAt !== null && now - visitor.lumosAt < 2500) {
      if (this.bowTimer < 0) {
        this.bowTimer = 0;
      }
    }

    const isFocusing =
      visitor.focusUntil !== null && visitor.focusUntil > now;
    const focusBadge = isFocusing ? '집중중' : '';
    const role: 'self' | 'resident' | 'guest' = visitor.isResident
      ? 'resident'
      : isSelf
        ? 'self'
        : 'guest';

    const sig = `${visitor.name}|${role}|${focusBadge}`;
    if (sig !== this.lastLabelSignature) {
      this.lastLabelSignature = sig;
      const tex = getNameTagTexture(visitor.name, role, focusBadge);
      this.labelSprite.material.map = tex;
      this.labelSprite.material.needsUpdate = true;
    }
  }

  public updateFrame(
    dt: number,
    elapsed: number,
    visitor: ScholarVisitor
  ): void {
    const posLerp = Math.min(1, dt * 10);
    const dx = this.targetX - this.currentX;
    const dz = this.targetZ - this.currentZ;
    const isMoving =
      visitor.pose === 'walking' || Math.hypot(dx, dz) > 0.035;

    this.currentX += dx * posLerp;
    this.currentZ += dz * posLerp;

    let yawDiff = this.targetYaw - this.currentYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    this.currentYaw += yawDiff * posLerp;

    // 구역별 수심 / 벤치 높이 / 리클라이너 자세 판별
    const inMainBath =
      Math.hypot(this.currentX / 5.9, (this.currentZ - 0.5) / 4.6) < 1.0 &&
      Math.hypot(this.currentX / 1.9, (this.currentZ - 0.5) / 1.5) > 1.0;
    const inHinokiBath =
      Math.abs(this.currentX - 10.5) < 2.25 &&
      Math.abs(this.currentZ + 1.0) < 2.05;
    const inWater = inMainBath || inHinokiBath;

    const onVerandaBench =
      this.currentZ < -6.6 && Math.abs(this.currentX) < 5.5;
    const onReclinerZone =
      this.currentX < -7.5 && this.currentZ > 0.5 && visitor.pose === 'sitting';

    const isSeated = visitor.pose === 'sitting';

    let targetY = 0;
    if (inWater) {
      targetY = isSeated ? -0.52 : -0.32;
    } else if (onVerandaBench && isSeated) {
      targetY = 0.14;
    } else if (onReclinerZone) {
      targetY = 0.25;
    }

    this.currentY += (targetY - this.currentY) * Math.min(1, dt * 8);
    this.group.position.set(this.currentX, this.currentY, this.currentZ);
    this.group.rotation.y = this.currentYaw;

    // 수면 물결 링 표시
    this.rippleRing.visible = inWater;
    if (inWater) {
      this.rippleRing.position.y = -this.currentY + 0.02;
      const s = 1 + Math.sin(elapsed * 2.5 + visitor.seat) * 0.06;
      this.rippleRing.scale.set(s, s, 1);
    }

    // 사우나 고요 It() 관절 애니메이션 로직
    this.breathePhase += dt;
    this.walkAmp += ((isMoving ? 1 : 0) - this.walkAmp) * Math.min(1, dt * 10);
    if (isMoving) {
      this.walkPhase += dt * 9.5;
    }

    this.sitTarget = isSeated && !onReclinerZone ? 1 : 0;
    this.floorTarget = isSeated && inWater ? 1 : 0;
    this.lieTarget = onReclinerZone ? 1 : 0;

    const blendRate = Math.min(1, dt * 9);
    this.sitBlend += (this.sitTarget - this.sitBlend) * blendRate;
    this.floorBlend += (this.floorTarget - this.floorBlend) * blendRate;
    this.lieBlend += (this.lieTarget - this.lieBlend) * blendRate;

    const swing = Math.sin(this.walkPhase) * this.walkAmp;
    const o = this.sitBlend;
    const s = this.floorBlend;
    const c = this.lieBlend;

    // 다리 회전 (걸을 땐 앞뒤 스윙, 앉을 땐 앞으로 -90도 구부려 발이 보이게, 탕 안에서는 양반다리)
    this.legs[0].rotation.x = lerp(swing * 0.65, -Math.PI / 2, o);
    this.legs[1].rotation.x = lerp(-swing * 0.65, -Math.PI / 2, o);
    this.legs[0].rotation.z = lerp(lerp(0, 0.08, o), 0.55, s);
    this.legs[1].rotation.z = lerp(lerp(0, -0.08, o), -0.55, s);

    // 팔 회전
    this.arms[0].rotation.x = lerp(
      lerp(lerp(-swing * 0.5, -0.55, o), -0.4, s),
      0,
      c
    );
    this.arms[0].rotation.z = lerp(lerp(0.18, 0.42, s), 0.08, c);
    this.arms[1].rotation.x = lerp(
      lerp(lerp(swing * 0.5, -0.55, o), -0.4, s),
      0,
      c
    );
    this.arms[1].rotation.z = lerp(lerp(-0.18, -0.42, s), -0.08, c);

    this.hips.position.y =
      0.4 + Math.abs(Math.cos(this.walkPhase)) * 0.03 * this.walkAmp;
    this.group.rotation.x = -0.95 * c;

    // 꾸벅 인사 모션 (bowTimer)
    if (this.bowTimer >= 0) {
      this.bowTimer += dt;
      const r = this.bowTimer;
      const raw =
        r < 0.35
          ? r / 0.35
          : r < 1.75
            ? 1
            : Math.max(0, 1 - (r - 1.75) / 0.45);
      const ease = raw * raw * (3 - 2 * raw);
      const bowWave = Math.sin(Math.PI * clamp((r - 0.35) / 1.4, 0, 1));
      this.upper.rotation.x = 0.48 * bowWave * (1 - c);
      this.head.rotation.x = 0.18 * bowWave;
      this.arms[0].rotation.x = lerp(this.arms[0].rotation.x, -1.45, ease);
      this.arms[0].rotation.z = lerp(this.arms[0].rotation.z, -0.62, ease);
      this.arms[1].rotation.x = lerp(this.arms[1].rotation.x, -1.45, ease);
      this.arms[1].rotation.z = lerp(this.arms[1].rotation.z, 0.62, ease);
      if (r >= 2.2) {
        this.bowTimer = -1;
      }
    } else {
      this.upper.rotation.x =
        Math.sin(this.breathePhase * 1.3) * 0.018 + o * 0.05 * (1 - c);
      this.head.rotation.x = 0;
    }

    this.upper.position.y = Math.sin(this.breathePhase * 1.3) * 0.004;

    // 간식 들고 있을 때 오른팔 들기 & 한 모금/한 입 모션
    if (this.heldSnackId !== 'none') {
      this.arms[1].rotation.x = Math.min(this.arms[1].rotation.x, -0.55);
    }
    if (this.useSnackTimer >= 0) {
      this.useSnackTimer += dt;
      const r = this.useSnackTimer;
      const raw =
        r < 0.4 ? r / 0.4 : r < 0.9 ? 1 : Math.max(0, 1 - (r - 0.9) / 0.4);
      const ease = raw * raw * (3 - 2 * raw);
      const isSip = this.useSnackAct === 'sip';
      this.arms[1].rotation.x = lerp(
        this.arms[1].rotation.x,
        isSip ? -2.2 : -2.05,
        ease
      );
      this.arms[1].rotation.z = lerp(this.arms[1].rotation.z, 0.52, ease);
      this.head.rotation.x += (isSip ? -0.14 : 0.08) * ease;
      if (r >= 1.3) {
        this.useSnackTimer = -1;
      }
    }

    if (this.lumosBoost > 0) {
      this.lumosBoost = Math.max(0, this.lumosBoost - dt * 0.5);
    }

    // 온기 볼터치 투명도
    this.cheekMat.opacity = inWater ? 0.65 : 0.42;

    // 이름표 위치 보정
    const tagPitch = -0.95 * c;
    const tagH = lerp(1.76, 1.05, c);
    this.labelSprite.position.set(
      0,
      tagH * Math.cos(tagPitch),
      -tagH * Math.sin(tagPitch)
    );

    // 발밑 그림자 위치 보정
    this.shadowMesh.position.y = 0.012 - this.currentY;
    this.shadowMesh.visible = !inWater && c < 0.1;
  }

  public dispose(): void {
    const mat = this.labelSprite.material;
    if (mat.map) {
      mat.map.dispose();
    }
    mat.dispose();
  }
}
