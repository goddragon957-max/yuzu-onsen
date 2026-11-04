import { decodeArcnDeltaFrame } from '@/network/wireCodec';
import {
  createInitialWishCandles,
  createResidentScholars,
  sanitizeRoomId,
  STUDY_CHAIR_SLOTS,
} from '@/scene/hallLayout';
import type {
  ArcaneHouseId,
  ClientPacket,
  ScholarDynamicState,
  ScholarProfile,
  ScholarVisitor,
  ServerJsonPacket,
  SnapshotPacket,
  WishCandle,
} from '@/types/protocol';

export interface PresenceListeners {
  onVisitorsUpdated: (visitors: ScholarVisitor[], selfId: string) => void;
  onWishesUpdated: (wishes: WishCandle[]) => void;
  onWishCreated: (wish: WishCandle) => void;
  onBellResonance: (triggeredBy: string) => void;
  onConnectionStateChange: (connected: boolean, roomId: string) => void;
  onRemoteLumos: (visitor: ScholarVisitor) => void;
  onRemoteBow?: (visitor: ScholarVisitor) => void;
  onSelfSeatAssigned?: (seat: number) => void;
  onPeerJoined?: (visitor: ScholarVisitor) => void;
}

interface ExtendedSnapshotPacket extends SnapshotPacket {
  lastBell?: {
    id: string;
    triggeredBy: string;
    serverTime: number;
  } | null;
}

const MAIN_BATH_HUMAN_SLOTS = [
  0, 1, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 23,
];

function createUniqueTabSelfId(): string {
  const rand = Math.random().toString(36).slice(2, 9);
  const tail = Date.now().toString(36).slice(-4);
  return `bather-${rand}-${tail}`;
}

function deriveSeatFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return 7 + (hash % 34);
}

export class PresenceClient {
  private ws: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private roomId: string;
  private selfId = createUniqueTabSelfId();
  private selfSeat = deriveSeatFromId(this.selfId);
  private visitorsBySeat = new Map<number, ScholarVisitor>();
  private wishes: WishCandle[] = [];
  private listeners: PresenceListeners;
  private reconnectTimer: number | null = null;
  private httpPollTimer: number | null = null;
  private httpSyncThrottleTimer: number | null = null;
  private usingHttpSync = false;
  private lastKnownLumosBySeat = new Map<number, number>();
  private lastKnownBowBySeat = new Map<number, number>();
  private lastKnownBellId: string | null = null;
  private knownWishIds = new Set<string>();
  private knownHumanSeats = new Set<number>();

  constructor(initialRoomId: string, listeners: PresenceListeners) {
    this.roomId = sanitizeRoomId(initialRoomId);
    this.listeners = listeners;
    this.seedFallbackState();
    this.setupLocalBroadcastChannel();
    this.setupUnloadLeaveBeacon();
  }

  public getRoomId(): string {
    return this.roomId;
  }

  public getSelfId(): string {
    return this.selfId;
  }

  public getSelfSeat(): number {
    return this.selfSeat;
  }

  public getVisitors(): ScholarVisitor[] {
    return Array.from(this.visitorsBySeat.values());
  }

  public getWishes(): WishCandle[] {
    return this.wishes;
  }

