// Runs in the browser (Playwright), injected by test/pixels.ts. `runShader(cfg)` renders one
// shader with deterministic inputs and returns what it produced, so the node side can compare
// an original against its minified form.
//
//   pixels mode:   a fragment shader drawn over the whole canvas with a generated vertex shader
//                  that feeds every `in`; the result is the RGBA8 pixels.
//   varyings mode: a vertex shader run on generated attributes with rasterization discarded;
//                  every `out` and gl_Position are captured by transform feedback (WebGL2).
//
// Uniforms are set by name, so both shaders must keep their externals (--preserve-externals).
// A few well-known names (resolution, time, mouse) get sensible values; everything else gets a
// hash of its name, textures a hash of their texel. Nothing here is random.
(() => {
  const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const unit = (s) => fnv(s) / 4294967296; // [0, 1)
  const isResolution = (n) => /^(i|u_?|u)?res(olution)?$|^uCRes$|^iChannelResolution/i.test(n);
  const isTime = (n) => /^(i|u_?|u)?t(ime)?$/i.test(n);
  const isMouse = (n) => /^(i|u_?|u)?mouse$/i.test(n);
  const isProgress = (n) => /^progress$/i.test(n); // gl-transitions
  const isRatio = (n) => /^ratio$/i.test(n);

  const scalarTypes = { float: 1, vec2: 2, vec3: 3, vec4: 4, int: 1, ivec2: 2, ivec3: 3, ivec4: 4, uint: 1, uvec2: 2, uvec3: 3, uvec4: 4, bool: 1, bvec2: 2, bvec3: 3, bvec4: 4 };
  const isIntegral = (t) => /^(u?int|[iu]vec[234])$/.test(t);

  window.runShader = function runShader(cfg) {
    const size = cfg.size;
    // Every generated value depends on the seed too, so a case can be rendered with several sets of inputs.
    const seed = cfg.seed || 0;
    const unit = (s) => fnv(`${seed}|${s}`) / 4294967296;
    const texel = (k, x, y, z, c) => fnv(`${seed}|${k}:${x}:${y}:${z}:${c}`) & 255;
    const depthData = (k, w, h) => Uint16Array.from({ length: w * h }, (_, i) => fnv(`${seed}|d${k}:${i}`) & 0xffff);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const gl = canvas.getContext(cfg.version === 2 ? "webgl2" : "webgl", { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false, alpha: true });
    if (!gl) return { ok: false, error: `no WebGL${cfg.version} context` };

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`compile: ${gl.getShaderInfoLog(sh)}`);
      return sh;
    };
    const link = (vs, fs, beforeLink) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      if (beforeLink) beforeLink(p);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
      return p;
    };

    // The j-th float of uniform `name`: a value the case supplies (cfg.uniforms), a well-known
    // name's value, else a hash of the name.
    const supplied = (name, j) => {
      const v = cfg.uniforms && cfg.uniforms[name];
      if (v === undefined) return undefined;
      const arr = Array.isArray(v) ? v : [v];
      const x = arr[j % arr.length];
      return typeof x === "boolean" ? (x ? 1 : 0) : x;
    };
    const floatFor = (name, j) => {
      const s = supplied(name, j);
      if (s !== undefined) return s;
      if (isResolution(name)) return [size, size, 1][j % 3];
      if (isTime(name)) return 3.7 + 1.3 * seed;
      if (isMouse(name)) return [size * (0.5 + 0.1 * seed), size * (0.3 + 0.1 * seed), 0, 0][j % 4];
      if (isProgress(name)) return [0.4, 0.15, 0.8][seed % 3];
      if (isRatio(name)) return 1;
      return 0.3 + 1.4 * unit(`${name}#${j}`);
    };
    const intFor = (name, j) => {
      const s = supplied(name, j);
      if (s !== undefined) return Math.round(s);
      return name === "iFrame" ? 12 : 1 + Math.floor(unit(`${name}#${j}`) * 4);
    };

    let textureUnits = 0;
    const texData = (k, w, h, d) => {
      const data = new Uint8Array(w * h * d * 4);
      for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) data[((z * h + y) * w + x) * 4 + c] = texel(k, x, y, z, c);
      return data;
    };
    // A shadow sampler gets a depth texture in compare mode, with deterministic depths.
    const bindTexture = (target, k, shadow) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + k);
      gl.bindTexture(target, t);
      if (shadow) {
        const faces = target === gl.TEXTURE_CUBE_MAP ? [0, 1, 2, 3, 4, 5].map((f) => gl.TEXTURE_CUBE_MAP_POSITIVE_X + f) : [target];
        for (const face of faces) gl.texImage2D(face, 0, gl.DEPTH_COMPONENT16, 8, 8, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, depthData(k + face, 8, 8));
        gl.texParameteri(target, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
        gl.texParameteri(target, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      } else if (target === gl.TEXTURE_CUBE_MAP) {
        for (let f = 0; f < 6; f++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA, 8, 8, 0, gl.RGBA, gl.UNSIGNED_BYTE, texData(k * 6 + f, 8, 8, 1));
      } else if (target === gl.TEXTURE_2D) {
        gl.texImage2D(target, 0, gl.RGBA, 8, 8, 0, gl.RGBA, gl.UNSIGNED_BYTE, texData(k, 8, 8, 1));
      } else {
        gl.texImage3D(target, 0, gl.RGBA, 4, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, texData(k, 4, 4, 4));
      }
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };

    const setUniforms = (program) => {
      const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      const floatTypes = { [gl.FLOAT]: 1, [gl.FLOAT_VEC2]: 2, [gl.FLOAT_VEC3]: 3, [gl.FLOAT_VEC4]: 4 };
      const intTypes = { [gl.INT]: 1, [gl.INT_VEC2]: 2, [gl.INT_VEC3]: 3, [gl.INT_VEC4]: 4, [gl.BOOL]: 1, [gl.BOOL_VEC2]: 2, [gl.BOOL_VEC3]: 3, [gl.BOOL_VEC4]: 4 };
      const matTypes = { [gl.FLOAT_MAT2]: 2, [gl.FLOAT_MAT3]: 3, [gl.FLOAT_MAT4]: 4 };
      const gl2 = cfg.version === 2 ? gl : {};
      const uintTypes = { [gl2.UNSIGNED_INT]: 1, [gl2.UNSIGNED_INT_VEC2]: 2, [gl2.UNSIGNED_INT_VEC3]: 3, [gl2.UNSIGNED_INT_VEC4]: 4 };
      const samplerTargets = {
        [gl.SAMPLER_2D]: gl.TEXTURE_2D, [gl.SAMPLER_CUBE]: gl.TEXTURE_CUBE_MAP,
        [gl2.SAMPLER_3D]: gl2.TEXTURE_3D, [gl2.SAMPLER_2D_ARRAY]: gl2.TEXTURE_2D_ARRAY,
        [gl2.SAMPLER_2D_SHADOW]: gl.TEXTURE_2D, [gl2.SAMPLER_CUBE_SHADOW]: gl.TEXTURE_CUBE_MAP,
      };
      const shadowSamplers = new Set([gl2.SAMPLER_2D_SHADOW, gl2.SAMPLER_CUBE_SHADOW]);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(program, i);
        const loc = gl.getUniformLocation(program, info.name);
        if (loc === null) continue;
        const name = info.name.replace(/\[0\]$/, "");
        const count = info.size;
        if (info.type in floatTypes) {
          const c = floatTypes[info.type];
          gl[`uniform${c}fv`](loc, Float32Array.from({ length: c * count }, (_, j) => floatFor(name, j)));
        } else if (info.type in intTypes) {
          const c = intTypes[info.type];
          gl[`uniform${c}iv`](loc, Int32Array.from({ length: c * count }, (_, j) => intFor(name, j)));
        } else if (info.type in uintTypes) {
          const c = uintTypes[info.type];
          gl[`uniform${c}uiv`](loc, Uint32Array.from({ length: c * count }, (_, j) => intFor(name, j)));
        } else if (info.type in matTypes) {
          const d = matTypes[info.type];
          const vals = Float32Array.from({ length: d * d * count }, (_, j) => ((j % (d * d)) % (d + 1) === 0 ? 1 : 0) + 0.2 * (unit(`${name}#${j}`) - 0.5));
          gl[`uniformMatrix${d}fv`](loc, false, vals);
        } else if (info.type in samplerTargets) {
          const units = [];
          for (let e = 0; e < count; e++) { bindTexture(samplerTargets[info.type], textureUnits, shadowSamplers.has(info.type)); units.push(textureUnits++); }
          gl.uniform1iv(loc, new Int32Array(units));
        } else {
          throw new Error(`uniform ${info.name}: unsupported type 0x${info.type.toString(16)}`);
        }
      }
    };

    // Every active attribute gets deterministic data in [-1, 1], so a vertex shader has something
    // to transform. A matrix attribute (three.js instanceMatrix) is near-identity per vertex.
    const feedAttributes = (program, vertices) => {
      const n = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
      const floatTypes = { [gl.FLOAT]: 1, [gl.FLOAT_VEC2]: 2, [gl.FLOAT_VEC3]: 3, [gl.FLOAT_VEC4]: 4 };
      const intTypes = { [gl.INT]: 1, [gl.INT_VEC2]: 2, [gl.INT_VEC3]: 3, [gl.INT_VEC4]: 4 };
      const uintTypes = cfg.version === 2 ? { [gl.UNSIGNED_INT]: 1, [gl.UNSIGNED_INT_VEC2]: 2, [gl.UNSIGNED_INT_VEC3]: 3, [gl.UNSIGNED_INT_VEC4]: 4 } : {};
      const matTypes = { [gl.FLOAT_MAT2]: 2, [gl.FLOAT_MAT3]: 3, [gl.FLOAT_MAT4]: 4 };
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveAttrib(program, i);
        const loc = gl.getAttribLocation(program, info.name);
        if (loc < 0) continue; // a builtin like gl_VertexID
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(loc);
        if (info.type in floatTypes) {
          const c = floatTypes[info.type];
          gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from({ length: vertices * c }, (_, j) => 2 * unit(`${info.name}@${j}`) - 1), gl.STATIC_DRAW);
          gl.vertexAttribPointer(loc, c, gl.FLOAT, false, 0, 0);
        } else if (info.type in matTypes) {
          const d = matTypes[info.type];
          gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from({ length: vertices * d * d }, (_, j) => ((j % (d * d)) % (d + 1) === 0 ? 1 : 0) + 0.2 * (unit(`${info.name}@${j}`) - 0.5)), gl.STATIC_DRAW);
          for (let col = 0; col < d; col++) {
            gl.enableVertexAttribArray(loc + col);
            gl.vertexAttribPointer(loc + col, d, gl.FLOAT, false, d * d * 4, col * d * 4);
          }
        } else if (info.type in intTypes || info.type in uintTypes) {
          const c = intTypes[info.type] || uintTypes[info.type];
          const signed = info.type in intTypes;
          const data = (signed ? Int32Array : Uint32Array).from({ length: vertices * c }, (_, j) => Math.floor(unit(`${info.name}@${j}`) * 8) - (signed ? 4 : 0));
          gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
          gl.vertexAttribIPointer(loc, c, signed ? gl.INT : gl.UNSIGNED_INT, 0, 0);
        } else {
          throw new Error(`attribute ${info.name}: unsupported type 0x${info.type.toString(16)}`);
        }
      }
    };

    const checkError = () => {
      const e = gl.getError();
      if (e !== gl.NO_ERROR) throw new Error(`GL error 0x${e.toString(16)}`);
    };

    try {
      if (cfg.mode === "link") { link(cfg.source, cfg.fragmentSource); return { ok: true, data: [] }; }
      if (cfg.mode === "program") return { ok: true, data: renderProgram() };
      if (cfg.mode === "pixels") return { ok: true, data: renderPixels() };
      return { ok: true, data: captureVaryings() };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }

    // A real pair: the vertex shader the file ships with, feeding the fragment shader the file
    // ships with. Nothing here is generated, so a varying that the two halves disagree about is
    // visible, which neither of the single-shader modes can see. The uniform matrices are
    // near-identity and the attributes are in [-1, 1], so the triangles land on screen.
    function renderProgram() {
      const program = link(cfg.source, cfg.fragmentSource);
      gl.useProgram(program);
      setUniforms(program);
      feedAttributes(program, cfg.vertices);
      gl.viewport(0, 0, size, size);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, cfg.vertices - (cfg.vertices % 3));
      const px = new Uint8Array(size * size * 4);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
      checkError();
      return Array.from(px);
    }

    // A vertex shader that draws one triangle over the canvas and feeds every fragment input
    // a smooth function of position, distinct per input.
    function renderPixels() {
      const es3 = cfg.version === 2;
      const lines = [];
      if (es3) lines.push("#version 300 es");
      lines.push(es3 ? "in vec2 aPos;" : "attribute vec2 aPos;");
      const body = [];
      cfg.inputs.forEach((inp, k) => {
        const comps = scalarTypes[inp.type];
        if (comps === undefined) throw new Error(`fragment input ${inp.name}: unsupported type ${inp.type}`);
        const flat = inp.flat || isIntegral(inp.type) ? "flat " : "";
        lines.push(`${flat}${es3 ? "out" : "varying"} ${inp.type} ${inp.name}${inp.array ? `[${inp.size}]` : ""};`);
        for (let e = 0; e < inp.size; e++) {
          const q = `(vec4(aPos, aPos.x * aPos.y, .5) * (1. + ${(k * 0.37 + e * 0.13).toFixed(2)}) + ${(k * 0.11 + e * 0.05).toFixed(2)})`;
          const swz = ["x", "xy", "xyz", "xyzw"][comps - 1];
          const conv = isIntegral(inp.type) ? `${inp.type}(${q}.${swz} * 4.)` : inp.type === "bool" ? `${q}.x > .5` : /^bvec/.test(inp.type) ? `greaterThan(${q}.${swz}, vec${comps}(.5))` : `${q}.${swz}`;
          body.push(`${inp.name}${inp.array ? `[${e}]` : ""} = ${conv};`);
        }
      });
      lines.push(`void main(){ ${body.join(" ")} gl_Position = vec4(aPos, 0., 1.); }`);
      const program = link(lines.join("\n"), cfg.source);
      gl.useProgram(program);
      setUniforms(program);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.viewport(0, 0, size, size);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(size * size * 4);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
      checkError();
      return Array.from(px);
    }

    // The vertex shader's main is wrapped so gl_Position is captured too: `main` is renamed by a
    // macro placed after the #version line, and a new main calls it.
    function captureVaryings() {
      if (cfg.version !== 2) throw new Error("varyings mode needs WebGL2");
      const vertices = cfg.vertices, instances = cfg.instances;
      const src = cfg.source.replace(/^(\s*#version[^\n]*\n)?/, (v) => `${v}#define main _main_orig\n`) + "\n#undef main\nout vec4 _p;void main(){_main_orig();_p=gl_Position;}\n";
      // ANGLE captures neither an array varying nor its elements ("undefined and not supported"), so arrays are left out.
      const outs = [...cfg.inputs.filter((o) => !o.array), { name: "_p", type: "vec4", size: 1 }];
      const names = outs.map((o) => o.name);
      const program = link(src, "#version 300 es\nvoid main(){}", (p) => gl.transformFeedbackVaryings(p, names, gl.INTERLEAVED_ATTRIBS));
      gl.useProgram(program);
      setUniforms(program);

      feedAttributes(program, vertices);

      const comps = outs.reduce((a, o) => a + (scalarTypes[o.type] || 0) * o.size, 0);
      if (outs.some((o) => scalarTypes[o.type] === undefined)) throw new Error("varying of unsupported type: " + outs.filter((o) => scalarTypes[o.type] === undefined).map((o) => `${o.type} ${o.name}`).join(", "));
      const total = vertices * instances * comps;
      const tfBuf = gl.createBuffer();
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, tfBuf);
      gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, new Float32Array(total).fill(-12345), gl.STATIC_READ);
      const tf = gl.createTransformFeedback();
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, tfBuf);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArraysInstanced(gl.POINTS, 0, vertices, instances);
      gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);
      const out = new Float32Array(total);
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
      checkError();
      return Array.from(out);
    }
  };
})();
