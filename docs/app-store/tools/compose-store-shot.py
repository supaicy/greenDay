#!/usr/bin/env python3
"""App Store 스크린샷 합성 — 배경·헤드라인·창 겹침·브랜드 마크를 한 장으로.

    python3 compose-store-shot.py <작업폴더> <장면> <로케일> <출력.png>

로케일은 ko|en 이다. 헤드라인은 아래 HEADLINES 표에서만 온다 — 예전에는 호출부가
자유 문자열로 넘겨서, 인자를 잘못 주면 조용히 성공하고 영문 세트에 한국어가 박혔다
(2026-09-09 en-06 사고). 표에 없는 조합은 즉시 실패한다.

배경·기하는 2026-09-09 다관점 진단(begreen docs/37)의 결정을 반영한 v4다.
"""
import sys, os, base64, subprocess, pathlib, hashlib

WORK = pathlib.Path(sys.argv[1]); SCENE = sys.argv[2]; LOCALE = sys.argv[3]; OUT = sys.argv[4]

SRC = pathlib.Path(__file__).resolve().parent.parent          # docs/app-store
FONTS = SRC / 'tools' / 'fonts'
MARK = pathlib.Path('/Users/supermicrosoft/orca/workspaces/begreen/needlefish/site/assets/favicon.svg')

# ── 헤드라인. 워크시트 승인 문구만 들어간다. 여기에 새 카피를 슬쩍 끼워 넣지 말 것.
HEADLINES = {
    'ko': {
        '01-오늘':          '오늘 할 일만, 한 화면에',
        '02-캘린더-주':      '일정을 시간 블록으로',
        '03-칸반보드':       '같은 할 일, 진행 상태로',
        '04-아이젠하워':     '중요한 것부터',
        '05-습관':          '매일의 작은 반복',
        '06-설정-프라이버시': '데이터는 내 맥에만',
    },
    'en': {
        '01-오늘':          'Only today’s tasks, one screen',
        '02-캘린더-주':      'Your schedule as time blocks',
        '03-칸반보드':       'Same tasks, by status',
        '04-아이젠하워':     'Important things first',
        '05-습관':          'Keep the streak alive',
        '06-설정-프라이버시': 'Your data stays on your Mac',
    },
}
if LOCALE not in HEADLINES:
    raise SystemExit(f'모르는 로케일: {LOCALE}')
if SCENE not in HEADLINES[LOCALE]:
    raise SystemExit(f'헤드라인 없음: {LOCALE}/{SCENE}')
HEADLINE = HEADLINES[LOCALE][SCENE]
# 타자기 따옴표는 92px 로 확대되면 '에디터에서 복붙했다'로 읽힌다.
if "'" in HEADLINE or '"' in HEADLINE:
    raise SystemExit(f'헤드라인에 타자기 따옴표 — ’ “ ” 를 쓸 것: {HEADLINE!r}')

# ── 소스. 로케일마다 따로다. 없으면 조용히 ko 를 쓰지 않고 즉시 멈춘다.
SUFFIX = '' if LOCALE == 'ko' else f'-{LOCALE}'
DARK_P = SRC / f'screenshots{SUFFIX}' / f'{SCENE}.png'
LIGHT_P = SRC / f'screenshots{SUFFIX}-light' / f'{SCENE}.png'
for p in (DARK_P, LIGHT_P):
    if not p.exists():
        raise SystemExit(f'{LOCALE} 소스 없음: {p}')


def b64(path, mime):
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()


dark = b64(DARK_P, 'image/png')
light = b64(LIGHT_P, 'image/png')
archivo = b64(FONTS / 'Archivo.woff2', 'font/woff2')
pretendard = b64(FONTS / 'Pretendard-headline.woff2', 'font/woff2')
mark = MARK.read_text(encoding='utf-8')

# ── 장면별 배경 변주. 여섯 장이 픽셀 단위로 같은 배경이면 스토어 한 줄에서
# 같은 사진을 여섯 번 올린 것처럼 읽힌다. 팔레트는 그대로 두고 빛의 자리만 흔든다.
# 값은 임의가 아니다 — 창을 뺀 배경의 명도 분포가 여섯 장 모두 목표 구간
# (어두움 45~55%, 밝음 25% 안팎)에 들어오도록 측정해 고른 조합이다.
# 한 방향으로 쭉 밀면 빛이 창 뒤로 숨어 뒤로 갈수록 어두워진다. 그래서 좌우로 흔든다.
ORDER = ['01-오늘', '02-캘린더-주', '03-칸반보드', '04-아이젠하워', '05-습관', '06-설정-프라이버시']
IDX = ORDER.index(SCENE) if SCENE in ORDER else 0
B1_X = (-500, -430, -560, -470, -530, -400)[IDX]
B1_Y = (-600, -540, -660, -570, -630, -510)[IDX]
B3_X = (300, 225, 365, 265, 330, 190)[IDX]
VIGN_X = (40, 36, 44, 38, 42, 34)[IDX]

# ── 창 크롬. 헤드리스 캡처에는 macOS 가 그리는 신호등이 없어 여기서 그린다.
# 기존 Electron 캡처에서 잰 값: 지름 14, 중심 (21.75, 21.75), 간격 23 (CSS px, 1440 폭 기준).
WIN_W = 1560
SCALE = WIN_W / 1440
DOT = round(14 * SCALE, 2)
DOT_X = round(21.75 * SCALE - DOT / 2, 2)
DOT_Y = round(21.75 * SCALE - DOT / 2, 2)
GAP = round(23 * SCALE, 2)
DOTS = ''.join(
    f'<i style="left:{DOT_X + i * GAP}px;background:{c}"></i>'
    for i, c in enumerate(('#F36964', '#F6C842', '#5BC266')))

