# 🍊 온라인 3D 힐링 공간 (유자 노천탕 · Ambient 3D Web) 핵심 룰

이 문서는 **유자 노천탕 (`arcane-hall`)** 및 산사(`sansatemple.com`)·사우나 고요(`saunagoyo.com`) 스타일의 3D 멀티플레이어 힐링 웹앱을 개발·유지보수할 때 에이전트가 반드시 준수해야 하는 아키텍처 및 그래픽/UI 품질 규칙입니다.

---

## 1. 3D 렌더링 & 라이팅 밸런스 (화이트아웃·백화 현상 절대 금지)

1. **노출 및 색공간 표준 (`three@0.174+`)**:
   - `renderer.outputColorSpace = THREE.SRGBColorSpace`
   - `renderer.toneMapping = THREE.ACESFilmicToneMapping`
   - `renderer.toneMappingExposure`는 **`0.90 ~ 0.95`** 범위를 유지합니다. (`1.1` 이상 설정 시 밝은 재질이 하얗게 날아갑니다.)
2. **라이팅 강도 상한선**:
   - `HemisphereLight` (`0.6 ~ 0.7`), `AmbientLight` (`0.15 ~ 0.22`), `DirectionalLight` (`0.85 ~ 1.0`) 조합을 기본으로 사용합니다.
   - 바닥 재질에 순백색(`#ffffff`, `#fffdf9`) 사용을 금지하며, 자연석 판석(`#5d574f`)·편백나무·이끼 잔디 등 눈이 편안한 중명도 자연 텍스처를 사용합니다.
3. **프로시저럴 캔버스 텍스처 (`CanvasTexture`) 필수 적용**:
   - 단색 기하 도형(Untextured Box/Cylinder)만 나열하지 않고 `src/scene/proceduralTextures.ts`의 절차적 텍스처(`TEX_STONE_PAVING`, `TEX_HINOKI_WALL`, `TEX_HINOKI_BENCH`, `TEX_BATH_TILE_TEAL`, `TEX_WATER_RIPPLES`, `TEX_ROCK_SURFACE`, `TEX_BAMBOO_FENCE`)를 반드시 적용합니다.
   - 모든 `CanvasTexture` 생성 시 `tex.colorSpace = THREE.SRGBColorSpace`를 명시합니다.
   - 텍스처(`map`)가 적용된 `MeshStandardMaterial`의 `color`는 `0xffffff` 또는 밝은 웜톤(`0xe8e2d8`)으로 두어 텍스처 명도가 검게 죽지 않도록 합니다.
4. **수조·연못 타공 (`THREE.ShapeGeometry` + `holes`)**:
   - 땅 아래로 파인 탕(노천탕, 히노끼탕, 수영장 등)을 만들 때는 반드시 바닥 `Shape`에 `holes`를 뚫어, 지면 메쉬가 수조 바닥 타일(`poolBottom`)을 가리지 않도록 합니다.

---

## 2. 3인칭 밀착 카메라 & 관절 아바타 표준

1. **카메라 거리 및 화각**:
   - 기본 3인칭 추적 카메라는 `fov = 60`(모바일 세로 화면 `70`), `cameraDistance = 5.2 ~ 5.6m`, `cameraElevation = 0.40 ~ 0.45 rad`를 유지하여 내 캐릭터와 머리 위 아이템이 화면 중앙에 큼직하고 또렷하게 보이도록 합니다.
2. **원목 인형 관절 캐릭터 (`ScholarAvatarMesh`)**:
   - 캐릭터는 `hips`, `upper`, `head`, `arms`(좌/우 팔 피벗), `legs`(좌/우 다리 피벗) 계층 구조를 갖춰 걷기(`walking`) 시 팔다리가 교차 스윙하고, 앉기(`sitting`) 시 무릎이 앞으로 굽혀지도록 구현합니다.
   - 눈·볼터치·코는 머리 구면 표면에 투영 배치하고, 발밑에는 반드시 부드러운 방사형 그림자 데칼(`TEX_SOFT_SHADOW`)을 배치합니다.
   - 머리 위 이름표는 고해상도 둥근 필(Pill) `THREE.Sprite`로 렌더링하고 `depthTest: false`를 설정해 지형에 묻히지 않게 합니다.

---

## 3. UI/UX 레이아웃 불변 규칙 (겹침·깨짐 방지)

1. **4분할 비간섭 HUD 구조**:
   - **좌측 상단 (`.hud.tl`)**: 브랜드명, 현재 구역 제목, 접속 채널 및 실시간 인원수 표시 (`pointer-events: none`).
   - **우측 상단 (`.hud.tr`)**: 수온계(`°C`), 머문 시간, 온기 게이지 바, 구역 빠른 이동 칩(`.sets`).
   - **하단 중앙 (`.actions`)**: 핵심 행동 버튼 바 (`물 끼얹기`, `일어서기/앉기`, `인사하기`, `매점 간식`, `소원 유자`, `모자`, `공간 이동`, `더보기`).
   - **팝업 트레이 (`.tray`)**: 하단 버튼 클릭 시 한 번에 하나의 트레이만 `.actions` 바 바로 위에 뜨며, 3D 캔버스 클릭이나 `Escape` 키 입력 시 즉시 닫힙니다.
   - **첫 입장 카드 (`.entry`)**: 화면 중앙 모달 카드로 모자 선택 및 오디오 잠금 해제를 동시에 처리합니다.
2. **고정 사이드 드로어 남발 금지**:
   - 3D 뷰포트 좌우를 상시 가리는 고정 사이드 패널 대신, 필요할 때만 열리는 하단 팝업 트레이(`.tray`) 방식을 유지합니다.

---

## 4. 빌드 & 시각적 검증 루프 (Goal-Driven Verification)

1. 코드 수정 후 반드시 `npm run build` (`tsc --noEmit && vite build`)를 실행해 타입 에러 및 번들 에러가 `0`건인지 확인합니다.
2. UI 스타일이나 3D 씬을 변경한 경우, 텍스트 로그만 믿지 말고 실제 브라우저 스크린샷(`capture_browser_scenario`)을 캡처하여 **① 첫 입장 웰컴 화면**과 **② 입장 후 3D 본 화면 + 팝업 트레이**를 눈으로 직접 대조·검증합니다.
3. 모든 Git 커밋 메시지는 `<RULE[user_global]>`에 따라 **한글**로 명확하게 작성합니다 (예: `feat: 유자 노천탕 3D 멀티플레이어 힐링 웹앱 구현`).
