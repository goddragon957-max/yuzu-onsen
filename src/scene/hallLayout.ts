import type {
  ArcaneHouseId,
  RoomSummary,
  ScholarVisitor,
  WishCandle,
} from '@/types/protocol';

export type BathZoneId = 'main_bath' | 'hinoki_bath' | 'pavilion' | 'footbath';

export interface StudyChairSlot {
  index: number;
  tableIndex: number;
  zone: BathZoneId;
  zoneName: string;
  house: ArcaneHouseId;
  seatX: number;
  seatY: number;
  seatZ: number;
  deskX: number;
  deskZ: number;
  facingYaw: number;
  isWater: boolean;
}

export interface HallRoomDefinition {
  id: string;
  name: string;
  subtitle: string;
  capacity: number;
}

const ROOM_THEMES: ReadonlyArray<{ title: string; desc: string }> = [
  {
    title: '모락모락 유자 대노천탕',
    desc: '폭포수 아래 노란 유자와 카피바라가 떠 있는 대표 노천탕 (41.2°C)',
  },
  {
    title: '솔향기 편백(히노끼) 노천탕',
    desc: '은은한 편백나무 향을 맡으며 조용히 코딩·공부하기 좋은 탕 (40.5°C)',
  },
  {
    title: '함박눈 설경 바위탕',
    desc: '머리는 시원하고 몸은 뜨끈한 산중턱 설경 노천탕 (42.0°C)',
  },
  {
    title: '벚꽃 흩날리는 봄밤 온천',
    desc: '분홍빛 꽃잎이 물 위에 내려앉는 포근한 야간 온천 (40.2°C)',
  },
  {
    title: '반딧불이 여름밤 계곡탕',
    desc: '시원한 계곡 물소리와 풀벌레 소리가 들리는 노천탕 (39.5°C)',
  },
  {
    title: '단풍 물든 가을 산사 온천',
    desc: '붉은 단풍나무 아래서 사색에 잠기는 고요한 온천 (41.0°C)',
  },
];

/**
 * 산사(sansatemple.com)의 maru ~ maru-100 구조와 동일하게
 * 총 100개의 노천탕 채널(hall-01 ~ hall-100)을 생성합니다.
 */
export const HALL_ROOMS: readonly HallRoomDefinition[] = Array.from(
  { length: 100 },
  (_, idx) => {
    const num = idx + 1;
    const padded = String(num).padStart(2, '0');
    const id = `hall-${padded}`;
    const theme = ROOM_THEMES[idx % ROOM_THEMES.length];
    return {
      id,
      name: `제${num}온천 · ${theme.title}`,
      subtitle: theme.desc,
      capacity: 100,
    };
  }
);

export const TABLE_COLUMNS: ReadonlyArray<{
  tableIndex: number;
  centerX: number;
  house: ArcaneHouseId;
}> = [
  { tableIndex: 0, centerX: -6.0, house: 'ignis' },
  { tableIndex: 1, centerX: -2.0, house: 'astra' },
  { tableIndex: 2, centerX: 2.0, house: 'sylph' },
  { tableIndex: 3, centerX: 6.0, house: 'terra' },
];

/**
 * 4개 구역 총 42석의 대규모 온천 마을 좌석 배치:
 * 1) 중앙 대노천탕 (Main Grand Bath): 18석 (index 0..17, 수중 반신욕)
 * 2) 중앙 바위섬 명당 (Center Island): 6석 (index 18..23, 수중 반신욕)
 * 3) 동쪽 히노끼 편백탕 (East Hinoki Cypress Bath): 8석 (index 24..31, 수중 반신욕)
 * 4) 북쪽 온천 본관 누각 툇마루 (North Grand Pavilion Veranda): 6석 (index 32..37, 마루 방석 좌석)
 * 5) 서남쪽 모닥불 족욕탕 평상 (West Footbath & Campfire Deck): 4석 (index 38..41, 족욕 좌석)
 */
