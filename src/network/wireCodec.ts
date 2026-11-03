import type {
  ScholarDynamicState,
  ScholarPose,
  ScholarProfile,
} from '@/types/protocol';

/**
 * 산사(Sansa)의 SNSC(0x534E5343) 바이너리 델타 프로토콜을 계승한
 * 아케인 홀 전용 ARCN(0x4152434E, "ARCN") 바이너리 프레임 코덱
 *
 * [Header: 28 Bytes]
 * - 0..4   (Uint32 LE): Magic 0x4152434E ("ARCN")
 * - 4..8   (Uint32 LE): JSON payload byte length
 * - 8..10  (Uint16 LE): Binary state upsert record count
 * - 10..12 (Uint16 LE): Reserved (0)
 * - 12..20 (Float64 LE): Revision number
 * - 20..28 (Float64 LE): Server timestamp (ms)
 *
 * [JSON Payload: jsonLength Bytes]
 * - UTF-8 JSON: { room: string, profiles?: ScholarProfile[], removed?: number[] }
 *
 * [Binary Visitor Records: variable 30 / 38 / 46 Bytes per record]
 * - +0  (Uint16 LE): seat
 * - +2  (Int16 LE):  chairIndex (-1 if standing/walking)
 * - +4  (Uint8):     pose (0=standing, 1=walking, 2=sitting, 3=lumos)
 * - +5  (Uint8):     flags (bit 0 = hasLumosAt, bit 1 = hasFocusUntil)
 * - +6  (Float64 LE): x
 * - +14 (Float64 LE): z
 * - +22 (Float64 LE): yaw
 * - +30 (Float64 LE, optional): lumosAt (if flags & 1)
 * - +38 (Float64 LE, optional): focusUntil (if flags & 2)
 */
export const ARCN_WIRE_MAGIC = 0x4152434e;
const HEADER_BYTES = 28;
const POSE_TABLE: readonly ScholarPose[] = [
  'standing',
  'walking',
  'sitting',
  'lumos',
];

export interface ArcnDeltaEnvelope {
  room: string;
  revision: number;
  serverTime: number;
  profiles: ScholarProfile[];
  removedSeats: number[];
  upserts: ScholarDynamicState[];
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function poseToByte(pose: ScholarPose): number {
  const idx = POSE_TABLE.indexOf(pose);
  return idx >= 0 ? idx : 0;
}

function byteToPose(code: number): ScholarPose {
  return POSE_TABLE[code] ?? 'standing';
}

export function encodeArcnDeltaFrame(envelope: ArcnDeltaEnvelope): Uint8Array {
  const jsonText = JSON.stringify({
    room: envelope.room,
    profiles: envelope.profiles.length > 0 ? envelope.profiles : undefined,
    removed: envelope.removedSeats.length > 0 ? envelope.removedSeats : undefined,
  });
  const jsonBytes = textEncoder.encode(jsonText);

  let recordsByteLength = 0;
  for (const rec of envelope.upserts) {
    let recLen = 30;
    if (rec.lumosAt !== null && Number.isFinite(rec.lumosAt)) recLen += 8;
    if (rec.focusUntil !== null && Number.isFinite(rec.focusUntil)) recLen += 8;
    recordsByteLength += recLen;
  }

  const totalBytes = HEADER_BYTES + jsonBytes.byteLength + recordsByteLength;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  const outBytes = new Uint8Array(buffer);

  view.setUint32(0, ARCN_WIRE_MAGIC, true);
  view.setUint32(4, jsonBytes.byteLength, true);
  view.setUint16(8, envelope.upserts.length, true);
  view.setUint16(10, 0, true);
  view.setFloat64(12, envelope.revision, true);
  view.setFloat64(20, envelope.serverTime, true);

  outBytes.set(jsonBytes, HEADER_BYTES);

  let cursor = HEADER_BYTES + jsonBytes.byteLength;
  for (const rec of envelope.upserts) {
    const hasLumos = rec.lumosAt !== null && Number.isFinite(rec.lumosAt);
    const hasFocus = rec.focusUntil !== null && Number.isFinite(rec.focusUntil);
    const flags = (hasLumos ? 1 : 0) | (hasFocus ? 2 : 0);

    view.setUint16(cursor, rec.seat, true);
    view.setInt16(cursor + 2, rec.chairIndex, true);
    view.setUint8(cursor + 4, poseToByte(rec.pose));
    view.setUint8(cursor + 5, flags);
    view.setFloat64(cursor + 6, rec.x, true);
    view.setFloat64(cursor + 14, rec.z, true);
    view.setFloat64(cursor + 22, rec.yaw, true);
    cursor += 30;

    if (hasLumos && rec.lumosAt !== null) {
      view.setFloat64(cursor, rec.lumosAt, true);
      cursor += 8;
    }
    if (hasFocus && rec.focusUntil !== null) {
      view.setFloat64(cursor, rec.focusUntil, true);
      cursor += 8;
    }
  }

  return outBytes;
}

export function decodeArcnDeltaFrame(buffer: ArrayBuffer): ArcnDeltaEnvelope | null {
  if (buffer.byteLength < HEADER_BYTES) return null;
  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  if (magic !== ARCN_WIRE_MAGIC) return null;

  const jsonLength = view.getUint32(4, true);
  const upsertCount = view.getUint16(8, true);
  const revision = view.getFloat64(12, true);
  const serverTime = view.getFloat64(20, true);

  const jsonEnd = HEADER_BYTES + jsonLength;
  if (jsonEnd > buffer.byteLength) return null;

  let parsedMeta: {
    room?: string;
    profiles?: ScholarProfile[];
    removed?: number[];
  };
  try {
    const jsonSlice = new Uint8Array(buffer, HEADER_BYTES, jsonLength);
    parsedMeta = JSON.parse(textDecoder.decode(jsonSlice)) as {
      room?: string;
      profiles?: ScholarProfile[];
      removed?: number[];
    };
  } catch {
    return null;
  }

  const upserts: ScholarDynamicState[] = [];
  let cursor = jsonEnd;
  for (let i = 0; i < upsertCount; i += 1) {
    if (cursor + 30 > buffer.byteLength) return null;
    const seat = view.getUint16(cursor, true);
    const chairIndex = view.getInt16(cursor + 2, true);
    const pose = byteToPose(view.getUint8(cursor + 4));
    const flags = view.getUint8(cursor + 5);
    const x = view.getFloat64(cursor + 6, true);
    const z = view.getFloat64(cursor + 14, true);
    const yaw = view.getFloat64(cursor + 22, true);
    cursor += 30;

    let lumosAt: number | null = null;
    if ((flags & 1) !== 0) {
      if (cursor + 8 > buffer.byteLength) return null;
      lumosAt = view.getFloat64(cursor, true);
      cursor += 8;
    }

    let focusUntil: number | null = null;
    if ((flags & 2) !== 0) {
      if (cursor + 8 > buffer.byteLength) return null;
      focusUntil = view.getFloat64(cursor, true);
      cursor += 8;
    }

    upserts.push({
      seat,
      chairIndex,
      pose,
      x,
      z,
      yaw,
      lumosAt,
      focusUntil,
    });
  }

  return {
    room: parsedMeta.room ?? 'hall-01',
    revision,
    serverTime,
    profiles: Array.isArray(parsedMeta.profiles) ? parsedMeta.profiles : [],
    removedSeats: Array.isArray(parsedMeta.removed) ? parsedMeta.removed : [],
    upserts,
  };
}
