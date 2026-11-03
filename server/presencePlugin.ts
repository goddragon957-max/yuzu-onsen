import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { encodeArcnDeltaFrame } from '../src/network/wireCodec';
import {
  createInitialWishCandles,
  createResidentScholars,
  HALL_ROOMS,
  sanitizeRoomId,
} from '../src/scene/hallLayout';
import type {
  ArcaneHouseId,
  BellResonancePacket,
  ClientPacket,
  ScholarProfile,
  ScholarVisitor,
  SnapshotPacket,
  WishCandle,
  WishCreatedPacket,
} from '../src/types/protocol';

interface ConnectedScholarClient {
  ws: WebSocket;
  visitor: ScholarVisitor;
}

interface RoomState {
  id: string;
  revision: number;
  nextSeat: number;
  residents: ScholarVisitor[];
  clients: Map<string, ConnectedScholarClient>;
  wishes: WishCandle[];
}

const VALID_HOUSES: readonly ArcaneHouseId[] = [
  'ignis',
  'sylph',
  'astra',
  'terra',
];

function sanitizeHouse(input: string | undefined): ArcaneHouseId {
  if (input && (VALID_HOUSES as readonly string[]).includes(input)) {
    return input as ArcaneHouseId;
  }
  return 'astra';
}

export function arcanePresenceServerPlugin(): Plugin {
  const rooms = new Map<string, RoomState>();
  const now = Date.now();

  for (const def of HALL_ROOMS) {
    rooms.set(def.id, {
      id: def.id,
      revision: 1,
      nextSeat: 10,
      residents: createResidentScholars(now),
      clients: new Map(),
      wishes: createInitialWishCandles(now),
    });
  }

  function getOrCreateRoom(roomId: string): RoomState {
    const cleanId = sanitizeRoomId(roomId);
    const existing = rooms.get(cleanId);
    if (existing) return existing;
    const created: RoomState = {
      id: cleanId,
      revision: 1,
      nextSeat: 10,
      residents: createResidentScholars(Date.now()),
      clients: new Map(),
      wishes: createInitialWishCandles(Date.now()),
    };
    rooms.set(cleanId, created);
    return created;
  }

  function broadcastBinaryDelta(
    room: RoomState,
    profiles: ScholarProfile[],
    removedSeats: number[],
    upserts: ScholarVisitor[]
  ): void {
    room.revision += 1;
    const frame = encodeArcnDeltaFrame({
      room: room.id,
      revision: room.revision,
      serverTime: Date.now(),
      profiles,
      removedSeats,
      upserts: upserts.map((v) => ({
        seat: v.seat,
        chairIndex: v.chairIndex,
        pose: v.pose,
        x: v.x,
        z: v.z,
        yaw: v.yaw,
        lumosAt: v.lumosAt,
        focusUntil: v.focusUntil,
      })),
    });

    for (const peer of room.clients.values()) {
      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(frame, { binary: true });
      }
    }
  }

  function broadcastJson(
    room: RoomState,
    packet: WishCreatedPacket | BellResonancePacket
  ): void {
    const raw = JSON.stringify(packet);
    for (const peer of room.clients.values()) {
      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(raw);
      }
    }
  }

  return {
    name: 'arcane-presence-server',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/rooms')) {
          const payload = HALL_ROOMS.map((def) => {
            const roomState = rooms.get(def.id);
            return {
              id: def.id,
              name: def.name,
              subtitle: def.subtitle,
              occupancy: roomState ? roomState.clients.size : 0,
              capacity: def.capacity,
            };
          });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ rooms: payload, serverTime: Date.now() }));
          return;
        }
        next();
      });

      server.httpServer?.on(
        'upgrade',
        (request: IncomingMessage, socket: Duplex, head: Buffer) => {
          const rawUrl = request.url ?? '/';
          if (!rawUrl.startsWith('/presence')) {
            return;
          }
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
          });
        }
      );

      wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
        const parsedUrl = new URL(
          request.url ?? '/presence',
          'http://localhost'
        );
        const roomId = sanitizeRoomId(parsedUrl.searchParams.get('room'));
        const room = getOrCreateRoom(roomId);

        const seat = room.nextSeat++;
        const clientId = `bather-${seat}-${Math.random().toString(36).slice(2, 7)}`;
        const spawnX = (Math.random() - 0.5) * 2.4;
        const spawnZ = 4.5 + (Math.random() - 0.5) * 0.6;

        const visitor: ScholarVisitor = {
          id: clientId,
          seat,
          name: `온천손님 #${seat}`,
          house: VALID_HOUSES[seat % VALID_HOUSES.length],
          focusTopic: '노곤노곤 반신욕 중',
          isResident: false,
          chairIndex: -1,
          pose: 'standing',
          x: spawnX,
          z: spawnZ,
          yaw: Math.PI,
          lumosAt: null,
          focusUntil: null,
        };

        room.clients.set(clientId, { ws, visitor });

        const allVisitors: ScholarVisitor[] = [
          ...room.residents,
          ...Array.from(room.clients.values()).map((c) => c.visitor),
        ];

        const snapshot: SnapshotPacket = {
          type: 'snapshot',
          room: room.id,
          selfId: clientId,
          selfSeat: seat,
          revision: room.revision,
          serverTime: Date.now(),
          visitors: allVisitors,
          wishes: room.wishes,
        };
        ws.send(JSON.stringify(snapshot));

        broadcastBinaryDelta(
          room,
          [
            {
              id: visitor.id,
              seat: visitor.seat,
              name: visitor.name,
              house: visitor.house,
              focusTopic: visitor.focusTopic,
              isResident: false,
            },
          ],
          [],
          [visitor]
        );

        ws.on('message', (data) => {
          let packet: ClientPacket;
          try {
            packet = JSON.parse(data.toString()) as ClientPacket;
          } catch {
            return;
          }

          if (packet.type === 'state') {
            visitor.pose = packet.pose;
            visitor.chairIndex = packet.chairIndex;
            visitor.x = Number.isFinite(packet.x) ? packet.x : visitor.x;
            visitor.z = Number.isFinite(packet.z) ? packet.z : visitor.z;
            visitor.yaw = Number.isFinite(packet.yaw)
              ? packet.yaw
              : visitor.yaw;
            visitor.lumosAt = packet.lumosAt;
            visitor.focusUntil = packet.focusUntil;

            broadcastBinaryDelta(room, [], [], [visitor]);
          } else if (packet.type === 'profile') {
            const cleanName = packet.name.trim().slice(0, 24);
            if (cleanName.length > 0) {
              visitor.name = cleanName;
            }
            visitor.house = sanitizeHouse(packet.house);
            visitor.focusTopic =
              packet.focusTopic.trim().slice(0, 40) || '자율 열람 중';

            broadcastBinaryDelta(
              room,
              [
                {
                  id: visitor.id,
                  seat: visitor.seat,
                  name: visitor.name,
                  house: visitor.house,
                  focusTopic: visitor.focusTopic,
                  isResident: false,
                },
              ],
              [],
              [visitor]
            );
          } else if (packet.type === 'create_wish') {
            const message = packet.message.trim().slice(0, 120);
            if (!message) return;
            const author =
              packet.author.trim().slice(0, 20) || visitor.name || '익명 손님';
            const house = sanitizeHouse(packet.house);

            const angle = Math.random() * Math.PI * 2;
            const radius = 0.6 + Math.random() * 2.1;
            const wish: WishCandle = {
              id: `wish-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              author,
              house,
              message,
              createdAt: Date.now(),
              x: Number((Math.cos(angle) * radius * 1.15).toFixed(2)),
              y: 0.16,
              z: Number((Math.sin(angle) * radius * 0.85 + 0.3).toFixed(2)),
            };

            room.wishes.unshift(wish);
            if (room.wishes.length > 36) {
              room.wishes.pop();
            }

            broadcastJson(room, {
              type: 'wish_created',
              wish,
            });
          } else if (packet.type === 'trigger_bell') {
            broadcastJson(room, {
              type: 'bell_resonance',
              triggeredBy: visitor.name,
              serverTime: Date.now(),
            });
          }
        });

        ws.on('close', () => {
          room.clients.delete(clientId);
          broadcastBinaryDelta(room, [], [visitor.seat], []);
        });
      });
    },
  };
}
