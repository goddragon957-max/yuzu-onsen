---
name: ambient-3d-space-dev
description: >-
  Use this skill when building, styling, or upgrading 3D multiplayer ambient healing web applications
  (inspired by sansatemple.com, saunagoyo.com, online temple/sauna/retreat/pool spaces) using Three.js,
  procedural CanvasTextures, articulated wooden-doll avatars, Web Audio synthesizers, and non-overlapping HUD/tray UI.
---

# 🍊 Ambient 3D Healing Space Development Skill (`ambient-3d-space-dev`)

산사(`sansatemple.com`), 사우나 고요(`saunagoyo.com`), 온라인 성당·교회·한강·수영장·노천탕 같은 **비언어적(Non-verbal) 3D 멀티플레이어 힐링 공간**을 제작하거나 개선할 때 사용하는 실전 워크플로우입니다.

---

## 1. 핵심 아키텍처 구성

```text
src/
├── audio/
│   └── ArcaneAudioEngine.ts      # Web Audio API 절차적 자연음(물·바람·모닥불) + 효과음 신디사이저
├── network/
│   ├── PresenceClient.ts         # WebSocket 실시간 동기화 + 오프라인 BroadcastChannel/NPC 폴백
│   └── wireCodec.ts              # 경량 바이너리 델타 패킷 코덱 (ARCN 포맷)
├── scene/
│   ├── proceduralTextures.ts     # 외부 이미지 없이 즉시 로드되는 고해상도 CanvasTexture 생성기
│   ├── ScholarAvatarMesh.ts      # 팔·다리 관절 원목 인형 캐릭터 + 모자 4종 + 오른손 간식 + 카피바라
│   ├── hallLayout.ts             # 다중 구역(대노천탕·편백탕·외기욕·툇마루) 42석 좌석 및 100개 채널 정의
│   └── ArcaneHallScene.ts        # Three.js 메인 씬, ShapeGeometry 타공 수조, 3인칭 밀착 카메라
├── styles/
│   └── main.css                  # 다크 우드 글래스모피즘(.hud.tl, .hud.tr, .actions, .tray, .entry)
└── main.ts                       # UI 이벤트 바인딩 및 씬·네트워크·오디오 오케스트레이션
```

---

## 2. 3D 씬 퀄리티 체크리스트 (구리게 보이지 않는 핵심 비결)

### A. 라이팅 & 노출 밸런스 (`three@0.174+`)
- **절대 하지 말아야 할 것**: `AmbientLight > 1.0`, `toneMappingExposure > 1.1`, 순백색(`#ffffff`) 바닥 조합. (화면 전체가 하얗게 날아가는 백화 현상 발생)
- **권장 세팅**:
  ```ts
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const hemiLight = new THREE.HemisphereLight(0xdfecf5, 0x5a5244, 0.65);
  const ambientLight = new THREE.AmbientLight(0xffe8d4, 0.18);
  const sunDirLight = new THREE.DirectionalLight(0xfff1cf, 0.95);
  ```

### B. 프로시저럴 캔버스 텍스처 (`proceduralTextures.ts`)
- 모든 지면·벽면·수면·바위에는 프로시저럴 캔버스 텍스처(`CanvasTexture`)를 입히고 `tex.colorSpace = THREE.SRGBColorSpace`를 설정합니다.
- **필수 텍스처 프리셋**:
  - `TEX_STONE_PAVING`: `#5d574f` 베이스 위에 타원형 자연석 판석 패턴
  - `TEX_ROCK_SURFACE`: `#928a80` 베이스 위에 미세 스펙클 입자 (바위·석등용, `material.color`는 `0xe8e2d8` 유지)
  - `TEX_HINOKI_WALL` / `TEX_HINOKI_BENCH`: 편백나무 나뭇결과 플랭크 이음새
  - `TEX_BATH_TILE_TEAL` / `TEX_BATH_TILE_SLATE`: 수조 바닥용 세라믹 타일 그리드
  - `TEX_WATER_RIPPLES`: 매 프레임 UV 오프셋(`tex.offset.x/y`)을 스크롤하는 청록빛 윤슬
  - `TEX_STEAM_PUFF` / `TEX_SOFT_SHADOW`: 방사형 알파 그라디언트 스프라이트 (수증기 및 발밑 그림자)

### C. 깊이 파인 수조/연못 (`ShapeGeometry` + `holes`)
- 땅에 파인 탕이나 수영장을 만들 때는 바닥 플레인이 수조 내부를 덮지 않도록 반드시 `Shape.holes`로 구멍을 뚫어야 수조 바닥 타일(`poolBottom`)이 투명한 물결 아래로 비칩니다.
- 외곽 배경 지면(`outerForestFloor`) 역시 마당 영역(`innerCutout`)을 구멍으로 비워두어야 수조 바닥과 겹치지 않습니다.

### D. 3인칭 밀착 카메라 & 관절 원목 인형 (`ScholarAvatarMesh.ts`)
- **카메라**: `fov = 60`, `cameraDistance = 5.4`, `cameraElevation = 0.42`로 캐릭터를 가까이 비춥니다.
- **관절 아바타**:
  - 몸통(`upper`), 반바지(`shorts`), 상의(`shirt`), 목(`neck`), 구형 머리(`head`) + 구면 좌표로 투영된 눈·볼터치·입체 코.
  - 좌우 팔(`arms`)·다리(`legs`) 그룹 피벗을 두어 걸을 때(`pose === 'walking'`) `Math.sin(walkPhase)`로 흔들고, 앉을 때(`pose === 'sitting'`) 다리를 `-Math.PI / 2`로 굽힙니다.
  - 오른손(`arms[1]`) 끝에 `handSlot`을 두어 매점 간식(식혜, 바나나우유, 구운란, 유자차)을 장착하고 마시는 애니메이션(`triggerUseSnack()`)을 지원합니다.

---

## 3. UI 깨짐 없는 HUD & 트레이 설계 패턴

1. **상단 좌측 (`.hud.tl`)**: 브랜드 타이틀 + 현재 구역명 + 접속 인원 표시.
2. **상단 우측 (`.hud.tr`)**: 온도/상태 숫자(`30px bold`) + 머문 시간 + 온기 게이지 + 구역 이동 알약 버튼(`.sets`).
3. **하단 중앙 (`.actions`)**: 한 줄짜리 가로 액션 바 (`max-width: min(680px, calc(100vw - 20px))`).
4. **팝업 트레이 (`.tray`)**:
   - `bottom: calc(22px + var(--actions-h, 58px) + env(safe-area-inset-bottom, 0px))`에 중앙 정렬로 배치.
   - 동시에 1개의 트레이만 열리도록 `closeAllTrays()` 후 대상 트레이의 `hidden` 속성을 토글합니다.
5. **입장 웰컴 오버레이 (`#entry-overlay.entry`)**:
   - 첫 진입 시 화면 중앙 카드(`.card`)에서 머리 위 아이템(SVG 칩)을 고르고 입장 버튼을 누르면 `audio.unlock()`과 함께 오버레이가 닫힙니다.

---

## 4. 검증 절차 (Verification Procedure)

1. **타입 및 프로덕션 빌드 검증**:
   ```powershell
   npm run build
   ```
2. **헤드리스 브라우저 시각 검증 (`capture_browser_scenario`)**:
   - 첫 입장 오버레이 화면(`#entry-overlay`)과 입장 버튼(`#btn-enter-onsen`) 클릭 후의 3D 메인 화면을 각각 스크린샷으로 캡처해 UI 겹침 여부와 수조 타일·바위·캐릭터 가시성을 눈으로 직접 확인합니다.
