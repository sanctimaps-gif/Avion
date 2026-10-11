"""Génère les icônes et écrans de démarrage (Android, iOS, web) depuis assets/brand/logo-source.png."""
from PIL import Image, ImageChops, ImageDraw
import base64, io, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = Image.open(os.path.join(ROOT, 'assets/brand/logo-source.png')).convert('RGB')
# Recadrage sur le logo (fond blanc retiré)
bg = Image.new('RGB', src.size, (255, 255, 255))
diff = ImageChops.difference(src, bg).convert('L').point(lambda v: 255 if v > 12 else 0)
logo = src.crop(diff.getbbox())
WHITE = (255, 255, 255)

def square(size, scale, color=WHITE):
    """Logo centré sur un carré, occupant `scale` de la largeur."""
    im = Image.new('RGB', (size, size), color)
    w = int(size * scale)
    h = int(w * logo.height / logo.width)
    if h > size * scale:
        h = int(size * scale)
        w = int(h * logo.width / logo.height)
    im.paste(logo.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    return im

def save(im, rel):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    im.save(p, optimize=True)

res = 'android/app/src/main/res'
for d, s in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    save(square(s, 0.92), f'{res}/mipmap-{d}/ic_launcher.png')
    r = square(s, 0.8).convert('RGBA')
    m = Image.new('L', (s * 4, s * 4), 0)
    ImageDraw.Draw(m).ellipse((0, 0, s * 4 - 1, s * 4 - 1), fill=255)
    r.putalpha(m.resize((s, s), Image.LANCZOS))
    save(r, f'{res}/mipmap-{d}/ic_launcher_round.png')
    # Icône adaptative : zone sûre = 66/108 du carré
    fg = square(int(s * 108 / 48), 0.6).convert('RGBA')
    save(fg, f'{res}/mipmap-{d}/ic_launcher_foreground.png')

def splash(w, h):
    im = Image.new('RGB', (w, h), WHITE)
    k = int(min(w, h) * 0.55)
    lg = logo.resize((k, int(k * logo.height / logo.width)), Image.LANCZOS)
    im.paste(lg, ((w - lg.width) // 2, (h - lg.height) // 2))
    return im

for f in sorted(os.listdir(os.path.join(ROOT, res))):
    p = f'{res}/{f}/splash.png'
    if os.path.exists(os.path.join(ROOT, p)):
        w, h = Image.open(os.path.join(ROOT, p)).size
        save(splash(w, h), p)

ios = 'ios/App/App/Assets.xcassets'
save(square(1024, 0.92), f'{ios}/AppIcon.appiconset/AppIcon-512@2x.png')
for n in ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']:
    save(splash(2732, 2732), f'{ios}/Splash.imageset/{n}')

save(square(512, 0.94), 'public/icon-512.png')
save(square(192, 0.94), 'public/icon-192.png')
save(square(512, 0.72), 'public/icon-maskable-512.png')
save(square(180, 0.94), 'public/apple-touch-icon.png')
# Favicon intégré au fichier du jeu (petit PNG en base64)
buf = io.BytesIO()
square(64, 0.96).save(buf, 'PNG', optimize=True)
open(os.path.join(ROOT, 'assets/brand/favicon.b64'), 'w').write(base64.b64encode(buf.getvalue()).decode())
print('icônes générées')
buf = io.BytesIO()
square(200, 0.96).save(buf, 'JPEG', quality=85, optimize=True)
open(os.path.join(ROOT, 'assets/brand/boot.b64'), 'w').write(base64.b64encode(buf.getvalue()).decode())
