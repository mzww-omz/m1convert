"""Generate independent Phase 6 TIFF fixtures with Pillow (test tooling only)."""
from pathlib import Path
from PIL import Image

out = Path(__file__).resolve().parent.parent / 'tests/fixtures'
image = Image.new('RGB', (32, 16))
image.putdata([(255, 0, 128) if x < 16 else (0, 255, 64) for y in range(16) for x in range(32)])
image.save(out / 'phase6-packbits.tiff', compression='packbits')
for mode in ['I;16', 'I;16B']:
    image = Image.new(mode, (32, 16))
    for y in range(16):
        for x in range(32):
            image.putpixel((x, y), x * 2114)
    image.save(out / ('phase6-gray16' + ('be' if mode.endswith('B') else 'le') + '.tiff'), compression='raw')
