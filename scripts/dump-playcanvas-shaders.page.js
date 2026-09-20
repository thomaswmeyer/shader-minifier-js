// Runs in the page (scripts/dump-playcanvas-shaders.ts loads it). Same idea as the Babylon dumper:
// wrap the WebGL calls so every program the engine links is captured with its two sources, then
// build a scene per material feature set and render until nothing new compiles.
window.dumpPlayCanvasPrograms = async () => {
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

  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://playcanvas.local/playcanvas.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("could not load playcanvas.js"));
    document.head.appendChild(s);
  });
  const pc = window.pc;
  if (!pc) throw new Error("pc global not defined after loading the bundle");

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: ["webgl2"], antialias: false });
  const app = new pc.AppBase(canvas);
  app.init({ graphicsDevice: device, componentSystems: [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem], resourceHandlers: [] });
  app.start();

  const texture = (k) => {
    const t = new pc.Texture(device, { width: 4, height: 4, format: pc.PIXELFORMAT_RGBA8 });
    const px = t.lock();
    for (let i = 0; i < px.length; i++) px[i] = (i * 37 + k * 11) & 255;
    t.unlock();
    return t;
  };

  const cases = {
    StandardMaterial: () => {
      const m = new pc.StandardMaterial();
      m.diffuseMap = texture(1);
      m.update();
      return m;
    },
    "StandardMaterial-normal-emissive": () => {
      const m = new pc.StandardMaterial();
      m.diffuseMap = texture(2);
      m.normalMap = texture(3);
      m.emissiveMap = texture(4);
      m.update();
      return m;
    },
    "StandardMaterial-metalness": () => {
      const m = new pc.StandardMaterial();
      m.useMetalness = true;
      m.metalnessMap = texture(5);
      m.glossMap = texture(6);
      m.update();
      return m;
    },
    "StandardMaterial-opacity": () => {
      const m = new pc.StandardMaterial();
      m.opacityMap = texture(7);
      m.blendType = pc.BLEND_NORMAL;
      m.update();
      return m;
    },
  };

  const scenes = [];
  for (const [name, make] of Object.entries(cases)) {
    const before = captured.length;
    const root = new pc.Entity();
    app.root.addChild(root);
    const camera = new pc.Entity();
    camera.addComponent("camera", { clearColor: new pc.Color(0.1, 0.1, 0.1) });
    camera.setPosition(0, 1, 5);
    camera.lookAt(0, 0, 0);
    root.addChild(camera);
    for (const [type, pos] of [["directional", [2, 3, 1]], ["point", [-2, 2, 2]], ["spot", [0, 4, 2]]]) {
      const l = new pc.Entity();
      l.addComponent("light", { type, castShadows: true, shadowResolution: 256 });
      l.setPosition(pos[0], pos[1], pos[2]);
      l.lookAt(0, 0, 0);
      root.addChild(l);
    }
    const mesh = new pc.Entity();
    mesh.addComponent("render", { type: "sphere", castShadows: true, receiveShadows: true });
    root.addChild(mesh);
    mesh.render.material = make();
    const ground = new pc.Entity();
    ground.addComponent("render", { type: "plane", receiveShadows: true });
    ground.setLocalScale(10, 1, 10);
    ground.setPosition(0, -1.5, 0);
    root.addChild(ground);

    let quiet = 0;
    for (let i = 0; i < 60 && quiet < 2; i++) {
      const n = captured.length;
      app.render();
      await new Promise((r) => setTimeout(r, 40));
      quiet = captured.length === n ? quiet + 1 : 0;
    }
    scenes.push({ name, from: before });
    root.destroy();
  }

  const results = [];
  const seen = new Set();
  for (let i = 0; i < captured.length; i++) {
    const { vert, frag } = captured[i];
    const key = vert + "\0" + frag;
    if (seen.has(key) || vert.length === 0 || frag.length === 0) continue;
    seen.add(key);
    const owner = [...scenes].reverse().find((s) => s.from <= i);
    // PlayCanvas writes the shader's definition name into a comment or a #define in some builds.
    const hint = (/#define\s+SHADER_NAME\s+(\w+)/.exec(frag) ?? /\/\/\s*Shader:\s*([\w-]+)/.exec(frag) ?? [])[1];
    // Every PlayCanvas program is a "StandardShader"; the name says nothing, so it is dropped.
    const case_ = owner ? owner.name : "playcanvas";
    const base = hint && hint !== "StandardShader" ? `${case_}-${hint}` : case_;
    let unique = base, k = 2;
    while (results.some((r) => r.name === unique)) unique = `${base}-${k++}`;
    results.push({ name: unique, vert, frag });
  }
  return results;
};
