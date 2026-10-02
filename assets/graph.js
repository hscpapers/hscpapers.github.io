(function () {
  "use strict";

  // =====================================================================
  // Parsing
  // =====================================================================

  var BUILTINS = ["arcsin", "arccos", "arctan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "sin", "cos", "tan",
    "sec", "csc", "cot", "exp", "ln", "log", "sqrt", "cbrt", "abs", "floor", "ceil", "round", "sign", "min", "max",
    "mod", "conj", "real", "imag", "arg"];
  var ALIAS = { arcsin: "asin", arccos: "acos", arctan: "atan" };
  var NAMED = ["theta", "pi", "tau"];
  var RESERVED = { x: 1, y: 1, t: 1, "θ": 1, r: 1, z: 1, w: 1, e: 1, i: 1, pi: 1, tau: 1 };

  function GraphError(msg, missing) { this.message = msg; this.missing = missing || []; }

  function tokenize(src, userFns) {
    src = src.replace(/[·×]/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/≤/g, "<=").replace(/≥/g, ">=")
      .replace(/→/g, "->").replace(/\*\*/g, "^").replace(/π/g, "pi").replace(/τ/g, "tau");
    var out = [], p = 0;
    while (p < src.length) {
      var ch = src[p], rest = src.slice(p), m;
      if (/\s/.test(ch)) { p++; continue; }
      if ((m = /^(\d+\.?\d*|\.\d+)/.exec(rest))) { out.push({ k: "num", v: parseFloat(m[1]) }); p += m[1].length; continue; }
      var two = rest.slice(0, 2);
      if (two === "<=" || two === ">=" || two === "->" || two === "==") { out.push({ k: "op", v: two === "==" ? "=" : two }); p += 2; continue; }
      if ("+-*/^(),|!=<>".indexOf(ch) >= 0) { out.push({ k: "op", v: ch }); p++; continue; }
      if (/[A-Za-zθ]/.test(ch)) {
        var hit = null, j;
        for (j = 0; j < BUILTINS.length; j++) if (rest.indexOf(BUILTINS[j]) === 0) { hit = { k: "fn", v: ALIAS[BUILTINS[j]] || BUILTINS[j] }; p += BUILTINS[j].length; break; }
        if (!hit) for (j = 0; j < NAMED.length; j++) if (rest.indexOf(NAMED[j]) === 0) { hit = { k: "id", v: NAMED[j] === "theta" ? "θ" : NAMED[j] }; p += NAMED[j].length; break; }
        if (!hit) {
          m = /^[A-Za-zθ](_[A-Za-z0-9]+)?/.exec(rest);
          hit = { k: "id", v: m[0] }; p += m[0].length;
        }
        out.push(hit);
        continue;
      }
      throw new GraphError("can't read “" + ch + "”");
    }
    return out;
  }

  function parse(src, userFns) {
    var toks = tokenize(src, userFns), p = 0, absDepth = 0;
    function peek() { return toks[p]; }
    function isOp(v) { var t = toks[p]; return t && t.k === "op" && t.v === v; }
    function expect(v) { if (!isOp(v)) throw new GraphError(p < toks.length ? "expected “" + v + "”" : "unfinished expression"); p++; }
    function startsFactor() {
      var t = toks[p];
      if (!t) return false;
      if (t.k !== "op") return true;
      return t.v === "(" || (t.v === "|" && absDepth === 0);
    }
    function args() {
      expect("(");
      var a = [expr()];
      while (isOp(",")) { p++; a.push(expr()); }
      expect(")");
      return a;
    }
    function primary() {
      var t = toks[p++];
      if (!t) throw new GraphError("unfinished expression");
      if (t.k === "num") return { t: "num", v: t.v };
      if (t.k === "op" && t.v === "(") {
        var items = [expr()];
        while (isOp(",")) { p++; items.push(expr()); }
        expect(")");
        return items.length > 1 ? { t: "tuple", items: items } : items[0];
      }
      if (t.k === "op" && t.v === "|") {
        absDepth++;
        var a = expr();
        absDepth--;
        expect("|");
        return { t: "call", f: "abs", args: [a] };
      }
      if (t.k === "fn") {
        var ex = null;
        if (isOp("^")) { p++; ex = unary(); }
        var node = { t: "call", f: t.v, args: isOp("(") ? args() : [implicitArg()] };
        return ex ? { t: "bin", op: "^", a: node, b: ex } : node;
      }
      if (t.k === "id") {
        if (userFns[t.v] && isOp("(")) return { t: "ucall", n: t.v, args: args() };
        if (t.v === "pi") return { t: "num", v: Math.PI };
        if (t.v === "tau") return { t: "num", v: 2 * Math.PI };
        if (t.v === "e") return { t: "num", v: Math.E };
        if (t.v === "i") return { t: "i" };
        return { t: "var", n: t.v };
      }
      throw new GraphError("unexpected “" + t.v + "”");
    }
    function postfix() {
      var a = primary();
      while (isOp("!")) { p++; a = { t: "fact", a: a }; }
      return a;
    }
    function power() {
      var base = postfix();
      if (isOp("^")) { p++; return { t: "bin", op: "^", a: base, b: unary() }; }
      return base;
    }
    function implicitArg() {
      var a = isOp("-") ? (p++, { t: "neg", a: power() }) : power();
      while (startsFactor() && peek().k !== "fn") a = { t: "bin", op: "*", a: a, b: power() };
      return a;
    }
    function unary() {
      if (isOp("-")) { p++; return { t: "neg", a: unary() }; }
      if (isOp("+")) { p++; return unary(); }
      return power();
    }
    function term() {
      var a = unary();
      for (;;) {
        if (isOp("*") || isOp("/")) { var o = toks[p++].v; a = { t: "bin", op: o, a: a, b: unary() }; }
        else if (startsFactor()) a = { t: "bin", op: "*", a: a, b: power() };
        else return a;
      }
    }
    function expr() {
      var a = term();
      while (isOp("+") || isOp("-")) { var o = toks[p++].v; a = { t: "bin", op: o, a: a, b: term() }; }
      return a;
    }
    if (!toks.length) return null;
    var lhs = expr(), t = peek(), op = null, rhs = null;
    if (t && t.k === "op" && ["=", "<", ">", "<=", ">=", "->"].indexOf(t.v) >= 0) { p++; op = t.v; rhs = expr(); }
    if (p < toks.length) throw new GraphError("unexpected “" + toks[p].v + "”");
    return { op: op, lhs: lhs, rhs: rhs };
  }

  // =====================================================================
  // AST helpers
  // =====================================================================

  function substitute(n, map) {
    switch (n.t) {
      case "var": return map.hasOwnProperty(n.n) ? map[n.n] : n;
      case "neg": case "fact": return { t: n.t, a: substitute(n.a, map) };
      case "bin": return { t: "bin", op: n.op, a: substitute(n.a, map), b: substitute(n.b, map) };
      case "call": case "ucall": return { t: n.t, f: n.f, n: n.n, args: n.args.map(function (x) { return substitute(x, map); }) };
      case "tuple": return { t: "tuple", items: n.items.map(function (x) { return substitute(x, map); }) };
      default: return n;
    }
  }

  function inline(n, fns, depth) {
    depth = depth || 0;
    if (depth > 30) throw new GraphError("functions call each other in a loop");
    switch (n.t) {
      case "ucall":
        var def = fns[n.n];
        if (n.args.length !== def.params.length) throw new GraphError(n.n + " takes " + def.params.length + " input" + (def.params.length > 1 ? "s" : ""));
        var map = {};
        def.params.forEach(function (prm, k) { map[prm] = inline(n.args[k], fns, depth); });
        return inline(substitute(def.body, map), fns, depth + 1);
      case "neg": case "fact": return { t: n.t, a: inline(n.a, fns, depth) };
      case "bin": return { t: "bin", op: n.op, a: inline(n.a, fns, depth), b: inline(n.b, fns, depth) };
      case "call": return { t: "call", f: n.f, args: n.args.map(function (x) { return inline(x, fns, depth); }) };
      case "tuple": return { t: "tuple", items: n.items.map(function (x) { return inline(x, fns, depth); }) };
      default: return n;
    }
  }

  function freeVars(n, out) {
    out = out || {};
    switch (n.t) {
      case "var": out[n.n] = 1; break;
      case "neg": case "fact": freeVars(n.a, out); break;
      case "bin": freeVars(n.a, out); freeVars(n.b, out); break;
      case "call": case "ucall": n.args.forEach(function (x) { freeVars(x, out); }); break;
      case "tuple": n.items.forEach(function (x) { freeVars(x, out); }); break;
    }
    return out;
  }

  function hasI(n) {
    switch (n.t) {
      case "i": return true;
      case "neg": case "fact": return hasI(n.a);
      case "bin": return hasI(n.a) || hasI(n.b);
      case "call": case "ucall": return n.args.some(hasI);
      case "tuple": return n.items.some(hasI);
      default: return false;
    }
  }

  // =====================================================================
  // Complex arithmetic (constants, value display, constant folding)
  // =====================================================================

  var Cx = {
    add: function (a, b) { return [a[0] + b[0], a[1] + b[1]]; },
    sub: function (a, b) { return [a[0] - b[0], a[1] - b[1]]; },
    mul: function (a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; },
    div: function (a, b) { var d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; },
    exp: function (a) { var e = Math.exp(a[0]); return [e * Math.cos(a[1]), e * Math.sin(a[1])]; },
    ln: function (a) { return [Math.log(Math.hypot(a[0], a[1])), Math.atan2(a[1], a[0])]; },
    log: function (a) { var l = Cx.ln(a); return [l[0] / Math.LN10, l[1] / Math.LN10]; },
    pow: function (a, b) {
      if (a[1] === 0 && b[1] === 0) { var rp = realPow(a[0], b[0]); if (rp === rp) return [rp, 0]; }
      if (a[0] === 0 && a[1] === 0) return b[0] === 0 && b[1] === 0 ? [1, 0] : [0, 0];
      return Cx.exp(Cx.mul(b, Cx.ln(a)));
    },
    sqrt: function (a) { return Cx.pow(a, [0.5, 0]); },
    sin: function (a) { return [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])]; },
    cos: function (a) { return [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])]; },
    tan: function (a) { return Cx.div(Cx.sin(a), Cx.cos(a)); },
    sinh: function (a) { return [Math.sinh(a[0]) * Math.cos(a[1]), Math.cosh(a[0]) * Math.sin(a[1])]; },
    cosh: function (a) { return [Math.cosh(a[0]) * Math.cos(a[1]), Math.sinh(a[0]) * Math.sin(a[1])]; },
    tanh: function (a) { return Cx.div(Cx.sinh(a), Cx.cosh(a)); },
    abs: function (a) { return [Math.hypot(a[0], a[1]), 0]; },
    conj: function (a) { return [a[0], -a[1]]; },
    real: function (a) { return [a[0], 0]; },
    imag: function (a) { return [a[1], 0]; },
    arg: function (a) { return [Math.atan2(a[1], a[0]), 0]; }
  };

  function realPow(a, b) {
    if (a < 0 && b !== Math.round(b)) {
      for (var q = 3; q <= 15; q += 2) {
        var pq = b * q;
        if (Math.abs(pq - Math.round(pq)) < 1e-9) return (Math.round(pq) % 2 === 0 ? 1 : -1) * Math.pow(-a, b);
      }
      return NaN;
    }
    return Math.pow(a, b);
  }

  function gamma(z) {
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    var g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
      12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    z -= 1;
    var x = c[0];
    for (var k = 1; k < g + 2; k++) x += c[k] / (z + k);
    var t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }

  // Real-only helpers shared by the compiled real functions and the complex evaluator.
  var RX = {
    P: realPow,
    F: function (n) {
      if (n === Math.round(n)) { if (n < 0) return NaN; if (n > 170) return Infinity; var r = 1; for (var k = 2; k <= n; k++) r *= k; return r; }
      return gamma(n + 1);
    },
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    sec: function (x) { return 1 / Math.cos(x); }, csc: function (x) { return 1 / Math.sin(x); }, cot: function (x) { return 1 / Math.tan(x); },
    asin: function (x, y) { return Math.asin(x); }, acos: Math.acos,
    atan: function (y, x) { return x === undefined ? Math.atan(y) : Math.atan2(y, x); },
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log10,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
    min: Math.min, max: Math.max,
    mod: function (a, b) { return ((a % b) + b) % b; },
    conj: function (x) { return x; }, real: function (x) { return x; }, imag: function () { return 0; },
    arg: function (x) { return x < 0 ? Math.PI : 0; }
  };

  function evalC(n, env) {
    switch (n.t) {
      case "num": return [n.v, 0];
      case "i": return [0, 1];
      case "var":
        if (env.hasOwnProperty(n.n)) return env[n.n];
        throw new GraphError(n.n + " isn't defined", [n.n]);
      case "neg": var a = evalC(n.a, env); return [0 - a[0], 0 - a[1]];
      case "fact":
        var f = evalC(n.a, env);
        if (f[1] !== 0) throw new GraphError("! needs a real number");
        return [RX.F(f[0]), 0];
      case "bin":
        var x = evalC(n.a, env), y = evalC(n.b, env);
        return n.op === "+" ? Cx.add(x, y) : n.op === "-" ? Cx.sub(x, y) : n.op === "*" ? Cx.mul(x, y) : n.op === "/" ? Cx.div(x, y) : Cx.pow(x, y);
      case "call":
        var as = n.args.map(function (q) { return evalC(q, env); });
        if (Cx[n.f] && as.length === 1) return Cx[n.f](as[0]);
        if (as.some(function (q) { return q[1] !== 0; })) throw new GraphError(n.f + " needs real numbers");
        return [RX[n.f].apply(null, as.map(function (q) { return q[0]; })), 0];
      case "tuple": throw new GraphError("a point can't go here");
    }
    throw new GraphError("can't evaluate this");
  }

  // =====================================================================
  // Real compiler -> JS function
  // =====================================================================

  function lit(v) {
    if (v !== v) return "NaN";
    if (v === Infinity) return "Infinity";
    if (v === -Infinity) return "(-Infinity)";
    return v < 0 ? "(" + v + ")" : String(v);
  }

  function genR(n, vars, consts) {
    switch (n.t) {
      case "num": return lit(n.v);
      case "i": throw new GraphError("i only works with z (complex mode)");
      case "var":
        if (vars.hasOwnProperty(n.n)) return vars[n.n];
        if (consts.hasOwnProperty(n.n)) {
          var c = consts[n.n];
          if (c[1] !== 0) throw new GraphError(n.n + " is complex, so it can only be used with z");
          return lit(c[0]);
        }
        throw new GraphError(n.n + " isn't defined", [n.n]);
      case "neg": return "(-" + genR(n.a, vars, consts) + ")";
      case "fact": return "H.F(" + genR(n.a, vars, consts) + ")";
      case "bin":
        var a = genR(n.a, vars, consts);
        if (n.op === "^") {
          if (n.b.t === "num" && n.b.v === 2) return "(" + a + "*" + a + ")";
          return "H.P(" + a + "," + genR(n.b, vars, consts) + ")";
        }
        return "(" + a + n.op + genR(n.b, vars, consts) + ")";
      case "call":
        return "H." + n.f + "(" + n.args.map(function (q) { return genR(q, vars, consts); }).join(",") + ")";
      case "tuple": throw new GraphError("a point can't go here");
    }
    throw new GraphError("can't compile this");
  }

  function compileReal1(n, p, consts) {
    var vars = {}; vars[p] = p === "θ" ? "q" : p;
    var f = new Function("H", vars[p], "return " + genR(n, vars, consts) + ";");
    return function (v) { return f(RX, v); };
  }

  function compileReal2(n, consts) {
    var f = new Function("H", "x", "y", "return " + genR(n, { x: "x", y: "y" }, consts) + ";");
    return function (x, y) { return f(RX, x, y); };
  }

  // =====================================================================
  // Complex compiler -> scalar JS source for the workers
  // =====================================================================

  function CGen(consts, pixelC) { this.lines = []; this.k = 0; this.consts = consts; this.pixelC = pixelC; }
  CGen.prototype.tmp = function () { return "v" + this.k++; };
  CGen.prototype.pair = function (r, i) {
    var a = this.tmp(), b = this.tmp();
    this.lines.push("var " + a + "=" + r + "," + b + "=" + i + ";");
    return { r: a, i: b };
  };
  CGen.prototype.dynamic = function (n) {
    var fv = freeVars(n);
    return fv.z || (fv.c && this.pixelC);
  };
  CGen.prototype.mul = function (a, b) {
    if (a.c && a.c[1] === 0) return this.pair(lit(a.c[0]) + "*" + b.r, lit(a.c[0]) + "*" + b.i);
    if (b.c && b.c[1] === 0) return this.pair(a.r + "*" + lit(b.c[0]), a.i + "*" + lit(b.c[0]));
    if (a.r === b.r && a.i === b.i) return this.pair(a.r + "*" + a.r + "-" + a.i + "*" + a.i, "2*" + a.r + "*" + a.i);
    return this.pair(a.r + "*" + b.r + "-" + a.i + "*" + b.i, a.r + "*" + b.i + "+" + a.i + "*" + b.r);
  };
  CGen.prototype.div = function (a, b) {
    if (b.c && b.c[1] === 0) return this.pair(a.r + "/" + lit(b.c[0]), a.i + "/" + lit(b.c[0]));
    var d = this.tmp();
    this.lines.push("var " + d + "=" + b.r + "*" + b.r + "+" + b.i + "*" + b.i + ";");
    return this.pair("(" + a.r + "*" + b.r + "+" + a.i + "*" + b.i + ")/" + d, "(" + a.i + "*" + b.r + "-" + a.r + "*" + b.i + ")/" + d);
  };
  CGen.prototype.expOf = function (r, i) {
    var e = this.tmp();
    this.lines.push("var " + e + "=Math.exp(" + r + ");");
    return this.pair(e + "*Math.cos(" + i + ")", e + "*Math.sin(" + i + ")");
  };
  CGen.prototype.gen = function (n) {
    if (!this.dynamic(n)) {
      var v = evalC(n, this.consts);
      return { r: lit(v[0]), i: lit(v[1]), c: v };
    }
    var a, b;
    switch (n.t) {
      case "var":
        if (n.n === "z") return { r: "zr", i: "zi" };
        return { r: "cr", i: "ci" };
      case "neg":
        a = this.gen(n.a);
        return this.pair("-" + a.r, "-" + a.i);
      case "fact": throw new GraphError("! doesn't work on complex numbers");
      case "bin":
        a = this.gen(n.a);
        if (n.op === "^") return this.pow(a, n.b);
        b = this.gen(n.b);
        if (n.op === "+") return this.pair(a.r + "+" + b.r, a.i + "+" + b.i);
        if (n.op === "-") return this.pair(a.r + "-" + b.r, a.i + "-" + b.i);
        if (n.op === "*") return this.mul(a, b);
        return this.div(a, b);
      case "call":
        if (n.args.length !== 1) throw new GraphError(n.f + " doesn't work on complex numbers");
        a = this.gen(n.args[0]);
        return this.fn(n.f, a);
      case "tuple": throw new GraphError("a point can't go here");
    }
    throw new GraphError("can't compile this");
  };
  CGen.prototype.pow = function (a, bn) {
    var b = this.gen(bn);
    if (b.c && b.c[1] === 0 && b.c[0] === Math.round(b.c[0]) && Math.abs(b.c[0]) <= 64) {
      var e = Math.abs(b.c[0]);
      if (e === 0) return { r: "1", i: "0", c: [1, 0] };
      var acc = null, base = a;
      while (e > 0) {
        if (e & 1) acc = acc ? this.mul(acc, base) : base;
        e >>= 1;
        if (e) base = this.mul(base, base);
      }
      return b.c[0] < 0 ? this.div({ r: "1", i: "0", c: [1, 0] }, acc) : acc;
    }
    if (a.c && a.c[0] === Math.E && a.c[1] === 0) return this.expOf(b.r, b.i);
    var lm = this.tmp(), an = this.tmp();
    this.lines.push("var " + lm + "=0.5*Math.log(" + a.r + "*" + a.r + "+" + a.i + "*" + a.i + ")," + an + "=Math.atan2(" + a.i + "," + a.r + ");");
    if (b.c && b.c[1] === 0) return this.expOf(lit(b.c[0]) + "*" + lm, lit(b.c[0]) + "*" + an);
    var er = this.tmp(), ei = this.tmp();
    this.lines.push("var " + er + "=" + b.r + "*" + lm + "-" + b.i + "*" + an + "," + ei + "=" + b.r + "*" + an + "+" + b.i + "*" + lm + ";");
    return this.expOf(er, ei);
  };
  CGen.prototype.fn = function (f, a) {
    var r = a.r, i = a.i;
    switch (f) {
      case "exp": return this.expOf(r, i);
      case "ln": case "log":
        var k = f === "log" ? "/Math.LN10" : "";
        return this.pair("0.5*Math.log(" + r + "*" + r + "+" + i + "*" + i + ")" + k, "Math.atan2(" + i + "," + r + ")" + k);
      case "sqrt":
        var m = this.tmp(), h = this.tmp();
        this.lines.push("var " + m + "=Math.sqrt(Math.sqrt(" + r + "*" + r + "+" + i + "*" + i + "))," + h + "=0.5*Math.atan2(" + i + "," + r + ");");
        return this.pair(m + "*Math.cos(" + h + ")", m + "*Math.sin(" + h + ")");
      case "sin": return this.pair("Math.sin(" + r + ")*Math.cosh(" + i + ")", "Math.cos(" + r + ")*Math.sinh(" + i + ")");
      case "cos": return this.pair("Math.cos(" + r + ")*Math.cosh(" + i + ")", "-Math.sin(" + r + ")*Math.sinh(" + i + ")");
      case "sinh": return this.pair("Math.sinh(" + r + ")*Math.cos(" + i + ")", "Math.cosh(" + r + ")*Math.sin(" + i + ")");
      case "cosh": return this.pair("Math.cosh(" + r + ")*Math.cos(" + i + ")", "Math.sinh(" + r + ")*Math.sin(" + i + ")");
      case "tan": return this.div(this.fn("sin", a), this.fn("cos", a));
      case "tanh": return this.div(this.fn("sinh", a), this.fn("cosh", a));
      case "abs": return this.pair("Math.sqrt(" + r + "*" + r + "+" + i + "*" + i + ")", "0");
      case "real": return this.pair(r, "0");
      case "imag": return this.pair(i, "0");
      case "conj": return this.pair(r, "-" + i);
      case "arg": return this.pair("Math.atan2(" + i + "," + r + ")", "0");
    }
    throw new GraphError(f + " doesn't work on complex numbers");
  };

  function fractalCode(rhs, consts, pixelC) {
    var g = new CGen(consts, pixelC), res = g.gen(rhs);
    var init = pixelC ? "var cr=pr,ci=pi,zr=0,zi=0;" : "var zr=pr,zi=pi;";
    return "function(pr,pi,maxIter,bail,lnDeg){" + init + "var m=0,n=0;for(;n<maxIter;n++){" + g.lines.join("") +
      "zr=" + res.r + ";zi=" + res.i + ";m=zr*zr+zi*zi;if(!(m<=bail))break;}" +
      "if(n>=maxIter)return -1;if(!(m<Infinity))return n;var s=n+1-Math.log(0.5*Math.log(m))/lnDeg;return s>0?s:0;}";
  }

  function domainCode(rhs, consts) {
    var g = new CGen(consts, false), res = g.gen(rhs);
    return "function(pr,pi,out){var zr=pr,zi=pi;" + g.lines.join("") + "out[0]=" + res.r + ";out[1]=" + res.i + ";}";
  }

  function degreeOf(n) {
    if (n.t === "bin" && (n.op === "+" || n.op === "-")) return degreeOf(n.a) || degreeOf(n.b);
    if (n.t === "bin" && n.op === "^" && n.a.t === "var" && n.a.n === "z" && n.b.t === "num" && n.b.v > 1) return n.b.v;
    return 0;
  }

  // =====================================================================
  // Rows: state and compilation
  // =====================================================================

  var STORE = "hscpapers-graph";
  var rows = [];
  var nextId = 1;
  var view = { cx: 0, cy: 0, s: 0.02 };
  var showGrid = true;

  function newRow(src, opts) {
    var r = { id: nextId++, src: src || "", color: 0, hidden: false, sMin: null, sMax: null, tMin: 0, tMax: 2 * Math.PI, iter: 300, playing: false, res: null };
    for (var k in opts || {}) r[k] = opts[k];
    return r;
  }

  function nextColor() {
    var used = rows.map(function (r) { return r.color; });
    for (var c = 0; c < PALETTE_LEN; c++) if (used.indexOf(c) < 0) return c;
    return rows.length % PALETTE_LEN;
  }

  function isPlainNumber(n) { return n.t === "num" || (n.t === "neg" && n.a.t === "num"); }

  function compileAll() {
    var userFns = {}, fns = {}, constAst = {}, owner = {};
    rows.forEach(function (r) {
      var m = /^\s*([A-Za-z](?:_[A-Za-z0-9]+)?)\s*\(\s*[A-Za-zθ]/.exec(r.src);
      if (m && /=/.test(r.src) && !RESERVED[m[1]]) userFns[m[1]] = 1;
    });

    rows.forEach(function (r) {
      r.res = null;
      r.stmt = null;
      if (!r.src.trim()) { r.res = { kind: "empty" }; return; }
      try { r.stmt = parse(r.src, userFns); }
      catch (e) { r.res = { kind: "error", msg: e.message || "can't read this" }; return; }
      var s = r.stmt;
      if (s.op === "=" && s.lhs.t === "ucall") {
        if (owner[s.lhs.n]) { r.res = { kind: "error", msg: s.lhs.n + " is defined twice" }; return; }
        var params = s.lhs.args.map(function (a) { return a.t === "var" ? a.n : null; });
        if (params.indexOf(null) >= 0) { r.res = { kind: "error", msg: "inputs must be single letters" }; return; }
        fns[s.lhs.n] = { params: params, body: s.rhs };
        owner[s.lhs.n] = r;
        r.def = { fn: s.lhs.n, params: params };
      } else if (s.op === "=" && s.lhs.t === "var" && !RESERVED[s.lhs.n]) {
        if (owner[s.lhs.n]) { r.res = { kind: "error", msg: s.lhs.n + " is defined twice" }; return; }
        constAst[s.lhs.n] = s.rhs;
        owner[s.lhs.n] = r;
      }
    });

    // Evaluate constants in dependency order.
    var consts = {}, state = {}, constErr = {};
    function evalConst(name) {
      if (state[name] === 2) return;
      if (state[name] === 1) throw new GraphError(name + " depends on itself");
      state[name] = 1;
      var ast = inline(constAst[name], fns);
      Object.keys(freeVars(ast)).forEach(function (v) {
        if (constAst.hasOwnProperty(v)) evalConst(v);
        else throw new GraphError(v + " isn't defined", [v]);
      });
      consts[name] = evalC(ast, consts);
      state[name] = 2;
    }
    Object.keys(constAst).forEach(function (name) {
      try { evalConst(name); } catch (e) { constErr[name] = e; state[name] = 2; }
    });

    var fxTaken = false;
    rows.forEach(function (r) {
      if (r.res) return;
      try { r.res = classify(r, fns, consts, constAst, constErr); }
      catch (e) { r.res = { kind: "error", msg: e.message || "can't graph this", missing: (e.missing || []).filter(function (v) { return !RESERVED[v] && !userFns[v]; }) }; }
      if (r.res.kind === "fx") {
        r.res.shadowed = fxTaken && !r.hidden;
        if (!r.hidden) fxTaken = true;
      }
    });
  }

  function onlyVars(fv, allowed, consts) {
    return Object.keys(fv).every(function (v) { return allowed.indexOf(v) >= 0 || consts.hasOwnProperty(v); });
  }

  function missingOf(fv, allowed, consts) {
    return Object.keys(fv).filter(function (v) { return allowed.indexOf(v) < 0 && !consts.hasOwnProperty(v); });
  }

  function classify(r, fns, consts, constAst, constErr) {
    var s = r.stmt;

    if (s.op === "=" && s.lhs.t === "ucall") {
      var p = r.def.params, body = inline(s.rhs, fns);
      if (p.length === 1 && p[0] === "x") {
        checkVars(body, ["x"], consts);
        return { kind: "explicitY", f: compileReal1(body, "x", consts) };
      }
      return { kind: "def" };
    }

    if (s.op === "=" && s.lhs.t === "var" && !RESERVED[s.lhs.n]) {
      var name = s.lhs.n;
      if (constErr[name]) throw constErr[name];
      var val = consts[name];
      if (isPlainNumber(s.rhs)) return { kind: "slider", name: name, value: val[0] };
      return { kind: "const", name: name, value: val };
    }

    var lhs = s.lhs && inline(s.lhs, fns), rhs = s.rhs && inline(s.rhs, fns);

    if (s.op === "->") {
      if (lhs.t !== "var" || lhs.n !== "z") throw new GraphError("iterate z, e.g. z -> z^2 + c");
      var fv = freeVars(rhs), pixelC = !!fv.c && !consts.hasOwnProperty("c");
      var bad = missingOf(fv, ["z", "c"], consts);
      if (bad.length) throw new GraphError(bad[0] + " isn't defined", bad);
      return { kind: "fx", mode: "fractal", code: fractalCode(rhs, consts, pixelC), degree: degreeOf(rhs) || 2 };
    }

    if (!s.op) {
      var e = lhs, ev = freeVars(e);
      if (e.t === "tuple") {
        if (e.items.length !== 2) throw new GraphError("points need two coordinates");
        if (!Object.keys(ev).length || onlyVars(ev, [], consts)) {
          var px = evalC(e.items[0], consts), py = evalC(e.items[1], consts);
          if (px[1] || py[1]) throw new GraphError("points need real coordinates");
          return { kind: "point", x: px[0], y: py[0] };
        }
        checkVars(e, ["t"], consts);
        return { kind: "param", fx: compileReal1(e.items[0], "t", consts), fy: compileReal1(e.items[1], "t", consts), v: "t" };
      }
      if (ev.z) {
        checkVars(e, ["z"], consts);
        return { kind: "fx", mode: "domain", code: domainCode(e, consts) };
      }
      if (ev.x && !ev.y) {
        checkVars(e, ["x"], consts);
        return { kind: "explicitY", f: compileReal1(e, "x", consts) };
      }
      if (!missingOf(ev, [], consts).length) return { kind: "value", value: evalC(e, consts) };
      if (Object.keys(ev).some(function (v) { return RESERVED[v]; })) throw new GraphError("add = or < to graph this");
      checkVars(e, [], consts);
    }

    if (s.op === "=") {
      var lv = freeVars(lhs), rv = freeVars(rhs);
      if (lhs.t === "var" && lhs.n === "w") { checkVars(rhs, ["z"], consts); return { kind: "fx", mode: "domain", code: domainCode(rhs, consts) }; }
      if (lhs.t === "var" && lhs.n === "r") { checkVars(rhs, ["θ"], consts); return { kind: "polar", f: compileReal1(rhs, "θ", consts), v: "θ" }; }
      if (lhs.t === "var" && lhs.n === "y" && !rv.y) { checkVars(rhs, ["x"], consts); return { kind: "explicitY", f: compileReal1(rhs, "x", consts) }; }
      if (rhs.t === "var" && rhs.n === "y" && !lv.y) { checkVars(lhs, ["x"], consts); return { kind: "explicitY", f: compileReal1(lhs, "x", consts) }; }
      if (lhs.t === "var" && lhs.n === "x" && !rv.x) { checkVars(rhs, ["y"], consts); return { kind: "explicitX", f: compileReal1(rhs, "y", consts) }; }
      if (rhs.t === "var" && rhs.n === "x" && !lv.x) { checkVars(lhs, ["y"], consts); return { kind: "explicitX", f: compileReal1(lhs, "y", consts) }; }
    }

    var diff = { t: "bin", op: "-", a: lhs, b: rhs };
    checkVars(diff, ["x", "y"], consts);
    return { kind: "implicit", op: s.op, F: compileReal2(diff, consts) };
  }

  function checkVars(n, allowed, consts) {
    var bad = missingOf(freeVars(n), allowed, consts);
    if (bad.length) throw new GraphError(bad[0] + " isn't defined", bad);
  }

  // =====================================================================
  // Theme and colours
  // =====================================================================

  var LIGHT_COLORS = ["#c0392b", "#1a5fb4", "#2e7d32", "#7b3fa0", "#d35400", "#1b1f24"];
  var DARK_COLORS = ["#e4594d", "#6fa8f5", "#5cc46b", "#b38be0", "#f5a35c", "#e7e9ec"];
  var PALETTE_LEN = LIGHT_COLORS.length;
  var theme = {};

  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    ["bg", "surface", "border", "text", "dim", "accent"].forEach(function (k) { theme[k] = cs.getPropertyValue("--" + k).trim(); });
    theme.dark = document.documentElement.getAttribute("data-theme") === "dark";
    theme.font = getComputedStyle(document.body).fontFamily;
  }
  function colorOf(r) { return (theme.dark ? DARK_COLORS : LIGHT_COLORS)[r.color % PALETTE_LEN]; }

  var themeBtn = document.getElementById("theme-toggle");
  function syncThemeBtn() { themeBtn.textContent = theme.dark ? "light" : "dark"; }
  themeBtn.addEventListener("click", function () {
    var t = theme.dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("papersdb-theme", t); } catch (e) {}
    readTheme(); syncThemeBtn(); renderAllRows(); dirtyPlot = true;
  });

  // =====================================================================
  // Number formatting
  // =====================================================================

  function fmt(v) {
    if (v !== v) return "undefined";
    if (!isFinite(v)) return v > 0 ? "∞" : "-∞";
    if (v === 0) return "0";
    var a = Math.abs(v);
    if (a >= 1e9 || a < 1e-6) return v.toExponential(4).replace(/\.?0+e/, "e").replace("e+", "e");
    return String(parseFloat(v.toPrecision(10)));
  }
  function fmtC(c) {
    var re = Math.abs(c[0]) < 1e-12 * Math.max(1, Math.abs(c[1])) ? 0 : c[0];
    var im = Math.abs(c[1]) < 1e-12 * Math.max(1, Math.abs(re)) ? 0 : c[1];
    if (!im) return fmt(re);
    var ims = (Math.abs(im) === 1 ? "" : fmt(Math.abs(im))) + "i";
    if (!re) return (im < 0 ? "-" : "") + ims;
    return fmt(re) + (im < 0 ? " - " : " + ") + ims;
  }
  function decimalsFor(step) { return Math.max(0, Math.min(10, -Math.floor(Math.log10(step)))); }

  // =====================================================================
  // Expression panel
  // =====================================================================

  var rowsEl = document.getElementById("rows");
  var SVG_X = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  var SVG_PLAY = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l5 3-5 3z" fill="currentColor"/></svg>';
  var SVG_PAUSE = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2h1.5v6H3zM5.5 2H7v6H5.5z" fill="currentColor"/></svg>';

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function buildRow(r) {
    var wrap = el("div", "row");
    var sw = el("button", "sw");
    sw.type = "button";
    sw.title = "show or hide";
    sw.addEventListener("click", function () { r.hidden = !r.hidden; changed(); });
    var body = el("div", "rb");
    var input = el("input", "src");
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("autocapitalize", "off");
    input.value = r.src;
    input.addEventListener("input", function () {
      r.src = input.value;
      if (rows[rows.length - 1] === r && r.src) { var nr = newRow("", { color: nextColor() }); rows.push(nr); rowsEl.appendChild(buildRow(nr)); }
      changed();
    });
    input.addEventListener("keydown", function (e) { rowKeys(e, r, input); });
    var ex = el("div", "ex");
    body.appendChild(input);
    body.appendChild(ex);
    var del = el("button", "del", SVG_X);
    del.type = "button";
    del.title = "delete";
    del.addEventListener("click", function () { removeRow(r, false); });
    wrap.appendChild(sw); wrap.appendChild(body); wrap.appendChild(del);
    r.el = { wrap: wrap, sw: sw, input: input, ex: ex, sig: "" };
    renderRow(r);
    return wrap;
  }

  function rowKeys(e, r, input) {
    var k = rows.indexOf(r);
    if (e.key === "Enter") {
      e.preventDefault();
      var nr = newRow("", { color: nextColor() });
      rows.splice(k + 1, 0, nr);
      rowsEl.insertBefore(buildRow(nr), r.el.wrap.nextSibling);
      nr.el.input.focus();
      changed();
    } else if (e.key === "Backspace" && !input.value && rows.length > 1) {
      e.preventDefault();
      removeRow(r, true);
    } else if (e.key === "ArrowUp" && k > 0) {
      e.preventDefault(); rows[k - 1].el.input.focus();
    } else if (e.key === "ArrowDown" && k < rows.length - 1) {
      e.preventDefault(); rows[k + 1].el.input.focus();
    }
  }

  function removeRow(r, focusPrev) {
    var k = rows.indexOf(r);
    rows.splice(k, 1);
    r.el.wrap.remove();
    if (!rows.length || rows[rows.length - 1].src) { var nr = newRow("", { color: nextColor() }); rows.push(nr); rowsEl.appendChild(buildRow(nr)); }
    if (focusPrev) { var prev = rows[Math.max(0, k - 1)]; prev.el.input.focus(); prev.el.input.setSelectionRange(prev.src.length, prev.src.length); }
    changed();
  }

  function renderAllRows() { rows.forEach(renderRow); }

  function renderRow(r) {
    var res = r.res || { kind: "empty" }, e = r.el;
    if (!e) return;
    var c = colorOf(r);
    var drawable = ["explicitY", "explicitX", "polar", "param", "point", "implicit", "fx"].indexOf(res.kind) >= 0;
    e.sw.style.setProperty("--c", c);
    e.sw.classList.toggle("off", r.hidden);
    e.sw.style.visibility = drawable ? "" : "hidden";
    e.wrap.classList.toggle("err", res.kind === "error");

    var sig = res.kind + "|" + (res.name || "") + "|" + (res.msg || "") + "|" + (res.missing || []).join(",") + "|" + (res.mode || "") + "|" + !!res.shadowed;
    if (sig !== e.sig) {
      e.sig = sig;
      e.ex.innerHTML = "";
      if (res.kind === "error") {
        var m = el("div", "msg");
        m.textContent = res.msg;
        e.ex.appendChild(m);
        (res.missing || []).slice(0, 3).forEach(function (v) {
          var b = el("button", "chip");
          b.type = "button";
          b.textContent = "add slider " + v;
          b.addEventListener("click", function () { addSlider(v, r); });
          e.ex.appendChild(b);
        });
      } else if (res.kind === "slider") {
        buildSlider(r);
      } else if (res.kind === "param" || res.kind === "polar") {
        buildRange(r, res.kind === "param" ? "t" : "θ");
      } else if (res.kind === "fx" && res.mode === "fractal") {
        var lab = el("label", "inline");
        lab.appendChild(document.createTextNode("iterations "));
        var it = el("input", "num");
        it.type = "text"; it.inputMode = "numeric"; it.value = r.iter;
        it.addEventListener("change", function () { var v = parseInt(it.value, 10); if (v > 0) r.iter = Math.min(v, 100000); it.value = r.iter; changed(true); });
        lab.appendChild(it);
        e.ex.appendChild(lab);
      }
      if (res.kind === "value" || res.kind === "const") e.ex.appendChild(el("div", "val"));
      if (res.shadowed) { var n = el("div", "msg dim"); n.textContent = "only the top colour layer is drawn"; e.ex.appendChild(n); }
    }
    if (res.kind === "value" || res.kind === "const") e.ex.querySelector(".val").textContent = "= " + fmtC(res.value);
    if (res.kind === "slider" && r.el.range && document.activeElement !== r.el.range) syncSlider(r, res.value);
  }

  function buildSlider(r) {
    var v = r.res.value;
    if (r.sMin == null || r.sMax == null || r.sMin >= r.sMax) { r.sMin = Math.min(-10, Math.floor(v)); r.sMax = Math.max(10, Math.ceil(v)); }
    var box = el("div", "slider");
    var play = el("button", "play", r.playing ? SVG_PAUSE : SVG_PLAY);
    play.type = "button";
    play.title = "play";
    play.addEventListener("click", function () { r.playing = !r.playing; play.innerHTML = r.playing ? SVG_PAUSE : SVG_PLAY; if (r.playing) startAnim(); save(); });
    var lo = el("input", "num"), hi = el("input", "num"), range = el("input", "");
    lo.type = hi.type = "text";
    lo.value = fmt(r.sMin); hi.value = fmt(r.sMax);
    range.type = "range"; range.step = "any";
    range.min = r.sMin; range.max = r.sMax; range.value = v;
    range.addEventListener("input", function () { setSlider(r, parseFloat(range.value)); });
    function bound() {
      var a = parseFloat(lo.value), b = parseFloat(hi.value);
      if (isFinite(a) && isFinite(b) && a < b) { r.sMin = a; r.sMax = b; range.min = a; range.max = b; save(); }
      lo.value = fmt(r.sMin); hi.value = fmt(r.sMax);
    }
    lo.addEventListener("change", bound);
    hi.addEventListener("change", bound);
    box.appendChild(play); box.appendChild(lo); box.appendChild(range); box.appendChild(hi);
    r.el.ex.appendChild(box);
    r.el.range = range;
  }

  function syncSlider(r, v) { r.el.range.value = v; }

  function setSlider(r, v) {
    var step = (r.sMax - r.sMin) / 1000, d = decimalsFor(step);
    v = parseFloat(v.toFixed(d));
    r.src = r.res.name + " = " + fmt(v);
    r.el.input.value = r.src;
    changed();
  }

  function buildRange(r, v) {
    var box = el("div", "range");
    var lo = el("input", "num"), hi = el("input", "num");
    lo.type = hi.type = "text";
    lo.value = fmt(r.tMin); hi.value = fmt(r.tMax);
    function bound() {
      var a = parseFloat(lo.value), b = parseFloat(hi.value);
      if (isFinite(a) && isFinite(b) && a < b) { r.tMin = a; r.tMax = b; changed(); }
      lo.value = fmt(r.tMin); hi.value = fmt(r.tMax);
    }
    lo.addEventListener("change", bound);
    hi.addEventListener("change", bound);
    box.appendChild(lo);
    box.appendChild(document.createTextNode(" ≤ " + v + " ≤ "));
    box.appendChild(hi);
    r.el.ex.appendChild(box);
  }

  function addSlider(name, after) {
    var nr = newRow(name + " = 1", { color: nextColor() });
    var k = rows.indexOf(after);
    rows.splice(k, 0, nr);
    rowsEl.insertBefore(buildRow(nr), after.el.wrap);
    changed();
  }

  // Slider animation
  var animating = false, lastAnim = 0;
  function startAnim() { if (!animating) { animating = true; lastAnim = performance.now(); requestAnimationFrame(animTick); } }
  function animTick(now) {
    var dt = Math.min(0.1, (now - lastAnim) / 1000);
    lastAnim = now;
    var any = false;
    rows.forEach(function (r) {
      if (!r.playing || !r.res || r.res.kind !== "slider") return;
      any = true;
      var span = r.sMax - r.sMin, v = r.res.value + span * dt / 6;
      if (v > r.sMax) v = r.sMin + (v - r.sMax);
      r.res.value = v;
      setSlider(r, v);
    });
    if (any) requestAnimationFrame(animTick); else animating = false;
  }

  // =====================================================================
  // Canvas and view
  // =====================================================================

  var stage = document.getElementById("stage");
  var plot = document.getElementById("plot"), pctx = plot.getContext("2d");
  var fxc = document.getElementById("fx"), fctx = fxc.getContext("2d");
  var W = 0, H = 0, dpr = 1;
  var dirtyPlot = true;

  function resize() {
    var rect = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    [plot, fxc].forEach(function (c) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); });
    dirtyPlot = true;
    fx.reset();
  }

  function sx(x) { return (x - view.cx) / view.s + W / 2; }
  function sy(y) { return H / 2 - (y - view.cy) / view.s; }
  function wx(px) { return view.cx + (px - W / 2) * view.s; }
  function wy(py) { return view.cy - (py - H / 2) * view.s; }

  function clampScale(s) { return Math.min(1e9, Math.max(1e-15 * Math.max(1, Math.abs(view.cx), Math.abs(view.cy)), s)); }

  function zoomAt(px, py, f) {
    var x = wx(px), y = wy(py);
    view.s = clampScale(view.s * f);
    view.cx = x - (px - W / 2) * view.s;
    view.cy = y + (py - H / 2) * view.s;
    viewChanged();
  }

  function viewChanged() { dirtyPlot = true; fx.request(false); saveSoon(); }

  // Pointer pan / pinch
  var pointers = {};
  function pts() { return Object.keys(pointers).map(function (k) { return pointers[k]; }); }
  plot.addEventListener("pointerdown", function (e) {
    plot.setPointerCapture(e.pointerId);
    pointers[e.pointerId] = { x: e.offsetX, y: e.offsetY };
  });
  plot.addEventListener("pointermove", function (e) {
    var prev = pointers[e.pointerId];
    if (!prev) return;
    var before = pts();
    pointers[e.pointerId] = { x: e.offsetX, y: e.offsetY };
    var after = pts();
    if (after.length === 1) {
      view.cx -= (e.offsetX - prev.x) * view.s;
      view.cy += (e.offsetY - prev.y) * view.s;
      viewChanged();
    } else if (after.length === 2) {
      var c0 = mid(before), c1 = mid(after), d0 = dist(before), d1 = dist(after);
      view.cx -= (c1.x - c0.x) * view.s;
      view.cy += (c1.y - c0.y) * view.s;
      if (d0 > 0 && d1 > 0) zoomAt(c1.x, c1.y, d0 / d1); else viewChanged();
    }
  });
  function endPointer(e) { delete pointers[e.pointerId]; }
  plot.addEventListener("pointerup", endPointer);
  plot.addEventListener("pointercancel", endPointer);
  function mid(a) { return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; }
  function dist(a) { return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }

  plot.addEventListener("wheel", function (e) {
    e.preventDefault();
    var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1);
    zoomAt(e.offsetX, e.offsetY, Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0015));
  }, { passive: false });

  document.getElementById("zin").addEventListener("click", function () { zoomAt(W / 2, H / 2, 0.5); });
  document.getElementById("zout").addEventListener("click", function () { zoomAt(W / 2, H / 2, 2); });
  document.getElementById("zhome").addEventListener("click", function () { view.cx = 0; view.cy = 0; view.s = 24 / Math.max(W, 1); viewChanged(); });
  var gridBtn = document.getElementById("zgrid");
  gridBtn.addEventListener("click", function () { showGrid = !showGrid; gridBtn.classList.toggle("on", showGrid); dirtyPlot = true; save(); });

  // =====================================================================
  // Plot drawing
  // =====================================================================

  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }

  function tickLabel(v, step) {
    if (Math.abs(v) < step * 1e-6) return "0";
    var a = Math.abs(v);
    if (a >= 1e7 || step < 1e-5) return v.toExponential(Math.max(0, Math.min(8, Math.floor(Math.log10(a)) - Math.floor(Math.log10(step))))).replace("e+", "e");
    return v.toFixed(decimalsFor(step));
  }

  function drawGrid(overFx) {
    var c = pctx, major = niceStep(view.s * 110), mant = major / Math.pow(10, Math.floor(Math.log10(major) + 1e-9));
    var minor = major / (Math.round(mant) === 2 ? 4 : 5);
    var x0 = wx(0), x1 = wx(W), y0 = wy(H), y1 = wy(0);
    var alpha = overFx ? 0.5 : 1;
    c.lineWidth = 1;
    function lines(step, color) {
      c.strokeStyle = color;
      c.beginPath();
      for (var x = Math.ceil(x0 / step) * step; x <= x1; x += step) { var X = Math.round(sx(x)) + 0.5; c.moveTo(X, 0); c.lineTo(X, H); }
      for (var y = Math.ceil(y0 / step) * step; y <= y1; y += step) { var Y = Math.round(sy(y)) + 0.5; c.moveTo(0, Y); c.lineTo(W, Y); }
      c.stroke();
    }
    c.globalAlpha = alpha * (theme.dark ? 0.35 : 0.45);
    if ((x1 - x0) / minor < 400) lines(minor, theme.border);
    c.globalAlpha = alpha * (theme.dark ? 0.9 : 1);
    lines(major, theme.border);
    c.globalAlpha = 1;

    var ax = sx(0), ay = sy(0);
    c.strokeStyle = theme.dim;
    c.lineWidth = 1.25;
    c.beginPath();
    if (ax >= 0 && ax <= W) { c.moveTo(ax, 0); c.lineTo(ax, H); }
    if (ay >= 0 && ay <= H) { c.moveTo(0, ay); c.lineTo(W, ay); }
    c.stroke();

    c.font = "11px " + theme.font;
    c.fillStyle = theme.dim;
    c.strokeStyle = overFx ? "rgba(0,0,0,0.6)" : theme.bg;
    if (overFx) c.fillStyle = "#e7e9ec";
    c.lineWidth = 3;
    c.lineJoin = "round";
    var ly = Math.min(Math.max(ay + 4, 4), H - 16);
    c.textAlign = "center"; c.textBaseline = "top";
    for (var x = Math.ceil(x0 / major) * major; x <= x1; x += major) {
      var X = sx(x);
      if (Math.abs(x) < major * 1e-6 || X < 12 || X > W - 12) continue;
      var t = tickLabel(x, major);
      c.strokeText(t, X, ly); c.fillText(t, X, ly);
    }
    var lx = Math.min(Math.max(ax - 6, 6), W - 6);
    var right = ax - 6 < 30;
    c.textAlign = right ? "left" : "right"; c.textBaseline = "middle";
    if (right) lx = Math.max(ax + 6, 6);
    for (var y = Math.ceil(y0 / major) * major; y <= y1; y += major) {
      var Y = sy(y);
      if (Math.abs(y) < major * 1e-6 || Y < 10 || Y > H - 10) continue;
      var u = tickLabel(y, major);
      c.strokeText(u, lx, Y); c.fillText(u, lx, Y);
    }
    if (ax > 0 && ax < W && ay > 0 && ay < H) {
      c.textAlign = "right"; c.textBaseline = "top";
      c.strokeText("0", ax - 5, ay + 4); c.fillText("0", ax - 5, ay + 4);
    }
  }

  function strokeCurve(color) {
    pctx.strokeStyle = color;
    pctx.lineWidth = 2.5;
    pctx.lineJoin = "round";
    pctx.lineCap = "round";
    pctx.stroke();
  }

  function clampPx(v) { return v > 1e5 ? 1e5 : v < -1e5 ? -1e5 : v; }

  function jumps(a, b, size) { return (a < -size * 0.5 && b > size * 1.5) || (a > size * 1.5 && b < -size * 0.5); }

  function drawExplicit(f, color, vertical) {
    var c = pctx, len = vertical ? H : W, cross = vertical ? W : H, pen = false, prev = 0;
    c.beginPath();
    for (var p = -1; p <= len + 1; p += 0.5) {
      var v = vertical ? f(wy(p)) : f(wx(p));
      if (typeof v !== "number" || !isFinite(v)) { pen = false; continue; }
      var q = clampPx(vertical ? sx(v) : sy(v));
      if (pen && jumps(prev, q, cross)) pen = false;
      if (vertical) { pen ? c.lineTo(q, p) : c.moveTo(q, p); }
      else { pen ? c.lineTo(p, q) : c.moveTo(p, q); }
      pen = true; prev = q;
    }
    strokeCurve(color);
  }

  function drawParam(fxF, fyF, t0, t1, color) {
    var c = pctx, n = 2400, pen = false, px = 0, py = 0;
    c.beginPath();
    for (var k = 0; k <= n; k++) {
      var t = t0 + (t1 - t0) * k / n, X = fxF(t), Y = fyF(t);
      if (!isFinite(X) || !isFinite(Y)) { pen = false; continue; }
      var a = clampPx(sx(X)), b = clampPx(sy(Y));
      if (pen && (jumps(px, a, W) || jumps(py, b, H))) pen = false;
      pen ? c.lineTo(a, b) : c.moveTo(a, b);
      pen = true; px = a; py = b;
    }
    strokeCurve(color);
  }

  var CELL = 4;
  function sampleGrid(F) {
    var gw = Math.ceil(W / CELL) + 1, gh = Math.ceil(H / CELL) + 1, g = new Float64Array(gw * gh);
    for (var j = 0; j < gh; j++) {
      var y = wy(j * CELL);
      for (var i = 0; i < gw; i++) g[j * gw + i] = F(wx(i * CELL), y);
    }
    return { g: g, gw: gw, gh: gh };
  }

  function drawImplicit(F, op, color) {
    var s = sampleGrid(F), g = s.g, gw = s.gw, gh = s.gh, c = pctx;
    if (op && op !== "=") {
      var img = new ImageData(gw, gh), d = img.data, rgb = hexRgb(color);
      for (var k = 0; k < g.length; k++) {
        var v = g[k];
        var inside = op === "<" ? v < 0 : op === "<=" ? v <= 0 : op === ">" ? v > 0 : v >= 0;
        if (inside) { d[k * 4] = rgb[0]; d[k * 4 + 1] = rgb[1]; d[k * 4 + 2] = rgb[2]; d[k * 4 + 3] = 70; }
      }
      var tmp = document.createElement("canvas");
      tmp.width = gw; tmp.height = gh;
      tmp.getContext("2d").putImageData(img, 0, 0);
      c.imageSmoothingEnabled = true;
      c.drawImage(tmp, -CELL / 2, -CELL / 2, gw * CELL, gh * CELL);
    }
    c.beginPath();
    function edge(ax, ay, va, bx, by, vb) {
      if (!(va < 0 !== vb < 0) || !isFinite(va) || !isFinite(vb)) return null;
      var t = va / (va - vb), X = ax + (bx - ax) * t, Y = ay + (by - ay) * t;
      var vm = F(wx(X), wy(Y));
      if (!(Math.abs(vm) <= Math.abs(va) + Math.abs(vb))) return null;
      return [X, Y];
    }
    for (var j = 0; j < gh - 1; j++) {
      for (var i = 0; i < gw - 1; i++) {
        var a = g[j * gw + i], b = g[j * gw + i + 1], cc = g[(j + 1) * gw + i + 1], dd = g[(j + 1) * gw + i];
        var x0 = i * CELL, y0 = j * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
        var e = [edge(x0, y0, a, x1, y0, b), edge(x1, y0, b, x1, y1, cc), edge(x1, y1, cc, x0, y1, dd), edge(x0, y1, dd, x0, y0, a)].filter(Boolean);
        if (e.length === 2) { c.moveTo(e[0][0], e[0][1]); c.lineTo(e[1][0], e[1][1]); }
        else if (e.length === 4) {
          var mv = F(wx(x0 + CELL / 2), wy(y0 + CELL / 2));
          if (mv < 0 === a < 0) { c.moveTo(e[0][0], e[0][1]); c.lineTo(e[3][0], e[3][1]); c.moveTo(e[1][0], e[1][1]); c.lineTo(e[2][0], e[2][1]); }
          else { c.moveTo(e[0][0], e[0][1]); c.lineTo(e[1][0], e[1][1]); c.moveTo(e[2][0], e[2][1]); c.lineTo(e[3][0], e[3][1]); }
        }
      }
    }
    if (op === "<" || op === ">") c.globalAlpha = 0.5;
    strokeCurve(color);
    c.globalAlpha = 1;
  }

  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }

  function drawPoint(x, y, color) {
    var X = sx(x), Y = sy(y);
    if (X < -10 || X > W + 10 || Y < -10 || Y > H + 10) return;
    pctx.beginPath();
    pctx.arc(X, Y, 5, 0, 2 * Math.PI);
    pctx.fillStyle = color;
    pctx.strokeStyle = theme.dark ? "#15171a" : "#ffffff";
    pctx.lineWidth = 2;
    pctx.stroke();
    pctx.fill();
  }

  function drawPlot() {
    var c = pctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    var overFx = fx.active;
    if (showGrid) drawGrid(overFx);
    var visible = rows.filter(function (r) { return !r.hidden && r.res; });
    visible.forEach(function (r) {
      var res = r.res, color = colorOf(r);
      try {
        if (res.kind === "implicit") drawImplicit(res.F, res.op, color);
        else if (res.kind === "explicitY") drawExplicit(res.f, color, false);
        else if (res.kind === "explicitX") drawExplicit(res.f, color, true);
        else if (res.kind === "param") drawParam(res.fx, res.fy, r.tMin, r.tMax, color);
        else if (res.kind === "polar") drawParam(function (q) { return res.f(q) * Math.cos(q); }, function (q) { return res.f(q) * Math.sin(q); }, r.tMin, r.tMax, color);
      } catch (e) { /* a bad sample shouldn't stop the other graphs */ }
    });
    visible.forEach(function (r) { if (r.res.kind === "point") drawPoint(r.res.x, r.res.y, colorOf(r)); });
  }

  // =====================================================================
  // Progressive fractal / domain-colouring layer
  // =====================================================================

  var fx = (function () {
    var n = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    var workers = [], jobId = 0, spec = null, image = null, bandLevel = [], doneCount = 0, jobView = null;
    var imgCanvas = document.createElement("canvas"), imgCtx = imgCanvas.getContext("2d"), imgDirty = false;
    var base = null, pending = false, pendingExprChange = false, dirty = false, lastStart = 0;
    for (var k = 0; k < n; k++) {
      var w = new Worker("assets/graph-worker.js");
      w.onmessage = onMsg;
      w.onerror = function (e) { console.error("fx worker:", e.message); };
      workers.push(w);
    }

    function onMsg(e) {
      var d = e.data;
      if (d.id !== jobId) return;
      if (d.type === "error") { console.error("fx worker:", d.msg); return; }
      if (d.type === "band") {
        image.data.set(new Uint8ClampedArray(d.buf), d.band * 16 * image.width * 4);
        bandLevel[d.band] = d.b;
        dirty = imgDirty = true;
      } else if (d.type === "done") {
        if (++doneCount === workers.length) {
          var bc = document.createElement("canvas");
          bc.width = image.width; bc.height = image.height;
          bc.getContext("2d").putImageData(image, 0, 0);
          base = { canvas: bc, view: jobView };
          dirty = true;
        }
      }
    }

    function currentSpec() {
      var r = rows.filter(function (r) { return r.res && r.res.kind === "fx" && !r.hidden; })[0];
      if (!r) return null;
      return { mode: r.res.mode, code: r.res.code, degree: r.res.degree, iter: r.iter };
    }

    function start() {
      spec = currentSpec();
      jobId++;
      if (!spec) {
        workers.forEach(function (w) { w.postMessage({ type: "cancel" }); });
        fctx.clearRect(0, 0, fxc.width, fxc.height);
        base = null; image = null;
        return;
      }
      var Wd = fxc.width, Hd = fxc.height, scale = view.s / dpr;
      jobView = { left: view.cx - (W / 2) * view.s, top: view.cy + (H / 2) * view.s, scale: scale };
      if (!image || image.width !== Wd || image.height !== Hd) {
        image = fctx.createImageData(Wd, Hd);
        imgCanvas.width = Wd; imgCanvas.height = Hd;
      } else image.data.fill(0);
      imgDirty = true;
      var bands = Math.ceil(Hd / 16);
      bandLevel = new Array(bands);
      for (var b = 0; b < bands; b++) bandLevel[b] = Infinity;
      doneCount = 0;
      var depth = Math.max(0, Math.log10(4 / (W * view.s)));
      var maxIter = Math.round(spec.iter * (1 + 0.5 * depth));
      workers.forEach(function (w, k) {
        var mine = [];
        for (var b = k; b < bands; b += workers.length) mine.push(b);
        w.postMessage({
          type: "job", id: jobId, kind: spec.mode === "fractal" ? "fractal" : "domain", code: spec.code, degree: spec.degree,
          left: jobView.left, top: jobView.top, scale: scale, width: Wd, height: Hd, bands: mine,
          passes: [16, 8, 4, 2, 1], maxIter: maxIter, bail: 1e6
        });
      });
      dirty = true;
    }

    function drawAt(src, from, cur) {
      var k = from.scale / cur.scale;
      fctx.drawImage(src, (from.left - cur.left) / cur.scale, (cur.top - from.top) / cur.scale, src.width * k, src.height * k);
    }

    return {
      get active() { return !!spec; },
      request: function (exprChanged) {
        pending = true;
        if (exprChanged) { pendingExprChange = true; }
      },
      reset: function () { image = null; base = null; pending = true; },
      frame: function (now) {
        if (pending && now - lastStart > 30) {
          if (pendingExprChange) base = null;
          pending = pendingExprChange = false;
          lastStart = now;
          start();
          if (spec) dirty = true;
        }
        if (!spec || !image) return;
        if (!dirty && !viewMoved) return;
        dirty = false;
        if (imgDirty) { imgCtx.putImageData(image, 0, 0); imgDirty = false; }
        var cur = { left: view.cx - (W / 2) * view.s, top: view.cy + (H / 2) * view.s, scale: view.s / dpr };
        fctx.setTransform(1, 0, 0, 1, 0, 0);
        fctx.clearRect(0, 0, fxc.width, fxc.height);
        fctx.imageSmoothingEnabled = false;
        drawAt(imgCanvas, jobView, cur);
        if (!base) return;
        var coarse = 0;
        for (var b = 0; b < bandLevel.length; b++) if (bandLevel[b] > coarse) coarse = bandLevel[b];
        // Keep the last finished image on top until the new passes are at least as sharp as it is.
        if (coarse > Math.max(1, base.view.scale / cur.scale)) drawAt(base.canvas, base.view, cur);
      }
    };
  })();

  var viewMoved = false;
  var lastViewKey = "";
  function loop(now) {
    var key = view.cx + "," + view.cy + "," + view.s;
    viewMoved = key !== lastViewKey;
    lastViewKey = key;
    fx.frame(now);
    if (dirtyPlot) { dirtyPlot = false; drawPlot(); }
    requestAnimationFrame(loop);
  }

  // =====================================================================
  // Change handling, persistence, examples
  // =====================================================================

  function changed(fxOnly) {
    if (!fxOnly) compileAll();
    renderAllRows();
    dirtyPlot = true;
    fx.request(true);
    saveSoon();
  }

  var saveTimer;
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        rows: rows.filter(function (r) { return r.src.trim(); }).map(function (r) {
          return { src: r.src, color: r.color, hidden: r.hidden, sMin: r.sMin, sMax: r.sMax, tMin: r.tMin, tMax: r.tMax, iter: r.iter };
        }),
        view: view, grid: showGrid
      }));
    } catch (e) {}
  }

  function load(state) {
    rows = (state.rows || []).map(function (o) { return newRow(o.src, o); });
    rows.push(newRow("", { color: nextColor() }));
    if (state.view) { view.cx = state.view.cx; view.cy = state.view.cy; view.s = state.view.s; }
    if (typeof state.grid === "boolean") showGrid = state.grid;
    gridBtn.classList.toggle("on", showGrid);
    rowsEl.innerHTML = "";
    compileAll();
    rows.forEach(function (r) { rowsEl.appendChild(buildRow(r)); });
    changed();
    viewChanged();
  }

  function fitView(cx, cy, width) { return { cx: cx, cy: cy, s: width / Math.max(W, 1) }; }

  var EXAMPLES = {
    mandelbrot: function () { return { rows: [{ src: "z -> z^2 + c" }], view: fitView(-0.6, 0, 3.6) }; },
    julia: function () { return { rows: [{ src: "a = -0.8", sMin: -1.5, sMax: 0.5 }, { src: "b = 0.156", sMin: -1, sMax: 1 }, { src: "c = a + b i" }, { src: "z -> z^2 + c" }], view: fitView(0, 0, 3.6) }; },
    ship: function () { return { rows: [{ src: "z -> (|real(z)| + i |imag(z)|)^2 + c" }], view: fitView(-0.45, -0.5, 3.4) }; },
    cubic: function () { return { rows: [{ src: "z -> z^3 + c" }], view: fitView(0, 0, 3.4) }; },
    domain: function () { return { rows: [{ src: "w = (z^2 - 1)(z - 2 - i)^2 / (z^2 + 2 + 2i)" }], view: fitView(0, 0, 7) }; },
    waves: function () { return { rows: [{ src: "a = 1", sMin: 0, sMax: 5 }, { src: "y = sin(a x)" }, { src: "y = cos x / a" }], view: fitView(0, 0, 16) }; },
    implicit: function () { return { rows: [{ src: "(x^2 + y^2 - 1)^3 = x^2 y^3" }, { src: "x^2 + y^2 < 0.25" }], view: fitView(0, 0, 5) }; },
    curves: function () { return { rows: [{ src: "r = cos(4θ)" }, { src: "(sin 3t, sin 4t)" }, { src: "(0.5, 0.5)" }], view: fitView(0, 0, 4) }; },
    calculus: function () { return { rows: [{ src: "f(x) = x^3 - 3x" }, { src: "a = 1.5", sMin: -2.5, sMax: 2.5 }, { src: "y = f(a) + (3a^2 - 3)(x - a)" }, { src: "(a, f(a))" }], view: fitView(0, 0, 9) }; }
  };

  document.getElementById("examples").addEventListener("change", function (e) {
    var k = e.target.value;
    e.target.value = "";
    if (!EXAMPLES[k]) return;
    var ex = EXAMPLES[k]();
    ex.rows.forEach(function (r, i) { r.color = i % PALETTE_LEN; });
    load(ex);
    save();
  });
  document.getElementById("clear").addEventListener("click", function () {
    load({ rows: [], view: { cx: 0, cy: 0, s: 24 / Math.max(W, 1) }, grid: showGrid });
    save();
    rows[0].el.input.focus();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      rows[rows.length - 1].el.input.focus();
    }
  });

  // =====================================================================
  // Start
  // =====================================================================

  readTheme();
  syncThemeBtn();
  resize();
  window.addEventListener("resize", function () { resize(); fx.request(false); });

  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE)); } catch (e) {}
  if (saved && saved.rows) load(saved);
  else load({ rows: [], view: { cx: 0, cy: 0, s: 24 / Math.max(W, 1) } });
  rows[0].el.input.placeholder = "y = sin x   or   z -> z^2 + c";
  requestAnimationFrame(loop);
})();