export const STUDY_CHAIR_SLOTS: readonly StudyChairSlot[] = (() => {
  const slots: StudyChairSlot[] = [];
  const houses: readonly ArcaneHouseId[] = ['ignis', 'astra', 'sylph', 'terra'];
  let idx = 0;

  // 1) 중앙 대노천탕 둘레 18석
  const mainCount = 18;
  for (let i = 0; i < mainCount; i += 1) {
    const angle = (i / mainCount) * Math.PI * 2;
    const rx = 5.4;
    const rz = 4.2;
    const seatX = Number((Math.cos(angle) * rx).toFixed(2));
    const seatZ = Number((Math.sin(angle) * rz + 0.5).toFixed(2));
    const deskX = Number((Math.cos(angle) * (rx - 0.85)).toFixed(2));
    const deskZ = Number((Math.sin(angle) * (rz - 0.78) + 0.5).toFixed(2));
    const facingYaw = Math.atan2(-seatX, -(seatZ - 0.5));

    slots.push({
      index: idx++,
      tableIndex: 0,
      zone: 'main_bath',
      zoneName: '중앙 대노천탕',
      house: houses[i % houses.length],
      seatX,
      seatY: 0,
      seatZ,
      deskX,
      deskZ,
      facingYaw,
      isWater: true,
    });
  }

  // 2) 중앙 석등 바위섬 주변 6석
  for (let j = 0; j < 6; j += 1) {
    const angle = (j / 6) * Math.PI * 2 + 0.3;
    const rx = 2.4;
    const rz = 1.9;
    const seatX = Number((Math.cos(angle) * rx).toFixed(2));
    const seatZ = Number((Math.sin(angle) * rz + 0.5).toFixed(2));
    const deskX = Number((Math.cos(angle) * (rx + 0.72)).toFixed(2));
    const deskZ = Number((Math.sin(angle) * (rz + 0.65) + 0.5).toFixed(2));
    const facingYaw = Math.atan2(seatX, seatZ - 0.5);

    slots.push({
      index: idx++,
      tableIndex: 1,
      zone: 'main_bath',
      zoneName: '중앙 석등 바위섬',
      house: houses[j % houses.length],
      seatX,
      seatY: 0,
      seatZ,
      deskX,
      deskZ,
      facingYaw,
      isWater: true,
    });
  }

  // 3) 동쪽 히노끼 편백탕 (중심 x = 10.5, z = -1.0) 8석
  const hinokiOffsets: ReadonlyArray<[number, number, number]> = [
    [-1.4, -1.2, Math.PI / 4],
    [0, -1.4, 0],
    [1.4, -1.2, -Math.PI / 4],
    [1.6, 0, -Math.PI / 2],
    [1.4, 1.2, (-3 * Math.PI) / 4],
    [0, 1.4, Math.PI],
    [-1.4, 1.2, (3 * Math.PI) / 4],
    [-1.6, 0, Math.PI / 2],
  ];
  for (let k = 0; k < hinokiOffsets.length; k += 1) {
    const [ox, oz, yaw] = hinokiOffsets[k];
    const seatX = Number((10.5 + ox).toFixed(2));
    const seatZ = Number((-1.0 + oz).toFixed(2));
    slots.push({
      index: idx++,
      tableIndex: 2,
      zone: 'hinoki_bath',
      zoneName: '동쪽 히노끼 편백탕',
      house: houses[k % houses.length],
      seatX,
      seatY: 0,
      seatZ,
      deskX: Number((10.5 + ox * 0.55).toFixed(2)),
      deskZ: Number((-1.0 + oz * 0.55).toFixed(2)),
      facingYaw: yaw,
      isWater: true,
    });
  }

  // 4) 북쪽 온천 본관 누각 툇마루 다다미 방석 6석 (z = -7.6, x = -4.5 .. 4.5)
  const verandaX = [-4.2, -2.5, -0.9, 0.9, 2.5, 4.2];
  for (let m = 0; m < verandaX.length; m += 1) {
    const vx = verandaX[m];
    slots.push({
      index: idx++,
      tableIndex: 3,
      zone: 'pavilion',
      zoneName: '온천 본관 툇마루',
      house: houses[m % houses.length],
      seatX: vx,
      seatY: 0.42,
      seatZ: -7.5,
      deskX: vx,
      deskZ: -6.8,
      facingYaw: 0,
      isWater: false,
    });
  }

  // 5) 서남쪽 모닥불 족욕탕 & 휴식 데크 4석 (중심 x = -10.2, z = 3.2)
  const footOffsets: ReadonlyArray<[number, number, number]> = [
    [-1.3, -1.1, Math.PI / 4],
    [1.3, -1.1, -Math.PI / 4],
    [1.3, 1.1, (-3 * Math.PI) / 4],
    [-1.3, 1.1, (3 * Math.PI) / 4],
  ];
  for (let n = 0; n < footOffsets.length; n += 1) {
    const [fx, fz, fyaw] = footOffsets[n];
    slots.push({
      index: idx++,
      tableIndex: 3,
      zone: 'footbath',
      zoneName: '모닥불 족욕탕',
      house: houses[n % houses.length],
      seatX: Number((-10.2 + fx).toFixed(2)),
      seatY: 0.15,
      seatZ: Number((3.2 + fz).toFixed(2)),
      deskX: Number((-10.2 + fx * 0.45).toFixed(2)),
      deskZ: Number((3.2 + fz * 0.45).toFixed(2)),
      facingYaw: fyaw,
      isWater: false,
    });
  }

  return slots;
})();

