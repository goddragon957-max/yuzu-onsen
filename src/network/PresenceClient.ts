import { decodeArcnDeltaFrame } from '@/network/wireCodec';
import {
  createInitialWishCandles,
  createResidentScholars,
  sanitizeRoomId,
} from '@/scene/hallLayout';
import type {
  ArcaneHouseId,
  ClientPacket,
  ScholarDynamicState,
  ScholarProfile,
  ScholarVisitor,
  ServerJsonPacket,
  WishCandle,
} from '@/types/protocol';

export interface PresenceListeners {
  onVisitorsUpdated: (visitors: ScholarVisitor[], selfId: string) => void;
  onWishesUpdated: (wishes: WishCandle[]) => void;
  onWishCreated: (wish: WishCandle) => void;
  onBellResonance: (triggeredBy: string) => void;
  onConnectionStateChange: (connected: boolean, roomId: string) => void;
  onRemoteLumos: (visitor: ScholarVisitor) => void;
}

export class PresenceClient {
  private ws: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private roomId: string;
  private selfId = `scholar-local-${Math.random().toString(36).slice(2, 6)}`;
  private selfSeat = Math.floor(20 + Math.random() * 70);
  private visitorsBySeat = new Map<number, ScholarVisitor>();
  private wishes: WishCandle[] = [];
  private listeners: PresenceListeners;
  private reconnectTimer: number | null = null;
  private lastKnownLumosBySeat = new Map<number, number>();

  constructor(initialRoomId: string, listeners: PresenceListeners) {
    this.roomId = sanitizeRoomId(initialRoomId);
    this.listeners = listeners;
    this.seedFallbackState();
    this.setupLocalBroadcastChannel();
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

    const envWsBase = (
      import.meta as unknown as { env?: Record<string, string | undefined> }
    ).env?.VITE_WS_URL;
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
        this.listeners.onConnectionStateChange(true, this.roomId);
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
        this.listeners.onConnectionStateChange(false, this.roomId);
        this.scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        this.listeners.onConnectionStateChange(false, this.roomId);
      });
    } catch {
      this.listeners.onConnectionStateChange(false, this.roomId);
    }
  }

  public switchRoom(nextRoomId: string): void {
    const clean = sanitizeRoomId(nextRoomId);
    if (clean === this.roomId && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    this.roomId = clean;
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.roomId);
    window.history.replaceState({}, '', url.toString());
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
      selfVisitor.focusUntil = state.focusUntil;
      this.listeners.onVisitorsUpdated(this.getVisitors(), this.selfId);
      this.broadcastLocalState(selfVisitor);
    }

    this.sendPacket({
      type: 'state',
      pose: state.pose,
      chairIndex: state.chairIndex,
      x: state.x,
      z: state.z,
      yaw: state.yaw,
      lumosAt: state.lumosAt,
      focusUntil: state.focusUntil,
    });
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

    this.sendPacket({
      type: 'profile',
      name,
      house,
      focusTopic,
    });
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

    // 오프라인 폴백 모드에서도 즉시 소원 유자 생성
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.6 + Math.random() * 2.1;
    const localWish: WishCandle = {
      id: `wish-local-${Date.now()}`,
      author,
      house,
      message,
      createdAt: Date.now(),
      x: Number((Math.cos(angle) * radius * 1.15).toFixed(2)),
      y: 0.16,
      z: Number((Math.sin(angle) * radius * 0.85 + 0.3).toFixed(2)),
    };
    this.wishes.unshift(localWish);
    this.listeners.onWishesUpdated(this.wishes);
    this.listeners.onWishCreated(localWish);
  }

  public sendTriggerBell(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendPacket({ type: 'trigger_bell' });
      return;
    }
    this.listeners.onBellResonance('수석 시계탑지기');
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
      this.selfId = packet.selfId;
      this.selfSeat = packet.selfSeat;
      this.visitorsBySeat.clear();
      this.lastKnownLumosBySeat.clear();

      for (const v of packet.visitors) {
        this.visitorsBySeat.set(v.seat, v);
        if (v.lumosAt !== null) {
          this.lastKnownLumosBySeat.set(v.seat, v.lumosAt);
        }
      }
      this.wishes = packet.wishes;
      this.listeners.onVisitorsUpdated(this.getVisitors(), this.selfId);
      this.listeners.onWishesUpdated(this.wishes);
    } else if (packet.type === 'wish_created') {
      const exists = this.wishes.some((w) => w.id === packet.wish.id);
      if (!exists) {
        this.wishes.unshift(packet.wish);
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
        name: existing?.name ?? prof?.name ?? `침묵의 학도 #${state.seat}`,
        house: existing?.house ?? prof?.house ?? 'astra',
        focusTopic: existing?.focusTopic ?? prof?.focusTopic ?? '자율 열람 중',
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
    const residents = createResidentScholars(now);
    for (const r of residents) {
      this.visitorsBySeat.set(r.seat, r);
    }
    this.visitorsBySeat.set(this.selfSeat, {
      id: this.selfId,
      seat: this.selfSeat,
      name: '온천손님 #99',
      house: 'ignis',
      focusTopic: '노곤노곤 반신욕 중',
      isResident: false,
      chairIndex: -1,
      pose: 'standing',
      x: 0,
      z: 4.5,
      yaw: Math.PI,
      lumosAt: null,
      focusUntil: null,
    });
    this.wishes = createInitialWishCandles(now);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3500);
  }

  private cleanupSocket(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private setupLocalBroadcastChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return;
    this.broadcastChannel = new BroadcastChannel('arcane-hall-sync-v1');
    this.broadcastChannel.addEventListener('message', (event: MessageEvent) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
      const data = event.data as
        | { type: 'peer_visitor'; room: string; visitor: ScholarVisitor }
        | undefined;
      if (!data || data.type !== 'peer_visitor' || data.room !== this.roomId) {
        return;
      }
      this.visitorsBySeat.set(data.visitor.seat, data.visitor);
      this.listeners.onVisitorsUpdated(this.getVisitors(), this.selfId);
    });
  }

  private broadcastLocalState(visitor: ScholarVisitor): void {
    if (!this.broadcastChannel) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.broadcastChannel.postMessage({
      type: 'peer_visitor',
      room: this.roomId,
      visitor,
    });
  }
}
