/* Hand-built environments for the accepted Teddy camera. No gameplay or catalogue writes.
 * Values here are art geometry/materials, not interface tokens. All randomness is seeded.
 */
import * as THREE from './three.module.min.js';

export function buildBiome(kind, kit) {
  const { world, scene, mesh, mat, ball, tube, glow, range, rand, island, tree, flower, sway, growth, particles, skyBackground, lights, makePortal } = kit;
  const pathX = z => Math.sin((z - 6.7) * .17) * .85;
  const warm = '#ffe4a4';
  const palette = {
    grove: ['#2a4a51', '#809f91', '#dae0bb', '#49695e', '#f5e3b3'],
    ocean: ['#0c425c', '#409b9a', '#b7ded1', '#2d686a', '#a4e3d7'],
    magic: ['#33335a', '#ad94af', '#eadbf3', '#56516d', '#efdcb6'],
    galaxy: ['#0b1739', '#39456a', '#adbce5', '#323852', '#d7e6ff'],
    candy: ['#786477', '#f5bfae', '#fff1d9', '#997970', '#ffdbc3'],
    snow: ['#1e3a56', '#8cadbb', '#e0f4ff', '#657f9d', '#f1e6d3'],
    wonder: ['#304956', '#b2c5bd', '#e0eedc', '#657d7d', '#fff0cb'],
  }[kind] || ['#304956', '#b2c5bd', '#e0eedc', '#657d7d', '#fff0cb'];
  skyBackground(palette[0], palette[1]);
  scene.fog = new THREE.FogExp2(palette[1], kind === 'galaxy' ? .006 : .012);
  lights(palette[2], palette[3], 1.6, palette[4], 2.5);
  const luminous = color => mat(color, { emissive: color, emissiveIntensity: .48, roughness: .55 });
  const flat = (color, y = -.06) => {
    const m = mesh(new THREE.PlaneGeometry(130, 160), mat(color), world, 0, y, -35);
    m.rotation.x = -Math.PI / 2;
    return m;
  };
  function ribbon(color, width = 1.9, y = .045, start = 18, end = -42) {
    const positions = [], indices = [];
    for (let i = 0; i <= 100; i++) {
      const z = start + (end - start) * i / 100, x = pathX(z);
      positions.push(x - width, y, z, x + width, y, z);
      if (i < 100) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices); g.computeVertexNormals();
    return mesh(g, mat(color), world);
  }
  function crystal(parent, x, y, z, size, color) {
    const g = new THREE.Group(); parent.add(g); g.position.set(x, y, z);
    for (let i = 0; i < 3; i++) {
      const h = size * (i === 1 ? 1 : .6), dx = (i - 1) * size * .22;
      const c = mesh(new THREE.CylinderGeometry(0, size * .23, h, 5), luminous(color), g, dx, h / 2, 0);
      c.rotation.z = (i - 1) * -.22;
    }
    return g;
  }
  function lantern(x, z, color = warm) {
    const group = new THREE.Group(); world.add(group); group.position.set(x, 0, z);
    mesh(new THREE.CylinderGeometry(.07, .11, .85, 8), mat('#746a6a'), group, 0, .42, 0);
    mesh(new THREE.BoxGeometry(.55, .58, .55), luminous(color), group, 0, 1.02, 0);
    mesh(new THREE.ConeGeometry(.47, .32, 4), mat('#576177'), group, 0, 1.46, 0).rotation.y = Math.PI / 4;
    const light = glow(group, color, 0, 1.02, 0, .001, .65);
    growth.push({ node: light, base: 2.5 });
    return group;
  }
  function cloud(x, y, z, size, color = '#d6d7e6') {
    const m = mat(color);
    for (let j = 0; j < 5; j++) ball(world, x + (j - 2) * size * .6, y + Math.sin(j * 1.8) * size * .2, z, size, size * .42, size * .66, m);
  }
  function star(x, y, z, size, color) {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? size * .45 : size;
      if (!i) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    shape.closePath();
    return mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }), world, x, y, z);
  }
  let portal;
  if (kind === 'grove') {
    flat('#648579'); ribbon('#a5af8a', 2.1);
    // An open, low clearing with pools and broad willows, distinct from the giant-tree corridor.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const z = 8 - i * 5, x = side * range(6.5, 11), size = range(1.3, 1.9);
        tree(world, x, 0, z, size, '#819f79');
        for (let j = 0; j < 5; j++) {
          const dx = x + (j - 2) * .6;
          tube([[dx, 2.7 * size, z], [dx + side * .3, 2.8, z + .4], [dx, 1.4, z + .5]], .07, mat('#749b7e'), world, 14);
        }
      }
      for (let i = 0; i < 5; i++) {
        const x = side * 4.7, z = 6 - i * 7.4;
        ball(world, x, .03, z, 1.8, .18, 2.5, mat('#a2b199'));
        ball(world, x, .19, z, 1.5, .04, 2.15, mat('#689c9e', {metalness:.35, roughness:.18}));
        flower(world, x + side * 1.4, .1, z + 1, 1.2, '#e8ceb3', true);
      }
    }
    for (let i = 0; i < 14; i++) {
      const z = 9 - i * 2.6, x = pathX(z) + (i % 2 ? -1 : 1) * 2.5;
      flower(world, x, 0, z, 1.4, i % 2 ? '#d6c994' : '#c7d9b0', true);
      lantern(x + (i % 2 ? -.7 : .7), z - .7);
    }
    portal = makePortal(world, pathX(-23), .02, -23, 2, warm);
    portal.children[0].material.color.set('#9da88f');
    for (const side of [-1, 1]) for(let i=0;i<3;i++) {
      mesh(new THREE.BoxGeometry(1.7 - i * .2, 1, 1.4), mat('#94a08c'), world, side * 3, .5 + i, -24);
    }
  } else if (kind === 'ocean') {
    flat('#699c98'); ribbon('#c0c5a0');
    const coralMats = ['#e69b97', '#eabb9c', '#85c8bd'].map(luminous);
    for (let i = 0; i < 34; i++) {
      const side = i % 2 ? -1 : 1, z = range(-43, 13), x = side * range(3.4, 14);
      ball(world, x, -.3, z, range(1.2, 3.8), range(.3, 1.1), range(1, 3), mat('#89b1a1'));
      const g = new THREE.Group(); world.add(g); g.position.set(x, 0, z);
      const h = range(1.2, 3.8), cm = coralMats[i % 3];
      tube([[0, 0, 0], [.2, h * .6, 0], [0, h, .1]], .16, cm, g, 12);
      for (const sign of [-1, 1]) {
        tube([[.1, h * .35, 0], [sign * .6, h * .65, .1], [sign * .7, h * .95, .1]], .12, cm, g, 12);
        ball(g, sign * .7, h * .95, .1, .2, .23, .2, cm);
      }
      for (let j = 0; j < 3; j++) {
        const leaf = ball(g, j * .27 - .3, .9, .6, .13, range(.9, 1.8), .2, mat('#448f83'));
        leaf.rotation.z = (j - 1) * .3;
      }
      sway.push({ node: g, phase: rand() * 6, strength: .025 });
    }
    for (let i = 0; i < 16; i++) {
      const z = 8 - i * 2.1, x = pathX(z) + (i % 2 ? -1 : 1) * 2.4;
      const shell = ball(world, x, .2, z, .62, .19, .5, mat('#e4c5b4'));
      shell.rotation.z = .15;
      ball(world, x, .44, z, .2, .2, .2, luminous('#e7f0ce'));
      const pearl = glow(world, '#f0ffe3', x, .45, z, .001, .55);
      growth.push({ node: pearl, base: 1.4 });
    }
    // A rippled surface high above, seen from the sea floor.
    for (let i = 0; i < 7; i++) tube([[-32, 15, -15 - i * 6], [-8, 16, -18 - i * 6], [12, 15.5, -15 - i * 6], [35, 16, -17 - i * 6]], .09, luminous('#7cc6c6'), world, 28);
    for (let i = 0; i < 40; i++) {
      const p = mesh(new THREE.SphereGeometry(range(.06, .2), 8, 8), new THREE.MeshBasicMaterial({ color: '#b4eeed', wireframe: true, transparent: true, opacity: .38 }), world, range(-13, 13), range(.4, 13), range(-39, 10));
      particles.push({ node: p, origin: p.position.clone(), phase: rand() * 8, speed: .3 });
    }
    portal = makePortal(world, pathX(-23), .02, -23, 2, '#e5f4c9');
    portal.children[0].material.color.set('#d5a18f');
    for (const s of [-1, 1]) crystal(world, s * 3.3, 0, -24, 3, '#ddad9e');
  } else if (kind === 'magic' || kind === 'wonder') {
    // Hanging gardens: open sky under a supported bridge, terraces and distant towers.
    ribbon('#b9a6bf');
    for (let i = 0; i < 13; i++) {
      const z = 12 - i * 4.3;
      island(world, pathX(z), -.35, z, 2.7, '#9aac97');
      for (const side of [-1, 1]) {
        const x = side * range(4.8, 11), zz = z - range(0, 2);
        island(world, x, range(-1.8, -.8), zz, range(2.3, 4), '#839c96');
        crystal(world, x, 0, zz, range(1.6, 3.8), '#b7a8df');
        flower(world, x + side, 0, zz + .8, 1.4, i % 2 ? '#f4d5ad' : '#eab4cf', true);
      }
    }
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      const x = side * (9 + i * 2.5), z = -23 - i * 9, h = 7 + i * 2;
      mesh(new THREE.CylinderGeometry(1.1, 1.5, h, 12), mat('#b8a8bc'), world, x, h / 2 - 1, z);
      mesh(new THREE.ConeGeometry(1.9, 3, 12), mat('#776b9b'), world, x, h, z);
      for (let j = 0; j < 3; j++) ball(world, x, 1.5 + j * 2.1, z + 1.25, .24, .5, .1, luminous('#ffe0a3'));
    }
    for (let i = 0; i < 10; i++) {
      const z = 6 - i * 3.2, side = i % 2 ? -1 : 1;
      const light = lantern(side * 2.6, z); light.position.y = 3.5;
      tube([[side * 3.2, 0, z], [side * 3.5, 5.5, z], [side * 2.6, 5.2, z]], .055, mat('#b2ad98'), world, 12);
    }
    for (let i = 0; i < 15; i++) cloud(range(-30, 30), range(-7, -3), -i * 5, range(2, 4));
    portal = makePortal(world, pathX(-23), .02, -23, 2, warm);
    crystal(world, -3.3, 0, -24, 5, '#d0b7e8'); crystal(world, 3.3, 0, -24, 5, '#d0b7e8');
  } else if (kind === 'galaxy') {
    // A solid stepping causeway, floating lunar rocks and a recognisable ringed planet.
    for (let i = 0; i < 42; i++) {
      const z = 18 - i * 1.45;
      const deck = mesh(new THREE.BoxGeometry(3.85, .25, 1.35), mat('#8994b0', { metalness: .25 }), world, pathX(z), -.1, z);
      deck.rotation.y = Math.cos((z - 6.7) * .17) * .14;
      for (const side of [-1, 1]) ball(world, pathX(z) + side * 1.8, .11, z, .09, .045, .5, luminous('#a8ddeb'));
    }
    for (let i = 0; i < 35; i++) {
      const z = range(-63, 12), x = (i % 2 ? -1 : 1) * range(4, 29), size = range(.7, 2.6);
      const rock = mesh(new THREE.IcosahedronGeometry(size, 1), mat('#77819d', { flatShading: true }), world, x, range(-5, 1.5), z);
      rock.rotation.set(rand(), rand(), rand());
      ball(world, x - size * .25, rock.position.y + size * .6, z + size * .4, size * .25, size * .08, size * .25, mat('#525d78'));
    }
    const planet = new THREE.Group(); world.add(planet); planet.position.set(-15, 15, -48); planet.rotation.z = -.32;
    ball(planet, 0, 0, 0, 6, 6, 6, mat('#c0a5b6'));
    const ring = mesh(new THREE.RingGeometry(7.2, 10.4, 96), mat('#e1cbaa', { side: THREE.DoubleSide }), planet);
    ring.rotation.x = -Math.PI * .38;
    ball(world, 19, 12, -53, 3, 3, 3, mat('#a5c8d6'));
    for (let i = 0; i < 100; i++) star(range(-55, 55), range(3, 35), range(-78, -40), range(.07, .26), '#ebdfc1');
    const constellation = [[-6, 9, -29], [-3, 12, -31], [1, 10, -33], [5, 14, -35], [8, 12, -37]];
    tube(constellation, .025, luminous('#9bd8e5'), world, 20);
    constellation.forEach(p => star(...p, .27, warm));
    for (let i = 0; i < 12; i++) lantern((i % 2 ? -1 : 1) * 2.3, 8 - i * 2.7, '#a6e5f3');
    portal = makePortal(world, pathX(-23), .02, -23, 2, '#c9e6ff');
    const orbit = mesh(new THREE.TorusGeometry(3.65, .11, 8, 72), luminous('#d5c4a5'), world, pathX(-23), 2.8, -23.6);
    orbit.rotation.y = .45; orbit.rotation.x = .3;
  } else if (kind === 'candy') {
    flat('#c89a8d'); ribbon('#eed3a4', 2);
    for (let i = 0; i < 35; i++) {
      const z = 16 - i * 1.65;
      mesh(new THREE.BoxGeometry(3.65, .12, 1.45), mat('#d8b47e'), world, pathX(z), -.01, z);
      for (const side of [-1, 1]) ball(world, pathX(z) + side * 1.4, .07, z, .045, .025, .46, mat('#af875b'));
    }
    for (const side of [-1, 1]) {
      tube([[side * 4, -.1, 19], [side * 6, -.1, 0], [side * 4.5, -.1, -18], [side * 7, -.1, -48]], 1.2, mat('#ad775d', { roughness: .32 }), world, 60);
      for (let i = 0; i < 12; i++) {
        const x = side * range(6.5, 18), z = 9 - i * 4.9, size = range(1.3, 3.5);
        ball(world, x, size * .3, z, size, size * .65, size, mat(i % 2 ? '#eac6ce' : '#e8d8bb'));
      }
    }
    for (let i = 0; i < 20; i++) {
      const x = (i % 2 ? -1 : 1) * range(3.4, 8), z = range(-36, 10), h = range(2.5, 5.5);
      mesh(new THREE.CylinderGeometry(.09, .09, h, 10), mat('#f0dfc2'), world, x, h / 2, z);
      const sweet = new THREE.Group(); world.add(sweet); sweet.position.set(x, h, z); sweet.rotation.y = range(-.3, .3);
      ball(sweet, 0, 0, 0, .94, .94, .26, mat(i % 2 ? '#de9bb2' : '#c8ad83'));
      const spiral = [];
      for (let j = 0; j < 75; j++) { const a = j * .19, r = .82 * (1 - j / 82); spiral.push([Math.cos(a) * r, Math.sin(a) * r, .28]); }
      tube(spiral, .065, mat('#fff0ca'), sweet, 75);
    }
    for (let i = 0; i < 16; i++) {
      const z = 8 - i * 2, x = pathX(z) + (i % 2 ? -1 : 1) * 2.5;
      ball(world, x, .25, z, .35, .4, .35, luminous(i % 2 ? '#bce1c5' : '#f3bb9b'));
      const g = glow(world, warm, x, .3, z, .001, .55); growth.push({ node: g, base: 1.4 });
    }
    portal = makePortal(world, pathX(-23), .02, -23, 2, '#ffe0ab');
    portal.children[0].material.color.set('#c6976e');
    const dough = mesh(new THREE.TorusGeometry(3, .65, 16, 48), mat('#d3a16f'), world, pathX(-23), 2.8, -24);
    const icing = mesh(new THREE.TorusGeometry(3, .42, 12, 48), mat('#efc2c6'), world, pathX(-23), 2.8, -23.5);
    dough.scale.y = icing.scale.y = 1.1;
  } else if (kind === 'snow') {
    flat('#b9d0da'); ribbon('#d5e2e2');
    for (const side of [-1, 1]) {
      for (let i = 0; i < 14; i++) {
        const z = 11 - i * 4.6, r = range(2, 4.5), x = side * range(r + 3.3, 19);
        ball(world, x, -.6, z, r, range(.8, 1.7), r * 1.3, mat('#d3e1e4'));
        if (i % 2 === 0) {
          const h = range(4, 8);
          mesh(new THREE.CylinderGeometry(.15, .3, h, 8), mat('#718384'), world, x, h / 2, z);
          for (let j = 0; j < 3; j++) {
            mesh(new THREE.ConeGeometry(1.7 - j * .35, h * .48, 9), mat('#b8d1d4'), world, x, h * .45 + j * h * .19, z);
            mesh(new THREE.ConeGeometry(1.4 - j * .3, h * .36, 9), mat('#e1e9e6'), world, x, h * .52 + j * h * .19, z);
          }
        }
      }
      for (let i = 0; i < 5; i++) mesh(new THREE.ConeGeometry(range(7, 13), range(18, 28), 5), mat(i % 2 ? '#9bb6cb' : '#c1d4df', { flatShading: true }), world, side * (11 + i * 8), 5, -48 - i * 5);
    }
    for (let i = 0; i < 12; i++) lantern((i % 2 ? -1 : 1) * 2.6, 8 - i * 2.7);
    for (let i = 0; i < 12; i++) crystal(world, (i % 2 ? -1 : 1) * range(3.7, 8), 0, range(-35, 6), range(1.2, 3), '#a0cddf');
    // Aurora curtains are translucent ribbons with a broad silhouette, above the valley.
    for (let k = 0; k < 3; k++) {
      const p = [], ix = [];
      for (let i = 0; i <= 48; i++) {
        const x = -39 + i * 1.6, y = 17 + Math.sin(i * .13 + k) * 2.5, z = -45 - k * 6;
        p.push(x, y, z, x, y + 3.8, z);
        if (i < 48) { const n = i * 2; ix.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix);
      mesh(g, new THREE.MeshBasicMaterial({ color: k % 2 ? '#b5b5df' : '#8cd8c5', transparent: true, opacity: .26, side: THREE.DoubleSide, depthWrite: false }), world);
    }
    for (let i = 0; i < 75; i++) {
      const p = glow(world, '#f3f9f2', range(-16, 16), range(1, 13), range(-45, 10), range(.04, .09), .55);
      particles.push({ node: p, origin: p.position.clone(), phase: rand() * 8, speed: .25 });
    }
    portal = makePortal(world, pathX(-23), .02, -23, 2, warm);
    portal.children[0].material.color.set('#b4dbe3');
    crystal(world, -3.2, 0, -24, 5.5, '#b5dfea'); crystal(world, 3.2, 0, -24, 5.5, '#b5dfea');
  }
  return {
    portal,
    update(time, progress) {
      portal.userData.disc.material.uniforms.uTime.value = time;
      portal.userData.disc.material.uniforms.uOpen.value = progress;
    },
  };
}
