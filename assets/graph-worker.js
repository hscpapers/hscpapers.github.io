// Renders fractal / domain-colouring bands progressively: coarse blocks first, then finer passes.
"use strict";

var BAND = 16;

// Cyclic palette for escape-time colouring: deep navy, blue, near white, amber, red.
var LUT = (function () {
  var stops = [[0, 8, 10, 24], [0.16, 26, 64, 140], [0.42, 237, 240, 250], [0.64, 244, 168, 48], [0.85, 160, 32, 24], [1, 8, 10, 24]];
  var n = 1024, out = new Uint8Array(n * 3);
  for (var k = 0; k < n; k++) {
    var t = k / n, s = 0;
    while (stops[s + 1][0] < t) s++;
    var a = stops[s], b = stops[s + 1], f = (t - a[0]) / (b[0] - a[0]);
    f = f * f * (3 - 2 * f);
    for (var c = 0; c < 3; c++) out[k * 3 + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * f);
  }
  return out;
})();

function hsl(h, s, l, out, o) {
  var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  function ch(t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  }
  out[o] = ch(h + 1 / 3) * 255; out[o + 1] = ch(h) * 255; out[o + 2] = ch(h - 1 / 3) * 255;
}

var current = null;
var chan = new MessageChannel();
chan.port1.onmessage = step;

onmessage = function (e) {
  var d = e.data;
  if (d.type === "cancel") { current = null; return; }
  if (d.type !== "job") return;
  try { d.fn = new Function("return " + d.code)(); }
  catch (err) { postMessage({ type: "error", id: d.id, msg: String(err) }); return; }
  if (!d.bands.length) { current = null; postMessage({ type: "done", id: d.id }); return; }
  d.bufs = {};
  d.pass = 0; d.bandPos = 0; d.row = -1;
  d.lnDeg = Math.log(d.degree || 2);
  d.rgb = new Float64Array(3);
  d.w = new Float64Array(2);
  current = d;
  chan.port2.postMessage(0);
};

function step() {
  var job = current;
  if (!job) return;
  var t0 = performance.now();
  while (performance.now() - t0 < 8) {
    var band = job.bands[job.bandPos];
    var y0 = band * BAND, bh = Math.min(BAND, job.height - y0);
    var buf = job.bufs[band] || (job.bufs[band] = new Uint8ClampedArray(job.width * bh * 4));
    var b = job.passes[job.pass], pb = job.pass ? job.passes[job.pass - 1] : 0;
    if (job.row < 0) job.row = 0;
    renderRow(job, buf, y0, job.row, bh, b, pb);
    job.row += b;
    if (job.row < bh) continue;
    var copy = buf.slice();
    postMessage({ type: "band", id: job.id, band: band, b: b, buf: copy.buffer }, [copy.buffer]);
    job.row = -1;
    if (++job.bandPos >= job.bands.length) {
      job.bandPos = 0;
      if (++job.pass >= job.passes.length) { postMessage({ type: "done", id: job.id }); current = null; return; }
    }
  }
  chan.port2.postMessage(0);
}

function renderRow(job, buf, y0, ly, bh, b, pb) {
  var W = job.width, y = y0 + ly, fn = job.fn;
  var im = job.top - (y + 0.5) * job.scale;
  var fractal = job.kind === "fractal", rgb = job.rgb, w = job.w;
  var maxIter = job.maxIter, bail = job.bail, lnDeg = job.lnDeg;
  for (var x = 0; x < W; x += b) {
    if (pb && x % pb === 0 && y % pb === 0) continue;
    var re = job.left + (x + 0.5) * job.scale, r, g, bl;
    if (fractal) {
      var nu = fn(re, im, maxIter, bail, lnDeg);
      if (nu < 0) { r = 6; g = 7; bl = 10; }
      else {
        var k = ((Math.sqrt(nu) * 0.16 + 0.12) % 1 + 1) % 1, li = (k * 1024 | 0) * 3;
        r = LUT[li]; g = LUT[li + 1]; bl = LUT[li + 2];
      }
    } else {
      fn(re, im, w);
      var wr = w[0], wi = w[1], m = Math.sqrt(wr * wr + wi * wi);
      if (m !== m) { r = g = bl = 128; }
      else if (m === Infinity) { r = g = bl = 255; }
      else {
        var hue = Math.atan2(wi, wr) / (2 * Math.PI) + 1;
        var lg = Math.log(m) / Math.LN2, band = lg - Math.floor(lg);
        var l = (0.06 + 0.86 * (2 / Math.PI) * Math.atan(m)) * (0.8 + 0.2 * band);
        hsl(hue % 1, 0.85, l, rgb, 0);
        r = rgb[0]; g = rgb[1]; bl = rgb[2];
      }
    }
    var xe = Math.min(x + b, W), ye = Math.min(ly + b, bh);
    for (var yy = ly; yy < ye; yy++) {
      var o = (yy * W + x) * 4;
      for (var xx = x; xx < xe; xx++, o += 4) { buf[o] = r; buf[o + 1] = g; buf[o + 2] = bl; buf[o + 3] = 255; }
    }
  }
}
