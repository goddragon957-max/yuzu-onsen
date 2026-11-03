// Vercel Serverless Function — 실시간 온천 멀티플레이어 동기화 허브 (/api/presence)
// 전 세계 접속자(PC/모바일)의 위치, 모자, 이름표, 소원 유자, 시시오도시 울림을 공유합니다.

const VISITOR_TTL_MS = 22000;

const RESIDENT_VISITORS = [
  {
    id: 'resident-1',
    seat: 1,
    name: '카피바라 대장',
    house: 'ignis',
    focusTopic: '유자탕 명상 중',
    isResident: true,
    chairIndex: 2,
    pose: 'sitting',
    x: 0.0,
    z: -3.25,
    yaw: 0,
    lumosAt: null,
    focusUntil: Date.now() + 3600000,
  },
  {
    id: 'resident-2',
    seat: 2,
    name: '꾸벅꾸벅 아기 카피',
    house: 'astra',
    focusTopic: '뜨끈하게 반신욕',
    isResident: true,
    chairIndex: 7,
    pose: 'sitting',
    x: 4.56,
    z: 1.56,
    yaw: -1.8,
    lumosAt: null,
    focusUntil: Date.now() + 3600000,
  },
  {
    id: 'resident-3',
    seat: 3,
    name: '온천 마니아 수달',
    house: 'sylph',
    focusTopic: '오리 모자 쓰고 휴식',
    isResident: true,
    chairIndex: 13,
    pose: 'sitting',
    x: -4.56,
    z: 1.56,
    yaw: 1.8,
    lumosAt: null,
    focusUntil: Date.now() + 3600000,
  },
  {
    id: 'resident-4',
    seat: 4,
    name: '편백탕 지킴이 카피할배',
    house: 'terra',
    focusTopic: '솔향기 히노끼욕',
    isResident: true,
    chairIndex: 22,
    pose: 'sitting',
    x: 10.5,
    z: -2.4,
    yaw: 0,
    lumosAt: null,
    focusUntil: Date.now() + 3600000,
  },
  {
    id: 'resident-5',
    seat: 5,
    name: '마루 위 치즈냥이 친구',
    house: 'ignis',
    focusTopic: '식혜 마시며 코딩',
    isResident: true,
    chairIndex: 31,
    pose: 'sitting',
    x: -2.1,
    z: -5.45,
    yaw: 0,
    lumosAt: null,
    focusUntil: Date.now() + 3600000,
  },
  {
    id: 'resident-6',
    seat: 6,
    name: '모닥불 불멍러',
    house: 'astra',
    focusTopic: '외기욕 선베드 휴식',
    isResident: true,
    chairIndex: 38,
    pose: 'sitting',
    x: -11.9,
    z: 2.3,
    yaw: 1.2,
    lumosAt: null,
    focusUntil: Date.now() + 3600000,
  },
];

const INITIAL_WISHES = [
  {
    id: 'wish-seed-1',
    author: '온천지기',
    house: 'ignis',
    message: '유자 노천탕에 오신 모든 분들 오늘 하루도 따뜻하고 평안하시길 🍊',
    createdAt: Date.now() - 360000,
    x: -1.8,
    y: 0.16,
    z: 1.4,
  },
  {
    id: 'wish-seed-2',
    author: '새벽코더',
    house: 'astra',
    message: '버그 없이 무사히 배포하고 뜨끈한 온천에 몸 담그고 싶어요',
    createdAt: Date.now() - 240000,
    x: 2.1,
    y: 0.16,
    z: 1.8,
  },
  {
    id: 'wish-seed-3',
    author: '양머리수건',
    house: 'sylph',
    message: '살얼음 식혜 한 모금 마시면서 조용히 물소리 듣는 시간 최고!',
    createdAt: Date.now() - 120000,
    x: -2.2,
    y: 0.16,
    z: -0.9,
  },
];

function getGlobalStore() {
  if (!globalThis.__YUZU_ONSEN_STORE__) {
    globalThis.__YUZU_ONSEN_STORE__ = {
      rooms: new Map(),
    };
  }
  return globalThis.__YUZU_ONSEN_STORE__;
}

function getOrCreateRoom(roomId) {
  const cleanId = /^hall-(?:0[1-9]|[1-9][0-9]|100)$/.test(roomId || '')
    ? roomId
    : 'hall-01';
  const store = getGlobalStore();
  let room = store.rooms.get(cleanId);
  if (!room) {
    room = {
      id: cleanId,
      visitorsById: new Map(),
      wishes: [...INITIAL_WISHES],
      lastBell: null,
      revision: 1,
    };
    store.rooms.set(cleanId, room);
  }
  return room;
}

function pruneStaleVisitors(room, now) {
  for (const [clientId, entry] of room.visitorsById.entries()) {
    if (now - entry.lastSeen > VISITOR_TTL_MS) {
      room.visitorsById.delete(clientId);
      room.revision += 1;
    }
  }
}

function assignSeatForClient(room, clientId, preferredSeat) {
  const existing = room.visitorsById.get(clientId);
  if (existing) return existing.visitor.seat;

  const usedSeats = new Set([1, 2, 3, 4, 5, 6]);
  for (const entry of room.visitorsById.values()) {
    usedSeats.add(entry.visitor.seat);
  }

  if (
    typeof preferredSeat === 'number' &&
    preferredSeat >= 7 &&
    preferredSeat <= 99 &&
    !usedSeats.has(preferredSeat)
  ) {
    return preferredSeat;
  }

  let hash = 0;
  for (let i = 0; i < clientId.length; i += 1) {
    hash = (hash * 31 + clientId.charCodeAt(i)) >>> 0;
  }
  for (let offset = 0; offset < 90; offset += 1) {
    const candidate = 7 + ((hash + offset) % 90);
    if (!usedSeats.has(candidate)) {
      return candidate;
    }
  }
  return 97;
}

