import * as THREE from "./three.module.min.js";

// Scene materials, shared by every outfit. Teddy's fur, face and ear tag stay canonical.
const colors = {
  mint: "#92bdac",
  cream: "#eee1b7",
  gold: "#e8c54e",
  rose: "#d57493",
  plum: "#796394",
  ice: "#c4e7ec",
  blue: "#689bb3",
};

/** Dress the existing articulated bear; no separate character or gameplay state. */
export function dressTeddy(bear, kind, { mesh, mat, ball, tube }) {
  const head = bear.userData.head;
  const body = new THREE.Group();
  body.name = "teddy-outfit";
  bear.add(body);
  const hat = new THREE.Group();
  hat.name = "teddy-headwear";
  head.add(hat);
  const cloth = mat(colors.mint),
    trim = mat(colors.cream),
    gold = mat(colors.gold);
  const ring = (parent, radius, thickness, material, x, y, z) =>
    mesh(new THREE.TorusGeometry(radius, thickness, 12, 48), material, parent, x, y, z);
  let moving = null;
  let accessory = kind;

  if (kind === "ocean") {
    // The clear lenses sit in front of the eyes; the muzzle and smile remain uncovered.
    const frame = mat(colors.blue);
    const glass = new THREE.MeshStandardMaterial({
      color: colors.ice,
      transparent: true,
      opacity: 0.12,
      roughness: 0.18,
      depthWrite: false,
    });
    for (const sign of [-1, 1]) {
      const rim = ring(hat, 0.145, 0.027, frame, sign * 0.245, 0.065, 0.573);
      rim.scale.set(1.1, 0.87, 1);
      const lens = mesh(
        new THREE.CircleGeometry(0.143, 32),
        glass,
        hat,
        sign * 0.245,
        0.065,
        0.574,
      );
      lens.scale.set(1.1, 0.87, 1);
    }
    tube(
      [
        [-0.08, 0.065, 0.573],
        [0, 0.1, 0.57],
        [0.08, 0.065, 0.573],
      ],
      0.025,
      frame,
      hat,
      12,
    );
    tube(
      [
        [-0.43, 0.08, 0.52],
        [-0.66, 0.1, 0.06],
        [0, 0.1, -0.54],
        [0.66, 0.1, 0.06],
        [0.43, 0.08, 0.52],
      ],
      0.036,
      cloth,
      hat,
    );
    tube(
      [
        [0.35, -0.24, 0.61],
        [0.73, -0.2, 0.43],
        [0.82, 0.2, 0.16],
        [0.82, 0.83, 0.12],
      ],
      0.048,
      gold,
      hat,
      24,
    );
    ball(hat, 0.82, 0.84, 0.12, 0.075, 0.055, 0.075, frame);
  } else if (kind === "magic") {
    const cape = new THREE.Group();
    cape.position.set(0, 1.48, -0.08);
    body.add(cape);
    // Bell-shaped cloth, open at the front and broad enough to read from the trail camera.
    const geometry = new THREE.CylinderGeometry(
      0.38,
      0.73,
      1.03,
      28,
      8,
      true,
      Math.PI * 0.58,
      Math.PI * 0.84,
    );
    const velvet = mat(colors.plum, { side: THREE.DoubleSide });
    mesh(geometry, velvet, cape, 0, -0.43, -0.1);
    tube(
      [
        [-0.32, 0.01, -0.19],
        [0, 0.1, -0.39],
        [0.32, 0.01, -0.19],
      ],
      0.055,
      trim,
      cape,
      20,
    );
    for (const [x, y, z] of [
      [0, -0.35, -0.68],
      [-0.32, -0.62, -0.62],
      [0.32, -0.62, -0.62],
    ]) {
      const star = mesh(new THREE.OctahedronGeometry(0.075), gold, cape, x, y, z);
      star.scale.set(1, 1.3, 0.35);
    }
    ball(body, 0, 1.48, 0.43, 0.09, 0.09, 0.045, gold);
    moving = cape;
  } else if (kind === "galaxy") {
    const helmet = new THREE.MeshStandardMaterial({
      color: colors.ice,
      transparent: true,
      opacity: 0.1,
      roughness: 0.16,
      depthWrite: false,
    });
    ball(hat, 0, 0.1, 0.035, 0.86, 0.83, 0.81, helmet);
    const collar = ring(body, 0.52, 0.082, trim, 0, 1.45, 0.035);
    collar.rotation.x = Math.PI / 2;
    for (const sign of [-1, 1]) {
      ball(hat, sign * 0.8, 0.04, 0.035, 0.08, 0.18, 0.18, trim);
      ball(hat, sign * 0.86, 0.04, 0.035, 0.035, 0.09, 0.09, gold);
    }
    tube(
      [
        [-0.62, 0.39, 0.37],
        [-0.38, 0.75, 0.26],
        [0, 0.87, 0.07],
        [0.38, 0.75, -0.16],
      ],
      0.023,
      trim,
      hat,
      24,
    );
  } else if (kind === "snow") {
    const wool = mat(colors.rose);
    const brim = ring(hat, 0.5, 0.1, trim, 0, 0.43, 0);
    brim.rotation.x = Math.PI / 2;
    ball(hat, 0, 0.59, -0.01, 0.51, 0.31, 0.47, wool);
    ball(hat, 0.12, 0.89, -0.015, 0.15, 0.15, 0.15, trim);
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      ball(hat, Math.cos(a) * 0.5, 0.43, Math.sin(a) * 0.5, 0.047, 0.097, 0.047, trim);
    }
  } else if (kind === "candy") {
    const ribbon = new THREE.Group();
    ribbon.position.set(0, 1.46, 0.44);
    body.add(ribbon);
    const pink = mat(colors.rose);
    for (const sign of [-1, 1]) {
      const loop = new THREE.Group();
      ribbon.add(loop);
      loop.position.x = sign * 0.2;
      loop.rotation.z = -sign * 0.3;
      ball(loop, 0, 0, 0, 0.23, 0.16, 0.09, pink);
      for (const x of [-0.09, 0.035, 0.15]) ball(loop, x, 0, 0.072, 0.025, 0.125, 0.025, trim);
    }
    ball(ribbon, 0, 0, 0.04, 0.105, 0.105, 0.09, trim);
    const band = ring(body, 0.43, 0.05, pink, 0, 1.48, 0.04);
    band.rotation.x = Math.PI / 2;
    moving = ribbon;
  } else {
    // Both forest compositions and unknown themes retain the accepted knitted scarf.
    accessory = "forest";
    const neck = ring(body, 0.43, 0.12, cloth, 0, 1.48, 0.04);
    neck.rotation.x = Math.PI / 2;
    const tail = new THREE.Group();
    tail.position.set(0.26, 1.24, 0.465);
    tail.rotation.z = -0.13;
    body.add(tail);
    mesh(new THREE.BoxGeometry(0.23, 0.5, 0.075), cloth, tail);
    for (let i = 0; i < 4; i++)
      mesh(new THREE.BoxGeometry(0.234, 0.045, 0.082), trim, tail, 0, 0.18 - i * 0.11, 0);
    moving = tail;
  }
  bear.userData.accessory = accessory;
  return moving;
}
