"""Finish derived Gemini cutouts; original baby art and the published pilot stay intact."""
from pathlib import Path
from PIL import Image, ImageOps

for path in Path('assets/creature-stages').glob('*.png'):
    if path.name.startswith('creature_world_0_0-'):
        continue
    art = Image.open(path).convert('RGBA')
    pixels = art.load()
    for y in range(art.height):
        for x in range(art.width):
            r, g, b, alpha = pixels[x, y]
            # Saturated chroma-key matte, including enclosed holes and edge residue.
            matte = r - g > 65 and b - g > 55
            if path.name == 'creature_world_4_4-ado.png' and y < art.height / 3:
                matte = matte or (r - g > 25 and b - g > 15)
            if matte or alpha < 10:
                pixels[x, y] = (r, g, b, 0)
    if path.name == 'creature_world_5_3-adulte.png':
        # The provider's uneven matte left isolated dust beyond the fish outline.
        seen = set()
        for y in range(art.height):
            for x in range(art.width):
                if (x, y) in seen or not pixels[x, y][3]:
                    continue
                group = [(x, y)]; seen.add((x, y)); cursor = 0
                while cursor < len(group):
                    px, py = group[cursor]; cursor += 1
                    for nx, ny in ((px-1, py), (px+1, py), (px, py-1), (px, py+1)):
                        if 0 <= nx < art.width and 0 <= ny < art.height and (nx, ny) not in seen and pixels[nx, ny][3]:
                            seen.add((nx, ny)); group.append((nx, ny))
                if len(group) < 1000:
                    for px, py in group:
                        r, g, b, _ = pixels[px, py]; pixels[px, py] = (r, g, b, 0)
    bounds = art.getchannel('A').getbbox()
    assert bounds, path
    subject = ImageOps.contain(art.crop(bounds), (640, 640), Image.Resampling.LANCZOS)
    result = Image.new('RGBA', (768, 768))
    result.paste(subject, ((768 - subject.width) // 2, (768 - subject.height) // 2))
    result.save(path)
