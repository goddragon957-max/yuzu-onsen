import { ArcaneAudioEngine } from '@/audio/ArcaneAudioEngine';
import { PresenceClient } from '@/network/PresenceClient';
import {
  ArcaneHallScene,
  type CameraPresetId,
} from '@/scene/ArcaneHallScene';
import {
  type BathZoneId,
  buildDefaultRoomSummaries,
  HALL_ROOMS,
  sanitizeRoomId,
} from '@/scene/hallLayout';
import type { SnackItemId } from '@/scene/ScholarAvatarMesh';
import '@/styles/main.css';
import {
  ARCANE_HOUSES,
  type ArcaneHouseId,
  type RoomSummary,
  type ScholarVisitor,
  type WeatherMood,
  type WishCandle,
} from '@/types/protocol';

const STORAGE_KEYS = {
  SPLASHES: 'onsen.splashCount.v2',
  STAY_SEC: 'onsen.staySeconds.v2',
  PROFILE: 'onsen.batherProfile.v2',
} as const;

interface StoredProfile {
  name: string;
  house: ArcaneHouseId;
  focusTopic: string;
}

const WEATHER_CYCLE: ReadonlyArray<{
  mood: WeatherMood;
  buttonLabel: string;
  subLabel: string;
}> = [
  {
    mood: 'starlight',
    buttonLabel: '❄️ 풍경: 겨울 낮 설경',
    subLabel: '바위 노천 온천 · 낮 설경',
  },
  {
    mood: 'dawn',
    buttonLabel: '🌸 풍경: 봄 벚꽃 온천',
    subLabel: '분홍 꽃잎 노천탕 · 봄날',
  },
  {
    mood: 'rainstorm',
    buttonLabel: '🍁 풍경: 노을 단풍 온천',
    subLabel: '따스한 석양빛 · 가을 단풍',
  },
  {
    mood: 'aurora',
    buttonLabel: '🏮 풍경: 별밤 초롱불 온천',
    subLabel: '석등 불빛이 비치는 고요한 밤',
  },
];

const ZONE_META: Record<
  BathZoneId,
  { title: string; temp: string; tempLabel: string }
> = {
  main_bath: {
    title: '중앙 유자 대노천탕',
    temp: '41.2',
    tempLabel: '대노천탕 수온',
  },
  hinoki_bath: {
    title: '동쪽 히노끼 편백탕',
    temp: '40.5',
    tempLabel: '편백탕 수온',
  },
  footbath: {
    title: '외기욕 쉼터 & 모닥불',
    temp: '18.4',
    tempLabel: '솔숲 외기 온도',
  },
  pavilion: {
    title: '온천 본관 툇마루 & 매점',
    temp: '23.0',
    tempLabel: '툇마루 온도',
  },
};

const SNACK_LABELS: Record<Exclude<SnackItemId, 'none'>, string> = {
  sikhye: '살얼음 식혜',
  banana_milk: '뚱바 바나나우유',
  egg: '맥반석 구운란',
  yuzu_tea: '따뜻한 유자차',
};

function loadNumber(key: string): number {
  const raw = window.localStorage.getItem(key);
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function loadProfile(): StoredProfile {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.PROFILE);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredProfile>;
      if (parsed.name && parsed.house && ARCANE_HOUSES[parsed.house]) {
        return {
          name: parsed.name,
          house: parsed.house,
          focusTopic: parsed.focusTopic ?? '노곤노곤 반신욕 중',
        };
      }
    }
  } catch {
    // ignore storage errors
  }
  const randomNo = Math.floor(10 + Math.random() * 89);
  return {
    name: `온천손님 #${randomNo}`,
    house: 'ignis',
    focusTopic: '노곤노곤 반신욕 중',
  };
}

function saveProfile(profile: StoredProfile): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile));
  } catch {
    // ignore storage errors
  }
}

function formatStayDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function bootstrapOnsenApp(): void {
  const sceneRoot = document.getElementById('scene-root');
  if (!sceneRoot) return;

  const urlParams = new URLSearchParams(window.location.search);
  const initialRoomId = sanitizeRoomId(urlParams.get('room'));

  let splashCount = loadNumber(STORAGE_KEYS.SPLASHES);
  let staySeconds = loadNumber(STORAGE_KEYS.STAY_SEC);
  let profile = loadProfile();
  let weatherIdx = 0;
  let focusEndTime: number | null = null;
  let currentHeldSnack: SnackItemId = 'none';
  let allRoomsCache: RoomSummary[] = buildDefaultRoomSummaries();
  let toastTimeout: number | null = null;

  const audio = new ArcaneAudioEngine();

  // DOM Elements
  const roomZoneTitleEl = document.getElementById('room-zone-title');
  const roomZoneSubEl = document.getElementById('room-zone-sub');
  const connDotEl = document.getElementById('conn-dot');
  const channelLabelEl = document.getElementById('channel-label');
  const pplHereEl = document.getElementById('ppl-here');
  const pplHumanEl = document.getElementById('ppl-human');
  const onlineGuestsListEl = document.getElementById('online-guests-list');
  const hudNoteEl = document.getElementById('hud-note');

  const tempValEl = document.getElementById('temp-val');
  const tempLabelEl = document.getElementById('temp-label');
  const stayTimerEl = document.getElementById('stay-timer');
  const splashCountEl = document.getElementById('splash-count');
  const focusStatusTextEl = document.getElementById('focus-status-text');
  const heatFillEl = document.getElementById('heat-fill');
  const toastEl = document.getElementById('toast');

  const sitActionLabelEl = document.getElementById('sit-action-label');
  const btnActSplash = document.getElementById('btn-act-splash');
  const btnActSit = document.getElementById('btn-act-sit');
  const btnActBow = document.getElementById('btn-act-bow');
  const btnActSnack = document.getElementById('btn-act-snack');
  const btnActWish = document.getElementById('btn-act-wish');
  const btnActHat = document.getElementById('btn-act-hat');
  const btnActSpace = document.getElementById('btn-act-space');
  const btnActMore = document.getElementById('btn-act-more');

  const trayHat = document.getElementById('tray-hat');
  const traySpace = document.getElementById('tray-space');
  const traySnack = document.getElementById('tray-snack');
  const trayWish = document.getElementById('tray-wish');
  const trayMore = document.getElementById('tray-more');

  const entryOverlay = document.getElementById('entry-overlay');
  const btnEnterOnsen = document.getElementById('btn-enter-onsen');
  const modalRooms = document.getElementById('modal-rooms');
  const btnOpenAllRooms = document.getElementById('btn-open-all-rooms');
  const btnCloseRooms = document.getElementById('btn-close-rooms');
  const inputRoomSearch = document.getElementById(
    'input-room-search'
  ) as HTMLInputElement | null;
  const roomListContainer = document.getElementById('room-list-container');
  const quickRoomListEl = document.getElementById('quick-room-list');

  const formProfileInline = document.getElementById(
    'form-profile-inline'
  ) as HTMLFormElement | null;
  const inputProfileName = document.getElementById(
    'input-profile-name'
  ) as HTMLInputElement | null;
  const inputProfileTopic = document.getElementById(
    'input-profile-topic'
  ) as HTMLInputElement | null;

  const formWish = document.getElementById(
    'form-wish'
  ) as HTMLFormElement | null;
  const inputWishMessage = document.getElementById(
    'input-wish-message'
  ) as HTMLInputElement | null;
  const wishCountLabel = document.getElementById('wish-count-label');
  const wishFeedList = document.getElementById('wish-feed-list');

  const btnUseSnack = document.getElementById('btn-use-snack');
  const btnDropSnack = document.getElementById('btn-drop-snack');
  const btnWeatherCycle = document.getElementById('btn-weather-cycle');
  const btnFocusTimer = document.getElementById('btn-focus-timer');
  const btnBellRing = document.getElementById('btn-bell-ring');
  const btnAudioMute = document.getElementById('btn-audio-mute');
  const sliderBgm = document.getElementById(
    'slider-bgm'
  ) as HTMLInputElement | null;
  const sliderWater = document.getElementById(
    'slider-water'
  ) as HTMLInputElement | null;
  const sliderWind = document.getElementById(
    'slider-wind'
  ) as HTMLInputElement | null;
  const sliderFire = document.getElementById(
    'slider-fire'
  ) as HTMLInputElement | null;

  function showToast(message: string, durationMs = 2800): void {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimeout !== null) {
      window.clearTimeout(toastTimeout);
    }
    toastTimeout = window.setTimeout(() => {
      toastEl.hidden = true;
    }, durationMs);
  }

  function updateZoneHud(zoneId: BathZoneId, customZoneLabel?: string): void {
    const meta = ZONE_META[zoneId] ?? ZONE_META.main_bath;
    if (roomZoneTitleEl) {
      roomZoneTitleEl.textContent = customZoneLabel ?? meta.title;
    }
    if (tempValEl) {
      tempValEl.textContent = meta.temp;
    }
    if (tempLabelEl) {
      tempLabelEl.textContent = meta.tempLabel;
    }

    document.querySelectorAll<HTMLButtonElement>('[data-quick-zone]').forEach((btn) => {
      const z = btn.dataset.quickZone as BathZoneId | undefined;
      btn.classList.toggle('now', z === zoneId);
    });

    document.querySelectorAll<HTMLButtonElement>('[data-move-zone]').forEach((btn) => {
      const z = btn.dataset.moveZone as BathZoneId | undefined;
      btn.setAttribute('aria-current', z === zoneId ? 'true' : 'false');
    });
  }

  function syncHatChipsUI(selectedHouse: ArcaneHouseId): void {
    document.querySelectorAll<HTMLButtonElement>('[data-hat]').forEach((btn) => {
      const hat = btn.dataset.hat as ArcaneHouseId | undefined;
      btn.setAttribute('aria-checked', hat === selectedHouse ? 'true' : 'false');
    });
  }

  // 초기 프로필 UI 반영
  syncHatChipsUI(profile.house);
  if (inputProfileName) inputProfileName.value = profile.name;
  if (inputProfileTopic) inputProfileTopic.value = profile.focusTopic;
  if (splashCountEl) splashCountEl.textContent = String(splashCount);
  if (stayTimerEl) stayTimerEl.textContent = formatStayDuration(staySeconds);

  // 3D 씬 초기화
  let presence: PresenceClient;

  const hallScene = new ArcaneHallScene(sceneRoot, {
    onSelfStateChanged: (state) => {
      presence?.sendState(state);
      if (sitActionLabelEl) {
        sitActionLabelEl.textContent =
          state.pose === 'sitting' ? '일어서기' : '입수/앉기';
      }
    },
    onWishCandleSelected: (wish) => {
      hallScene.focusOnWorldPoint(wish.x, wish.y, wish.z);
      const houseMeta = ARCANE_HOUSES[wish.house] ?? ARCANE_HOUSES.ignis;
      showToast(
        `🍊 ${wish.author} (${houseMeta.nameKo}): "${wish.message}"`,
        4200
      );
    },
    onSeatChanged: (_chairIndex, zoneName) => {
      let matchedZone: BathZoneId = 'main_bath';
      if (zoneName.includes('히노끼') || zoneName.includes('편백')) {
        matchedZone = 'hinoki_bath';
      } else if (zoneName.includes('외기욕') || zoneName.includes('쉼터') || zoneName.includes('족욕')) {
        matchedZone = 'footbath';
      } else if (zoneName.includes('툇마루') || zoneName.includes('본관') || zoneName.includes('다실')) {
        matchedZone = 'pavilion';
      }
      updateZoneHud(matchedZone, zoneName);
      if (sitActionLabelEl) {
        sitActionLabelEl.textContent = '일어서기';
      }
    },
    onToastMessage: (msg) => {
      showToast(msg);
    },
  });

  function renderWishFeed(wishes: WishCandle[]): void {
    if (wishCountLabel) {
      wishCountLabel.textContent = String(wishes.length);
    }
    if (!wishFeedList) return;
    wishFeedList.innerHTML = '';

    for (const wish of wishes.slice(0, 30)) {
      const item = document.createElement('div');
      item.className = 'wish-item-card';
      const head = document.createElement('div');
      head.className = 'wish-item-head';
      const houseMeta = ARCANE_HOUSES[wish.house] ?? ARCANE_HOUSES.ignis;
      head.innerHTML = `<span>${wish.author}</span><span>${houseMeta.nameKo}</span>`;

      const msg = document.createElement('div');
      msg.className = 'wish-item-msg';
      msg.textContent = wish.message;

      item.appendChild(head);
      item.appendChild(msg);
      item.addEventListener('click', () => {
        hallScene.focusOnWorldPoint(wish.x, wish.y, wish.z);
        showToast(`🍊 "${wish.message}" — ${wish.author}`);
      });
      wishFeedList.appendChild(item);
    }
  }

  function updateRoomHeaderUI(roomId: string, visitors: ScholarVisitor[]): void {
    const roomNum = Number.parseInt(roomId.replace('hall-', ''), 10) || 1;
    if (channelLabelEl) {
      channelLabelEl.textContent = `제${roomNum}온천 · `;
    }
    const totalCount = visitors.length;
    const humanVisitors = visitors.filter((v) => !v.isResident);
    const humanCount = Math.max(1, humanVisitors.length);
    if (pplHereEl) pplHereEl.textContent = String(totalCount);
    if (pplHumanEl) pplHumanEl.textContent = String(humanCount);

    if (onlineGuestsListEl) {
      onlineGuestsListEl.innerHTML = '';
      const selfSeat = presence?.getSelfSeat();
      const sortedHumans = [...humanVisitors].sort((a, b) => {
        if (a.seat === selfSeat) return -1;
        if (b.seat === selfSeat) return 1;
        return a.seat - b.seat;
      });

      for (const guest of sortedHumans) {
        const isMe = guest.seat === selfSeat;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = isMe ? 'guest-pill self' : 'guest-pill';
        btn.title = isMe
          ? '내 캐릭터 시점으로 이동'
          : `${guest.name}님 위치로 카메라 이동`;
        btn.textContent = isMe ? `🟢 나(${guest.name})` : `🟢 ${guest.name}`;
        btn.addEventListener('click', () => {
          hallScene.focusOnWorldPoint(guest.x, 0.35, guest.z);
          showToast(
            isMe
              ? `내 자리(${guest.name})를 바라봅니다`
              : `👀 ${guest.name}님의 자리를 바라봅니다 (${guest.focusTopic})`
          );
        });
        onlineGuestsListEl.appendChild(btn);
      }
    }
  }

  presence = new PresenceClient(initialRoomId, {
    onVisitorsUpdated: (visitors) => {
      hallScene.syncVisitors(visitors, presence.getSelfSeat());
      updateRoomHeaderUI(presence.getRoomId(), visitors);
    },
    onWishesUpdated: (wishes) => {
      hallScene.syncWishes(wishes);
      renderWishFeed(wishes);
    },
    onWishCreated: (wish) => {
      hallScene.addWishCandleMesh(wish);
      showToast(`🍊 ${wish.author}님이 따뜻한 온천수에 소원 유자를 띄웠어요`);
    },
    onBellResonance: (triggeredBy) => {
      hallScene.triggerBellResonanceWave();
      audio.playClocktowerResonance();
      showToast(
        `🎋 ${triggeredBy}님이 대나무 낙수대(시시오도시)를 울렸어요 · 맑은 물소리가 퍼집니다`
      );
    },
    onConnectionStateChange: (connected, roomId) => {
      if (connDotEl) {
        connDotEl.classList.toggle('online', connected);
      }
      if (hudNoteEl) {
        hudNoteEl.textContent = connected
          ? '실시간 온천 채널에 연결되어 있어요. 위 손님 태그를 누르면 해당 손님을 바라봅니다.'
          : '조용한 개인 온천 모드로 카피바라·온천 고양이와 함께 쉬고 있어요.';
      }
      updateRoomHeaderUI(roomId, presence.getVisitors());
      renderQuickRooms();
    },
    onRemoteLumos: (visitor) => {
      audio.playLumosChime(true);
      showToast(`💧 ${visitor.name}님이 온천수를 끼얹으며 온기를 나눴어요`);
    },
    onSelfSeatAssigned: (seat) => {
      hallScene.setSelfIdentity(seat);
    },
    onPeerJoined: (visitor) => {
      audio.playLumosChime(true);
      showToast(`♨️ ${visitor.name}님이 유자 노천탕에 들어오셨어요!`);
    },
  });

  // 초기 스냅샷 동기화 및 프로필 전송
  hallScene.setSelfIdentity(presence.getSelfSeat());
  presence.sendProfile(profile.name, profile.house, profile.focusTopic);
  hallScene.syncVisitors(presence.getVisitors(), presence.getSelfSeat());
  hallScene.syncWishes(presence.getWishes());
  renderWishFeed(presence.getWishes());
  updateRoomHeaderUI(presence.getRoomId(), presence.getVisitors());
  presence.connect();

  // ── 팝업 트레이 토글 관리 ──
  const trayPairs: ReadonlyArray<{
    btn: HTMLElement | null;
    tray: HTMLElement | null;
  }> = [
    { btn: btnActHat, tray: trayHat },
    { btn: btnActSpace, tray: traySpace },
    { btn: btnActSnack, tray: traySnack },
    { btn: btnActWish, tray: trayWish },
    { btn: btnActMore, tray: trayMore },
  ];

  function closeAllTrays(): void {
    for (const pair of trayPairs) {
      if (pair.tray) pair.tray.hidden = true;
      if (pair.btn) pair.btn.setAttribute('aria-expanded', 'false');
    }
  }

  function toggleTray(targetTray: HTMLElement | null, targetBtn: HTMLElement | null): void {
    if (!targetTray || !targetBtn) return;
    const willOpen = targetTray.hidden;
    closeAllTrays();
    if (willOpen) {
      targetTray.hidden = false;
      targetBtn.setAttribute('aria-expanded', 'true');
    }
  }

  btnActHat?.addEventListener('click', () => toggleTray(trayHat, btnActHat));
  btnActSpace?.addEventListener('click', () => {
    renderQuickRooms();
    toggleTray(traySpace, btnActSpace);
  });
  btnActSnack?.addEventListener('click', () => toggleTray(traySnack, btnActSnack));
  btnActWish?.addEventListener('click', () => toggleTray(trayWish, btnActWish));
  btnActMore?.addEventListener('click', () => toggleTray(trayMore, btnActMore));

  // 캔버스 클릭 시 열려있는 트레이 자동 닫기
  sceneRoot.addEventListener('pointerdown', () => {
    closeAllTrays();
  });

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeAllTrays();
      if (modalRooms) modalRooms.hidden = true;
    }
    const activeTag = document.activeElement?.tagName.toLowerCase();
    if (activeTag === 'input' || activeTag === 'textarea') return;
    if (e.code === 'Space') {
      e.preventDefault();
      triggerSplashAction();
    }
  });

  // ── 첫 입장 웰컴 오버레이 제어 ──
  btnEnterOnsen?.addEventListener('click', () => {
    if (entryOverlay) {
      entryOverlay.hidden = true;
    }
    void audio.unlock();
    audio.playPageTurn();
    const hatMeta = ARCANE_HOUSES[profile.house];
    showToast(`${hatMeta.nameKo} 아이템을 얹고 노천탕에 들어왔어요`);
  });

  // ── 모자(머리 위 아이템) 선택 칩 이벤트 (입장 카드 & 모자 트레이 공통) ──
  document.querySelectorAll<HTMLButtonElement>('[data-hat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const chosenHat = btn.dataset.hat as ArcaneHouseId | undefined;
      if (!chosenHat || !ARCANE_HOUSES[chosenHat]) return;
      profile = { ...profile, house: chosenHat };
      saveProfile(profile);
      syncHatChipsUI(chosenHat);
      presence.sendProfile(profile.name, profile.house, profile.focusTopic);
      audio.playPageTurn();
      showToast(`머리 위 아이템을 [${ARCANE_HOUSES[chosenHat].nameKo}](으)로 바꿨어요`);
    });
  });

  // ── 인라인 닉네임 / 상태 메시지 변경 폼 ──
  formProfileInline?.addEventListener('submit', (e: SubmitEvent) => {
    e.preventDefault();
    const nextName = inputProfileName?.value.trim() || profile.name;
    const nextTopic = inputProfileTopic?.value.trim() || '노곤노곤 반신욕 중';
    profile = {
      ...profile,
      name: nextName.slice(0, 16),
      focusTopic: nextTopic.slice(0, 24),
    };
    saveProfile(profile);
    presence.sendProfile(profile.name, profile.house, profile.focusTopic);
    closeAllTrays();
    showToast(`이름표를 [${profile.name} · ${profile.focusTopic}](으)로 변경했어요`);
  });

  // ── 1. 바가지로 물 끼얹기 액션 ──
  function triggerSplashAction(): void {
    splashCount += 1;
    window.localStorage.setItem(STORAGE_KEYS.SPLASHES, String(splashCount));
    if (splashCountEl) splashCountEl.textContent = String(splashCount);

    hallScene.triggerSelfLumos();
    audio.playPageTurn();

    // 온기 게이지 살짝 상승
    const heatPercent = Math.min(100, 42 + (splashCount % 12) * 5);
    if (heatFillEl) heatFillEl.style.width = `${heatPercent}%`;
    showToast('🪣 편백 바가지로 따뜻한 유자 온천수를 끼얹었어요');
  }

  btnActSplash?.addEventListener('click', () => {
    triggerSplashAction();
  });

  // ── 2. 앉기/입수 ↔ 일어서기 액션 ──
  btnActSit?.addEventListener('click', () => {
    const msg = hallScene.toggleSitOrStand();
    const pose = hallScene.getSelfPose();
    if (sitActionLabelEl) {
      sitActionLabelEl.textContent = pose === 'sitting' ? '일어서기' : '입수/앉기';
    }
    audio.playPageTurn();
    showToast(msg);
  });

  // ── 3. 가볍게 목례(인사하기) 액션 ──
  btnActBow?.addEventListener('click', () => {
    hallScene.triggerSelfBow();
    hallScene.triggerSelfLumos();
    audio.playLumosChime(false);
    showToast('🙇 주변 온천 손님들에게 가볍게 목례를 건넸어요');
  });

  // ── 4. 구역 빠른 이동 (우측 상단 .sets & 공간 이동 트레이) ──
  document.querySelectorAll<HTMLButtonElement>('[data-quick-zone]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const zoneId = btn.dataset.quickZone as BathZoneId | undefined;
      if (!zoneId) return;
      hallScene.moveToZone(zoneId);
      updateZoneHud(zoneId);
      audio.playPageTurn();
      showToast(`${ZONE_META[zoneId].title}(으)로 자리를 옮겼어요`);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-move-zone]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const zoneId = btn.dataset.moveZone as BathZoneId | undefined;
      if (!zoneId) return;
      hallScene.moveToZone(zoneId);
      updateZoneHud(zoneId);
      document
        .querySelectorAll<HTMLButtonElement>('[data-cam-only]')
        .forEach((b) => b.setAttribute('aria-current', 'false'));
      closeAllTrays();
      audio.playPageTurn();
      showToast(`${ZONE_META[zoneId].title}(으)로 이동했어요`);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-cam-only]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.camOnly as CameraPresetId | undefined;
      if (!preset) return;
      hallScene.setCameraPreset(preset);
      btn.setAttribute('aria-current', 'true');
      closeAllTrays();
      showToast('온천 마을 전체 풍경을 조망합니다 (클릭·이동 시 내 캐릭터 시점으로 복귀)');
    });
  });

  // ── 5. 온천 매점 간식 주문 / 마시기 / 내려놓기 ──
  document.querySelectorAll<HTMLButtonElement>('[data-snack]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const snackId = btn.dataset.snack as Exclude<SnackItemId, 'none'> | undefined;
      if (!snackId) return;
      currentHeldSnack = snackId;
      hallScene.setSelfSnack(snackId);
      document.querySelectorAll<HTMLButtonElement>('[data-snack]').forEach((b) => {
        b.classList.toggle('active', b.dataset.snack === snackId);
      });
      audio.playPageTurn();
      showToast(`🥤 오른손에 [${SNACK_LABELS[snackId]}] 아이템을 들었어요!`);
    });
  });

  btnUseSnack?.addEventListener('click', () => {
    if (currentHeldSnack === 'none') {
      showToast('먼저 위 메뉴에서 손에 들 간식을 골라주세요!');
      return;
    }
    const ok = hallScene.triggerSelfUseSnack();
    if (ok) {
      audio.playLumosChime(false);
      showToast(`😋 시원하고 달콤한 ${SNACK_LABELS[currentHeldSnack]} 한 모금! 노곤함이 풀려요`);
      closeAllTrays();
    }
  });

  btnDropSnack?.addEventListener('click', () => {
    currentHeldSnack = 'none';
    hallScene.setSelfSnack('none');
    document
      .querySelectorAll<HTMLButtonElement>('[data-snack]')
      .forEach((b) => b.classList.remove('active'));
    showToast('손에 들고 있던 간식을 내려놓았어요');
  });

  // ── 6. 소원 유자 띄우기 ──
  formWish?.addEventListener('submit', (e: SubmitEvent) => {
    e.preventDefault();
    const msg = inputWishMessage?.value.trim();
    if (!msg) return;
    presence.sendCreateWish(profile.name, profile.house, msg.slice(0, 80));
    if (inputWishMessage) inputWishMessage.value = '';
    audio.playLumosChime(false);
  });

  // ── 7. 더보기 트레이: 계절·시간대 전환 / 30분 집중 타이머 / 낙수대 / 사운드 믹서 ──
  btnWeatherCycle?.addEventListener('click', () => {
    weatherIdx = (weatherIdx + 1) % WEATHER_CYCLE.length;
    const nextWeather = WEATHER_CYCLE[weatherIdx];
    hallScene.setWeatherMood(nextWeather.mood);
    audio.setWeatherMood(nextWeather.mood);
    if (btnWeatherCycle) {
      btnWeatherCycle.innerHTML = `<span>${nextWeather.buttonLabel}</span>`;
    }
    if (roomZoneSubEl) {
      roomZoneSubEl.textContent = nextWeather.subLabel;
    }
    showToast(`${nextWeather.buttonLabel.replace('풍경: ', '')} 분위기로 전환되었어요`);
  });

  btnFocusTimer?.addEventListener('click', () => {
    if (focusEndTime !== null && focusEndTime > Date.now()) {
      focusEndTime = null;
      hallScene.setSelfFocusUntil(null);
      if (focusStatusTextEl) focusStatusTextEl.textContent = '노곤노곤';
      if (btnFocusTimer) {
        btnFocusTimer.innerHTML = '<span>⏱️ 30분 반신욕 집중 타이머</span>';
      }
      showToast('반신욕 집중 타이머를 종료했어요');
    } else {
      focusEndTime = Date.now() + 30 * 60 * 1000;
      hallScene.setSelfFocusUntil(focusEndTime);
      if (btnFocusTimer) {
        btnFocusTimer.innerHTML = '<span>⏱️ 집중 타이머 진행 중 (클릭 시 해제)</span>';
      }
      audio.playLumosChime(false);
      showToast('⏱️ 30분 반신욕 집중 타이머를 시작했어요! 내 자리에 미니 유자 트레이가 놓입니다');
    }
  });

  btnBellRing?.addEventListener('click', () => {
    presence.sendTriggerBell();
    closeAllTrays();
  });

  btnAudioMute?.addEventListener('click', () => {
    const muted = audio.toggleMute();
    if (btnAudioMute) {
      btnAudioMute.innerHTML = muted
        ? '<span>🔇 캐롤 & 자연 소리: 꺼짐</span>'
        : '<span>🔊 캐롤 & 자연 소리: 켜짐</span>';
    }
    showToast(
      muted
        ? '겨울 캐롤 BGM과 자연의 소리를 음소거했어요'
        : '겨울 캐롤 BGM과 자연의 소리를 다시 켰어요'
    );
  });

  sliderBgm?.addEventListener('input', () => {
    void audio.unlock();
    audio.setLevels({ bgm: Number(sliderBgm.value) / 100 });
  });
  sliderWater?.addEventListener('input', () => {
    audio.setLevels({ water: Number(sliderWater.value) / 100 });
  });
  sliderWind?.addEventListener('input', () => {
    audio.setLevels({ wind: Number(sliderWind.value) / 100 });
  });
  sliderFire?.addEventListener('input', () => {
    audio.setLevels({ fire: Number(sliderFire.value) / 100 });
  });

  // ── 8. 채널 목록 렌더링 (공간 트레이 5개 빠른 채널 + 100개 전체 모달) ──
  function renderQuickRooms(): void {
    if (!quickRoomListEl) return;
    quickRoomListEl.innerHTML = '';
    const activeRoomId = presence.getRoomId();
    const topFive = allRoomsCache.slice(0, 5);

    for (const room of topFive) {
      const num = Number.parseInt(room.id.replace('hall-', ''), 10) || 1;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'roomBtn';
      const isCurrent = room.id === activeRoomId;
      btn.setAttribute('aria-current', isCurrent ? 'true' : 'false');
      const occ = isCurrent ? presence.getVisitors().length : room.occupancy;
      btn.innerHTML = `<b>${num}탕</b><small>${occ}명</small>`;
      btn.addEventListener('click', () => {
        if (room.id !== presence.getRoomId()) {
          presence.switchRoom(room.id);
          closeAllTrays();
          showToast(`제${num}온천 채널로 이동했어요`);
        }
      });
      quickRoomListEl.appendChild(btn);
    }
  }

  function renderAllRoomsModal(filterQuery = ''): void {
    if (!roomListContainer) return;
    roomListContainer.innerHTML = '';
    const q = filterQuery.trim().toLowerCase();
    const activeRoomId = presence.getRoomId();

    const filtered = allRoomsCache.filter(
      (r) =>
        !q ||
        r.id.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.subtitle.toLowerCase().includes(q)
    );

    for (const room of filtered) {
      const num = Number.parseInt(room.id.replace('hall-', ''), 10) || 1;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'roomBtn';
      const isCurrent = room.id === activeRoomId;
      btn.setAttribute('aria-current', isCurrent ? 'true' : 'false');
      const occ = isCurrent ? presence.getVisitors().length : room.occupancy;
      const shortTheme =
        HALL_ROOMS[num - 1]?.name.split('·')[1]?.trim() ?? '유자 온천';
      btn.innerHTML = `<b>제${num}온천 (${occ}명)</b><small>${shortTheme}</small>`;
      btn.addEventListener('click', () => {
        presence.switchRoom(room.id);
        if (modalRooms) modalRooms.hidden = true;
        closeAllTrays();
        showToast(`${room.name} 채널로 이동했어요`);
      });
      roomListContainer.appendChild(btn);
    }
  }

  async function fetchServerRooms(): Promise<void> {
    try {
      const res = await fetch('/api/rooms');
      if (!res.ok) return;
      const data = (await res.json()) as { rooms?: RoomSummary[] };
      if (Array.isArray(data.rooms) && data.rooms.length > 0) {
        allRoomsCache = data.rooms;
        renderQuickRooms();
      }
    } catch {
      // 오프라인/정적 배포 시 기본 100개 채널 목록 사용
    }
  }

  btnOpenAllRooms?.addEventListener('click', () => {
    closeAllTrays();
    void fetchServerRooms();
    renderAllRoomsModal(inputRoomSearch?.value ?? '');
    if (modalRooms) modalRooms.hidden = false;
  });

  btnCloseRooms?.addEventListener('click', () => {
    if (modalRooms) modalRooms.hidden = true;
  });

  inputRoomSearch?.addEventListener('input', () => {
    renderAllRoomsModal(inputRoomSearch.value);
  });

  renderQuickRooms();
  void fetchServerRooms();

  // ── 9. 매초 머문 시간 및 집중 타이머 갱신 ──
  window.setInterval(() => {
    staySeconds += 1;
    if (staySeconds % 5 === 0) {
      window.localStorage.setItem(STORAGE_KEYS.STAY_SEC, String(staySeconds));
    }
    if (stayTimerEl) {
      stayTimerEl.textContent = formatStayDuration(staySeconds);
    }

    if (focusEndTime !== null) {
      const remainMs = focusEndTime - Date.now();
      if (remainMs <= 0) {
        focusEndTime = null;
        hallScene.setSelfFocusUntil(null);
        if (focusStatusTextEl) focusStatusTextEl.textContent = '집중 완료!';
        audio.playClocktowerResonance();
        showToast('🎉 30분 반신욕 집중 세션을 완주했어요! 시원한 식혜 한 모금 어때요?');
      } else if (focusStatusTextEl) {
        const remainSec = Math.ceil(remainMs / 1000);
        focusStatusTextEl.textContent = `집중 ${formatStayDuration(remainSec)}`;
      }
    }
  }, 1000);
}

bootstrapOnsenApp();
