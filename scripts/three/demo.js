// A small but realistic three.js scene, for `npm run three:precompile` to capture when no --url is
// given: a textured PBR mesh, a clearcoat material, an unlit one, a point cloud, fog, and a light
// that casts shadows, which is what pulls in the depth programs. Nothing loads from the network and
// nothing is random, so two runs of it render the same picture and the verification pass means
// something.
import * as THREE from "/node_modules/three/build/three.module.js";

const size = { w: 320, h: 240 };

function texture(f) {
  const n = 32, data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const [r, g, b] = f(i % n, Math.floor(i / n));
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n);
  t.needsUpdate = true;
  return t;
}

export function build() {
  const canvas = document.createElement("canvas");
  canvas.width = size.w; canvas.height = size.h;
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x223344);
  scene.fog = new THREE.Fog(0x223344, 6, 22);
  const camera = new THREE.PerspectiveCamera(50, size.w / size.h, 0.1, 100);
  camera.position.set(4, 3.5, 6);
  camera.lookAt(0, 0.6, 0);

  const key = new THREE.DirectionalLight(0xffeedd, 2.4);
  key.position.set(5, 8, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(256, 256);
  scene.add(key, new THREE.AmbientLight(0x405070, 1.1), new THREE.PointLight(0x66ccff, 8, 20));

  const place = (geometry, material, position) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  place(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.9 }), [0, 0, 0])
    .rotation.x = -Math.PI / 2;
  place(new THREE.TorusKnotGeometry(0.8, 0.28, 90, 16), new THREE.MeshStandardMaterial({
    map: texture((x, y) => [x * 8, y * 8, 160]), roughnessMap: texture((x) => [x * 8, 0, 0]),
    metalness: 0.6, roughness: 0.45,
  }), [-1.8, 1.4, 0]);
  place(new THREE.SphereGeometry(0.9, 32, 24), new THREE.MeshPhysicalMaterial({
    color: 0xff5533, clearcoat: 1, clearcoatRoughness: 0.15,
    normalMap: texture((x, y) => [128 + x, 128 + y, 255]),
  }), [1.6, 1.0, 0.4]);
  place(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffcc22 }), [0.2, 0.5, -2.4]);

  let seed = 12345;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const cloud = new THREE.BufferGeometry();
  cloud.setAttribute("position", new THREE.Float32BufferAttribute(
    Array.from({ length: 900 }, () => (random() - 0.5) * 14), 3));
  scene.add(new THREE.Points(cloud, new THREE.PointsMaterial({ color: 0xaaddff, size: 0.09 })));

  return { scene, camera, renderer };
}

/** Compile and draw once. `compile` alone misses the shadow-depth programs; only a render links those. */
export function draw() {
  const { scene, camera, renderer } = build();
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  return renderer;
}

window.__smjsDemo = { draw };
draw();