export function createResidentScholars(now: number): ScholarVisitor[] {
  const configs: ReadonlyArray<{
    id: string;
    seat: number;
    name: string;
    house: ArcaneHouseId;
    focusTopic: string;
    chairIndex: number;
  }> = [
    {
      id: 'resident:01',
      seat: 1,
      name: '카피바라 대장',
      house: 'ignis',
      focusTopic: '유자 올리고 3시간째 반신욕 명상',
      chairIndex: 13,
    },
    {
      id: 'resident:02',
      seat: 2,
      name: '꾸벅꾸벅 아기 카피',
      house: 'sylph',
      focusTopic: '물이 따뜻해서 눈이 감긴다...',
      chairIndex: 19,
    },
    {
      id: 'resident:03',
      seat: 3,
      name: '온천수 감정사 카피선생',
      house: 'astra',
      focusTopic: '오늘 수온 41.2도 아주 훌륭함',
      chairIndex: 4,
    },
    {
      id: 'resident:04',
      seat: 4,
      name: '편백탕 지킴이 카피할배',
      house: 'terra',
      focusTopic: '히노끼 탕에서 솔향기 맡는 중',
      chairIndex: 25,
    },
    {
      id: 'resident:05',
      seat: 5,
      name: '마루 위 카피선비',
      house: 'ignis',
      focusTopic: '툇마루에서 바나나우유 식히는 중',
      chairIndex: 34,
    },
    {
      id: 'resident:06',
      seat: 6,
      name: '모닥불 족욕 카피',
      house: 'astra',
      focusTopic: '모닥불 보며 발 담그고 불멍 중',
      chairIndex: 38,
    },
  ];

  return configs.map((cfg) => {
    const chair = STUDY_CHAIR_SLOTS[cfg.chairIndex] ?? STUDY_CHAIR_SLOTS[0];
    return {
      id: cfg.id,
      seat: cfg.seat,
      name: cfg.name,
      house: cfg.house,
      focusTopic: cfg.focusTopic,
      isResident: true,
      chairIndex: cfg.chairIndex,
      pose: 'sitting',
      x: chair.seatX,
      z: chair.seatZ,
      yaw: chair.facingYaw,
      lumosAt: null,
      focusUntil: now + 1000 * 60 * 180,
    };
  });
}

export function createInitialWishCandles(now: number): WishCandle[] {
  return [
    {
      id: 'wish-yuzu-1',
      author: '퇴근한 직장인',
      house: 'ignis',
      message:
        '오늘 하루도 다들 고생 많으셨어요. 따뜻한 노천탕 물에 걱정 다 녹이고 가세요 🍊',
      createdAt: now - 1000 * 60 * 48,
      x: -3.2,
      y: 0.18,
      z: -1.1,
    },
    {
      id: 'wish-yuzu-2',
      author: '양머리 수건러',
      house: 'astra',
      message: '뚱바 바나나우유 하나 옆에 두고 자격증 인강 2개만 딱 듣고 자자!',
      createdAt: now - 1000 * 60 * 31,
      x: 2.8,
      y: 0.18,
      z: 1.4,
    },
    {
      id: 'wish-yuzu-3',
      author: '밤샘 개발자',
      house: 'sylph',
      message: '버그 없이 배포 한 번에 성공하게 해주세요 카피바라 대장님 🙏',
      createdAt: now - 1000 * 60 * 19,
      x: -1.4,
      y: 0.18,
      z: 2.5,
    },
    {
      id: 'wish-yuzu-4',
      author: '편백탕 매니아',
      house: 'terra',
      message: '말없이 각자 할 일 하면서 같은 온천에 앉아 있는 이 분위기가 참 좋네요.',
      createdAt: now - 1000 * 60 * 11,
      x: 10.2,
      y: 0.18,
      z: -0.8,
    },
    {
      id: 'wish-yuzu-5',
      author: '고시생 도토리',
      house: 'ignis',
      message: '30분 반신욕 타이머 맞춰놓고 기출 1회독 집중 출발합니다!',
      createdAt: now - 1000 * 60 * 4,
      x: 1.5,
      y: 0.18,
      z: -2.1,
    },
  ];
}

export function sanitizeRoomId(raw: string | null | undefined): string {
  if (!raw) return 'hall-01';
  const cleaned = raw.trim().toLowerCase();
  const found = HALL_ROOMS.find((r) => r.id === cleaned);
  return found ? found.id : 'hall-01';
}

export function buildDefaultRoomSummaries(): RoomSummary[] {
  return HALL_ROOMS.map((r, idx) => ({
    id: r.id,
    name: r.name,
    subtitle: r.subtitle,
    occupancy: idx === 0 ? 1 : 0,
    capacity: r.capacity,
  }));
}