  public connect(): void {
    this.cleanupSocket();

    // Vercel 배포 환경(yuzu-onsen.vercel.app 등)에서는 즉시 Serverless HTTP Sync + 폴링 활성화
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    const envWsBase = (
      import.meta as unknown as { env?: Record<string, string | undefined> }
    ).env?.VITE_WS_URL;

    if (!isLocalhost && !envWsBase) {
      this.startHttpPresenceSync();
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const baseWs = envWsBase
      ? envWsBase.replace(/\/$/, '')
      : `${protocol}//${window.location.host}`;
    const wsUrl = `${baseWs}/presence?room=${encodeURIComponent(
      this.roomId
    )}&protocol=2&wire=3`;

    try {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.addEventListener('open', () => {
        this.usingHttpSync = false;
        this.stopHttpPresenceSync();
        this.listeners.onConnectionStateChange(true, this.roomId);
        const selfVisitor = this.visitorsBySeat.get(this.selfSeat);
        if (selfVisitor) {
          this.sendPacket({
            type: 'profile',
            name: selfVisitor.name,
            house: selfVisitor.house,
            focusTopic: selfVisitor.focusTopic,
          });
          this.sendPacket({
            type: 'state',
            pose: selfVisitor.pose,
            chairIndex: selfVisitor.chairIndex,
            x: selfVisitor.x,
            z: selfVisitor.z,
            yaw: selfVisitor.yaw,
            lumosAt: selfVisitor.lumosAt,
            focusUntil: selfVisitor.focusUntil,
          });
        }
      });

      ws.addEventListener('message', (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          this.handleBinaryDelta(event.data);
          return;
        }
        if (typeof event.data === 'string') {
          this.handleJsonMessage(event.data);
        }
      });

      ws.addEventListener('close', () => {
        if (!this.usingHttpSync) {
          this.startHttpPresenceSync();
        }
      });

      ws.addEventListener('error', () => {
        if (!this.usingHttpSync) {
          this.startHttpPresenceSync();
        }
      });
    } catch {
      this.startHttpPresenceSync();
    }
  }

  public switchRoom(nextRoomId: string): void {
    const clean = sanitizeRoomId(nextRoomId);
    if (clean === this.roomId) return;

    this.roomId = clean;
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.roomId);
    window.history.replaceState({}, '', url.toString());