html = f'''<!doctype html><meta charset="utf-8"><style>
@font-face{{font-family:Archivo;src:url({archivo}) format('woff2');font-weight:100 900;font-display:block}}
@font-face{{font-family:Pretendard;src:url({pretendard}) format('woff2');font-weight:45 930;font-display:block}}
html,body{{margin:0;width:2880px;height:1800px;overflow:hidden;background:#04060A;
  font-family:Archivo,Pretendard,-apple-system,sans-serif}}
/* 배경: near-black 위 오로라 림. 이전에는 바탕이 #071A16 이고 블롭 불투명도가 .8~.95라
   어둠이 드러날 자리가 없어 '초록 벽지'가 됐고, 우측 블롭이 시안(hue 188)이라
   브랜드 그린에서 35도 벗어나 있었다.
   창을 뺀 배경에서 v<0.15 는 45~55%, v>0.30 은 25% 이하로 맞춘 값이다.
   더 어둡게 밀면 320px 썸네일이 검은 사각형이 되어 스토어 한 줄에서 존재감을 잃는다. */
.bg{{position:absolute;inset:0;background:#04060A;overflow:hidden}}
.blob{{position:absolute;border-radius:50%;filter:blur(160px)}}
.b1{{width:2200px;height:1800px;left:{B1_X}px;top:{B1_Y}px;
  background:radial-gradient(ellipse at 50% 50%,#2FD48F 0%,#0E6B4A 40%,transparent 70%);opacity:.86}}
.b2{{width:2000px;height:1700px;right:-500px;top:-500px;
  background:radial-gradient(ellipse,#1FA97F 0%,#0A3B30 45%,transparent 70%);opacity:.66}}
.b3{{width:2400px;height:1400px;left:{B3_X}px;bottom:-800px;
  background:radial-gradient(ellipse,#3BF0A2 0%,#0B4A34 45%,transparent 70%);opacity:.64}}
.grain{{position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(255,255,255,.05),transparent 40%,rgba(0,0,0,.18))}}
.vign{{position:absolute;inset:0;background:
  radial-gradient(ellipse at {VIGN_X}% 34%,transparent 20%,rgba(4,6,10,.30) 55%,rgba(4,6,10,.74) 100%),
  linear-gradient(180deg,transparent 38%,rgba(4,6,10,.42) 100%)}}
.hl{{position:absolute;left:160px;top:130px;color:#F6FBF8;font-size:104px;font-weight:700;
  letter-spacing:-.025em;line-height:1.08;max-width:1500px;text-shadow:0 3px 14px rgba(4,6,10,.55)}}
.brand{{position:absolute;left:160px;bottom:100px;display:flex;align-items:center;gap:22px;
  color:#E3F4EA;font-size:34px;font-weight:600;letter-spacing:-.01em}}
.brand svg{{width:48px;height:48px;flex:none}}
.win{{position:absolute;border-radius:24px;overflow:hidden}}
.win img{{display:block;width:100%;height:auto}}
/* 신호등. 헤드리스에는 OS 크롬이 없어 그려 넣는다 — 맥 앱이라는 신호를 0.3초에 준다. */
.win i{{position:absolute;top:{DOT_Y}px;width:{DOT}px;height:{DOT}px;border-radius:50%;display:block}}
/* 뒤(라이트) 창은 위로, 앞(다크) 창은 아래로 흘린다. 예전에는 오른쪽에 뒤 창의
   빈 흰 여백만 250px 기둥으로 남아, 화면에서 가장 밝은 덩어리가 정보량 0이었다. */
.back{{width:{WIN_W}px;right:430px;top:250px;
  box-shadow:0 50px 120px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.08)}}
.front{{width:{WIN_W}px;left:1010px;top:700px;
  box-shadow:0 34px 80px rgba(0,0,0,.50),0 0 0 1px rgba(255,255,255,.16)}}
</style>
<div class="bg"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
<div class="grain"></div><div class="vign"></div></div>
<div class="hl">{HEADLINE}</div>
<div class="win back"><img src="{light}">{DOTS}</div>
<div class="win front"><img src="{dark}">{DOTS}</div>
<div class="brand">{mark}<span>Greenday · begreen.dev</span></div>
'''

# 중간 HTML 이름에 출력 경로를 섞는다. 장면 이름만 쓰면 ko/en 을 동시에 돌릴 때
# 서로 덮어쓰고 두 로케일이 같은 그림으로 나온다 (2026-09-09 en-06 사고).
tag = hashlib.md5(str(pathlib.Path(OUT).resolve()).encode()).hexdigest()[:8]
page = WORK / 'store' / f'{SCENE}-{LOCALE}-{tag}.html'
page.parent.mkdir(parents=True, exist_ok=True)
page.write_text(html, encoding='utf-8')
pathlib.Path(OUT).parent.mkdir(parents=True, exist_ok=True)
subprocess.run(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless=new',
                '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                '--window-size=2880,1800', f'--screenshot={OUT}', f'file://{page}'],
               check=True, capture_output=True)
print(OUT)
