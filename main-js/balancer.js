// Chemical equation balancer
// Reads an equation like "Fe + O2 = Fe2O3", builds an element/charge matrix
// and finds the smallest whole-number coefficients with exact fractions.

const ELEMENTS = new Set((
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
  "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu " +
  "Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr " +
  "Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og"
).split(" "));

const EXAMPLES = [
  "H2 + O2 = H2O",
  "Fe + O2 = Fe2O3",
  "CH4 + O2 = CO2 + H2O",
  "C3H8 + O2 = CO2 + H2O",
  "C6H12O6 + O2 = CO2 + H2O",
  "Al + HCl = AlCl3 + H2",
  "Na + H2O = NaOH + H2",
  "KClO3 = KCl + O2",
  "NH3 + O2 = NO + H2O",
  "Cu + HNO3 = Cu(NO3)2 + NO + H2O",
  "Ca(OH)2 + H3PO4 = Ca3(PO4)2 + H2O",
  "Al2(SO4)3 + Ca(OH)2 = Al(OH)3 + CaSO4",
  "KMnO4 + HCl = KCl + MnCl2 + Cl2 + H2O",
  "K4[Fe(CN)6] + KMnO4 + H2SO4 = KHSO4 + Fe2(SO4)3 + MnSO4 + HNO3 + CO2 + H2O",
  "CuSO4·5H2O = CuSO4 + H2O",
  "Zn + NO3^- + H^+ = Zn^2+ + NH4^+ + H2O",
  "MnO4^- + Fe^2+ + H^+ = Mn^2+ + Fe^3+ + H2O",
  "Cr2O7^2- + I^- + H^+ = Cr^3+ + I2 + H2O",
  "Fe^3+ + e = Fe^2+",
  "C2H5OH + O2 = CO2 + H2O",
];

// ---------- rational numbers (BigInt) ----------

function bigGcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

