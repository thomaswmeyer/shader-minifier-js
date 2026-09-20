// Runs in the page (scripts/dump-babylon-shaders.ts loads it). Babylon assembles a shader per
// material and feature set, so the programs only exist once a scene has rendered. Rather than
// reach into Babylon's own effect registry, this intercepts the WebGL calls: shaderSource records
// each shader's text, attachShader records which shaders a program has, and linkProgram pairs
// them. That is engine-agnostic, so the same trick works for any renderer.
window.dumpBabylonPrograms = async () => {
  const captured = [];
  const srcOf = new WeakMap();
  const attached = new WeakMap();
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const source = proto.shaderSource, attach = proto.attachShader, link = proto.linkProgram;
    proto.shaderSource = function (sh, src) { srcOf.set(sh, src); return source.call(this, sh, src); };
    proto.attachShader = function (p, sh) { attached.set(p, [...(attached.get(p) ?? []), sh]); return attach.call(this, p, sh); };
    proto.linkProgram = function (p) {
      const r = link.call(this, p);
      const shaders = attached.get(p) ?? [];
      const kind = shaders.map((sh) => this.getShaderParameter(sh, this.SHADER_TYPE));
      const v = kind.indexOf(this.VERTEX_SHADER), f = kind.indexOf(this.FRAGMENT_SHADER);
      if (v >= 0 && f >= 0) captured.push({ vert: srcOf.get(shaders[v]) ?? "", frag: srcOf.get(shaders[f]) ?? "" });
      return r;
    };
  }

  // babylon.max.js is a UMD bundle, not a module: load it as a classic script so it defines
  // window.BABYLON.
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://babylon.local/babylon.max.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("could not load babylon.max.js"));
    document.head.appendChild(s);
  });
  const B = window.BABYLON;
  if (!B) throw new Error("BABYLON global not defined after loading the bundle");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const engine = new B.Engine(canvas, false, { preserveDrawingBuffer: false }, false);

  const tex = (scene, k) => {
    const t = new B.RawTexture(new Uint8Array(Array.from({ length: 4 * 4 * 4 }, (_, i) => (i * 37 + k * 11) & 255)), 4, 4, B.Engine.TEXTUREFORMAT_RGBA, scene, false);
    return t;
  };

  const scenes = [];
  // Each entry builds one scene and returns the name for the material under test.
  const cases = {
    StandardMaterial: (scene) => {
      const m = new B.StandardMaterial("std", scene);
      m.diffuseTexture = tex(scene, 1);
      m.specularColor = new B.Color3(1, 1, 1);
      return m;
    },
    "StandardMaterial-bump-fog": (scene) => {
      const m = new B.StandardMaterial("stdb", scene);
      m.diffuseTexture = tex(scene, 2);
      m.bumpTexture = tex(scene, 3);
      m.emissiveTexture = tex(scene, 4);
      m.useParallax = true;
      scene.fogMode = B.Scene.FOGMODE_EXP2;
      return m;
    },
    PBRMaterial: (scene) => {
      const m = new B.PBRMaterial("pbr", scene);
      m.albedoTexture = tex(scene, 5);
      m.metallic = 0.6;
      m.roughness = 0.4;
      return m;
    },
    "PBRMaterial-clearcoat-sheen": (scene) => {
      const m = new B.PBRMaterial("pbr2", scene);
      m.albedoTexture = tex(scene, 6);
      m.bumpTexture = tex(scene, 7);
      m.clearCoat.isEnabled = true;
      m.sheen.isEnabled = true;
      m.anisotropy.isEnabled = true;
      return m;
    },
    PBRMetallicRoughnessMaterial: (scene) => {
      const m = new B.PBRMetallicRoughnessMaterial("pbrmr", scene);
      m.baseTexture = tex(scene, 8);
      m.metallic = 1;
      m.roughness = 0.3;
      return m;
    },
    BackgroundMaterial: (scene) => new B.BackgroundMaterial("bg", scene),
  };

  for (const [name, make] of Object.entries(cases)) {
    const before = captured.length;
    const scene = new B.Scene(engine);
    const camera = new B.FreeCamera("cam", new B.Vector3(0, 1, -5), scene);
    camera.setTarget(B.Vector3.Zero());
    const dir = new B.DirectionalLight("dir", new B.Vector3(-1, -2, 1), scene);
    const point = new B.PointLight("pt", new B.Vector3(2, 2, -2), scene);
    new B.HemisphericLight("hemi", new B.Vector3(0, 1, 0), scene);
    const mesh = B.MeshBuilder.CreateTorusKnot("knot", { radius: 0.8, tube: 0.25, radialSegments: 32, tubularSegments: 8 }, scene);
    mesh.material = make(scene);
    const ground = B.MeshBuilder.CreateGround("ground", { width: 10, height: 10 }, scene);
    ground.position.y = -1.5;
    ground.material = new B.StandardMaterial("groundMat", scene);
    const shadows = new B.ShadowGenerator(256, dir);
    shadows.addShadowCaster(mesh);
    ground.receiveShadows = true;
    point.shadowEnabled = true;
    // Babylon compiles asynchronously, so a render only schedules the work: keep rendering,
    // yielding to the event loop each time, until two rounds produce no new program.
    let quiet = 0;
    for (let i = 0; i < 60 && quiet < 2; i++) {
      const n = captured.length;
      scene.render();
      await new Promise((r) => setTimeout(r, 40));
      quiet = captured.length === n ? quiet + 1 : 0;
    }
    scenes.push({ name, from: before });
    scene.dispose();
  }
  engine.dispose();

  // Name each program after the case that first produced it, and after Babylon's own SHADER_NAME
  // where it wrote one. Duplicate programs (the ground material repeats) are dropped.
  const results = [];
  const seen = new Set();
  for (let i = 0; i < captured.length; i++) {
    const { vert, frag } = captured[i];
    const key = vert + "\0" + frag;
    if (seen.has(key) || vert.length === 0 || frag.length === 0) continue;
    seen.add(key);
    const owner = [...scenes].reverse().find((s) => s.from <= i);
    // Babylon writes `#define SHADER_NAME fragment:pbr`; the part after the colon names the
    // shader it built from, which is what distinguishes the programs one case produces.
    const hint = (/#define SHADER_NAME\s+\w+:(\w+)/.exec(frag) ?? [])[1];
    const case_ = owner ? owner.name : "babylon";
    const base = hint && hint !== "default" ? `${case_}-${hint}` : case_;
    let unique = base, k = 2;
    while (results.some((r) => r.name === unique)) unique = `${base}-${k++}`;
    results.push({ name: unique, vert, frag });
  }
  return results;
};
