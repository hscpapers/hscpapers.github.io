(function () {
  "use strict";

  if (window.MathfieldElement) {
    MathfieldElement.fontsDirectory = new URL("assets/vendor/mathlive/fonts/", location.href).href;
    MathfieldElement.soundsDirectory = null;
  }

  // =====================================================================
  // Parsing (LaTeX from the MathLive editor)
  // =====================================================================

  var FN_CMDS = { sin: 1, cos: 1, tan: 1, sec: 1, csc: 1, cot: 1, arcsin: "asin", arccos: "acos", arctan: "atan",
    sinh: 1, cosh: 1, tanh: 1, exp: 1, ln: 1, log: 1, arg: 1, min: 1, max: 1 };
  var OPNAMES = { Re: "real", Im: "imag", real: "real", imag: "imag", arg: "arg", sign: "sign", sgn: "sign", floor: "floor",
    ceil: "ceil", round: "round", mod: "mod", nCr: "nCr", conj: "conj", abs: "abs", sec: "sec", csc: "csc", cot: "cot",
    sinh: "sinh", cosh: "cosh", tanh: "tanh", arcsin: "asin", arccos: "acos", arctan: "atan", exp: "exp", ln: "ln", log: "log",
    sin: "sin", cos: "cos", tan: "tan", min: "min", max: "max", cbrt: "cbrt", sqrt: "sqrt" };
  var GREEK = { alpha: 1, beta: 1, gamma: 1, delta: 1, epsilon: 1, varepsilon: 1, zeta: 1, eta: 1, iota: 1, kappa: 1, lambda: 1,
    mu: 1, nu: 1, xi: 1, rho: 1, sigma: 1, phi: 1, varphi: 1, chi: 1, psi: 1, omega: 1, Gamma: 1, Delta: 1, Lambda: 1, Phi: 1, Psi: 1, Omega: 1 };
  var SKIP_CMDS = { ",": 1, ";": 1, ":": 1, "!": 1, " ": 1, quad: 1, qquad: 1, displaystyle: 1, textstyle: 1, limits: 1, nolimits: 1 };
  var RESERVED = { x: 1, y: 1, t: 1, "θ": 1, r: 1, z: 1, w: 1, e: 1, i: 1 };

  function GraphError(msg, missing) { this.message = msg; this.missing = missing || []; }

  var UNICODE_CMDS = { "→": "to", "≤": "le", "≥": "ge", "·": "cdot", "×": "times", "÷": "div", "π": "pi", "θ": "theta", "∞": "infty" };

  function lex(src) {
    var out = [], p = 0, m;
    while (p < src.length) {
      var ch = src[p];
      if (ch === "\\") {
        m = /^\\([A-Za-z]+|.)/.exec(src.slice(p));
        p += m[0].length;
        if (!SKIP_CMDS[m[1]]) out.push({ k: "cmd", v: m[1] });
        continue;
      }
      if (UNICODE_CMDS[ch]) { out.push({ k: "cmd", v: UNICODE_CMDS[ch] }); p++; continue; }
      if (ch === "−") { out.push({ k: "sym", v: "-" }); p++; continue; }
      if (/\s|~/.test(ch)) { p++; continue; }
      if (/[0-9.]/.test(ch)) { out.push({ k: "digit", v: ch }); p++; continue; }
      if (/[A-Za-z]/.test(ch)) { out.push({ k: "letter", v: ch }); p++; continue; }
      if ("{}^_()[]|+-*/=<>,!'".indexOf(ch) >= 0) { out.push({ k: "sym", v: ch }); p++; continue; }
      throw new GraphError("can't read “" + ch + "”");
    }
    return out;
  }

  function parse(src, userFns) {
    var T = lex(src), p = 0, absDepth = 0, intDepth = 0;
    function tok(o) { return T[p + (o || 0)]; }
    function isSym(v, o) { var t = tok(o); return !!t && t.k === "sym" && t.v === v; }
    function isCmd(v, o) { var t = tok(o); return !!t && t.k === "cmd" && (v === undefined || t.v === v); }
    function expectSym(v) {
      if (!isSym(v)) throw new GraphError(p < T.length ? "expected “" + v + "”" : "unfinished expression");
      p++;
    }
    function expectRight(close) {
      if (!isCmd("right")) throw new GraphError("unfinished bracket");
      p++;
      var t = T[p++];
      if (!t || (t.v !== close && !(close === "|" && (t.v === "vert" || t.v === "rvert")))) throw new GraphError("mismatched brackets");
    }
    function placeholderCheck() {
      if (isCmd("placeholder")) throw new GraphError("fill in the empty box");
    }

    // {group} or a single token, as used by \frac, ^, _ and \sqrt
    function arg() {
      placeholderCheck();
      if (isSym("{")) {
        p++;
        if (isSym("}")) throw new GraphError("fill in the empty box");
        var e = expr();
        expectSym("}");
        return e;
      }
      var t = T[p];
      if (!t) throw new GraphError("unfinished expression");
      if (t.k === "digit") { p++; return { t: "num", v: parseFloat(t.v) }; }
      if (t.k === "letter") { p++; return letterNode(t.v); }
      return primary();
    }

    // raw text of a {group}, used for subscripts and \operatorname{...}
    function rawText() {
      if (!isSym("{")) { var t = T[p++]; return t ? t.v : ""; }
      p++;
      var depth = 1, s = "";
      while (p < T.length) {
        var t2 = T[p++];
        if (t2.k === "sym" && t2.v === "{") { depth++; continue; }
        if (t2.k === "sym" && t2.v === "}") { if (--depth === 0) break; continue; }
        if (t2.k === "cmd" && (t2.v === "mathrm" || t2.v === "operatorname" || t2.v === "text" || t2.v === "mathit")) continue;
        s += t2.v;
      }
      return s;
    }

    function letterNode(v) {
      if (v === "e") return { t: "num", v: Math.E };
      if (v === "i") return { t: "i" };
      return { t: "var", n: v };
    }

    // Is the next thing a differential (dx, \differentialD x, \mathrm{d}x)?
    function diffHere(strict) {
      var t = tok(), n = tok(1);
      if (!t || !n) return false;
      if (t.k === "cmd" && t.v === "differentialD") return true;
      if (t.k === "cmd" && t.v === "mathrm" && isSym("{", 1) && tok(2) && tok(2).v === "d" && isSym("}", 3)) return true;
      if (t.k === "letter" && t.v === "d" && (n.k === "letter" || (n.k === "cmd" && n.v === "theta"))) return !strict || isEndAfterDiff(2);
      return false;
    }
    function atDifferential() { return intDepth > 0 && diffHere(true); }
    // "dx" only ends an integral when nothing that could continue the product follows it
    function isEndAfterDiff(o) {
      var t = tok(o);
      return !t || (t.k === "sym" && "+-=<>),]}".indexOf(t.v) >= 0) || (t.k === "cmd" && (t.v === "right" || t.v === "le" || t.v === "ge" || t.v === "to"));
    }
    function readDifferential() {
      if (isCmd("differentialD")) p++;
      else if (isCmd("mathrm")) p += 4;
      else p++;
      var t = T[p++];
      if (!t) throw new GraphError("add the variable after d, e.g. dx");
      if (t.k === "letter") return t.v;
      if (t.k === "cmd" && t.v === "theta") return "θ";
      throw new GraphError("add the variable after d, e.g. dx");
    }

    function startsFactor() {
      var t = tok();
      if (!t) return false;
      if (atDifferential()) return false;
      if (t.k === "digit" || t.k === "letter") return true;
      if (t.k === "sym") return t.v === "(" || t.v === "[" || t.v === "{" || (t.v === "|" && absDepth === 0);
      if (t.k === "cmd") {
        if (t.v === "left") return true;
        return !/^(right|cdot|times|div|le|leq|leqslant|ge|geq|geqslant|lt|gt|to|rightarrow|mapsto|longrightarrow|rfloor|rceil|rvert|vert|mid|pm|prime)$/.test(t.v);
      }
      return false;
    }

    function callArgs() {
      var list = [];
      if (isSym("(")) {
        p++;
        list.push(expr());
        while (isSym(",")) { p++; list.push(expr()); }
        expectSym(")");
      } else {
        p++;
        if (!isSym("(")) throw new GraphError("expected “(”");
        p++;
        list.push(expr());
        while (isSym(",")) { p++; list.push(expr()); }
        expectRight(")");
      }
      return list;
    }
    function opensCall() { return isSym("(") || (isCmd("left") && isSym("(", 1)); }

    function implicitArg() {
      var a = isSym("-") ? (p++, { t: "neg", a: power() }) : power();
      while (startsFactor() && !isFnStart()) a = { t: "bin", op: "*", a: a, b: power() };
      return a;
    }
    function isFnStart() {
      var t = tok();
      if (!t || t.k !== "cmd") return false;
      return !!FN_CMDS[t.v] || t.v === "operatorname" || t.v === "int" || t.v === "sum" || t.v === "prod";
    }

    function applyFn(name) {
      var ex = null, base = null;
      if (name === "log" && isSym("_")) { p++; base = arg(); }
      if (isSym("^")) { p++; ex = arg(); }
      if (name === "log" && isSym("_") && !base) { p++; base = arg(); }
      var args = opensCall() ? callArgs() : [implicitArg()];
      var node = { t: "call", f: name, args: args };
      if (base) node = { t: "bin", op: "/", a: { t: "call", f: "ln", args: args }, b: { t: "call", f: "ln", args: [base] } };
      return ex ? { t: "bin", op: "^", a: node, b: ex } : node;
    }

    function bigOp(kind) {
      var lo = null, hi = null, v = null;
      for (var k = 0; k < 2; k++) {
        if (isSym("_")) {
          p++;
          if (kind === "int") lo = arg();
          else {
            if (!isSym("{")) throw new GraphError("write the start like n=1");
            p++;
            var vt = T[p++];
            if (!vt || vt.k !== "letter") throw new GraphError("write the start like n=1");
            v = vt.v;
            if (isSym("_")) { p++; v += "_" + rawText(); }
            expectSym("=");
            lo = expr();
            expectSym("}");
          }
        } else if (isSym("^")) { p++; hi = arg(); }
      }
      if (!lo || !hi) throw new GraphError(kind === "int" ? "integrals need limits" : "add the start and end values");
      if (kind === "int") {
        intDepth++;
        var body = expr();
        intDepth--;
        if (!diffHere(false)) throw new GraphError("finish the integral with dx");
        return { t: "int", v: readDifferential(), lo: lo, hi: hi, a: body };
      }
      return { t: kind, v: v, lo: lo, hi: hi, a: implicitArg() };
    }

    function fracOrDeriv() {
      // d/dx written as \frac{d}{dx} or \frac{\differentialD}{\differentialD x}
      var save = p;
      if (isSym("{") && ((tok(1) && tok(1).v === "d") || isCmd("differentialD", 1)) && isSym("}", 2) && isSym("{", 3)) {
        var t = tok(4), u = tok(5);
        if (t && (t.v === "d" || (t.k === "cmd" && t.v === "differentialD")) && u && (u.k === "letter" || (u.k === "cmd" && u.v === "theta")) && isSym("}", 6)) {
          p += 7;
          return { t: "deriv", v: u.k === "letter" ? u.v : "θ", a: implicitArg() };
        }
      }
      p = save;
      var num = arg(), den = arg();
      return { t: "bin", op: "/", a: num, b: den };
    }

    function primary() {
      placeholderCheck();
      var t = T[p++];
      if (!t) throw new GraphError("unfinished expression");
      if (t.k === "digit") {
        var s = t.v;
        while (tok() && tok().k === "digit") s += T[p++].v;
        var v = parseFloat(s);
        if (isNaN(v)) throw new GraphError("can't read the number “" + s + "”");
        return { t: "num", v: v };
      }
      if (t.k === "letter") {
        var name = t.v, primes = 0;
        if (isSym("_")) { p++; name += "_" + rawText(); }
        while (isSym("'")) { p++; primes++; }
        if (isSym("^") && isSym("{", 1) && isCmd("prime", 2)) {
          p += 2;
          while (isCmd("prime")) { p++; primes++; }
          expectSym("}");
        }
        if (userFns[name] && opensCall()) return { t: "ucall", n: name, args: callArgs(), primes: primes };
        if (primes) throw new GraphError("′ only works on functions like f′(x)");
        return name.length === 1 ? letterNode(name) : { t: "var", n: name };
      }
      if (t.k === "sym") {
        if (t.v === "(" || t.v === "[") {
          var close = t.v === "(" ? ")" : "]", items = [expr()];
          while (isSym(",")) { p++; items.push(expr()); }
          expectSym(close);
          return items.length > 1 ? { t: "tuple", items: items } : items[0];
        }
        if (t.v === "{") { var g = expr(); expectSym("}"); return g; }
        if (t.v === "|") { absDepth++; var a = expr(); absDepth--; expectSym("|"); return { t: "call", f: "abs", args: [a] }; }
        throw new GraphError("unexpected “" + t.v + "”");
      }
      // commands
      var c = t.v;
      if (c === "left") {
        var d = T[p++];
        if (!d) throw new GraphError("unfinished bracket");
        if (d.v === "(" || d.v === "[") {
          var cl = d.v === "(" ? ")" : "]", its = [expr()];
          while (isSym(",")) { p++; its.push(expr()); }
          expectRight(cl);
          return its.length > 1 ? { t: "tuple", items: its } : its[0];
        }
        if (d.v === "|" || d.v === "vert" || d.v === "lvert") {
          absDepth++; var b = expr(); absDepth--;
          expectRight("|");
          return { t: "call", f: "abs", args: [b] };
        }
        if (d.v === "lfloor" || d.v === "lceil") {
          var f2 = expr();
          expectRight(d.v === "lfloor" ? "rfloor" : "rceil");
          return { t: "call", f: d.v === "lfloor" ? "floor" : "ceil", args: [f2] };
        }
        if (d.v === "{" || d.v === "lbrace") throw new GraphError("piecewise functions aren't supported yet");
        throw new GraphError("unsupported bracket");
      }
      if (c === "frac" || c === "dfrac" || c === "tfrac") return fracOrDeriv();
      if (c === "sqrt") {
        if (isSym("[")) {
          p++;
          var n = expr();
          expectSym("]");
          return { t: "bin", op: "^", a: arg(), b: { t: "bin", op: "/", a: { t: "num", v: 1 }, b: n } };
        }
        return { t: "call", f: "sqrt", args: [arg()] };
      }
      if (c === "pi") return { t: "num", v: Math.PI };
      if (c === "tau") return { t: "num", v: 2 * Math.PI };
      if (c === "infty") return { t: "num", v: Infinity };
      if (c === "theta") return { t: "var", n: "θ" };
      if (c === "exponentialE") return { t: "num", v: Math.E };
      if (c === "imaginaryI") return { t: "i" };
      if (c === "differentialD") return { t: "var", n: "d" };
      if (GREEK[c]) {
        var gname = c;
        if (isSym("_")) { p++; gname += "_" + rawText(); }
        return { t: "var", n: gname };
      }
      if (FN_CMDS[c]) return applyFn(FN_CMDS[c] === 1 ? c : FN_CMDS[c]);
      if (c === "operatorname" || c === "mathrm" || c === "text" || c === "mathit") {
        var word = rawText();
        if (OPNAMES[word]) return applyFn(OPNAMES[word]);
        if (word === "d") return { t: "var", n: "d" };
        throw new GraphError("unknown function “" + word + "”");
      }
      if (c === "overline" || c === "bar") return { t: "call", f: "conj", args: [arg()] };
      if (c === "binom") { var top = arg(); return { t: "call", f: "nCr", args: [top, arg()] }; }
      if (c === "lfloor" || c === "lceil") {
        var fl = expr();
        if (!isCmd(c === "lfloor" ? "rfloor" : "rceil")) throw new GraphError("unfinished bracket");
        p++;
        return { t: "call", f: c === "lfloor" ? "floor" : "ceil", args: [fl] };
      }
      if (c === "vert" || c === "lvert" || c === "mid") { absDepth++; var vb = expr(); absDepth--; p++; return { t: "call", f: "abs", args: [vb] }; }
      if (c === "int") return bigOp("int");
      if (c === "sum") return bigOp("sum");
      if (c === "prod") return bigOp("prod");
      if (c === "placeholder") throw new GraphError("fill in the empty box");
      throw new GraphError("unsupported: \\" + c);
    }

    function postfix() {
      var a = primary();
      while (isSym("!")) { p++; a = { t: "fact", a: a }; }
      return a;
    }
    function power() {
      var base = postfix();
      if (isSym("^")) { p++; return { t: "bin", op: "^", a: base, b: arg() }; }
      return base;
    }
    function unary() {
      if (isSym("-")) { p++; return { t: "neg", a: unary() }; }
      if (isSym("+")) { p++; return unary(); }
      return power();
    }
    function term() {
      var a = unary();
      for (;;) {
        if (isSym("*") || isCmd("cdot") || isCmd("times")) { p++; a = { t: "bin", op: "*", a: a, b: unary() }; }
        else if (isSym("/") || isCmd("div")) { p++; a = { t: "bin", op: "/", a: a, b: unary() }; }
        else if (startsFactor()) a = { t: "bin", op: "*", a: a, b: power() };
        else return a;
      }
    }
    function expr() {
      var a = term();
      for (;;) {
        if (isSym("+")) { p++; a = { t: "bin", op: "+", a: a, b: term() }; }
        else if (isSym("-") && !isSym(">", 1)) { p++; a = { t: "bin", op: "-", a: a, b: term() }; }
        else return a;
      }
    }
    function relation() {
      var t = tok();
      if (!t) return null;
      if (t.k === "sym") {
        if (t.v === "=") { p++; return "="; }
        if (t.v === "<" || t.v === ">") { p++; if (isSym("=")) { p++; return t.v + "="; } return t.v; }
        if (t.v === "-" && isSym(">", 1)) { p += 2; return "->"; }
        return null;
      }
      if (t.k === "cmd") {
        var map = { le: "<=", leq: "<=", leqslant: "<=", ge: ">=", geq: ">=", geqslant: ">=", lt: "<", gt: ">", to: "->", rightarrow: "->", mapsto: "->", longrightarrow: "->" };
        if (map[t.v]) { p++; return map[t.v]; }
      }
      return null;
    }

    if (!T.length) return null;
    var lhs = expr(), op = relation(), rhs = null;
    if (op) rhs = expr();
    if (p < T.length) {
      var bad = T[p];
      if (bad.k === "cmd" && bad.v === "placeholder") throw new GraphError("fill in the empty box");
      throw new GraphError("unexpected “" + (bad.k === "cmd" ? "\\" + bad.v : bad.v) + "”");
    }
    return { op: op, lhs: lhs, rhs: rhs };
  }

  function userFnNames(latex) {
    var m = /^\s*([A-Za-z])(?:_\{?([A-Za-z0-9]+)\}?)?\s*(?:\\left)?\(/.exec(latex);
    if (!m || latex.indexOf("=") < 0) return null;
    var name = m[1] + (m[2] ? "_" + m[2] : "");
    return RESERVED[name] ? null : name;
  }

  function nameLatex(n) {
    var parts = n.split("_"), head = parts[0];
    head = head === "θ" ? "\\theta" : GREEK[head] ? "\\" + head : head;
    return parts.length > 1 ? head + "_{" + parts.slice(1).join("_") + "}" : head;
  }

  // =====================================================================
  // AST helpers
  // =====================================================================

  var BOUND = { int: 1, sum: 1, prod: 1 };

  function without(map, v) {
    if (!map.hasOwnProperty(v)) return map;
    var m = {};
    for (var k in map) if (k !== v) m[k] = map[k];
    return m;
  }

  function substitute(n, map) {
    switch (n.t) {
      case "var": return map.hasOwnProperty(n.n) ? map[n.n] : n;
      case "neg": case "fact": return { t: n.t, a: substitute(n.a, map) };
      case "bin": return { t: "bin", op: n.op, a: substitute(n.a, map), b: substitute(n.b, map) };
      case "call": return { t: "call", f: n.f, args: n.args.map(function (x) { return substitute(x, map); }) };
      case "ucall": return { t: "ucall", n: n.n, primes: n.primes, args: n.args.map(function (x) { return substitute(x, map); }) };
      case "tuple": return { t: "tuple", items: n.items.map(function (x) { return substitute(x, map); }) };
      case "int": case "sum": case "prod":
        return { t: n.t, v: n.v, lo: substitute(n.lo, map), hi: substitute(n.hi, map), a: substitute(n.a, without(map, n.v)) };
      case "deriv": case "nderiv":
        return { t: n.t, v: n.v, a: substitute(n.a, map) };
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
        var body = inline(def.body, fns, depth + 1);
        if (n.primes) {
          if (def.params.length !== 1) throw new GraphError("′ only works on functions of one variable");
          for (var k = 0; k < n.primes; k++) body = derivative(body, def.params[0]);
        }
        var map = {};
        def.params.forEach(function (prm, k) { map[prm] = inline(n.args[k], fns, depth); });
        return substitute(body, map);
      case "neg": case "fact": return { t: n.t, a: inline(n.a, fns, depth) };
      case "bin": return { t: "bin", op: n.op, a: inline(n.a, fns, depth), b: inline(n.b, fns, depth) };
      case "call": return { t: "call", f: n.f, args: n.args.map(function (x) { return inline(x, fns, depth); }) };
      case "tuple": return { t: "tuple", items: n.items.map(function (x) { return inline(x, fns, depth); }) };
      case "int": case "sum": case "prod":
        return { t: n.t, v: n.v, lo: inline(n.lo, fns, depth), hi: inline(n.hi, fns, depth), a: inline(n.a, fns, depth) };
      case "deriv": return derivative(inline(n.a, fns, depth), n.v);
      default: return n;
    }
  }

  // Symbolic derivative where possible; otherwise a numeric-derivative node (real graphs only).
  function derivative(a, v) {
    try { return simplify(diff(a, v)); }
    catch (e) { return { t: "nderiv", v: v, a: a }; }
  }

  function freeVars(n, out) {
    out = out || {};
    switch (n.t) {
      case "var": out[n.n] = 1; break;
      case "neg": case "fact": freeVars(n.a, out); break;
      case "bin": freeVars(n.a, out); freeVars(n.b, out); break;
      case "call": case "ucall": n.args.forEach(function (x) { freeVars(x, out); }); break;
      case "tuple": n.items.forEach(function (x) { freeVars(x, out); }); break;
      case "int": case "sum": case "prod":
        freeVars(n.lo, out); freeVars(n.hi, out);
        var inner = freeVars(n.a, {});
        for (var k in inner) if (k !== n.v) out[k] = 1;
        break;
      case "nderiv": freeVars(n.a, out); out[n.v] = 1; break;
    }
    return out;
  }

  function depends(n, v) { return !!freeVars(n)[v]; }

  function hasI(n) {
    switch (n.t) {
      case "i": return true;
      case "neg": case "fact": case "deriv": case "nderiv": return hasI(n.a);
      case "bin": return hasI(n.a) || hasI(n.b);
      case "call": case "ucall": return n.args.some(hasI);
      case "tuple": return n.items.some(hasI);
      case "int": case "sum": case "prod": return hasI(n.lo) || hasI(n.hi) || hasI(n.a);
      default: return false;
    }
  }

  // Holomorphic in z: built only from arithmetic and analytic functions (no |z|, Re, Im, arg, conj, x or y).
  var ANALYTIC_FNS = { exp: 1, ln: 1, log: 1, sin: 1, cos: 1, tan: 1, sinh: 1, cosh: 1, tanh: 1, sqrt: 1 };
  function isAnalytic(n) {
    switch (n.t) {
      case "num": case "i": return true;
      case "var": return n.n !== "x" && n.n !== "y";
      case "neg": return isAnalytic(n.a);
      case "bin": return isAnalytic(n.a) && isAnalytic(n.b);
      case "call": return !!ANALYTIC_FNS[n.f] && n.args.length === 1 && isAnalytic(n.args[0]);
      default: return false;
    }
  }

  // ---------- symbolic differentiation ----------
  var ZERO = { t: "num", v: 0 }, ONE = { t: "num", v: 1 };
  function num(v) { return { t: "num", v: v }; }
  function add(a, b) { return { t: "bin", op: "+", a: a, b: b }; }
  function sub(a, b) { return { t: "bin", op: "-", a: a, b: b }; }
  function mul(a, b) { return { t: "bin", op: "*", a: a, b: b }; }
  function dv(a, b) { return { t: "bin", op: "/", a: a, b: b }; }
  function pw(a, b) { return { t: "bin", op: "^", a: a, b: b }; }
  function fn(f, a) { return { t: "call", f: f, args: [a] }; }
  function neg(a) { return { t: "neg", a: a }; }

  function diff(n, v) {
    if (!depends(n, v)) return ZERO;
    switch (n.t) {
      case "var": return ONE;
      case "neg": return neg(diff(n.a, v));
      case "bin":
        var a = n.a, b = n.b, da = diff(a, v), db = diff(b, v);
        if (n.op === "+") return add(da, db);
        if (n.op === "-") return sub(da, db);
        if (n.op === "*") return add(mul(da, b), mul(a, db));
        if (n.op === "/") return dv(sub(mul(da, b), mul(a, db)), pw(b, num(2)));
        if (!depends(b, v)) return mul(mul(b, pw(a, sub(b, ONE))), da);
        if (!depends(a, v)) return mul(mul(n, fn("ln", a)), db);
        return mul(n, add(mul(db, fn("ln", a)), dv(mul(b, da), a)));
      case "call":
        if (n.args.length !== 1) throw new GraphError("can't differentiate " + n.f);
        var u = n.args[0], du = diff(u, v);
        var outer, unit = ANG === 1 ? null : num(ANG), inv = ANG === 1 ? null : num(1 / ANG);
        switch (n.f) {
          case "sin": outer = fn("cos", u); break;
          case "cos": outer = neg(fn("sin", u)); break;
          case "tan": outer = pw(fn("sec", u), num(2)); break;
          case "sec": outer = mul(fn("sec", u), fn("tan", u)); break;
          case "csc": outer = neg(mul(fn("csc", u), fn("cot", u))); break;
          case "cot": outer = neg(pw(fn("csc", u), num(2))); break;
          case "asin": outer = dv(ONE, fn("sqrt", sub(ONE, pw(u, num(2))))); break;
          case "acos": outer = neg(dv(ONE, fn("sqrt", sub(ONE, pw(u, num(2)))))); break;
          case "atan": outer = dv(ONE, add(ONE, pw(u, num(2)))); break;
          case "sinh": outer = fn("cosh", u); break;
          case "cosh": outer = fn("sinh", u); break;
          case "tanh": outer = sub(ONE, pw(fn("tanh", u), num(2))); break;
          case "exp": outer = fn("exp", u); break;
          case "ln": outer = dv(ONE, u); break;
          case "log": outer = dv(ONE, mul(u, num(Math.LN10))); break;
          case "sqrt": outer = dv(ONE, mul(num(2), fn("sqrt", u))); break;
          case "cbrt": outer = dv(ONE, mul(num(3), pw(fn("cbrt", u), num(2)))); break;
          case "abs": outer = fn("sign", u); break;
          default: throw new GraphError("can't differentiate " + n.f);
        }
        if (TRIG[n.f] && unit) outer = mul(unit, outer);
        if ((n.f === "asin" || n.f === "acos" || n.f === "atan") && inv) outer = mul(inv, outer);
        return mul(outer, du);
    }
    throw new GraphError("can't differentiate this");
  }

  function isNum(n, v) { return n.t === "num" && (v === undefined || n.v === v); }

  function simplify(n) {
    switch (n.t) {
      case "neg":
        var a0 = simplify(n.a);
        if (isNum(a0)) return num(-a0.v);
        if (a0.t === "neg") return a0.a;
        return neg(a0);
      case "bin":
        var a = simplify(n.a), b = simplify(n.b);
        if (isNum(a) && isNum(b) && n.op !== "^") {
          return num(n.op === "+" ? a.v + b.v : n.op === "-" ? a.v - b.v : n.op === "*" ? a.v * b.v : a.v / b.v);
        }
        switch (n.op) {
          case "+": if (isNum(a, 0)) return b; if (isNum(b, 0)) return a; break;
          case "-": if (isNum(b, 0)) return a; if (isNum(a, 0)) return neg(b); break;
          case "*":
            if (isNum(a, 0) || isNum(b, 0)) return ZERO;
            if (isNum(a, 1)) return b; if (isNum(b, 1)) return a;
            break;
          case "/": if (isNum(a, 0)) return ZERO; if (isNum(b, 1)) return a; break;
          case "^":
            if (isNum(b, 0)) return ONE; if (isNum(b, 1)) return a;
            if (isNum(a) && isNum(b)) return num(realPow(a.v, b.v));
            break;
        }
        return { t: "bin", op: n.op, a: a, b: b };
      case "call": return { t: "call", f: n.f, args: n.args.map(simplify) };
      default: return n;
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
  var GK_X = [0.991455371120812639, 0.949107912342758525, 0.864864423359769073, 0.741531185599394440, 0.586087235467691130, 0.405845151377397167, 0.207784955007898468, 0];
  var GK_W = [0.022935322010529225, 0.063092092629978553, 0.104790010322250184, 0.140653259715525919, 0.169004726639267903, 0.190350578064785410, 0.204432940075298892, 0.209482141084727828];
  var G_W = [0.129484966168869693, 0.279705391489276668, 0.381830050505118945, 0.417959183673469388];

  function gk15(f, a, b) {
    var c = (a + b) / 2, h = (b - a) / 2, fc = f(c), k = fc * GK_W[7], g = fc * G_W[3];
    for (var j = 0; j < 7; j++) {
      var dx = h * GK_X[j], s = f(c - dx) + f(c + dx);
      k += GK_W[j] * s;
      if (j % 2 === 1) g += G_W[(j - 1) / 2] * s;
    }
    return { v: k * h, err: Math.abs((k - g) * h) };
  }

  // Adaptive Gauss-Kronrod; infinite limits are mapped onto finite ones.
  function integrate(f, a, b) {
    if (a === b) return 0;
    if (a > b) return -integrate(f, b, a);
    if (a === -Infinity && b === Infinity) return integrate(f, -Infinity, 0) + integrate(f, 0, Infinity);
    var g = f, lo = a, hi = b;
    if (b === Infinity) { g = function (t) { var u = 1 - t; return f(a + t / u) / (u * u); }; lo = 0; hi = 1; }
    else if (a === -Infinity) { g = function (t) { var u = 1 - t; return f(b - t / u) / (u * u); }; lo = 0; hi = 1; }
    var stack = [[lo, hi]], total = 0, count = 0;
    while (stack.length) {
      var iv = stack.pop(), r = gk15(g, iv[0], iv[1]);
      if (r.v !== r.v) return NaN;
      if (r.err <= 1e-10 * Math.max(1, Math.abs(r.v)) || count > 400 || iv[1] - iv[0] < 1e-12 * (hi - lo)) total += r.v;
      else { var m = (iv[0] + iv[1]) / 2; stack.push([iv[0], m], [m, iv[1]]); }
      count++;
    }
    return total;
  }

  // Levin u-transform of the first terms of a series: accelerates alternating and slowly converging sums.
  // Higher orders lose accuracy to cancellation, so take the order where successive estimates agree best.
  function levin(terms, partial) {
    var prev = NaN, bestDiff = Infinity, best = NaN;
    for (var k = 4; k < Math.min(terms.length, 22); k++) {
      var num = 0, den = 0;
      for (var j = 0; j <= k; j++) {
        var w = (1 + j) * terms[j];
        if (!w) return { ok: false };
        var c = binom(k, j) * Math.pow((1 + j) / (1 + k), k - 1) * (j % 2 ? -1 : 1);
        num += c * partial[j] / w;
        den += c / w;
      }
      if (!den) return { ok: false };
      var L = num / den, d = Math.abs(L - prev);
      if (d < bestDiff) { bestDiff = d; best = L; }
      prev = L;
    }
    return { ok: bestDiff <= 1e-9 * Math.max(1, Math.abs(best)), v: best };
  }

  function binom(n, k) {
    var r = 1;
    for (var i = 1; i <= k; i++) r = r * (n - k + i) / i;
    return r;
  }

  // Σ term(k) for k = start, start+1, ... to infinity. NaN when it doesn't converge.
  function sumToInfinity(term, start) {
    var S = 0, small = 0, terms = [], partial = [];
    for (var n = 0; n < 200000; n++) {
      var t = term(start + n);
      if (t !== t) return NaN;
      S += t;
      if (!isFinite(S)) return S;
      if (n < 32) { terms.push(t); partial.push(S); }
      if (t === 0 || Math.abs(t) <= 1e-16 * Math.abs(S)) { if (++small >= 10) return S; }
      else small = 0;
      if (n === 40) {
        // Only trust acceleration when the terms are clearly shrinking towards 0.
        var head = Math.max(Math.abs(terms[0]), Math.abs(terms[1]), Math.abs(terms[2]));
        if (Math.abs(terms[31]) < 0.05 * head) {
          var L = levin(terms, partial);
          if (L.ok) return L.v;
        }
      }
    }
    return NaN;
  }

  function prodToInfinity(term, start) {
    // Positive factors: sum the logs so the same acceleration applies (e.g. Wallis' product).
    if (term(start) > 0) {
      var L = sumToInfinity(function (k) { var t = term(k); return t > 0 ? Math.log(t) : NaN; }, start);
      if (L === L) return Math.exp(L);
    }
    var P = 1, small = 0;
    for (var n = 0; n < 200000; n++) {
      var t = term(start + n);
      if (t !== t) return NaN;
      P *= t;
      if (P === 0) return 0;
      if (!isFinite(P)) return P;
      if (Math.abs(t - 1) <= 1e-15) { if (++small >= 10) return P; }
      else small = 0;
    }
    return NaN;
  }

  function series(f, a, b, prod) {
    if (a !== a || b !== b) return NaN;
    var toInf = prod ? prodToInfinity : sumToInfinity;
    if (a === -Infinity && b === Infinity) {
      var right = toInf(f, 0), left = toInf(function (m) { return f(-m); }, 1);
      return prod ? right * left : right + left;
    }
    if (b === Infinity) return toInf(f, Math.round(a));
    if (a === -Infinity) return toInf(function (m) { return f(-m); }, -Math.round(b));
    if (a === Infinity || b === -Infinity) return prod ? 1 : 0;
    a = Math.round(a); b = Math.round(b);
    if (b - a > 1e6) return NaN;
    var acc = prod ? 1 : 0;
    for (var k = a; k <= b; k++) acc = prod ? acc * f(k) : acc + f(k);
    return acc;
  }

  // Angle unit for trig functions: 1 for radians, π/180 in degree mode.
  var ANG = 1;
  var TRIG = { sin: 1, cos: 1, tan: 1, sec: 1, csc: 1, cot: 1 };

  var RX = {
    P: realPow,
    F: function (n) {
      if (n === Math.round(n)) { if (n < 0) return NaN; if (n > 170) return Infinity; var r = 1; for (var k = 2; k <= n; k++) r *= k; return r; }
      return gamma(n + 1);
    },
    I: integrate,
    S: function (f, a, b) { return series(f, a, b, false); },
    Pr: function (f, a, b) { return series(f, a, b, true); },
    D: function (f, x) {
      var h = 1e-3 * Math.max(1, Math.abs(x));
      return (f(x - 2 * h) - 8 * f(x - h) + 8 * f(x + h) - f(x + 2 * h)) / (12 * h);
    },
    nCr: function (n, r) {
      if (n === Math.round(n) && r === Math.round(r)) {
        if (r < 0 || r > n) return 0;
        var out = 1;
        for (var k = 1; k <= Math.min(r, n - r); k++) out = out * (n - k + 1) / k;
        return Math.round(out);
      }
      return gamma(n + 1) / (gamma(r + 1) * gamma(n - r + 1));
    },
    sin: function (x) { return Math.sin(x * ANG); }, cos: function (x) { return Math.cos(x * ANG); }, tan: function (x) { return Math.tan(x * ANG); },
    sec: function (x) { return 1 / Math.cos(x * ANG); }, csc: function (x) { return 1 / Math.sin(x * ANG); }, cot: function (x) { return 1 / Math.tan(x * ANG); },
    asin: function (x) { return Math.asin(x) / ANG; }, acos: function (x) { return Math.acos(x) / ANG; },
    atan: function (y, x) { return (x === undefined ? Math.atan(y) : Math.atan2(y, x)) / ANG; },
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log10,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
    min: Math.min, max: Math.max,
    mod: function (a, b) { return ((a % b) + b) % b; },
    conj: function (x) { return x; }, real: function (x) { return x; }, imag: function () { return 0; },
    arg: function (x) { return x < 0 ? Math.PI : 0; }
  };

  function withVar(env, v, val) {
    var e = Object.create(env);
    e[v] = val;
    return e;
  }

  function evalC(n, env) {
    switch (n.t) {
      case "num": return [n.v, 0];
      case "i": return [0, 1];
      case "var":
        if (n.n in env) return env[n.n];
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
        if (TRIG[n.f] && ANG !== 1 && as.length === 1) as[0] = [as[0][0] * ANG, as[0][1] * ANG];
        if (Cx[n.f] && as.length === 1) return Cx[n.f](as[0]);
        if (as.some(function (q) { return q[1] !== 0; })) throw new GraphError(n.f + " needs real numbers");
        return [RX[n.f].apply(null, as.map(function (q) { return q[0]; })), 0];
      case "int":
        var lo = realOf(evalC(n.lo, env), "limits"), hi = realOf(evalC(n.hi, env), "limits");
        return [integrate(function (t) { return realOf(evalC(n.a, withVar(env, n.v, [t, 0])), "integral"); }, lo, hi), 0];
      case "sum": case "prod":
        var s0 = realOf(evalC(n.lo, env), "limits"), s1 = realOf(evalC(n.hi, env), "limits");
        if (!isFinite(s0) || !isFinite(s1)) {
          var termAt = function (k, part) { return evalC(n.a, withVar(env, n.v, [k, 0]))[part]; };
          if (n.t === "prod") return [series(function (k) { return realOf(evalC(n.a, withVar(env, n.v, [k, 0])), "product"); }, s0, s1, true), 0];
          return [series(function (k) { return termAt(k, 0); }, s0, s1, false), series(function (k) { return termAt(k, 1); }, s0, s1, false)];
        }
        s0 = Math.round(s0); s1 = Math.round(s1);
        if (s1 - s0 > 1e6) throw new GraphError("too many terms");
        var acc = n.t === "sum" ? [0, 0] : [1, 0];
        for (var k = s0; k <= s1; k++) {
          var term = evalC(n.a, withVar(env, n.v, [k, 0]));
          acc = n.t === "sum" ? Cx.add(acc, term) : Cx.mul(acc, term);
        }
        return acc;
      case "nderiv":
        var x0 = realOf(evalC({ t: "var", n: n.v }, env), "derivative");
        return [RX.D(function (t) { return realOf(evalC(n.a, withVar(env, n.v, [t, 0])), "derivative"); }, x0), 0];
      case "tuple": throw new GraphError("a point can't go here");
    }
    throw new GraphError("can't evaluate this");
  }

  function realOf(c, what) {
    if (c[1] !== 0) throw new GraphError("the " + what + " must be real");
    return c[0];
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

  function jsName(n) { return "v_" + n.replace(/[^A-Za-z0-9]/g, function (c) { return "$" + c.charCodeAt(0); }); }

  function genR(n, vars, consts) {
    function g(q) { return genR(q, vars, consts); }
    function bound(v) { var vs = Object.create(vars); vs[v] = jsName(v); return vs; }
    switch (n.t) {
      case "num": return lit(n.v);
      case "i": throw new GraphError("i only works with z (complex mode)");
      case "var":
        if (n.n in vars) return vars[n.n];
        if (consts.hasOwnProperty(n.n)) {
          var c = consts[n.n];
          if (c[1] !== 0) throw new GraphError(n.n + " is complex, so it can only be used with z");
          return lit(c[0]);
        }
        throw new GraphError(n.n + " isn't defined", [n.n]);
      case "neg": return "(-" + g(n.a) + ")";
      case "fact": return "H.F(" + g(n.a) + ")";
      case "bin":
        var a = g(n.a);
        if (n.op === "^") {
          if (n.b.t === "num" && n.b.v === 2) return "(" + a + "*" + a + ")";
          return "H.P(" + a + "," + g(n.b) + ")";
        }
        return "(" + a + n.op + g(n.b) + ")";
      case "call":
        return "H." + n.f + "(" + n.args.map(g).join(",") + ")";
      case "int": case "sum": case "prod":
        var helper = n.t === "int" ? "H.I" : n.t === "sum" ? "H.S" : "H.Pr";
        return helper + "(function(" + jsName(n.v) + "){return " + genR(n.a, bound(n.v), consts) + ";}," + g(n.lo) + "," + g(n.hi) + ")";
      case "nderiv":
        if (!(n.v in vars)) throw new GraphError("d/d" + n.v + " needs " + n.v + " to be the graph's variable");
        return "H.D(function(" + jsName(n.v) + "){return " + genR(n.a, bound(n.v), consts) + ";}," + vars[n.v] + ")";
      case "tuple": throw new GraphError("a point can't go here");
    }
    throw new GraphError("can't compile this");
  }

  function compileReal1(n, p, consts) {
    var vars = {}; vars[p] = jsName(p);
    var f = new Function("H", vars[p], "return " + genR(n, vars, consts) + ";");
    return function (v) { return f(RX, v); };
  }

  function compileReal2(n, consts) {
    var f = new Function("H", "v_x", "v_y", "return " + genR(n, { x: "v_x", y: "v_y" }, consts) + ";");
    return function (x, y) { return f(RX, x, y); };
  }

  // =====================================================================
  // Complex compiler -> scalar JS source for the workers
  // =====================================================================

  function CGen(consts, pixelC, locus) { this.lines = []; this.k = 0; this.consts = consts; this.pixelC = pixelC; this.locus = locus; }
  CGen.prototype.tmp = function () { return "v" + this.k++; };
  CGen.prototype.pair = function (r, i) {
    var a = this.tmp(), b = this.tmp();
    this.lines.push("var " + a + "=" + r + "," + b + "=" + i + ";");
    return { r: a, i: b };
  };
  CGen.prototype.dynamic = function (n) {
    var fv = freeVars(n);
    return fv.z || (fv.c && this.pixelC) || (this.locus && (fv.x || fv.y));
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
        if (this.locus && n.n === "x") return { r: "zr", i: "0" };
        if (this.locus && n.n === "y") return { r: "zi", i: "0" };
        return { r: "cr", i: "ci" };
      case "neg":
        a = this.gen(n.a);
        return this.pair("-" + a.r, "-" + a.i);
      case "fact": throw new GraphError("! doesn't work on complex numbers");
      case "int": case "sum": case "prod": case "nderiv": throw new GraphError("integrals and sums can't use z yet");
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

  // f(z) as a JS function (zr, zi) -> [re, im], used for root finding.
  function compileComplexZ(node, consts) {
    var g = new CGen(consts, false), res = g.gen(node);
    return new Function("return function(zr,zi){" + g.lines.join("") + "return [" + res.r + "," + res.i + "];}")();
  }

  // A relation in z = x + iy as a real function of (x, y); NaN where the value isn't real.
  function compileLocus(node, consts) {
    var g = new CGen(consts, false, true), res = g.gen(node);
    return new Function("return function(x,y){var zr=x,zi=y;" + g.lines.join("") +
      "var R=" + res.r + ",I=" + res.i + ";return Math.abs(I)<=1e-9*(1+Math.abs(R))?R:NaN;}")();
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
  var settings = { grid: "square", minor: true, numbers: true, arrows: false, xLabel: "", yLabel: "",
    degrees: false, complex: false, projector: false, lock: false };

  function newRow(src, opts) {
    var r = { id: nextId++, src: src || "", color: 0, hidden: false, sMin: null, sMax: null, tMin: 0, tMax: 2 * Math.PI, iter: 300, playing: false, arrow: false, step: 0, res: null };
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
    ANG = settings.degrees ? Math.PI / 180 : 1;
    var userFns = {}, fns = {}, constAst = {}, owner = {};
    rows.forEach(function (r) {
      var name = userFnNames(r.src);
      if (name) userFns[name] = 1;
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

  // In complex mode a complex constant or value is also drawn as a point on the Argand plane.
  function complexPoint(ast, val) {
    return settings.complex && (val[1] !== 0 || hasI(ast)) && isFinite(val[0]) && isFinite(val[1]) ? val : null;
  }
  function realOnly(val) { return settings.complex || val[1] === 0 ? val : [NaN, 0]; }

  function classify(r, fns, consts, constAst, constErr) {
    var s = r.stmt;
    var isFractal = s.op === "->";
    var isDomain = (s.op === "=" && s.lhs.t === "var" && s.lhs.n === "w") || (!s.op && freeVars(s.lhs).z && !(s.lhs.t === "tuple"));
    if (!settings.complex && !isFractal && !isDomain && (hasI(s.lhs) || (s.rhs && hasI(s.rhs)))) {
      throw new GraphError("turn on complex mode in settings to use i");
    }

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
      return { kind: "const", name: name, value: realOnly(val), point: complexPoint(s.rhs, val) };
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
      if (!missingOf(ev, [], consts).length) {
        var v = evalC(e, consts);
        return { kind: "value", value: realOnly(v), point: complexPoint(e, v) };
      }
      if (Object.keys(ev).some(function (v) { return RESERVED[v]; })) throw new GraphError("add = or < to graph this");
      checkVars(e, [], consts);
    }

    // Relations in z: roots of analytic equations, otherwise a locus of z = x + iy.
    if (s.op && !isDomain) {
      var rel = { t: "bin", op: "-", a: lhs, b: rhs }, relVars = freeVars(rel);
      if (relVars.z) {
        if (!settings.complex) throw new GraphError("turn on complex mode in settings to graph z");
        checkVars(rel, ["z", "x", "y"], consts);
        if (s.op === "=" && isAnalytic(rel)) {
          return { kind: "roots", F: compileComplexZ(rel, consts), dF: compileComplexZ(derivative(rel, "z"), consts) };
        }
        return { kind: "implicit", op: s.op, F: compileLocus(rel, consts) };
      }
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

    var gap = { t: "bin", op: "-", a: lhs, b: rhs };
    checkVars(gap, ["x", "y"], consts);
    return { kind: "implicit", op: s.op, F: compileReal2(gap, consts) };
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

  var GREEK_SC = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu",
    "rho", "sigma", "tau", "phi", "chi", "omega", "Gamma", "Delta", "Lambda", "Phi", "Omega"];
  var SHORTCUTS = (function () {
    var s = {
      pi: "\\pi", infinity: "\\infty", infty: "\\infty",
      sqrt: "\\sqrt{#?}", cbrt: "\\sqrt[3]{#?}", nthroot: "\\sqrt[#?]{#?}",
      int: "\\int_{#?}^{#?}", sum: "\\sum_{#?}^{#?}", prod: "\\prod_{#?}^{#?}",
      sin: "\\sin", cos: "\\cos", tan: "\\tan", sec: "\\sec", csc: "\\csc", cot: "\\cot",
      arcsin: "\\arcsin", arccos: "\\arccos", arctan: "\\arctan",
      sinh: "\\sinh", cosh: "\\cosh", tanh: "\\tanh", exp: "\\exp", ln: "\\ln", log: "\\log",
      abs: "\\left|#?\\right|", Re: "\\operatorname{Re}", Im: "\\operatorname{Im}", arg: "\\arg", conj: "\\overline{#?}",
      sign: "\\operatorname{sign}", floor: "\\left\\lfloor#?\\right\\rfloor", ceil: "\\left\\lceil#?\\right\\rceil",
      mod: "\\operatorname{mod}", nCr: "\\operatorname{nCr}", min: "\\min", max: "\\max",
      dx: "\\differentialD x", dy: "\\differentialD y", dt: "\\differentialD t",
      "<=": "\\le", ">=": "\\ge", "*": "\\cdot"
    };
    GREEK_SC.forEach(function (g) { s[g] = "\\" + g; });
    return s;
  })();

  function configField(mf) {
    mf.inlineShortcuts = SHORTCUTS;
    mf.smartFence = true;
    mf.smartSuperscript = true;
    mf.smartMode = false;
    mf.mathVirtualKeyboardPolicy = "auto";
    try { mf.menuItems = []; } catch (e) {}
  }

  function blankRow() {
    var nr = newRow("", { color: nextColor() });
    rows.push(nr);
    rowsEl.appendChild(buildRow(nr));
    return nr;
  }

  function focusRow(r, atStart) {
    if (!r.mounted) { r.focusOnMount = true; return; }
    var mf = r.el.input;
    mf.focus();
    try { mf.position = atStart ? 0 : mf.lastOffset; } catch (e) {}
  }

  function buildRow(r) {
    var wrap = el("div", "row");
    var sw = el("button", "sw");
    sw.type = "button";
    sw.title = "show or hide";
    sw.addEventListener("click", function () { r.hidden = !r.hidden; changed(null); });
    var body = el("div", "rb");
    var mf = document.createElement("math-field");
    mf.className = "src";
    mf.textContent = r.src;
    // MathLive only accepts settings once the field is attached to the page.
    mf.addEventListener("mount", function () {
      configField(mf);
      r.mounted = true;
      if (r.focusOnMount) { r.focusOnMount = false; focusRow(r, false); }
    }, { once: true });
    mf.addEventListener("input", function () {
      // Subscripts only hold letters and digits (as in Desmos): an operator typed there moves out.
      var fixed = mf.value.replace(/_\{([A-Za-z0-9]+)(\+|-|=|<|>|,|\\cdot|\\le|\\ge|\\to)\}$/, "_{$1}$2");
      if (fixed !== mf.value) {
        mf.setValue(fixed, { silenceNotifications: true });
        mf.position = mf.lastOffset;
      }
      r.src = mf.value;
      if (rows[rows.length - 1] === r && r.src) blankRow();
      changed("type:" + r.id);
    });
    mf.addEventListener("keydown", function (e) { rowKeys(e, r, mf); }, true);
    mf.addEventListener("move-out", function (e) {
      var d = e.detail && e.detail.direction, k = rows.indexOf(r);
      if (d === "downward" && k < rows.length - 1) { e.preventDefault(); focusRow(rows[k + 1], true); }
      else if (d === "upward" && k > 0) { e.preventDefault(); focusRow(rows[k - 1], false); }
    });
    var ex = el("div", "ex");
    body.appendChild(mf);
    body.appendChild(ex);
    var del = el("button", "del", SVG_X);
    del.type = "button";
    del.title = "delete";
    del.addEventListener("click", function () { removeRow(r, false); });
    wrap.appendChild(sw); wrap.appendChild(body); wrap.appendChild(del);
    r.el = { wrap: wrap, sw: sw, input: mf, ex: ex, sig: "" };
    renderRow(r);
    return wrap;
  }

  function rowKeys(e, r, mf) {
    var k = rows.indexOf(r);
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();
      var nr = newRow("", { color: nextColor() });
      rows.splice(k + 1, 0, nr);
      rowsEl.insertBefore(buildRow(nr), r.el.wrap.nextSibling);
      focusRow(nr, false);
      changed(null);
    } else if (e.key === "Backspace" && !mf.value && rows.length > 1) {
      e.preventDefault(); e.stopPropagation();
      removeRow(r, true);
    } else if (e.key === "|") {
      e.preventDefault(); e.stopPropagation();
      mf.executeCommand(["insert", "\\left|#?\\right|", { selectionMode: "placeholder" }]);
    } else if (e.key === ">") {
      var prev = "";
      try { prev = mf.getValue(mf.position - 1, mf.position); } catch (err) {}
      if (prev === "-") {
        e.preventDefault(); e.stopPropagation();
        mf.executeCommand("deleteBackward");
        mf.executeCommand(["insert", "\\to"]);
      }
    }
  }

  function removeRow(r, focusPrev) {
    var k = rows.indexOf(r);
    rows.splice(k, 1);
    r.el.wrap.remove();
    if (!rows.length || rows[rows.length - 1].src) blankRow();
    if (focusPrev) focusRow(rows[Math.max(0, k - 1)], false);
    changed(null);
  }

  function renderAllRows() { rows.forEach(renderRow); }

  function renderRow(r) {
    var res = r.res || { kind: "empty" }, e = r.el;
    if (!e) return;
    var c = colorOf(r);
    var drawable = ["explicitY", "explicitX", "polar", "param", "point", "implicit", "fx", "roots"].indexOf(res.kind) >= 0 || !!res.point;
    e.sw.style.setProperty("--c", c);
    e.sw.classList.toggle("off", r.hidden);
    e.sw.style.visibility = drawable ? "" : "hidden";
    e.wrap.classList.toggle("err", res.kind === "error");

    var sig = res.kind + "|" + (res.name || "") + "|" + (res.msg || "") + "|" + (res.missing || []).join(",") + "|" + (res.mode || "") + "|" + !!res.shadowed + "|" + !!res.point + "|" + r.arrow;
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
        it.addEventListener("change", function () { var v = parseInt(it.value, 10); if (v > 0) r.iter = Math.min(v, 100000); it.value = r.iter; changed(null, true); });
        lab.appendChild(it);
        e.ex.appendChild(lab);
      }
      if (res.kind === "value" || res.kind === "const") e.ex.appendChild(el("div", "val"));
      if (res.kind === "roots") e.ex.appendChild(el("div", "val roots"));
      if (res.point || res.kind === "roots") arrowChip(r);
      if (res.shadowed) { var n = el("div", "msg dim"); n.textContent = "only the top colour layer is drawn"; e.ex.appendChild(n); }
    }
    if (res.kind === "value" || res.kind === "const") e.ex.querySelector(".val").textContent = "= " + fmtC(res.value);
    if (res.kind === "roots") e.ex.querySelector(".roots").textContent = rootsText(res.found);
    if (res.kind === "slider" && r.el.range && document.activeElement !== r.el.range) syncSlider(r, res.value);
  }

  function shortC(c) { return fmtC([parseFloat(c[0].toPrecision(6)), parseFloat(c[1].toPrecision(6))]); }
  function rootsText(found) {
    if (!found) return "";
    if (!found.length) return "no roots in view";
    var list = found.slice(0, 8).map(shortC).join(",  ");
    return found.length + (found.length === 1 ? " root:  " : " roots:  ") + list + (found.length > 8 ? ", …" : "");
  }

  function arrowChip(r) {
    var b = el("button", "chip" + (r.arrow ? " on" : ""));
    b.type = "button";
    b.textContent = "arrow from origin";
    b.addEventListener("click", function () { r.arrow = !r.arrow; changed(null, true); });
    r.el.ex.appendChild(b);
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
    range.type = "range"; range.step = r.step || "any";
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

  function numLatex(v) {
    var s = String(v);
    return /e/.test(s) ? v.toFixed(12).replace(/0+$/, "").replace(/\.$/, "") : s;
  }

  function setSlider(r, v) {
    var step = r.step || (r.sMax - r.sMin) / 1000, d = decimalsFor(step);
    if (r.step) v = Math.round(v / r.step) * r.step;
    v = parseFloat(v.toFixed(d));
    r.src = nameLatex(r.res.name) + "=" + numLatex(v);
    r.el.input.setValue(r.src, { silenceNotifications: true });
    changed("slider:" + r.id);
  }

  function buildRange(r, v) {
    var box = el("div", "range");
    var lo = el("input", "num"), hi = el("input", "num"), unit = v === "θ" ? ANG : 1;
    lo.type = hi.type = "text";
    function show() { lo.value = fmt(parseFloat((r.tMin / unit).toPrecision(10))); hi.value = fmt(parseFloat((r.tMax / unit).toPrecision(10))); }
    show();
    function bound() {
      var a = parseFloat(lo.value) * unit, b = parseFloat(hi.value) * unit;
      if (isFinite(a) && isFinite(b) && a < b) { r.tMin = a; r.tMax = b; changed(null); }
      show();
    }
    lo.addEventListener("change", bound);
    hi.addEventListener("change", bound);
    box.appendChild(lo);
    box.appendChild(document.createTextNode(" ≤ " + v + " ≤ "));
    box.appendChild(hi);
    r.el.ex.appendChild(box);
  }

  function addSlider(name, after) {
    var nr = newRow(nameLatex(name) + "=1", { color: nextColor() });
    var k = rows.indexOf(after);
    rows.splice(k, 0, nr);
    rowsEl.insertBefore(buildRow(nr), after.el.wrap);
    changed(null);
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
  var setPanel = null;
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

  function viewChanged() { dirtyPlot = true; fx.request(false); saveSoon(); if (setPanel && !setPanel.hidden) syncRanges(); }

  // Pointer pan / pinch
  var pointers = {};
  function pts() { return Object.keys(pointers).map(function (k) { return pointers[k]; }); }
  plot.addEventListener("pointerdown", function (e) {
    if (settings.lock) return;
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
    if (settings.lock) return;
    var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1);
    zoomAt(e.offsetX, e.offsetY, Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0015));
  }, { passive: false });

  document.getElementById("zin").addEventListener("click", function () { if (!settings.lock) zoomAt(W / 2, H / 2, 0.5); });
  document.getElementById("zout").addEventListener("click", function () { if (!settings.lock) zoomAt(W / 2, H / 2, 2); });
  document.getElementById("zhome").addEventListener("click", function () { if (settings.lock) return; view.cx = 0; view.cy = 0; view.s = 24 / Math.max(W, 1); viewChanged(); });
  var gridBtn = document.getElementById("zgrid");
  gridBtn.addEventListener("click", function () { showGrid = !showGrid; gridBtn.classList.toggle("on", showGrid); dirtyPlot = true; save(); });

  // ---------- graph settings menu ----------
  var setBtn = document.getElementById("zset");
  setPanel = document.getElementById("gsettings");
  var CHECKS = ["minor", "numbers", "arrows", "complex", "projector", "lock"];
  var RANGE_IDS = ["gs-xmin", "gs-xmax", "gs-ymin", "gs-ymax"];
  function syncRanges() {
    var vals = [wx(0), wx(W), wy(H), wy(0)];
    RANGE_IDS.forEach(function (id, k) {
      var inp = document.getElementById(id);
      if (document.activeElement !== inp) inp.value = parseFloat(vals[k].toPrecision(5));
    });
  }
  function syncSettingsUI() {
    setPanel.querySelectorAll("[data-set]").forEach(function (b) { b.classList.toggle("on", String(settings[b.dataset.set]) === b.dataset.v); });
    CHECKS.forEach(function (k) { document.getElementById("gs-" + k).checked = !!settings[k]; });
    document.getElementById("gs-xlabel").value = settings.xLabel;
    document.getElementById("gs-ylabel").value = settings.yLabel;
    document.getElementById("gs-xlabel").placeholder = settings.complex ? "Re" : "x";
    document.getElementById("gs-ylabel").placeholder = settings.complex ? "Im" : "y";
    syncRanges();
  }
  function applySettings(recompile) {
    if (recompile) changed(null);
    else { dirtyPlot = true; saveSoon(); }
    syncSettingsUI();
  }
  function openSettings(open) {
    setPanel.hidden = !open;
    setBtn.classList.toggle("on", open);
    if (open) syncSettingsUI();
  }
  setBtn.addEventListener("click", function (e) { e.stopPropagation(); openSettings(setPanel.hidden); });
  document.addEventListener("pointerdown", function (e) { if (!setPanel.hidden && !setPanel.contains(e.target) && e.target !== setBtn && !setBtn.contains(e.target)) openSettings(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !setPanel.hidden) openSettings(false); });
  setPanel.querySelectorAll("[data-set]").forEach(function (b) {
    b.addEventListener("click", function () {
      var v = b.dataset.v;
      settings[b.dataset.set] = v === "true" ? true : v === "false" ? false : v;
      applySettings(b.dataset.set === "degrees");
    });
  });
  CHECKS.forEach(function (k) {
    document.getElementById("gs-" + k).addEventListener("change", function (e) {
      settings[k] = e.target.checked;
      applySettings(k === "complex");
    });
  });
  ["x", "y"].forEach(function (a) {
    document.getElementById("gs-" + a + "label").addEventListener("input", function (e) { settings[a + "Label"] = e.target.value; applySettings(false); });
  });
  RANGE_IDS.forEach(function (id) {
    document.getElementById(id).addEventListener("change", function () {
      var v = RANGE_IDS.map(function (i) { return parseFloat(document.getElementById(i).value); });
      if (v.every(isFinite) && v[1] > v[0] && v[3] > v[2]) {
        view.s = clampScale(Math.max((v[1] - v[0]) / W, (v[3] - v[2]) / H));
        view.cx = (v[0] + v[1]) / 2;
        view.cy = (v[2] + v[3]) / 2;
        viewChanged();
      }
      syncRanges();
    });
  });

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

  function lineWidth() { return settings.projector ? 4 : 2.5; }

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  function angleLabel(k, den) {
    if (settings.degrees) return Math.round(k * 180 / den) + "°";
    if (k === 0) return "0";
    var g = gcd(k, den), n = k / g, d = den / g;
    return (n === 1 ? "" : n) + "π" + (d === 1 ? "" : "/" + d);
  }

  function setLabelStyle(overFx) {
    var c = pctx;
    c.font = (settings.projector ? 15 : 11) + "px " + theme.font;
    c.fillStyle = overFx ? "#e7e9ec" : theme.dim;
    c.strokeStyle = overFx ? "rgba(0,0,0,0.6)" : theme.bg;
    c.lineWidth = 3;
    c.lineJoin = "round";
  }
  function haloText(t, x, y) { pctx.strokeText(t, x, y); pctx.fillText(t, x, y); }

  function drawGrid(overFx) {
    var c = pctx, major = niceStep(view.s * (settings.projector ? 150 : 110));
    var mant = major / Math.pow(10, Math.floor(Math.log10(major) + 1e-9));
    var minor = major / (Math.round(mant) === 2 ? 4 : 5);
    var x0 = wx(0), x1 = wx(W), y0 = wy(H), y1 = wy(0);
    var alpha = overFx ? 0.5 : 1, ox = sx(0), oy = sy(0);
    var minorAlpha = alpha * (theme.dark ? 0.35 : 0.45), majorAlpha = alpha * (theme.dark ? 0.9 : 1);
    c.lineWidth = 1;

    if (settings.grid === "square") {
      var lines = function (step) {
        c.strokeStyle = theme.border;
        c.beginPath();
        for (var x = Math.ceil(x0 / step) * step; x <= x1; x += step) { var X = Math.round(sx(x)) + 0.5; c.moveTo(X, 0); c.lineTo(X, H); }
        for (var y = Math.ceil(y0 / step) * step; y <= y1; y += step) { var Y = Math.round(sy(y)) + 0.5; c.moveTo(0, Y); c.lineTo(W, Y); }
        c.stroke();
      };
      if (settings.minor && (x1 - x0) / minor < 400) { c.globalAlpha = minorAlpha; lines(minor); }
      c.globalAlpha = majorAlpha;
      lines(major);
    } else if (settings.grid === "polar") {
      var dx = x0 > 0 ? x0 : x1 < 0 ? -x1 : 0, dy = y0 > 0 ? y0 : y1 < 0 ? -y1 : 0;
      var rMin = Math.hypot(dx, dy);
      var rMax = Math.max(Math.hypot(x0, y0), Math.hypot(x1, y0), Math.hypot(x0, y1), Math.hypot(x1, y1));
      var circles = function (step) {
        var n0 = Math.max(1, Math.floor(rMin / step)), n1 = Math.ceil(rMax / step);
        if (n1 - n0 > 500) return;
        c.strokeStyle = theme.border;
        c.beginPath();
        for (var k = n0; k <= n1; k++) { var R = k * step / view.s; c.moveTo(ox + R, oy); c.arc(ox, oy, R, 0, 2 * Math.PI); }
        c.stroke();
      };
      if (settings.minor) { c.globalAlpha = minorAlpha; circles(minor); }
      c.globalAlpha = majorAlpha;
      circles(major);
      // spokes every π/12; the π/6 ones are drawn stronger, and the axes are drawn separately
      var reach = rMax / view.s + 10;
      c.strokeStyle = theme.border;
      [1, 0].forEach(function (odd) {
        if (odd && !settings.minor) return;
        c.beginPath();
        for (var a = 0; a < 24; a++) {
          if (a % 6 === 0 || a % 2 !== odd) continue;
          var th = a * Math.PI / 12;
          c.moveTo(ox, oy);
          c.lineTo(ox + reach * Math.cos(th), oy - reach * Math.sin(th));
        }
        c.globalAlpha = odd ? minorAlpha : majorAlpha;
        c.stroke();
      });
    }
    c.globalAlpha = 1;

    // axes, with optional arrowheads
    c.strokeStyle = theme.dim;
    c.fillStyle = theme.dim;
    c.lineWidth = settings.projector ? 2 : 1.25;
    c.beginPath();
    var showY = ox >= 0 && ox <= W, showX = oy >= 0 && oy <= H;
    if (showY) { c.moveTo(ox, 0); c.lineTo(ox, H); }
    if (showX) { c.moveTo(0, oy); c.lineTo(W, oy); }
    c.stroke();
    if (settings.arrows) {
      var hs = settings.projector ? 11 : 8;
      c.beginPath();
      if (showX) { c.moveTo(W, oy); c.lineTo(W - hs * 1.4, oy - hs / 2); c.lineTo(W - hs * 1.4, oy + hs / 2); c.closePath(); }
      if (showY) { c.moveTo(ox, 0); c.lineTo(ox - hs / 2, hs * 1.4); c.lineTo(ox + hs / 2, hs * 1.4); c.closePath(); }
      c.fill();
    }
    var xl = settings.xLabel || (settings.arrows ? (settings.complex ? "Re" : "x") : "");
    var yl = settings.yLabel || (settings.arrows ? (settings.complex ? "Im" : "y") : "");
    c.font = "italic " + (settings.projector ? 20 : 16) + "px KaTeX_Math, " + theme.font;
    c.fillStyle = theme.text;
    c.strokeStyle = overFx ? "rgba(0,0,0,0.6)" : theme.bg;
    c.lineWidth = 3;
    if (xl && showX) { c.textAlign = "right"; c.textBaseline = "bottom"; haloText(xl, W - 6, oy - 6); }
    if (yl && showY) { c.textAlign = "left"; c.textBaseline = "top"; haloText(yl, ox + 8, 4); }

    if (!settings.numbers) return;
    setLabelStyle(overFx);
    var ly = Math.min(Math.max(oy + 4, 4), H - 16);
    c.textAlign = "center"; c.textBaseline = "top";
    for (var x = Math.ceil(x0 / major) * major; x <= x1; x += major) {
      var X = sx(x);
      if (Math.abs(x) < major * 1e-6 || X < 12 || X > W - 12) continue;
      haloText(tickLabel(x, major), X, ly);
    }
    var right = ox - 6 < 30, lx = right ? Math.max(ox + 6, 6) : Math.min(ox - 6, W - 6);
    c.textAlign = right ? "left" : "right"; c.textBaseline = "middle";
    for (var y = Math.ceil(y0 / major) * major; y <= y1; y += major) {
      var Y = sy(y);
      if (Math.abs(y) < major * 1e-6 || Y < 10 || Y > H - 10) continue;
      haloText(tickLabel(y, major), lx, Y);
    }
    if (ox > 0 && ox < W && oy > 0 && oy < H) {
      c.textAlign = "right"; c.textBaseline = "top";
      haloText("0", ox - 5, oy + 4);
      if (settings.grid === "polar") {
        // angle labels every π/6 near the edge of the view
        c.textAlign = "center"; c.textBaseline = "middle";
        for (var k = 1; k < 12; k++) {
          if (k % 3 === 0) continue;
          var t = k * Math.PI / 6, ux = Math.cos(t), uy = -Math.sin(t);
          var tx = ux > 0 ? (W - ox) / ux : ux < 0 ? -ox / ux : Infinity;
          var ty = uy > 0 ? (H - oy) / uy : uy < 0 ? -oy / uy : Infinity;
          var d = Math.min(tx, ty) - (settings.projector ? 28 : 20);
          if (d > 40) haloText(angleLabel(k, 6), ox + ux * d, oy + uy * d);
        }
      }
    }
  }

  function strokeCurve(color) {
    pctx.strokeStyle = color;
    pctx.lineWidth = lineWidth();
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
    // A sign change is only a real crossing if the function is near zero at the interpolated point;
    // otherwise it's a jump (an asymptote, or a branch cut such as arg's at the negative real axis).
    function edge(ax, ay, va, bx, by, vb) {
      if (!(va < 0 !== vb < 0) || !isFinite(va) || !isFinite(vb)) return null;
      var t = va / (va - vb), X = ax + (bx - ax) * t, Y = ay + (by - ay) * t;
      var vm = F(wx(X), wy(Y));
      if (!(Math.abs(vm) <= 0.35 * (Math.abs(va) + Math.abs(vb)))) return null;
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

  function drawPoint(x, y, color, text) {
    var X = sx(x), Y = sy(y), rad = settings.projector ? 7 : 5;
    if (X < -10 || X > W + 10 || Y < -10 || Y > H + 10) return;
    pctx.beginPath();
    pctx.arc(X, Y, rad, 0, 2 * Math.PI);
    pctx.fillStyle = color;
    pctx.strokeStyle = theme.dark ? "#15171a" : "#ffffff";
    pctx.lineWidth = 2;
    pctx.stroke();
    pctx.fill();
    if (text) {
      pctx.font = (settings.projector ? 16 : 13) + "px " + theme.font;
      pctx.textAlign = "left"; pctx.textBaseline = "bottom";
      pctx.fillStyle = color;
      pctx.strokeStyle = theme.bg;
      pctx.lineWidth = 3;
      haloText(text, X + rad + 3, Y - rad);
    }
  }

  function drawArrow(x0, y0, x1, y1, color) {
    var X0 = sx(x0), Y0 = sy(y0), X1 = sx(x1), Y1 = sy(y1), L = Math.hypot(X1 - X0, Y1 - Y0);
    if (L < 1) return;
    var ux = (X1 - X0) / L, uy = (Y1 - Y0) / L, hs = settings.projector ? 16 : 12;
    var c = pctx;
    c.beginPath();
    c.moveTo(X0, Y0);
    c.lineTo(X1 - ux * hs * 0.8, Y1 - uy * hs * 0.8);
    strokeCurve(color);
    c.beginPath();
    c.moveTo(X1, Y1);
    c.lineTo(X1 - ux * hs - uy * hs * 0.45, Y1 - uy * hs + ux * hs * 0.45);
    c.lineTo(X1 - ux * hs + uy * hs * 0.45, Y1 - uy * hs - ux * hs * 0.45);
    c.closePath();
    c.fillStyle = color;
    c.fill();
  }

  // Roots of analytic equations in z, found by Newton's method from a grid of starting points.
  function findRoots(F, dF) {
    var x0 = Math.min(wx(0), -2), x1 = Math.max(wx(W), 2), y0 = Math.min(wy(H), -2), y1 = Math.max(wy(0), 2);
    var padX = (x1 - x0) * 0.15, padY = (y1 - y0) * 0.15, N = 28, out = [];
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
    for (var i = 0; i < N && out.length < 300; i++) {
      for (var j = 0; j < N && out.length < 300; j++) {
        var zr = x0 + (i + 0.5) * (x1 - x0) / N, zi = y0 + (j + 0.5) * (y1 - y0) / N, ok = false;
        for (var k = 0; k < 80; k++) {
          var f = F(zr, zi), d = dF(zr, zi), den = d[0] * d[0] + d[1] * d[1];
          if (!(den > 0) || !isFinite(f[0]) || !isFinite(f[1])) break;
          var sr = (f[0] * d[0] + f[1] * d[1]) / den, si = (f[1] * d[0] - f[0] * d[1]) / den;
          zr -= sr; zi -= si;
          if (Math.hypot(sr, si) <= 1e-13 * (1 + Math.hypot(zr, zi))) { ok = true; break; }
        }
        if (!ok) continue;
        var fz = F(zr, zi);
        if (!(Math.hypot(fz[0], fz[1]) < 1e-8)) continue;
        var dup = out.some(function (q) { return Math.hypot(q[0] - zr, q[1] - zi) < 1e-6 * (1 + Math.hypot(zr, zi)); });
        if (!dup) out.push([Math.abs(zr) < 1e-12 ? 0 : zr, Math.abs(zi) < 1e-12 ? 0 : zi]);
      }
    }
    out.sort(function (a, b) { return Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]) || Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]); });
    return out;
  }

  function drawPlot() {
    var c = pctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    var overFx = fx.active;
    if (showGrid) drawGrid(overFx);
    var visible = rows.filter(function (r) { return !r.hidden && r.res; });
    var rootsKey = [Math.round(view.cx / (W * view.s) * 4), Math.round(view.cy / (H * view.s) * 4), Math.round(Math.log(view.s) * 3)].join(",");
    visible.forEach(function (r) {
      var res = r.res, color = colorOf(r);
      try {
        if (res.kind === "implicit") drawImplicit(res.F, res.op, color);
        else if (res.kind === "explicitY") drawExplicit(res.f, color, false);
        else if (res.kind === "explicitX") drawExplicit(res.f, color, true);
        else if (res.kind === "param") drawParam(res.fx, res.fy, r.tMin, r.tMax, color);
        else if (res.kind === "polar") drawParam(function (q) { return res.f(q / ANG) * Math.cos(q); }, function (q) { return res.f(q / ANG) * Math.sin(q); }, r.tMin, r.tMax, color);
      } catch (e) { /* a bad sample shouldn't stop the other graphs */ }
    });
    visible.forEach(function (r) {
      var res = r.res, color = colorOf(r);
      if (res.kind === "point") drawPoint(res.x, res.y, color);
      else if (res.point) {
        if (r.arrow) drawArrow(0, 0, res.point[0], res.point[1], color);
        drawPoint(res.point[0], res.point[1], color, res.name ? displayName(res.name) : "");
      } else if (res.kind === "roots") {
        if (res.key !== rootsKey) {
          var before = res.found ? res.found.length : -1;
          res.found = findRoots(res.F, res.dF);
          res.key = rootsKey;
          if (res.found.length !== before) renderRow(r);
        }
        res.found.forEach(function (z) {
          if (r.arrow) drawArrow(0, 0, z[0], z[1], color);
          drawPoint(z[0], z[1], color);
        });
      }
    });
  }

  function displayName(n) {
    var sub = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉" };
    var parts = n.split("_"), head = parts[0] === "θ" ? "θ" : parts[0];
    if (parts.length < 2) return head;
    var tail = parts.slice(1).join("");
    return head + (/^\d+$/.test(tail) ? tail.split("").map(function (d) { return sub[d]; }).join("") : "_" + tail);
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
  // Change handling, undo, persistence, examples
  // =====================================================================

  function changed(key, fxOnly) {
    if (!fxOnly) compileAll();
    renderAllRows();
    dirtyPlot = true;
    fx.request(true);
    saveSoon();
    record(key);
  }

  function rowState(r) {
    return { src: r.src, color: r.color, hidden: r.hidden, sMin: r.sMin, sMax: r.sMax, tMin: r.tMin, tMax: r.tMax, iter: r.iter, arrow: r.arrow, step: r.step };
  }

  // Undo history: one snapshot per action; typing in the same row is merged until it pauses.
  var hist = [], histPos = -1, histKey = null, histTime = 0, restoring = false;
  function snapshot() { return JSON.stringify(rows.filter(function (r) { return r.src.trim(); }).map(rowState)); }
  function record(key) {
    if (restoring) return;
    var s = snapshot(), now = Date.now();
    if (histPos >= 0 && hist[histPos] === s) return;
    if (key && key === histKey && now - histTime < 1500 && histPos > 0 && histPos === hist.length - 1) hist[histPos] = s;
    else {
      hist.length = histPos + 1;
      hist.push(s);
      if (hist.length > 300) hist.shift();
      histPos = hist.length - 1;
    }
    histKey = key;
    histTime = now;
  }
  function resetHistory() { hist = [snapshot()]; histPos = 0; histKey = null; }
  function restore(s) {
    var active = rows.indexOf(rows.filter(function (r) { return r.el && r.el.wrap.contains(document.activeElement); })[0]);
    restoring = true;
    rows = JSON.parse(s).map(function (o) { return newRow(o.src, o); });
    rows.push(newRow("", { color: nextColor() }));
    rowsEl.innerHTML = "";
    compileAll();
    rows.forEach(function (r) { rowsEl.appendChild(buildRow(r)); });
    changed(null);
    restoring = false;
    histKey = null;
    if (active >= 0) focusRow(rows[Math.min(active, rows.length - 1)], false);
  }
  function undo() { if (histPos > 0) { histPos--; restore(hist[histPos]); } }
  function redo() { if (histPos < hist.length - 1) { histPos++; restore(hist[histPos]); } }

  window.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === "z" || k === "y") {
      e.preventDefault();
      e.stopPropagation();
      if (k === "z" && !e.shiftKey) undo(); else redo();
    }
  }, true);

  var saveTimer;
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        v: 2,
        rows: rows.filter(function (r) { return r.src.trim(); }).map(rowState),
        view: view, grid: showGrid, settings: settings
      }));
    } catch (e) {}
  }

  // Older saves stored plain text like "y = sin x"; MathLive can read that as ASCIIMath.
  function toLatex(src) {
    try {
      if (window.MathLive && MathLive.convertAsciiMathToLatex) return MathLive.convertAsciiMathToLatex(src.replace(/->/g, "→"));
    } catch (e) {}
    return src;
  }

  function load(state, keepHistory) {
    var list = state.rows || [];
    if (state.v !== 2) list = list.map(function (o) { var c = {}; for (var k in o) c[k] = o[k]; c.src = toLatex(o.src || ""); return c; });
    rows = list.map(function (o) { return newRow(o.src, o); });
    rows.push(newRow("", { color: nextColor() }));
    if (state.view) { view.cx = state.view.cx; view.cy = state.view.cy; view.s = state.view.s; }
    if (typeof state.grid === "boolean") showGrid = state.grid;
    if (state.settings) for (var sk in state.settings) if (sk in settings) settings[sk] = state.settings[sk];
    gridBtn.classList.toggle("on", showGrid);
    rowsEl.innerHTML = "";
    compileAll();
    rows.forEach(function (r) { rowsEl.appendChild(buildRow(r)); });
    if (keepHistory) changed(null);
    else { restoring = true; changed(null); restoring = false; resetHistory(); }
    viewChanged();
  }

  function fitView(cx, cy, width) { return { cx: cx, cy: cy, s: width / Math.max(W, 1) }; }

  var EXAMPLES = {
    mandelbrot: function () { return { rows: [{ src: "z\\to z^2+c" }], view: fitView(-0.6, 0, 3.6) }; },
    julia: function () { return { settings: { complex: true }, rows: [{ src: "a=-0.8", sMin: -1.5, sMax: 0.5 }, { src: "b=0.156", sMin: -1, sMax: 1 }, { src: "c=a+bi" }, { src: "z\\to z^2+c" }], view: fitView(0, 0, 3.6) }; },
    ship: function () { return { rows: [{ src: "z\\to\\left(\\left|\\operatorname{Re}\\left(z\\right)\\right|+i\\left|\\operatorname{Im}\\left(z\\right)\\right|\\right)^2+c" }], view: fitView(-0.45, -0.5, 3.4) }; },
    cubic: function () { return { rows: [{ src: "z\\to z^3+c" }], view: fitView(0, 0, 3.4) }; },
    domain: function () { return { rows: [{ src: "w=\\frac{\\left(z^2-1\\right)\\left(z-2-i\\right)^2}{z^2+2+2i}" }], view: fitView(0, 0, 7) }; },
    waves: function () { return { rows: [{ src: "a=1", sMin: 0, sMax: 5 }, { src: "y=\\sin\\left(ax\\right)" }, { src: "y=\\frac{\\cos x}{a}" }], view: fitView(0, 0, 16) }; },
    implicit: function () { return { rows: [{ src: "\\left(x^2+y^2-1\\right)^3=x^2y^3" }, { src: "x^2+y^2<0.25" }], view: fitView(0, 0, 5) }; },
    curves: function () { return { rows: [{ src: "r=\\cos\\left(4\\theta\\right)" }, { src: "\\left(\\sin3t,\\sin4t\\right)" }, { src: "\\left(0.5,0.5\\right)" }], view: fitView(0, 0, 4) }; },
    calculus: function () { return { rows: [{ src: "f\\left(x\\right)=x^3-3x" }, { src: "a=1.5", sMin: -2.5, sMax: 2.5 }, { src: "y=f\\left(a\\right)+f'\\left(a\\right)\\left(x-a\\right)" }, { src: "\\left(a,f\\left(a\\right)\\right)" }], view: fitView(0, 0, 9) }; },
    loci: function () {
      return { settings: { complex: true, grid: "square" }, rows: [{ src: "\\left|z-1-i\\right|=2" }, { src: "\\arg\\left(z-1\\right)=\\frac{\\pi}{4}" },
        { src: "\\left|z+2\\right|\\le1" }, { src: "z_1=1+i", arrow: true }], view: fitView(0, 0.5, 11) };
    },
    roots: function () {
      return { settings: { complex: true, grid: "polar" }, rows: [{ src: "n=5", sMin: 2, sMax: 12, step: 1 }, { src: "z^n=1", arrow: true },
        { src: "\\left|z\\right|=1" }], view: fitView(0, 0, 4.5) };
    },
    integral: function () { return { rows: [{ src: "f\\left(x\\right)=\\int_0^x\\sin\\left(t^2\\right)dt" }, { src: "y=\\sin\\left(x^2\\right)" }], view: fitView(0, 0, 10) }; },
    fourier: function () { return { rows: [{ src: "N=5", sMin: 1, sMax: 40 }, { src: "y=\\frac{4}{\\pi}\\sum_{n=1}^N\\frac{\\sin\\left(\\left(2n-1\\right)x\\right)}{2n-1}" }], view: fitView(0, 0, 14) }; }
  };

  document.getElementById("examples").addEventListener("change", function (e) {
    var k = e.target.value;
    e.target.value = "";
    if (!EXAMPLES[k]) return;
    var ex = EXAMPLES[k]();
    ex.rows.forEach(function (r, i) { r.color = i % PALETTE_LEN; });
    ex.v = 2;
    load(ex, true);
    save();
  });
  document.getElementById("clear").addEventListener("click", function () {
    load({ v: 2, rows: [], view: { cx: 0, cy: 0, s: 24 / Math.max(W, 1) }, grid: showGrid }, true);
    save();
    focusRow(rows[0], false);
  });

  document.addEventListener("keydown", function (e) {
    var tag = document.activeElement && document.activeElement.tagName;
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT|MATH-FIELD)$/.test(tag)) {
      e.preventDefault();
      focusRow(rows[rows.length - 1], false);
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
  else load({ v: 2, rows: [], view: { cx: 0, cy: 0, s: 24 / Math.max(W, 1) } });
  try { rows[0].el.input.placeholder = "y=\\sin x"; } catch (e) {}
  requestAnimationFrame(loop);
})();