class Frac {
  constructor(n, d = 1n) {
    if (d === 0n) throw new Error("division by zero");
    if (d < 0n) { n = -n; d = -d; }
    const g = bigGcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  static of(x) { return new Frac(BigInt(x)); }
  isZero() { return this.n === 0n; }
  sub(o) { return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Frac(this.n * o.n, this.d * o.d); }
  div(o) { return new Frac(this.n * o.d, this.d * o.n); }
  neg() { return new Frac(-this.n, this.d); }
}

// ---------- parsing ----------

class BalanceError extends Error {
  constructor(message, pos) {
    super(message);
    this.pos = pos;
  }
}

// A term is a map of element -> count, plus a charge and the text pieces used for display.
function parseEquation(text) {
  const src = text.replace(/→|->|=>/g, "=").replace(/[·•*]/g, "·");
  let i = 0;

  const peek = () => src[i];
  const skipSpaces = () => { while (i < src.length && src[i] === " ") i++; };
  const readNumber = () => {
    let start = i;
    while (i < src.length && /[0-9]/.test(src[i])) i++;
    return start === i ? null : parseInt(src.slice(start, i), 10);
  };

  function addCounts(target, source, times) {
    for (const [el, n] of source) target.set(el, (target.get(el) || 0) + n * times);
  }

  // items until a closing bracket, a charge, a dot or the end of the term
  function readItems(closing) {
    const counts = new Map();
    const parts = []; // for display: {text, sub}
    let any = false;
    while (i < src.length) {
      const c = peek();
      if (/[A-Z]/.test(c)) {
        let start = i++;
        while (i < src.length && /[a-z]/.test(src[i])) i++;
        const symbol = src.slice(start, i);
        if (!ELEMENTS.has(symbol)) throw new BalanceError(`Unknown element "${symbol}"`, start);
        const n = readNumber();
        if (n === 0) throw new BalanceError("A count can't be zero", i - 1);
        addCounts(counts, new Map([[symbol, 1]]), n || 1);
        parts.push({ text: symbol, sub: n ? String(n) : "" });
        any = true;
      } else if (c === "(" || c === "[") {
        const close = c === "(" ? ")" : "]";
        const open = i++;
        const inner = readItems(close);
        if (peek() !== close) throw new BalanceError(`Missing "${close}"`, open);
        i++;
        const n = readNumber();
        if (n === 0) throw new BalanceError("A count can't be zero", i - 1);
        addCounts(counts, inner.counts, n || 1);
        parts.push({ text: c, sub: "" }, ...inner.parts, { text: close, sub: n ? String(n) : "" });
        any = true;
      } else {
        break;
      }
    }
    if (!any) throw new BalanceError("Expected an element or a group", i);
    if (closing && peek() !== closing) throw new BalanceError(`Missing "${closing}"`, i);
    return { counts, parts };
  }

  function readTerm() {
    skipSpaces();
    const start = i;
    // a coefficient typed by the user is ignored, the balancer finds its own
    readNumber();
    skipSpaces();
    if (peek() === "e" && !/[a-z]/.test(src[i + 1] || "")) {
      i++;
      return { counts: new Map(), charge: -1, parts: [{ text: "e", sub: "" }], sup: "−", start };
    }
    const first = readItems(null);
    const counts = first.counts;
    const parts = first.parts;
    // hydrate: CuSO4·5H2O
    while (peek() === "·") {
      i++;
      const n = readNumber() || 1;
      const more = readItems(null);
      addCounts(counts, more.counts, n);
      parts.push({ text: "·" + (n > 1 ? n : ""), sub: "" }, ...more.parts);
    }
    let charge = 0;
    let sup = "";
    if (peek() === "^") {
      i++;
      const n = readNumber();
      const sign = peek();
      if (sign !== "+" && sign !== "-") throw new BalanceError('A charge needs a sign, like ^2+ or ^-', i);
      i++;
      if (n === 0) throw new BalanceError("A charge can't be zero", i - 1);
      charge = (n || 1) * (sign === "+" ? 1 : -1);
      sup = (n && n > 1 ? n : "") + (sign === "+" ? "+" : "−");
    }
    return { counts, charge, parts, sup, start };
  }

  function readSide() {
    const terms = [readTerm()];
    skipSpaces();
    while (peek() === "+") {
      i++;
      terms.push(readTerm());
      skipSpaces();
    }
    return terms;
  }

  if (!src.trim()) throw new BalanceError("Type an equation first, for example H2 + O2 = H2O", 0);
  const left = readSide();
  skipSpaces();
  if (peek() !== "=") throw new BalanceError(i < src.length ? `Unexpected "${peek()}"` : 'Missing "=" between the two sides', i);
  i++;
  const right = readSide();
  skipSpaces();
  if (i < src.length) throw new BalanceError(`Unexpected "${peek()}"`, i);
  return { left, right };
}

// ---------- solving ----------

function balance(eq) {
  const terms = [...eq.left, ...eq.right];
  const sign = terms.map((_, k) => (k < eq.left.length ? 1 : -1));

  const elements = [];
  for (const t of terms) for (const el of t.counts.keys()) if (!elements.includes(el)) elements.push(el);
  const rows = elements.map(el => terms.map((t, k) => Frac.of((t.counts.get(el) || 0) * sign[k])));
  if (terms.some(t => t.charge !== 0)) rows.push(terms.map((t, k) => Frac.of(t.charge * sign[k])));

  // every element must appear on both sides
  for (const el of elements) {
    const onLeft = eq.left.some(t => t.counts.has(el));
    const onRight = eq.right.some(t => t.counts.has(el));
    if (!onLeft || !onRight) throw new BalanceError(`${el} appears on only one side`, null);
  }

  // reduced row echelon form
  const cols = terms.length;
  const pivots = [];
  let r = 0;
  for (let c = 0; c < cols && r < rows.length; c++) {
    let p = r;
    while (p < rows.length && rows[p][c].isZero()) p++;
    if (p === rows.length) continue;
    [rows[r], rows[p]] = [rows[p], rows[r]];
    const lead = rows[r][c];
    rows[r] = rows[r].map(x => x.div(lead));
    for (let q = 0; q < rows.length; q++) {
      if (q === r || rows[q][c].isZero()) continue;
      const f = rows[q][c];
      rows[q] = rows[q].map((x, k) => x.sub(f.mul(rows[r][k])));
    }
    pivots.push(c);
    r++;
  }

  const free = [];
  for (let c = 0; c < cols; c++) if (!pivots.includes(c)) free.push(c);
  if (free.length === 0) throw new BalanceError("This equation can't be balanced", null);
  if (free.length > 1) throw new BalanceError("More than one independent way to balance this; split it into separate reactions", null);

  // free coefficient = 1, the pivots follow from it
  const f = free[0];
  const x = new Array(cols).fill(null);
  x[f] = Frac.of(1);
  pivots.forEach((c, row) => { x[c] = rows[row][f].neg(); });

  // scale to the smallest whole numbers
  let lcm = 1n;
  for (const v of x) lcm = lcm / bigGcd(lcm, v.d) * v.d;
  let ints = x.map(v => v.n * (lcm / v.d));
  let g = 0n;
  for (const v of ints) g = bigGcd(g, v);
  ints = ints.map(v => v / g);
  if (ints.every(v => v <= 0n)) ints = ints.map(v => -v);
  if (ints.some(v => v <= 0n)) throw new BalanceError("No balance with all positive coefficients; check which side each substance is on", null);
  return ints;
}

// ---------- page ----------

const formulaElem = document.querySelector("#inputFormula");
const msgElem = document.querySelector("#message");
const balancedElem = document.querySelector("#balanced");
const codeOutElem = document.querySelector("#codeOutput");

function termNode(t) {
  const span = document.createElement("span");
  for (const p of t.parts) {
    span.append(p.text);
    if (p.sub) {
      const sub = document.createElement("sub");
      sub.textContent = p.sub;
      span.append(sub);
    }
  }
  if (t.sup) {
    const sup = document.createElement("sup");
    sup.textContent = t.sup;
    span.append(sup);
  }
  return span;
}

function termText(t) {
  let s = t.parts.map(p => p.text + p.sub).join("");
  if (t.charge) s += "^" + (Math.abs(t.charge) > 1 ? Math.abs(t.charge) : "") + (t.charge > 0 ? "+" : "-");
  return s;
}

function doBalance() {
  msgElem.textContent = "";
  balancedElem.textContent = "";
  codeOutElem.textContent = "";
  const text = formulaElem.value;
  try {
    const eq = parseEquation(text);
    const coefs = balance(eq);
    const terms = [...eq.left, ...eq.right];
    const sides = [[], []];
    terms.forEach((t, k) => sides[k < eq.left.length ? 0 : 1].push({ t, n: coefs[k] }));

    sides.forEach((side, s) => {
      if (s === 1) balancedElem.append(" → ");
      side.forEach(({ t, n }, j) => {
        if (j > 0) balancedElem.append(" + ");
        if (n !== 1n) {
          const b = document.createElement("b");
          b.textContent = String(n);
          balancedElem.append(b);
        }
        balancedElem.append(termNode(t));
      });
    });
    codeOutElem.textContent = sides
      .map(side => side.map(({ t, n }) => (n !== 1n ? n : "") + termText(t)).join(" + "))
      .join(" = ");
  } catch (e) {
    if (!(e instanceof BalanceError)) throw e;
    msgElem.textContent = e.message;
    if (e.pos !== null && e.pos !== undefined && text) {
      // show where the problem is
      const where = document.createElement("code");
      where.append(text.slice(0, e.pos));
      const mark = document.createElement("mark");
      mark.textContent = text.slice(e.pos, e.pos + 1) || " ";
      where.append(mark, text.slice(e.pos + 1));
      codeOutElem.append(where);
    }
  }
}

let lastExample = -1;
function doRandom() {
  let k;
  do { k = Math.floor(Math.random() * EXAMPLES.length); } while (k === lastExample && EXAMPLES.length > 1);
  lastExample = k;
  formulaElem.value = EXAMPLES[k];
  doBalance();
}

formulaElem.addEventListener("keydown", e => {
  if (e.key === "Enter") doBalance();
});
