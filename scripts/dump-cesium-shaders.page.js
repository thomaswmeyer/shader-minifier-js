// Runs in the page (scripts/dump-cesium-shaders.ts loads it). Cesium assembles a shader from the
// one written in Source/Shaders plus the `czm_` builtins it references plus the automatic
// uniforms, so only a running renderer produces the real thing. Captured the same way as the
// other engines: wrap the WebGL calls and pair each program's two sources at link time.
window.dumpCesiumPrograms = async () => {
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
    s.src = "https://cesium.local/Cesium.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("could not load Cesium.js"));
    document.head.appendChild(s);
  });
  const C = window.Cesium;
  if (!C) throw new Error("Cesium global not defined after loading the bundle");
  C.buildModuleUrl.setBaseUrl("https://cesium.local/");

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  document.body.appendChild(canvas);
  // No imagery and no terrain: both want the network, and neither adds a shader we do not get
  // from the globe itself.
  const scene = new C.Scene({ canvas, contextOptions: { requestWebgl2: true } });
  scene.globe = new C.Globe(C.Ellipsoid.WGS84);
  scene.globe.baseColor = C.Color.DARKSLATEGRAY;
  scene.globe.showGroundAtmosphere = true;

  const settle = async (n) => { for (let i = 0; i < n; i++) { try { scene.render(C.JulianDate.now()); } catch (e) { /* a frame may throw while assets load */ } await new Promise((r) => setTimeout(r, 40)); } };

  const cases = [];
  const mark = (name) => cases.push({ name, from: captured.length });

  mark("globe");
  await settle(30);

  mark("primitives");
  const rect = C.Rectangle.fromDegrees(-10, -10, 10, 10);
  const add = (geometry, appearance) => scene.primitives.add(new C.Primitive({
    geometryInstances: new C.GeometryInstance({ geometry, attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.CORNFLOWERBLUE.withAlpha(0.7)) } }),
    appearance, asynchronous: false,
  }));
  add(new C.RectangleGeometry({ rectangle: rect, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), new C.PerInstanceColorAppearance());
  await settle(20);

  mark("material");
  add(new C.RectangleGeometry({ rectangle: C.Rectangle.fromDegrees(20, -10, 40, 10), vertexFormat: C.EllipsoidSurfaceAppearance.VERTEX_FORMAT }),
    new C.EllipsoidSurfaceAppearance({ material: C.Material.fromType("Stripe") }));
  await settle(20);

  mark("polyline");
  scene.primitives.add(new C.Primitive({
    geometryInstances: new C.GeometryInstance({ geometry: new C.PolylineGeometry({ positions: C.Cartesian3.fromDegreesArray([-30, 0, -20, 10, -10, 0]), width: 6 }) }),
    appearance: new C.PolylineMaterialAppearance({ material: C.Material.fromType("PolylineGlow") }),
    asynchronous: false,
  }));
  await settle(20);

  mark("post-processing");
  scene.postProcessStages.fxaa.enabled = true;
  scene.postProcessStages.bloom.enabled = true;
  await settle(25);

  const results = [];
  const seen = new Set();
  for (let i = 0; i < captured.length; i++) {
    const { vert, frag } = captured[i];
    const key = vert + "\0" + frag;
    if (seen.has(key) || vert.length === 0 || frag.length === 0) continue;
    seen.add(key);
    const owner = [...cases].reverse().find((c) => c.from <= i);
    const base = owner ? owner.name : "cesium";
    let unique = base, k = 2;
    while (results.some((r) => r.name === unique)) unique = `${base}-${k++}`;
    results.push({ name: unique, vert, frag });
  }
  return results;
};
