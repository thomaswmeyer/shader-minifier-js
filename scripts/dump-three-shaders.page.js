// Runs in the page (scripts/dump-three-shaders.ts loads it): one scene per material feature set, rendered once so shadow and depth
// materials compile too, then every program's sources. Returns [{ name, vert, frag }].
window.dumpThreePrograms = async () => {
  const THREE = await import("https://three.local/three.module.js");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.shadowMap.enabled = true;
  const gl = renderer.getContext();

  const data = (k) => {
    const px = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < px.length; i++) px[i] = (i * 37 + k * 11) & 255;
    const t = new THREE.DataTexture(px, 4, 4);
    t.needsUpdate = true;
    return t;
  };
  const cube = () => {
    const faces = [];
    for (let f = 0; f < 6; f++) {
      const c = document.createElement("canvas"); c.width = c.height = 4;
      const ctx = c.getContext("2d"); ctx.fillStyle = `rgb(${40 * f},${255 - 40 * f},128)`; ctx.fillRect(0, 0, 4, 4);
      faces.push(c);
    }
    const t = new THREE.CubeTexture(faces);
    t.needsUpdate = true;
    return t;
  };
  const gradient = () => { const t = data(9); t.minFilter = t.magFilter = THREE.NearestFilter; return t; };

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 1, 5);
  camera.lookAt(0, 0, 0);
  const lights = () => {
    const d = new THREE.DirectionalLight(0xffffff, 1); d.position.set(2, 3, 1); d.castShadow = true;
    const p = new THREE.PointLight(0xffaa88, 2, 20); p.position.set(-2, 2, 2); p.castShadow = true;
    const s = new THREE.SpotLight(0x88aaff, 2, 20, Math.PI / 6, 0.5); s.position.set(0, 4, 2); s.castShadow = true;
    return [d, p, s, new THREE.HemisphereLight(0xffffff, 0x444444, 0.5), new THREE.AmbientLight(0x202020)];
  };
  const geometry = new THREE.TorusKnotGeometry(0.8, 0.3, 32, 8);
  geometry.computeTangents?.();

  const materials = [];
  const mesh = (m) => m;
  materials.push(["MeshBasicMaterial", new THREE.MeshBasicMaterial({ map: data(1), alphaMap: data(2), envMap: cube(), reflectivity: 0.5 }), mesh]);
  materials.push(["MeshLambertMaterial", new THREE.MeshLambertMaterial({ map: data(1), emissiveMap: data(3), emissive: 0x222222, specularMap: data(4) }), mesh]);
  materials.push(["MeshPhongMaterial", new THREE.MeshPhongMaterial({ map: data(1), normalMap: data(5), bumpMap: data(6), specularMap: data(4), envMap: cube(), displacementMap: data(7) }), mesh]);
  materials.push(["MeshStandardMaterial", new THREE.MeshStandardMaterial({ map: data(1), normalMap: data(5), roughnessMap: data(6), metalnessMap: data(7), aoMap: data(8), emissiveMap: data(3), emissive: 0x111111, envMap: cube() }), mesh]);
  materials.push(["MeshPhysicalMaterial", new THREE.MeshPhysicalMaterial({ map: data(1), normalMap: data(5), clearcoat: 0.5, clearcoatNormalMap: data(6), transmission: 0.5, thickness: 0.5, sheen: 0.5, sheenColorMap: data(7), iridescence: 0.5, anisotropy: 0.5, specularIntensityMap: data(8), envMap: cube() }), mesh]);
  materials.push(["MeshToonMaterial", new THREE.MeshToonMaterial({ map: data(1), gradientMap: gradient() }), mesh]);
  materials.push(["MeshMatcapMaterial", new THREE.MeshMatcapMaterial({ matcap: data(2), normalMap: data(5) }), mesh]);
  materials.push(["MeshNormalMaterial", new THREE.MeshNormalMaterial({ normalMap: data(5) }), mesh]);
  materials.push(["MeshDepthMaterial", new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: data(1) }), mesh]);
  materials.push(["ShadowMaterial", new THREE.ShadowMaterial({ opacity: 0.5 }), mesh]);
  materials.push(["MeshStandardMaterial-fog-vertexColors", new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true }), (m) => {
    const colors = new Float32Array(m.geometry.attributes.position.count * 3).map((_, i) => (i % 7) / 7);
    m.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return m;
  }]);
  materials.push(["MeshStandardMaterial-instanced", new THREE.MeshStandardMaterial({ map: data(1) }), (m) => {
    const inst = new THREE.InstancedMesh(m.geometry, m.material, 4);
    for (let i = 0; i < 4; i++) inst.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i - 1.5, 0, 0));
    inst.castShadow = inst.receiveShadow = true;
    return inst;
  }]);
  materials.push(["MeshStandardMaterial-skinned-morph", new THREE.MeshStandardMaterial({ map: data(1) }), (m) => {
    const g = m.geometry;
    const n = g.attributes.position.count;
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    g.morphAttributes.position = [g.attributes.position.clone()];
    g.morphAttributes.normal = [g.attributes.normal.clone()];
    const bone = new THREE.Bone();
    const skinned = new THREE.SkinnedMesh(g, m.material);
    skinned.add(bone);
    skinned.bind(new THREE.Skeleton([bone]));
    skinned.morphTargetInfluences = [0.5];
    skinned.castShadow = skinned.receiveShadow = true;
    return skinned;
  }]);
  materials.push(["PointsMaterial", new THREE.PointsMaterial({ map: data(1), size: 4, sizeAttenuation: true, vertexColors: false }), (m) => new THREE.Points(m.geometry, m.material)]);
  materials.push(["SpriteMaterial", new THREE.SpriteMaterial({ map: data(1), rotation: 0.3 }), (m) => new THREE.Sprite(m.material)]);
  materials.push(["LineDashedMaterial", new THREE.LineDashedMaterial({ dashSize: 0.2, gapSize: 0.1 }), (m) => { const l = new THREE.Line(m.geometry.toNonIndexed(), m.material); l.computeLineDistances(); return l; }]);

  const results = [];
  const seen = new Set();
  for (const [name, material, wrap] of materials) {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x101010, 0.05);
    for (const l of lights()) scene.add(l);
    const m = new THREE.Mesh(geometry.clone(), material);
    m.castShadow = m.receiveShadow = true;
    scene.add(wrap(m));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: 0x808080 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.5; floor.receiveShadow = true;
    scene.add(floor);
    renderer.render(scene, camera);
    for (const p of renderer.info.programs ?? []) {
      const vert = gl.getShaderSource(p.vertexShader) ?? "";
      const frag = gl.getShaderSource(p.fragmentShader) ?? "";
      const key = vert + "\0" + frag;
      if (seen.has(key)) continue;
      seen.add(key);
      // three.js writes the material type into every program; the material under test gets the
      // variant name, the floor's own MeshStandardMaterial and the shadow-pass depth and distance
      // materials come along under their type names.
      const type = (/#define SHADER_TYPE (\w+)/.exec(frag) ?? /#define SHADER_NAME (\w+)/.exec(frag) ?? [, p.name || "program"])[1];
      const base = type === material.type ? name : type;
      let unique = base, k = 2;
      while (results.some((r) => r.name === unique)) unique = `${base}-${k++}`;
      results.push({ name: unique, vert, frag });
    }
  }
  return results;
};