    const selfVisitor = this.visitorsBySeat.get(this.selfSeat);
    this.seedFallbackState();
    if (selfVisitor) {
      this.visitorsBySeat.set(this.selfSeat, selfVisitor);
    }
    this.connect();
  }

  public sendState(state: Omit<ScholarDynamicState, 'seat'>): void {
    const selfVisitor = this.visitorsBySeat.get(this.selfSeat);
    if (selfVisitor) {
      selfVisitor.pose = state.pose;
      selfVisitor.chairIndex = state.chairIndex;
      selfVisitor.x = state.x;
      selfVisitor.z = state.z;
      selfVisitor.yaw = state.yaw;
      selfVisitor.lumosAt = state.lumosAt;
      selfVisitor.bowAt = state.bowAt;
      selfVisitor.focusUntil = state.focusUntil;
      this.listeners.onVisitorsUpdated(this.getVisitors(), this.selfId);
      this.broadcastLocalState(selfVisitor);
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendPacket({
        type: 'state',
        pose: state.pose,
        chairIndex: state.chairIndex,
        x: state.x,
        z: state.z,
        yaw: state.yaw,
        lumosAt: state.lumosAt,
        bowAt: state.bowAt,
        focusUntil: state.focusUntil,
      });
    } else if (this.usingHttpSync) {
      this.scheduleHttpSync();
    }
  }

  public sendProfile(
    name: string,
    house: ArcaneHouseId,
    focusTopic: string
  ): void {
    const selfVisitor = this.visitorsBySeat.get(this.selfSeat);
    if (selfVisitor) {
      selfVisitor.name = name;
      selfVisitor.house = house;
      selfVisitor.focusTopic = focusTopic;
      this.listeners.onVisitorsUpdated(this.getVisitors(), this.selfId);
      this.broadcastLocalState(selfVisitor);
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendPacket({
        type: 'profile',
        name,
        house,
        focusTopic,
      });
    } else if (this.usingHttpSync) {
      void this.postHttpPresence();
    }
  }

  public sendCreateWish(
    author: string,
    house: ArcaneHouseId,
    message: string
  ): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendPacket({
        type: 'create_wish',
        author,
        house,
        message,
      });
      return;
    }

    if (this.usingHttpSync) {
      void this.postHttpPresence({
        event: 'create_wish',
        wishMessage: message,
      });
      return;
    }

    // 완전 오프라인 폴백 모드
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.8 + Math.random() * 2.0;
    const localWish: WishCandle = {
      id: `wish-local-${Date.now()}`,
      author,
      house,
      message,
      createdAt: Date.now(),
      x: Number((Math.cos(angle) * radius).toFixed(2)),
      y: 0.16,
      z: Number((0.5 + Math.sin(angle) * (radius * 0.75)).toFixed(2)),
    };
    this.wishes.unshift(localWish);
    this.knownWishIds.add(localWish.id);
    this.listeners.onWishesUpdated(this.wishes);
    this.listeners.onWishCreated(localWish);
  }

  public sendTriggerBell(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendPacket({ type: 'trigger_bell' });
      return;
    }
    if (this.usingHttpSync) {
      void this.postHttpPresence({ event: 'trigger_bell' });
      return;
    }
    this.listeners.onBellResonance('온천지기');
  }

  // ── Vercel Serverless HTTP Sync (/api/presence) ──
  private startHttpPresenceSync(): void {
    this.stopHttpPresenceSync();
    this.usingHttpSync = true;
    void this.postHttpPresence();

    this.httpPollTimer = window.setInterval(() => {
      void this.postHttpPresence();
    }, 1800);
  }

  private stopHttpPresenceSync(): void {
    if (this.httpPollTimer !== null) {
      window.clearInterval(this.httpPollTimer);
      this.httpPollTimer = null;
    }
    if (this.httpSyncThrottleTimer !== null) {
      window.clearTimeout(this.httpSyncThrottleTimer);
      this.httpSyncThrottleTimer = null;
    }
  }

  private scheduleHttpSync(): void {
    if (this.httpSyncThrottleTimer !== null) return;
    this.httpSyncThrottleTimer = window.setTimeout(() => {
      this.httpSyncThrottleTimer = null;
      void this.postHttpPresence();
    }, 220);
  }

  private async postHttpPresence(extraPayload?: {
    event?: 'create_wish' | 'trigger_bell';
    wishMessage?: string;
  }): Promise<void> {
    const selfVisitor = this.visitorsBySeat.get(this.selfSeat);
    const payload = {
      room: this.roomId,
      selfId: this.selfId,
      seat: this.selfSeat,
      name: selfVisitor?.name ?? '온천손님',
      house: selfVisitor?.house ?? 'ignis',
      focusTopic: selfVisitor?.focusTopic ?? '노곤노곤 반신욕 중',
      pose: selfVisitor?.pose ?? 'sitting',
      chairIndex: selfVisitor?.chairIndex ?? 7,
      x: selfVisitor?.x ?? 0,
      z: selfVisitor?.z ?? 3.2,
      yaw: selfVisitor?.yaw ?? Math.PI,
      lumosAt: selfVisitor?.lumosAt ?? null,
      bowAt: selfVisitor?.bowAt ?? null,
      focusUntil: selfVisitor?.focusUntil ?? null,
      ...extraPayload,
    };

    try {
      const res = await fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return;
      const packet = (await res.json()) as ExtendedSnapshotPacket;
      if (packet && packet.type === 'snapshot') {
        this.listeners.onConnectionStateChange(true, this.roomId);
        this.applySnapshotPacket(packet);
      }
    } catch {
      this.listeners.onConnectionStateChange(false, this.roomId);
    }
  }

  private applySnapshotPacket(packet: ExtendedSnapshotPacket): void {
    const prevSelfVisitor = this.visitorsBySeat.get(this.selfSeat);
    const seatChanged = this.selfSeat !== packet.selfSeat;
    this.selfId = packet.selfId;
    this.selfSeat = packet.selfSeat;

    this.visitorsBySeat.clear();
    const currentHumanSeats = new Set<number>();

    for (const v of packet.visitors) {
      if (!v.isResident) {
        currentHumanSeats.add(v.seat);
      }

      if (v.seat === this.selfSeat && prevSelfVisitor) {
        // 내 로컬 위치·포즈는 부드러운 조작을 위해 로컬 최신값 우선 유지
        this.visitorsBySeat.set(v.seat, {
          ...v,
          name: prevSelfVisitor.name,
          house: prevSelfVisitor.house,
          focusTopic: prevSelfVisitor.focusTopic,
          pose: prevSelfVisitor.pose,
          chairIndex: prevSelfVisitor.chairIndex,
          x: prevSelfVisitor.x,
          z: prevSelfVisitor.z,
          yaw: prevSelfVisitor.yaw,
          lumosAt: prevSelfVisitor.lumosAt,
          bowAt: prevSelfVisitor.bowAt,
          focusUntil: prevSelfVisitor.focusUntil,
        });
      } else {
        this.visitorsBySeat.set(v.seat, v);
        if (
          !v.isResident &&
          v.seat !== this.selfSeat &&
          !this.knownHumanSeats.has(v.seat)
        ) {
          this.knownHumanSeats.add(v.seat);
          this.listeners.onPeerJoined?.(v);
        }
        if (
          v.seat !== this.selfSeat &&
          v.lumosAt !== null &&
          this.lastKnownLumosBySeat.get(v.seat) !== v.lumosAt
        ) {
          this.lastKnownLumosBySeat.set(v.seat, v.lumosAt);
          this.listeners.onRemoteLumos(v);
        }
        if (
          v.seat !== this.selfSeat &&
          v.bowAt !== null &&
          v.bowAt !== undefined &&
          this.lastKnownBowBySeat.get(v.seat) !== v.bowAt
        ) {
          this.lastKnownBowBySeat.set(v.seat, v.bowAt);
          this.listeners.onRemoteBow?.(v);
        }
      }
    }

    for (const oldSeat of Array.from(this.knownHumanSeats)) {
      if (!currentHumanSeats.has(oldSeat)) {
        this.knownHumanSeats.delete(oldSeat);
      }
    }

    if (seatChanged) {
      this.listeners.onSelfSeatAssigned?.(this.selfSeat);
    }

    // 새 소원 유자 알림 감지
    if (Array.isArray(packet.wishes)) {
      for (const w of packet.wishes) {
        if (!this.knownWishIds.has(w.id)) {
          this.knownWishIds.add(w.id);
          if (Math.abs(Date.now() - w.createdAt) < 15000) {
            this.listeners.onWishCreated(w);
          }
        }
      }
      this.wishes = packet.wishes;
      this.listeners.onWishesUpdated(this.wishes);
    }

    // 대나무 시시오도시(낙수대) 울림 감지
    if (
      packet.lastBell &&
      packet.lastBell.id !== this.lastKnownBellId &&
      Math.abs(Date.now() - packet.lastBell.serverTime) < 12000
    ) {
      this.lastKnownBellId = packet.lastBell.id;
      this.listeners.onBellResonance(packet.lastBell.triggeredBy);
    }

    this.listeners.onVisitorsUpdated(this.getVisitors(), this.selfId);
  }

  private sendPacket(packet: ClientPacket): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(packet));
    }
  }

  private handleJsonMessage(raw: string): void {
    let packet: ServerJsonPacket;
    try {
      packet = JSON.parse(raw) as ServerJsonPacket;
    } catch {
      return;
    }

    if (packet.type === 'snapshot') {
      this.applySnapshotPacket(packet);
    } else if (packet.type === 'wish_created') {
      const exists = this.wishes.some((w) => w.id === packet.wish.id);
      if (!exists) {
        this.wishes.unshift(packet.wish);
        this.knownWishIds.add(packet.wish.id);
        this.listeners.onWishesUpdated(this.wishes);
        this.listeners.onWishCreated(packet.wish);
      }
    } else if (packet.type === 'bell_resonance') {
      this.listeners.onBellResonance(packet.triggeredBy);
    }
  }

  private handleBinaryDelta(buffer: ArrayBuffer): void {
    const delta = decodeArcnDeltaFrame(buffer);
    if (!delta) return;

    const profileMap = new Map<number, ScholarProfile>();
    for (const prof of delta.profiles) {
      profileMap.set(prof.seat, prof);
      const existing = this.visitorsBySeat.get(prof.seat);
      if (existing) {
        existing.id = prof.id;
        existing.name = prof.name;
        existing.house = prof.house;
        existing.focusTopic = prof.focusTopic;
        existing.isResident = prof.isResident;
      }
    }

    for (const removedSeat of delta.removedSeats) {
      this.visitorsBySeat.delete(removedSeat);
      this.lastKnownLumosBySeat.delete(removedSeat);
    }

    for (const state of delta.upserts) {
      const existing = this.visitorsBySeat.get(state.seat);
      const prof = profileMap.get(state.seat);

      const updated: ScholarVisitor = {
        id: existing?.id ?? prof?.id ?? `scholar-${state.seat}`,
        seat: state.seat,
        name: existing?.name ?? prof?.name ?? `온천손님 #${state.seat}`,
        house: existing?.house ?? prof?.house ?? 'ignis',
        focusTopic: existing?.focusTopic ?? prof?.focusTopic ?? '노곤노곤 반신욕 중',
        isResident: existing?.isResident ?? prof?.isResident ?? false,
        chairIndex: state.chairIndex,
        pose: state.pose,
        x: state.x,
        z: state.z,
        yaw: state.yaw,
        lumosAt: state.lumosAt,
        focusUntil: state.focusUntil,
      };

      this.visitorsBySeat.set(state.seat, updated);

      if (
        state.seat !== this.selfSeat &&
        state.lumosAt !== null &&
        this.lastKnownLumosBySeat.get(state.seat) !== state.lumosAt
      ) {
        this.lastKnownLumosBySeat.set(state.seat, state.lumosAt);
        this.listeners.onRemoteLumos(updated);
      }
    }

    this.listeners.onVisitorsUpdated(this.getVisitors(), this.selfId);
  }

  private seedFallbackState(): void {
    const now = Date.now();
    this.visitorsBySeat.clear();
    const residents = createResidentScholars(now);
    for (const r of residents) {
      this.visitorsBySeat.set(r.seat, r);
    }

    const slotIdx =
      MAIN_BATH_HUMAN_SLOTS[
        Math.abs(this.selfSeat - 7) % MAIN_BATH_HUMAN_SLOTS.length
      ] ?? 0;
    const slot = STUDY_CHAIR_SLOTS[slotIdx] ?? STUDY_CHAIR_SLOTS[0];

    this.visitorsBySeat.set(this.selfSeat, {
      id: this.selfId,
      seat: this.selfSeat,
      name: `온천손님 #${this.selfSeat}`,
      house: 'ignis',
      focusTopic: '노곤노곤 반신욕 중',
      isResident: false,
      chairIndex: slot.index,
      pose: 'sitting',
      x: slot.seatX,
      z: slot.seatZ,
      yaw: slot.facingYaw,
      lumosAt: null,
      focusUntil: null,
    });
    this.wishes = createInitialWishCandles(now);
    for (const w of this.wishes) {
      this.knownWishIds.add(w.id);
    }
  }

  private setupUnloadLeaveBeacon(): void {
    const sendLeave = (): void => {
      if (!this.usingHttpSync || typeof navigator.sendBeacon !== 'function') {
        return;
      }
      try {
        const blob = new Blob(
          [
            JSON.stringify({
              room: this.roomId,
              selfId: this.selfId,
              event: 'leave',
            }),
          ],
          { type: 'application/json' }
        );
        navigator.sendBeacon('/api/presence', blob);
      } catch {
        // 무시
      }
    };
    window.addEventListener('pagehide', sendLeave);
    window.addEventListener('beforeunload', sendLeave);
  }

  private cleanupSocket(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHttpPresenceSync();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private setupLocalBroadcastChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return;
    this.broadcastChannel = new BroadcastChannel('arcane-hall-sync-v1');
    this.broadcastChannel.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as
        | { type: 'peer_visitor'; room: string; visitor: ScholarVisitor }
        | undefined;
      if (!data || data.type !== 'peer_visitor' || data.room !== this.roomId) {
        return;
      }
      if (data.visitor.seat === this.selfSeat) return;
      this.visitorsBySeat.set(data.visitor.seat, data.visitor);
      this.listeners.onVisitorsUpdated(this.getVisitors(), this.selfId);
    });
  }

  private broadcastLocalState(visitor: ScholarVisitor): void {
    if (!this.broadcastChannel) return;
    this.broadcastChannel.postMessage({
      type: 'peer_visitor',
      room: this.roomId,
      visitor,
    });
  }
}
