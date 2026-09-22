// Injected into the page before any of its own scripts run (Playwright addInitScript), so the
// WebGL prototypes are patched before three.js takes a context.
//
// Capture: every linked program, read back from the driver, which is the source the GPU compiles,
// after three.js has prepended its #define prefix and resolved its #include chunks.
// Substitute: swap a captured source for its minified twin on the way to the driver, so the
// verification pass renders the same scene through the same programs and uniforms.
(() => {
  const captured = [];
  let substitutions = null, hits = 0, misses = 0;

  for (const name of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
    const proto = window[name] && window[name].prototype;
    if (!proto) continue;

    const link = proto.linkProgram;
    proto.linkProgram = function (program) {
      try {
        const byType = {};
        for (const shader of this.getAttachedShaders(program) || []) {
          const isVertex = this.getShaderParameter(shader, this.SHADER_TYPE) === this.VERTEX_SHADER;
          byType[isVertex ? "vert" : "frag"] = this.getShaderSource(shader);
        }
        if (byType.vert && byType.frag) captured.push(byType);
      } catch { /* a program we did not build */ }
      return link.call(this, program);
    };

    const source = proto.shaderSource;
    proto.shaderSource = function (shader, text) {
      if (substitutions === null) return source.call(this, shader, text);
      const replacement = substitutions.get(text);
      if (replacement === undefined) misses++; else hits++;
      return source.call(this, shader, replacement === undefined ? text : replacement);
    };
  }

  window.__smjs = {
    /** Every program linked so far, deduplicated by its text. */
    programs: () => {
      const byText = new Map();
      for (const p of captured) byText.set(p.vert + "\u0000" + p.frag, p);
      return [...byText.values()];
    },
    /** From here on, replace these shader texts as they reach the driver. */
    substitute: (pairs) => { substitutions = new Map(pairs); hits = 0; misses = 0; },
    counts: () => ({ hits, misses }),
    /** The pixels of every canvas that has a WebGL context, in document order. */
    pixels: () => {
      const out = [];
      for (const canvas of document.querySelectorAll("canvas")) {
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        if (!gl) continue;
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        out.push(Array.from(px));
      }
      return out;
    },
  };
})();
