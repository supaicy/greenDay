import sys,base64,subprocess,pathlib,json
S=pathlib.Path(sys.argv[1]); scene=sys.argv[2]; headline=sys.argv[3]; out=sys.argv[4]
src=pathlib.Path('/Users/supermicrosoft/orca/workspaces/ticktick/coordinate/docs/app-store')
def b64(p): return 'data:image/png;base64,'+base64.b64encode(open(p,'rb').read()).decode()
light=b64(src/'screenshots-light'/f'{scene}.png'); dark=b64(src/'screenshots'/f'{scene}.png')
import os
front=os.environ.get('FRONT','dark')
back_img,front_img,back_cls,front_cls=(light,dark,'lightback','darkfront') if front=='dark' else (dark,light,'dark','light')
mark=open('/Users/supermicrosoft/orca/workspaces/begreen/needlefish/site/assets/favicon.svg',encoding='utf-8').read()
html=f'''<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;width:2880px;height:1800px;overflow:hidden;background:#04060A;font-family:-apple-system,"SF Pro Display","Pretendard","Apple SD Gothic Neo",sans-serif}}
.bg{{position:absolute;inset:0;background:#071A16;overflow:hidden}}
.blob{{position:absolute;border-radius:50%;filter:blur(160px)}}
.b1{{width:2200px;height:1800px;left:-500px;top:-600px;background:radial-gradient(ellipse at 50% 50%,#2FD48F 0%,#128A5E 40%,transparent 70%);opacity:.95}}
.b2{{width:2000px;height:1700px;right:-500px;top:-500px;background:radial-gradient(ellipse,#25C2C9 0%,#0E5F73 45%,transparent 70%);opacity:.85}}
.b3{{width:2400px;height:1400px;left:300px;bottom:-800px;background:radial-gradient(ellipse,#3BF0A2 0%,#0F6B4B 45%,transparent 70%);opacity:.8}}
.b4{{width:1200px;height:1200px;left:900px;top:200px;background:radial-gradient(circle,#B9F5D8 0%,#3BF0A2 30%,transparent 70%);opacity:.35}}
.grain{{position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.05),transparent 40%,rgba(0,0,0,.18))}}
.vign{{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,transparent 60%,rgba(4,6,10,.38) 100%)}}
.hl{{position:absolute;left:160px;top:130px;color:#F6FBF8;font-size:92px;font-weight:700;letter-spacing:-.025em;line-height:1.08;max-width:1700px;text-shadow:0 2px 30px rgba(0,0,0,.35)}}
.brand{{position:absolute;left:160px;bottom:100px;display:flex;align-items:center;gap:22px;color:#E3F4EA;font-size:34px;font-weight:600;letter-spacing:-.01em}}
.brand svg{{width:48px;height:48px;flex:none}}
.win{{position:absolute;border-radius:24px;overflow:hidden;box-shadow:0 50px 120px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.10)}}
.win img{{display:block;width:100%;height:auto}}
.dark{{width:1560px;right:300px;top:290px}}
.light{{width:1560px;left:480px;top:640px;box-shadow:0 70px 160px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.08)}}
.lightback{{width:1560px;right:430px;top:250px;box-shadow:0 50px 120px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.08)}}
.darkfront{{width:1560px;left:640px;top:600px;box-shadow:0 70px 160px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.12)}}
</style>
<div class="bg"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="blob b4"></div><div class="grain"></div><div class="vign"></div></div>
<div class="hl">{headline}</div>
<div class="win {back_cls}"><img src="{back_img}"></div>
<div class="win {front_cls}"><img src="{front_img}"></div>
<div class="brand">{mark}<span>Greenday · begreen.dev</span></div>
'''
p=S/'store'/f'{scene}.html'; p.write_text(html,encoding='utf-8')
subprocess.run(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','--headless=new','--disable-gpu','--hide-scrollbars','--force-device-scale-factor=1','--window-size=2880,1800',f'--screenshot={out}',f'file://{p}'],check=True,capture_output=True)
print(out)
