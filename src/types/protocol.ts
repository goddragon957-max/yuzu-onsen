export type ArcaneHouseId = 'ignis' | 'sylph' | 'astra' | 'terra';

export type ScholarPose = 'standing' | 'walking' | 'sitting' | 'lumos';

export type WeatherMood = 'starlight' | 'rainstorm' | 'aurora' | 'dawn';

export interface HouseMeta {
  id: ArcaneHouseId;
  nameKo: string;
  nameEn: string;
  motto: string;
  primaryHex: string;
  accentHex: string;
  primaryColor: number;
  accentColor: number;
}

/**
 * 머리 위 온천 아이템 & 유카타 컬러 테마 4종
 * (기존 프로토콜 필드 호환성을 유지하면서 귀여운 온천 테마로 매핑)
 */
export const ARCANE_HOUSES: Record<ArcaneHouseId, HouseMeta> = {
  ignis: {
    id: 'ignis',
    nameKo: '🍊 머리 위 노란 유자',
    nameEn: 'Yuzu Top',
    motto: '향긋한 유자 하나 머리에 얹고 노곤노곤',
    primaryHex: '#ff9f1c',
    accentHex: '#ffe66d',
    primaryColor: 0xff9f1c,
    accentColor: 0xffe66d,
  },
  astra: {
    id: 'astra',
    nameKo: '🐑 양머리 온천 수건',
    nameEn: 'Sheep Towel',
    motto: '찜질방과 온천의 국룰 양머리 수건',
    primaryHex: '#70c1b3',
    accentHex: '#ffffff',
    primaryColor: 0x70c1b3,
    accentColor: 0xffffff,
  },
  sylph: {
    id: 'sylph',
    nameKo: '🐤 노란 고무오리 친구',
    nameEn: 'Rubber Duck',
    motto: '머리 위에서 함께 온천욕 즐기는 아기 오리',
    primaryHex: '#ffbf69',
    accentHex: '#ff9f1c',
    primaryColor: 0xffbf69,
    accentColor: 0xff9f1c,
  },
  terra: {
    id: 'terra',
    nameKo: '🧖 접은 편백 수건',
    nameEn: 'Hinoki Towel',
    motto: '흘러내리지 않게 정수리에 착 올린 수건',
    primaryHex: '#e07a5f',
    accentHex: '#f4f1de',
    primaryColor: 0xe07a5f,
    accentColor: 0xf4f1de,
  },
};

export interface ScholarProfile {
  id: string;
  seat: number;
  name: string;
  house: ArcaneHouseId;
  focusTopic: string;
  isResident: boolean;
}

export interface ScholarDynamicState {
  seat: number;
  chairIndex: number;
  pose: ScholarPose;
  x: number;
  z: number;
  yaw: number;
  lumosAt: number | null;
  focusUntil: number | null;
}

export interface ScholarVisitor extends ScholarProfile, ScholarDynamicState {}

export interface WishCandle {
  id: string;
  author: string;
  house: ArcaneHouseId;
  message: string;
  createdAt: number;
  x: number;
  y: number;
  z: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  subtitle: string;
  occupancy: number;
  capacity: number;
}

export interface SnapshotPacket {
  type: 'snapshot';
  room: string;
  selfId: string;
  selfSeat: number;
  revision: number;
  serverTime: number;
  visitors: ScholarVisitor[];
  wishes: WishCandle[];
}

export interface WishCreatedPacket {
  type: 'wish_created';
  wish: WishCandle;
}

export interface BellResonancePacket {
  type: 'bell_resonance';
  triggeredBy: string;
  serverTime: number;
}

export type ServerJsonPacket =
  | SnapshotPacket
  | WishCreatedPacket
  | BellResonancePacket;

export interface ClientStateUpdatePacket {
  type: 'state';
  pose: ScholarPose;
  chairIndex: number;
  x: number;
  z: number;
  yaw: number;
  lumosAt: number | null;
  focusUntil: number | null;
}

export interface ClientProfileUpdatePacket {
  type: 'profile';
  name: string;
  house: ArcaneHouseId;
  focusTopic: string;
}

export interface ClientCreateWishPacket {
  type: 'create_wish';
  author: string;
  house: ArcaneHouseId;
  message: string;
}

export interface ClientTriggerBellPacket {
  type: 'trigger_bell';
}

export type ClientPacket =
  | ClientStateUpdatePacket
  | ClientProfileUpdatePacket
  | ClientCreateWishPacket
  | ClientTriggerBellPacket;
