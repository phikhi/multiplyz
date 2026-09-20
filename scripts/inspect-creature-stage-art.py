"""Inspection sheets and alpha/difference measurements, no catalogue/database writes."""
from PIL import Image, ImageDraw
from pathlib import Path
import json,hashlib
root=Path('assets/creature-stages');out=Path('docs/playthroughs/teddy-evolution');measurements=[]
for world in range(6):
 species=sorted({p.name.rsplit('-ado.png',1)[0] for p in root.glob(f'creature_world_{world}_*-ado.png')})
 if (root/f'legendary_world_{world}-adulte.png').exists():species.append(f'legendary_world_{world}')
 im=Image.new('RGB',(840,len(species)*270),'#263e33');d=ImageDraw.Draw(im)
 for i,s in enumerate(species):
  for j,p in enumerate([Path('test-fixtures/creature')/f'{s}.png',root/f'{s}-ado.png',root/f'{s}-adulte.png']):
   if not p.exists():continue
   a=Image.open(p).convert('RGBA');alpha=a.getchannel('A');hist=alpha.histogram();box=alpha.getbbox()
   measurements.append({'file':str(p),'size':a.size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'alphaBounds':box,'transparentFraction':hist[0]/(a.width*a.height)})
   a.thumbnail((250,240));im.paste(a,(j*280+(280-a.width)//2,i*270),a)
  d.text((10,i*270+245),s,fill='white')
 im.save(out/f'art-world-{world}.png')
(out/'art-measurements.json').write_text(json.dumps(measurements,indent=2)+'\n')
