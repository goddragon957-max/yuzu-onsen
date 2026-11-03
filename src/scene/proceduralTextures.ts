import * as THREE from 'three';

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function makeCanvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat = false,
  isColor = true
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    draw(ctx, width, height);
  }
  const tex = new THREE.CanvasTexture(canvas);
  if (isColor) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

export function tileTexture(
  source: THREE.CanvasTexture,
  repeatX: number,
  repeatY: number,
  rotation = 0
): THREE.CanvasTexture {
  const cloned = source.clone();
  cloned.colorSpace = source.colorSpace;
  cloned.wrapS = THREE.RepeatWrapping;
  cloned.wrapT = THREE.RepeatWrapping;
  cloned.repeat.set(repeatX, repeatY);
  if (rotation !== 0) {
    cloned.center.set(0.5, 0.5);
    cloned.rotation = rotation;
  }
  cloned.needsUpdate = true;
  return cloned;
}

function drawWoodPlanks(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rows: number,
  hsl: [number, number, number],
  seamAlpha: number
): void {
  const rowH = h / rows;
  for (let r = 0; r < rows; r += 1) {
    const hue = hsl[0] + rand(-3, 3);
    const sat = hsl[1] + rand(-6, 6);
    const lig = hsl[2] + rand(-5, 5);
    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${lig}%)`;
    ctx.fillRect(0, r * rowH, w, rowH);

    // 나뭇결 곡선
    for (let g = 0; g < 16; g += 1) {
      ctx.strokeStyle = `hsla(${hue - 5}, ${sat}%, ${lig - 14}%, ${rand(0.07, 0.22)})`;
      ctx.lineWidth = rand(0.7, 1.7);
      ctx.beginPath();
      const baseY = r * rowH + rand(2, rowH - 2);
      const amp = rand(0.5, 2.4);
      const freq = rand(0.004, 0.018);
      const phase = rand(0, 6.28);
      for (let x = 0; x <= w; x += 8) {
        const y = baseY + Math.sin(x * freq + phase) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // 옹이(Knot)
    if (Math.random() < 0.25) {
      ctx.fillStyle = `hsla(${hue - 8}, ${sat}%, ${lig - 24}%, 0.38)`;
      ctx.beginPath();
      ctx.ellipse(
        rand(24, w - 24),
        r * rowH + rowH / 2,
        rand(4, 9),
        rand(2, 3.8),
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // 판재 이음선
    ctx.fillStyle = `rgba(65, 32, 12, ${seamAlpha})`;
    ctx.fillRect(0, r * rowH, w, 2);
    ctx.fillRect(rand(30, w - 30), r * rowH, 1.5, rowH);
  }
}

function makeCeramicTileTexture(
  hue: number,
  sat: number,
  lig: number,
  grid: number,
  groutHex: string,
  ligSpread: number
): THREE.CanvasTexture {
  return makeCanvasTexture(
    512,
    512,
    (ctx, w, h) => {
      ctx.fillStyle = groutHex;
      ctx.fillRect(0, 0, w, h);
      const cell = w / grid;
      for (let r = 0; r < grid; r += 1) {
        for (let c = 0; c < grid; c += 1) {
          ctx.fillStyle = `hsl(${hue + rand(-2, 2)}, ${sat + rand(-4, 4)}%, ${lig + rand(-ligSpread, ligSpread)}%)`;
          ctx.fillRect(c * cell + 2, r * cell + 2, cell - 4, cell - 4);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
          ctx.fillRect(c * cell + 3, r * cell + 3, cell - 6, (cell - 6) * 0.35);
        }
      }
    },
    true,
    true
  );
}

/** 따뜻한 편백나무 벽면 텍스처 */
export const TEX_HINOKI_WALL = makeCanvasTexture(
  512,
  512,
  (ctx, w, h) => drawWoodPlanks(ctx, w, h, 8, [34, 48, 66], 0.55),
  true,
  true
);

/** 밝은 편백 벤치/의자 상판 텍스처 */
export const TEX_HINOKI_BENCH = makeCanvasTexture(
  512,
  256,
  (ctx, w, h) => drawWoodPlanks(ctx, w, h, 4, [36, 52, 70], 0.35),
  true,
  true
);

/** 실내외 마루 바닥 판재 텍스처 */
export const TEX_WOOD_FLOOR = makeCanvasTexture(
  512,
  512,
  (ctx, w, h) => drawWoodPlanks(ctx, w, h, 6, [30, 42, 52], 0.68),
  true,
  true
);

/** 진한 고목 마루/데크 텍스처 */
export const TEX_DARK_DECK = makeCanvasTexture(
  512,
  512,
  (ctx, w, h) => drawWoodPlanks(ctx, w, h, 6, [28, 32, 44], 0.75),
  true,
  true
);

/** 세로 방향 편백 루버/기둥 텍스처 */
export const TEX_VERTICAL_WOOD = makeCanvasTexture(
  256,
  512,
  (ctx, w, h) => {
    ctx.save();
    ctx.translate(w, 0);
    ctx.rotate(Math.PI / 2);
    drawWoodPlanks(ctx, h, w, 5, [33, 50, 62], 0.6);
    ctx.restore();
  },
  true,
  true
);

/** 대나무 울타리 텍스처 */
export const TEX_BAMBOO_FENCE = makeCanvasTexture(
  512,
  256,
  (ctx, w, h) => {
    for (let x = 0; x < w; x += 16) {
      const lig = rand(32, 46);
      ctx.fillStyle = `hsl(${rand(30, 42)}, ${rand(28, 42)}%, ${lig}%)`;
      ctx.fillRect(x, 0, 14, h);
      ctx.fillStyle = `hsla(30, 30%, ${lig - 14}%, 0.65)`;
      for (let y = rand(20, 60); y < h; y += rand(52, 88)) {
        ctx.fillRect(x, y, 14, 3);
      }
      ctx.fillStyle = 'rgba(20, 10, 4, 0.65)';
      ctx.fillRect(x + 14, 0, 2, h);
    }
  },
  true,
  true
);

/** 노천탕 주변 자연석 판석 바닥 텍스처 (절대 눈부시지 않은 차분한 현무암/화강암 톤) */
export const TEX_STONE_PAVING = makeCanvasTexture(
  512,
  512,
  (ctx, w, h) => {
    ctx.fillStyle = '#5d574f';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 75; i += 1) {
      const x = rand(0, w);
      const y = rand(0, h);
      const r = rand(22, 46);
      ctx.fillStyle = `hsl(30, ${rand(4, 10)}%, ${rand(46, 62)}%)`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * rand(0.6, 0.9), rand(0, 3.14), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(35, 30, 25, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  },
  true,
  true
);

/** 자연 바위 표면 스펙클 텍스처 */
export const TEX_ROCK_SURFACE = makeCanvasTexture(
  256,
  256,
  (ctx, w, h) => {
    ctx.fillStyle = '#928a80';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i += 1) {
      ctx.fillStyle = `hsla(30, ${rand(6, 14)}%, ${rand(46, 74)}%, 0.55)`;
      ctx.fillRect(rand(0, w), rand(0, h), rand(1, 4), rand(1, 4));
    }
  },
  true,
  true
);

/** 외곽 숲 이끼/잔디 지면 텍스처 */
export const TEX_FOREST_MOSS = makeCanvasTexture(
  512,
  512,
  (ctx, w, h) => {
    ctx.fillStyle = '#4a5a34';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8000; i += 1) {
      ctx.fillStyle = `hsla(${rand(72, 108)}, ${rand(25, 45)}%, ${rand(18, 38)}%, 0.7)`;
      ctx.fillRect(rand(0, w), rand(0, h), rand(1, 3), rand(2, 6));
    }
    for (let i = 0; i < 120; i += 1) {
      ctx.fillStyle = `hsla(30, 25%, ${rand(25, 40)}%, 0.5)`;
      ctx.beginPath();
      ctx.ellipse(
        rand(0, w),
        rand(0, h),
        rand(3, 10),
        rand(2, 6),
        rand(0, 3),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  },
  true,
  true
);

/** 청록빛 온천 타일 & 슬레이트 타일 */
export const TEX_BATH_TILE_TEAL = makeCeramicTileTexture(
  172,
  30,
  42,
  8,
  '#2a443f',
  4
);
export const TEX_BATH_TILE_SLATE = makeCeramicTileTexture(
  200,
  16,
  54,
  8,
  '#4f5d64',
  4
);

/** 물결 윤슬 애니메이션 텍스처 (매 프레임 offset 스크롤) */
export const TEX_WATER_RIPPLES = makeCanvasTexture(
  256,
  256,
  (ctx, w, h) => {
    ctx.fillStyle = '#d4e2e0';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
    for (let i = 0; i < 64; i += 1) {
      ctx.lineWidth = rand(0.9, 2.3);
      ctx.beginPath();
      const x = rand(0, w);
      const y = rand(0, h);
      const r = rand(6, 26);
      ctx.ellipse(
        x,
        y,
        r,
        r * rand(0.4, 0.8),
        rand(0, 3),
        rand(0, 3),
        rand(3, 6)
      );
      ctx.stroke();
    }
  },
  true,
  false
);

/** 폭포/대나무 수구 낙수 물줄기 텍스처 */
export const TEX_WATERFALL_STREAM = makeCanvasTexture(
  64,
  256,
  (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 42; i += 1) {
      ctx.fillStyle = `rgba(255, 255, 255, ${rand(0.18, 0.65)})`;
      ctx.fillRect(rand(0, w), rand(0, h), rand(1.2, 3.2), rand(30, 120));
    }
  },
  true,
  false
);

/** 낮 하늘 그라데이션 돔 텍스처 */
export const TEX_SKY_DAY = makeCanvasTexture(
  4,
  256,
  (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#6f9cc9');
    grad.addColorStop(0.45, '#a9c7de');
    grad.addColorStop(0.52, '#e8e4d6');
    grad.addColorStop(1, '#e8e4d6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  },
  false,
  true
);

/** 노을 하늘 그라데이션 돔 텍스처 */
export const TEX_SKY_SUNSET = makeCanvasTexture(
  4,
  256,
  (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#5a769a');
    grad.addColorStop(0.35, '#c99383');
    grad.addColorStop(0.5, '#f2c69d');
    grad.addColorStop(1, '#e8d4bc');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  },
  false,
  true
);

/** 별이 반짝이는 밤하늘 돔 텍스처 */
export const TEX_SKY_NIGHT = makeCanvasTexture(
  1024,
  512,
  (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#070c22');
    grad.addColorStop(0.32, '#111b3e');
    grad.addColorStop(0.48, '#24305a');
    grad.addColorStop(0.52, '#2c3860');
    grad.addColorStop(1, '#121829');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 900; i += 1) {
      const y = rand(0, h * 0.48);
      const fade = Math.min(1, (h * 0.5 - y) / (h * 0.14));
      const r = rand(0.6, 1.5);
      ctx.fillStyle = `rgba(255, 250, 235, ${rand(0.35, 1) * fade})`;
      ctx.beginPath();
      ctx.arc(rand(0, w), y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  false,
  true
);

/** 360도 병풍 산맥 & 소나무 숲 파노라마 텍스처 생성 */
function makeMountainPanorama(
  colors: [string, string, string, string]
): THREE.CanvasTexture {
  const tex = makeCanvasTexture(
    2048,
    512,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const drawRidge = (
        baseY: number,
        harmonics: Array<[number, number, number]>,
        fill: string
      ) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 4) {
          let y = baseY;
          for (const [amp, freq, phase] of harmonics) {
            y += amp * Math.sin((Math.PI * 2 * freq * x) / w + phase);
          }
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.fill();
      };

      drawRidge(
        h * 0.42,
        [
          [38, 3, 1],
          [20, 7, 2],
          [6, 23, 0.5],
        ],
        colors[0]
      );
      drawRidge(
        h * 0.55,
        [
          [30, 4, 3],
          [14, 9, 1],
          [5, 31, 2],
        ],
        colors[1]
      );
      drawRidge(
        h * 0.7,
        [
          [22, 5, 2],
          [10, 13, 4],
        ],
        colors[2]
      );

      for (let i = 0; i < 260; i += 1) {
        const x = rand(0, w);
        const y = h * 0.78 + rand(0, h * 0.2);
        const sz = rand(18, 48);
        ctx.fillStyle = colors[3];
        ctx.beginPath();
        ctx.moveTo(x - sz * 0.28, y);
        ctx.lineTo(x, y - sz);
        ctx.lineTo(x + sz * 0.28, y);
        ctx.fill();
      }
      ctx.fillStyle = colors[3];
      ctx.fillRect(0, h * 0.92, w, h * 0.08);
    },
    true,
    true
  );
  tex.repeat.set(2, 1);
  return tex;
}

export const TEX_PANORAMA_DAY = makeMountainPanorama([
  '#9db1c4',
  '#7e98a3',
  '#5d7b62',
  '#2f4a33',
]);

export const TEX_PANORAMA_NIGHT = makeMountainPanorama([
  '#2a3350',
  '#1f273f',
  '#161d2e',
  '#0c1018',
]);

/** 캐릭터 발밑 부드러운 원형 그림자 데칼 텍스처 */
export const TEX_SOFT_SHADOW = makeCanvasTexture(
  64,
  64,
  (ctx, w, h) => {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(30, 14, 5, 0.55)');
    grad.addColorStop(1, 'rgba(30, 14, 5, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  },
  false,
  false
);

/** 모락모락 피어오르는 수증기 소프트 파티클 텍스처 */
export const TEX_STEAM_PUFF = makeCanvasTexture(
  128,
  128,
  (ctx, w, h) => {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.42, 'rgba(255, 255, 255, 0.42)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  },
  false,
  false
);

/** 접은 온천 수건 텍스처 (주황 포인트 라인) */
export const TEX_FOLDED_TOWEL = makeCanvasTexture(
  256,
  128,
  (ctx, w, h) => {
    ctx.fillStyle = '#f4ebd9';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8781f';
    ctx.fillRect(w * 0.12, 0, w * 0.045, h);
    ctx.fillRect(w * 0.84, 0, w * 0.045, h);
  },
  false,
  true
);

/** 나무 현판 텍스처 생성기 */
export function makeWoodenSignTexture(
  title: string,
  subtitle?: string
): THREE.CanvasTexture {
  return makeCanvasTexture(
    512,
    176,
    (ctx, w, h) => {
      ctx.fillStyle = '#4e301b';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#684327';
      ctx.fillRect(8, 8, w - 16, h - 16);
      ctx.strokeStyle = '#8c5e3c';
      ctx.lineWidth = 3;
      ctx.strokeRect(12, 12, w - 24, h - 24);

      ctx.fillStyle = '#fbeedd';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font =
        '700 56px "Pretendard", "Noto Serif KR", "Malgun Gothic", sans-serif';
      ctx.fillText(title, w / 2, subtitle ? h * 0.42 : h * 0.52);

      if (subtitle) {
        ctx.font =
          '500 28px "Pretendard", "Noto Serif KR", "Malgun Gothic", sans-serif';
        ctx.fillStyle = '#f0cf9e';
        ctx.fillText(subtitle, w / 2, h * 0.78);
      }
    },
    false,
    true
  );
}

/** 매점 어닝 줄무늬 텍스처 */
export const TEX_AWNING_STRIPE = makeCanvasTexture(
  128,
  32,
  (ctx, w, h) => {
    ctx.fillStyle = '#f5ecd7';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2b84b';
    ctx.fillRect(0, 0, w / 2, h);
  },
  true,
  true
);