function buildRoomSnapshot(room, selfId, selfSeat, now) {
  pruneStaleVisitors(room, now);
  const visitors = [
    ...RESIDENT_VISITORS,
    ...Array.from(room.visitorsById.values()).map((e) => e.visitor),
  ];
  return {
    type: 'snapshot',
    room: room.id,
    selfId,
    selfSeat,
    revision: room.revision,
    serverTime: now,
    visitors,
    wishes: room.wishes.slice(0, 35),
    lastBell: room.lastBell,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const now = Date.now();
  const url = new URL(req.url || '/api/presence', 'http://localhost');
  const action = url.searchParams.get('action');

  // 전체 100개 온천 채널 인원 현황 조회
  if (req.method === 'GET' && action === 'rooms') {
    const store = getGlobalStore();
    const summaries = [];
    for (let i = 1; i <= 100; i += 1) {
      const padded = String(i).padStart(2, '0');
      const id = `hall-${padded}`;
      const room = store.rooms.get(id);
      if (room) {
        pruneStaleVisitors(room, now);
      }
      const humanCount = room ? room.visitorsById.size : 0;
      summaries.push({
        id,
        name: `제${i}온천`,
        subtitle: '실시간 유자 노천탕',
        occupancy: 6 + humanCount,
        capacity: 100,
      });
    }
    return res.status(200).json({ rooms: summaries });
  }

  if (req.method === 'GET') {
    const roomId = url.searchParams.get('room') || 'hall-01';
    const selfId = url.searchParams.get('selfId') || `anon-${now}`;
    const room = getOrCreateRoom(roomId);
    const selfSeat = assignSeatForClient(room, selfId, null);
    return res.status(200).json(buildRoomSnapshot(room, selfId, selfSeat, now));
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const roomId = body.room || 'hall-01';
    const selfId = String(body.selfId || `anon-${now}`).slice(0, 40);
    const room = getOrCreateRoom(roomId);
    pruneStaleVisitors(room, now);

    const seat = assignSeatForClient(room, selfId, body.seat);
    const existing = room.visitorsById.get(selfId);

    const baseSlotIdx = 7 + (seat % 14);
    const defaultAngle = ((baseSlotIdx - 7) / 14) * Math.PI * 2;
    const defaultX = Number((Math.cos(defaultAngle) * 4.5).toFixed(2));
    const defaultZ = Number((0.5 + Math.sin(defaultAngle) * 3.4).toFixed(2));

    const updatedVisitor = {
      id: selfId,
      seat,
      name: String(
        body.name ?? existing?.visitor.name ?? `온천손님 #${seat}`
      ).slice(0, 16),
      house: ['ignis', 'astra', 'sylph', 'terra'].includes(body.house)
        ? body.house
        : existing?.visitor.house ?? 'ignis',
      focusTopic: String(
        body.focusTopic ?? existing?.visitor.focusTopic ?? '노곤노곤 반신욕 중'
      ).slice(0, 24),
      isResident: false,
      chairIndex:
        typeof body.chairIndex === 'number'
          ? body.chairIndex
          : existing?.visitor.chairIndex ?? baseSlotIdx,
      pose: ['standing', 'walking', 'sitting', 'lumos'].includes(body.pose)
        ? body.pose
        : existing?.visitor.pose ?? 'sitting',
      x:
        typeof body.x === 'number'
          ? Number(body.x.toFixed(2))
          : existing?.visitor.x ?? defaultX,
      z:
        typeof body.z === 'number'
          ? Number(body.z.toFixed(2))
          : existing?.visitor.z ?? defaultZ,
      yaw:
        typeof body.yaw === 'number'
          ? Number(body.yaw.toFixed(2))
          : existing?.visitor.yaw ?? Number((defaultAngle + Math.PI).toFixed(2)),
      lumosAt:
        body.lumosAt !== undefined
          ? body.lumosAt
          : existing?.visitor.lumosAt ?? null,
      focusUntil:
        body.focusUntil !== undefined
          ? body.focusUntil
          : existing?.visitor.focusUntil ?? null,
    };

    room.visitorsById.set(selfId, {
      visitor: updatedVisitor,
      lastSeen: now,
    });
    room.revision += 1;

    // 소원 유자 생성 요청인 경우
    if (body.event === 'create_wish' && body.wishMessage) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.9 + Math.random() * 2.1;
      const newWish = {
        id: `wish-${now}-${Math.random().toString(36).slice(2, 6)}`,
        author: updatedVisitor.name,
        house: updatedVisitor.house,
        message: String(body.wishMessage).slice(0, 80),
        createdAt: now,
        x: Number((Math.cos(angle) * radius).toFixed(2)),
        y: 0.16,
        z: Number((0.5 + Math.sin(angle) * (radius * 0.75)).toFixed(2)),
      };
      room.wishes.unshift(newWish);
      if (room.wishes.length > 40) {
        room.wishes.length = 40;
      }
    }

    // 대나무 시시오도시(낙수대) 울림 요청인 경우
    if (body.event === 'trigger_bell') {
      room.lastBell = {
        id: `bell-${now}`,
        triggeredBy: updatedVisitor.name,
        serverTime: now,
      };
    }

    return res.status(200).json(buildRoomSnapshot(room, selfId, seat, now));
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
