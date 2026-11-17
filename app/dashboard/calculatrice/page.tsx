"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import { doc, getDoc, onSnapshot } from "firebase/firestore";

// =============================================================================
// CALCULATRICE + CONVERTISSEUR  ($ • HTG • $HT)
//  • Le taux se modifie dans les Paramètres de l'app (plus ici)
//  • 1 $ = taux HTG   (ex. 135)
//  • 1 $HT = 5 HTG   (fixe)  →  1 $ = taux ÷ 5 $HT (ex. 27)
//  • Résultat automatique, historique, copier, équivalences, clavier physique
//  • Mise en page adaptative (tous les écrans), état sauvegardé
// =============================================================================

// ─── 1. TYPES & CONSTANTES ───────────────────────────────────────────────────
interface UserSession {
  username: string; displayName: string; isAdmin: boolean;
  localId: string; permissions: Record<string, boolean>;
}
interface HistItem { e: string; r: string; t: string; }
type Cur = "usd" | "htg" | "dh";

const NAVY = "#1A1D2E", ORANGE = "#FF6B35";
const DEFAULT_TAUX = 135;
const DH_RATE = 5; // 1 $HT = 5 HTG
const HIST_KEY = "calc_history";
const STATE_KEY = "calc_state";
const OPS = ["+", "-", "×", "÷"];

const CUR_ORDER: Cur[] = ["usd", "htg", "dh"];
const CUR_LABEL: Record<Cur, string> = { usd: "$", htg: "HTG", dh: "$HT" };
const CUR_NAME: Record<Cur, string> = { usd: "Dollar US", htg: "Gourde", dh: "Dollar haïtien" };
const CUR_SHORT: Record<Cur, string> = { usd: "$", htg: "G", dh: "$H" };
const CUR_COLOR: Record<Cur, string> = { usd: "#00C853", htg: "#2979FF", dh: "#AA00FF" };
const CUR_LIGHT: Record<Cur, string> = { usd: "#69F0AE", htg: "#82B1FF", dh: "#EA80FF" };

// ─── 2. FORMATAGE ────────────────────────────────────────────────────────────
const group = (ip: string) => ip.replace(/(\d)(?=(\d{3})+$)/g, "$1,");
const stripZeros = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
const decFor = (v: number) => (v !== 0 && Math.abs(v) < 1 ? 4 : 2);

function fmt(v: number, dec = 2): string {
  if (!isFinite(v)) return "Erreur";
  const neg = v < 0;
  const s = stripZeros(Math.abs(v).toFixed(dec));
  const [ip, fp] = s.split(".");
  const out = fp ? `${group(ip)}.${fp}` : group(ip);
  return neg && out !== "0" ? `-${out}` : out;
}

function plain(v: number, dec: number): string {
  const s = stripZeros(v.toFixed(dec));
  return s === "-0" ? "0" : s;
}

function pretty(e: string): string {
  const g = e.replace(/\d+(\.\d*)?/g, m => {
    const [ip, fp] = m.split(".");
    return m.includes(".") ? `${group(ip)}.${fp}` : group(ip);
  });
  return g.replace(/([+×÷-])/g, " $1 ").replace(/\s+/g, " ").trim();
}

const withCur = (n: string, c: Cur) => (c === "usd" ? `$ ${n}` : `${n} ${CUR_LABEL[c]}`);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// ─── 3. ÉVALUATEUR (priorités + - × ÷ et %) ──────────────────────────────────
class Div0 extends Error {}

class Parser {
  private i = 0;
  constructor(private s: string) {}

  parse(): number {
    const r = this.expr();
    if (this.i !== this.s.length) throw new Error("extra");
    return r;
  }
  private expr(): number {
    let left = this.term().v;
    while (this.i < this.s.length && (this.s[this.i] === "+" || this.s[this.i] === "-")) {
      const op = this.s[this.i++];
      const t = this.term();
      const right = t.pct ? left * t.v : t.v; // 100 + 10% = 110
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  private term(): { v: number; pct: boolean } {
    const f = this.factor();
    let v = f.v, multi = false;
    while (this.i < this.s.length && (this.s[this.i] === "×" || this.s[this.i] === "÷")) {
      const op = this.s[this.i++];
      const r = this.factor().v;
      multi = true;
      if (op === "×") v *= r;
      else { if (r === 0) throw new Div0(); v /= r; }
    }
    return { v, pct: f.pct && !multi };
  }
  private factor(): { v: number; pct: boolean } {
    let sign = 1;
    while (this.i < this.s.length && (this.s[this.i] === "-" || this.s[this.i] === "+")) {
      if (this.s[this.i] === "-") sign = -sign;
      this.i++;
    }
    const start = this.i;
    while (this.i < this.s.length && /[0-9.]/.test(this.s[this.i])) this.i++;
    if (start === this.i) throw new Error("num");
    let t = this.s.substring(start, this.i);
    if (t.endsWith(".")) t += "0";
    let v = parseFloat(t);
    let pct = false;
    while (this.i < this.s.length && this.s[this.i] === "%") { v /= 100; pct = true; this.i++; }
    return { v: sign * v, pct };
  }
}

function evalSafe(expr: string): { res: number | null; div0: boolean } {
  let s = expr;
  while (s.length > 0 && "+-×÷.".includes(s[s.length - 1])) s = s.slice(0, -1);
  if (!s) return { res: null, div0: false };
  try {
    const v = new Parser(s).parse();
    if (!isFinite(v)) return { res: null, div0: false };
    return { res: parseFloat(v.toFixed(10)), div0: false };
  } catch (e) {
    return { res: null, div0: e instanceof Div0 };
  }
}

// ─── 4. LOGIQUE DES TOUCHES ──────────────────────────────────────────────────
function applyKey(expr: string, justEval: boolean, k: string): { expr: string; justEval: boolean } {
  const isOp = (c: string) => OPS.includes(c);
  if (k === "C") return { expr: "", justEval: false };
  if (k === "⌫") return { expr: expr.slice(0, -1), justEval: false };
  if (expr.length >= 60) return { expr, justEval };

  if (OPS.includes(k)) {
    if (expr === "") return { expr: k === "-" ? "-" : "", justEval: false };
    const last = expr[expr.length - 1];
    if (isOp(last)) {
      if (k === "-" && (last === "×" || last === "÷")) return { expr: expr + k, justEval: false };
      let base = expr.slice(0, -1);
      if (base && isOp(base[base.length - 1])) base = base.slice(0, -1);
      if (!base) return { expr: k === "-" ? "-" : "", justEval: false };
      return { expr: base + k, justEval: false };
    }
    return { expr: (last === "." ? expr + "0" : expr) + k, justEval: false };
  }

  if (k === "%") {
    if (!expr) return { expr, justEval };
    const last = expr[expr.length - 1];
    if (/[0-9]/.test(last) || last === "%") return { expr: expr + "%", justEval: false };
    return { expr, justEval };
  }

  // chiffres, ".", "00"
  let e = expr;
  if (justEval) e = "";
  if (e && e[e.length - 1] === "%") return { expr: e, justEval: false };
  const cur = (e.match(/[0-9.]*$/) ?? [""])[0];
  if (k === ".") {
    if (cur.includes(".")) return { expr: e, justEval: false };
    return { expr: e + (cur === "" ? "0." : "."), justEval: false };
  }
  if (k === "00") {
    if (cur === "") return { expr: e + "0", justEval: false };
    if (cur === "0") return { expr: e, justEval: false };
    return { expr: e + "00", justEval: false };
  }
  if (cur === "0") return { expr: e.slice(0, -1) + k, justEval: false };
  return { expr: e + k, justEval: false };
}

// ─── 5. PAGE ─────────────────────────────────────────────────────────────────
export default function CalculatricePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const canOpen = !!user && (user.isAdmin || user.permissions?.calculatriceVoir === true);

  const [expr, setExpr] = useState("");
  const [justEval, setJustEval] = useState(false);
  const [convert, setConvert] = useState(false);
  const [from, setFrom] = useState<Cur>("usd");
  const [to, setTo] = useState<Cur>("htg");

  const [taux, setTaux] = useState(DEFAULT_TAUX);
  const [history, setHistory] = useState<HistItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [menu, setMenu] = useState<"from" | "to" | null>(null);
  const [snack, setSnack] = useState<{ msg: string; color: string } | null>(null);
  const restored = useRef(false);

  const showSnack = (msg: string, color = "#00C853") => {
    setSnack({ msg, color });
    setTimeout(() => setSnack(null), 2500);
  };

  // ─── AUTH ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try { setUser(JSON.parse(raw) as UserSession); }
    catch { router.push("/login"); }
  }, [router]);

  // ─── TAUX (lecture seule, mis à jour en direct) + HISTORIQUE ───────────
  useEffect(() => {
    if (!user || !canOpen) return;
    const cached = parseFloat(localStorage.getItem("taux_dollar_htg") ?? "");
    if (cached > 1) setTaux(cached);
    try {
      const h = JSON.parse(localStorage.getItem(HIST_KEY) ?? "[]");
      if (Array.isArray(h)) setHistory(h);
    } catch {}

    withTimeout(getDoc(doc(db, "parametres", "taux")), 6000).then(s => {
      const n = Number(s.data()?.taux);
      if (n > 1) setTaux(n);
    }).catch(() => {});

    const unsub = onSnapshot(doc(db, "parametres", "taux"), s => {
      const n = Number(s.data()?.taux);
      if (n > 1) { setTaux(n); localStorage.setItem("taux_dollar_htg", String(n)); }
    }, () => {});
    return () => unsub();
  }, [user, canOpen]);

  // ─── CALCUL & DEVISES ──────────────────────────────────────────────────
  const { res, div0 } = useMemo(() => evalSafe(expr), [expr]);

  const rateToHtg = (c: Cur) => (c === "usd" ? taux : c === "dh" ? DH_RATE : 1);
  const convertTo = (a: number, f: Cur, t: Cur) => (a * rateToHtg(f)) / rateToHtg(t);
  const converted = convertTo(res ?? 0, from, to);

  const saveHistory = (list: HistItem[]) => {
    setHistory(list);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list)); } catch {}
  };

  const press = useCallback((k: string) => {
    if (k === "=") {
      if (!expr || res === null) return;
      const body = expr.slice(1);
      if (!convert && /[+×÷%-]/.test(body)) {
        saveHistory([{ e: expr, r: plain(res, 10), t: new Date().toISOString() }, ...history].slice(0, 30));
      }
      setExpr(plain(res, 10));
      setJustEval(true);
      return;
    }
    const n = applyKey(expr, justEval, k);
    setExpr(n.expr);
    setJustEval(n.justEval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expr, justEval, res, convert, history]);

  // ─── CLAVIER PHYSIQUE ──────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const k = ev.key;
      let m: string | null = null;
      if (/^[0-9]$/.test(k)) m = k;
      else if (k === "." || k === ",") m = ".";
      else if (k === "+") m = "+";
      else if (k === "-") m = "-";
      else if (k === "*" || k === "x" || k === "X") m = "×";
      else if (k === "/") m = "÷";
      else if (k === "%") m = "%";
      else if (k === "Enter" || k === "=") m = "=";
      else if (k === "Backspace") m = "⌫";
      else if (k === "Escape" || k === "Delete") m = "C";
      if (m) { ev.preventDefault(); press(m); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  // ─── RESTORE ETA A (retourner là où on était) ──────────────────────────
  useEffect(() => {
    if (!user || !canOpen || restored.current) return;
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const m = JSON.parse(raw);
        if (typeof m.expr === "string") setExpr(m.expr);
        setJustEval(m.justEval === true);
        setConvert(m.convert === true);
        const f: Cur = CUR_ORDER.includes(m.from) ? m.from : "usd";
        const t: Cur = CUR_ORDER.includes(m.to) ? m.to : "htg";
        setFrom(f);
        setTo(f === t ? (f === "htg" ? "usd" : "htg") : t);
      }
    } catch {}
    restored.current = true;
  }, [user, canOpen]);

  // ─── SÈRE ETA A chak fwa yon bagay chanje ──────────────────────────────
  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ expr, justEval, convert, from, to }));
    } catch {}
  }, [expr, justEval, convert, from, to]);

  // ─── ACTIONS ───────────────────────────────────────────────────────────
  const swap = () => {
    const conv = converted;
    setFrom(to);
    setTo(from);
    setExpr(plain(conv, decFor(conv)));
    setJustEval(true);
  };
  const pickFrom = (c: Cur) => { if (c === to) setTo(from); setFrom(c); };
  const pickTo = (c: Cur) => { if (c === from) setFrom(to); setTo(c); };

  const copy = async () => {
    const v = convert ? converted : (res ?? 0);
    try {
      await navigator.clipboard.writeText(plain(v, convert ? decFor(v) : 8));
      showSnack(`Copié : ${fmt(v, convert ? decFor(v) : 8)}`);
    } catch { showSnack("Impossible de copier", "#e65100"); }
  };

  if (!user) return null;

  if (!canOpen) {
    return (
      <main style={{ minHeight: "100dvh", background: "#0F1117", fontFamily: "'Segoe UI',sans-serif",
        color: "#fff", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 14, padding: 20, textAlign: "center" }}>
        <div style={{ fontSize: 54 }}>🔒</div>
        <p style={{ color: "#aaa", margin: 0 }}>
          Vous n&apos;avez pas la permission d&apos;utiliser la calculatrice.
        </p>
        <button onClick={() => router.push("/dashboard")}
          style={{ background: ORANGE, border: "none", color: "#fff", borderRadius: 12,
            padding: "10px 20px", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
          ← Retour
        </button>
      </main>
    );
  }

  // ─── AFFICHAGE ─────────────────────────────────────────────────────────
  let main = !expr ? "0" : div0 ? "Division par 0"
    : res !== null ? fmt(res, convert ? decFor(res) : 8) : "0";
  if (convert && !div0) main = withCur(main, from);
  const convLine = `= ${withCur(fmt(converted, decFor(converted)), to)}`;
  const longMain = main.length > 12;

  const rows = [
    ["C", "⌫", "%", "÷"],
    ["7", "8", "9", "×"],
    ["4", "5", "6", "-"],
    ["1", "2", "3", "+"],
    ["00", "0", ".", "="],
  ];

  const keyStyle = (k: string): React.CSSProperties => {
    let bg = "linear-gradient(180deg,#fff,#F0F1F8)", fg = NAVY, sh = "0 3px 7px rgba(0,0,0,0.08)";
    if (k === "C" || k === "⌫") { bg = "linear-gradient(180deg,#FF8A80,#EF5350)"; fg = "#fff"; sh = "0 3px 7px rgba(239,83,80,0.35)"; }
    else if (k === "=") { bg = `linear-gradient(180deg,#FF9A5C,${ORANGE})`; fg = "#fff"; sh = "0 3px 7px rgba(255,107,53,0.4)"; }
    else if (["%", "÷", "×", "-", "+"].includes(k)) { bg = "linear-gradient(180deg,#5B4CC4,#3A2F8F)"; fg = "#fff"; sh = "0 3px 7px rgba(58,47,143,0.35)"; }
    return {
      width: "100%", height: "100%", minHeight: 44, border: "none", borderRadius: 18,
      background: bg, color: fg, boxShadow: sh,
      fontSize: "clamp(20px, 3.6dvh, 28px)", fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    };
  };

  const badge = (c: Cur, size: number): React.CSSProperties => ({
    width: size, height: size, borderRadius: "50%", flexShrink: 0,
    background: `linear-gradient(135deg, ${CUR_LIGHT[c]}, ${CUR_COLOR[c]})`,
    color: "#fff", fontWeight: 700, fontSize: size * 0.4,
    display: "flex", alignItems: "center", justifyContent: "center",
  });

  // Sélecteur de devise (menu déroulant) comme dans l'app Flutter
  const curPicker = (value: Cur, isFrom: boolean) => {
    const key = isFrom ? "from" : "to";
    const open = menu === key;
    return (
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <button onClick={() => setMenu(open ? null : key)}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
            background: "#fff", cursor: "pointer", fontFamily: "inherit", color: NAVY,
            borderRadius: 16, border: `1.4px solid ${CUR_COLOR[value]}8c`,
            boxShadow: `0 3px 8px ${CUR_COLOR[value]}1f`, textAlign: "left" }}>
          <span style={badge(value, 30)}>{CUR_SHORT[value]}</span>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
            <span style={{ fontSize: 9, color: "#aaa", fontWeight: 700 }}>{isFrom ? "DE" : "VERS"}</span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{CUR_LABEL[value]}</span>
          </span>
          <span style={{ color: "#aaa", fontSize: 12 }}>▾</span>
        </button>

        {open && (
          <>
            <div onClick={() => setMenu(null)}
              style={{ position: "fixed", inset: 0, zIndex: 40 }} />
            <div style={{ position: "absolute", top: "calc(100% + 4px)", [isFrom ? "left" : "right"]: 0,
              minWidth: 210, background: "#fff", borderRadius: 16, padding: 6, zIndex: 50,
              boxShadow: "0 8px 24px rgba(0,0,0,0.22)" }}>
              {CUR_ORDER.map(c => (
                <button key={c} onClick={() => { if (isFrom) pickFrom(c); else pickTo(c); setMenu(null); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                    border: "none", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                    fontSize: 14, color: NAVY, textAlign: "left",
                    background: c === value ? `${CUR_COLOR[c]}18` : "transparent",
                    fontWeight: c === value ? 700 : 500 }}>
                  <span style={badge(c, 28)}>{CUR_SHORT[c]}</span>
                  {CUR_NAME[c]}  ({CUR_LABEL[c]})
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <main style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#0F1117",
      fontFamily: "'Segoe UI',sans-serif", color: "#fff", overflow: "hidden" }}>

      {/* HEADER */}
      <div style={{ borderBottom: "1px solid #1e1e2e", padding: "10px 16px", flexShrink: 0,
        display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.push("/dashboard")} title="Retour"
          style={{ background: "#1A1D2E", border: "none", color: "#aaa", width: 36, height: 36,
            borderRadius: 10, cursor: "pointer", fontSize: 16 }}>←</button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Calculatrice</h1>
      </div>

      {/* ZONE QUI S'ADAPTE À L'ÉCRAN */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex",
        justifyContent: "center", padding: "10px 12px 12px" }}>
        <div style={{ background: "#F4F5FA", color: NAVY, borderRadius: 28, padding: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)", width: "100%", maxWidth: 460,
          height: "100%", minHeight: 560, maxHeight: 900,
          display: "flex", flexDirection: "column", boxSizing: "border-box" }}>

          {/* TITRE + ACTIONS */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexShrink: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, fontSize: 20,
              background: `linear-gradient(135deg,#FF9A5C,${ORANGE})`,
              display: "flex", alignItems: "center", justifyContent: "center" }}>🧮</div>
            <span style={{ flex: 1, fontSize: 19, fontWeight: 700 }}>CALCULATRICE</span>
            <button onClick={() => setShowHistory(s => !s)} title="Historique"
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20 }}>🕘</button>
            <button onClick={copy} title="Copier le résultat"
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>📋</button>
          </div>

          {/* Historique */}
          {showHistory && (
            <div style={{ background: "#fff", borderRadius: 14, padding: 10, marginBottom: 8, flexShrink: 0,
              maxHeight: 160, overflowY: "auto", boxShadow: "0 3px 10px rgba(0,0,0,0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <b style={{ fontSize: 13 }}>Historique</b>
                {history.length > 0 && (
                  <button onClick={() => saveHistory([])}
                    style={{ background: "none", border: "none", color: "#EF5350", cursor: "pointer", fontSize: 12 }}>
                    Effacer
                  </button>
                )}
              </div>
              {history.length === 0 ? (
                <p style={{ margin: 0, color: "#999", fontSize: 12 }}>Aucun calcul pour le moment</p>
              ) : history.map((h, i) => (
                <div key={i} onClick={() => { setExpr(h.r); setJustEval(true); setConvert(false); setShowHistory(false); }}
                  style={{ padding: "6px 4px", cursor: "pointer", borderTop: i ? "1px solid #eee" : "none" }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {pretty(h.e)} = {fmt(parseFloat(h.r), 8)}
                  </div>
                  <div style={{ color: "#999", fontSize: 10 }}>
                    {new Date(h.t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* CALCUL / CONVERTIR */}
          <div style={{ display: "flex", background: "#E4E6F1", borderRadius: 16, padding: 4, marginBottom: 8, flexShrink: 0 }}>
            {([[false, "🧮  Calcul"], [true, "💱  Convertir"]] as const).map(([val, label]) => (
              <button key={label} onClick={() => setConvert(val)}
                style={{ flex: 1, padding: "10px 4px", border: "none", borderRadius: 13, cursor: "pointer",
                  fontWeight: 700, fontSize: 13.5, fontFamily: "inherit",
                  background: convert === val ? "#fff" : "transparent",
                  color: convert === val ? NAVY : "#888",
                  boxShadow: convert === val ? "0 2px 6px rgba(0,0,0,0.1)" : "none" }}>
                {label}
              </button>
            ))}
          </div>

          {/* DE → VERS (comme l'app Flutter) */}
          {convert && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexShrink: 0 }}>
              {curPicker(from, true)}
              <button onClick={swap} title="Inverser"
                style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: NAVY,
                  color: "#fff", cursor: "pointer", fontSize: 18, flexShrink: 0 }}>⇄</button>
              {curPicker(to, false)}
            </div>
          )}

          {/* ÉCRAN (prend l'espace disponible) */}
          <div style={{ flex: 2, minHeight: 96, background: `linear-gradient(135deg, ${NAVY}, #262B4D)`, color: "#fff",
            borderRadius: 26, padding: "12px 18px", textAlign: "right", overflow: "hidden",
            display: "flex", flexDirection: "column", justifyContent: "flex-end",
            border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 6px 14px rgba(26,29,46,0.25)" }}>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "clamp(13px, 2.4dvh, 20px)",
              minHeight: 20, wordBreak: "break-all", overflow: "hidden", maxHeight: "2.8em" }}>
              {expr ? pretty(expr) : " "}
            </div>
            <div style={{ fontSize: longMain ? "clamp(22px, 4.4dvh, 36px)" : "clamp(30px, 7dvh, 60px)",
              fontWeight: 700, marginTop: 4, lineHeight: 1.1,
              color: div0 ? "#ff5252" : "#fff", overflowWrap: "anywhere" }}>{main}</div>
            {convert && !div0 && (
              <div style={{ color: CUR_LIGHT[to], fontSize: main.length > 14 ? "clamp(16px, 3dvh, 22px)" : "clamp(18px, 4dvh, 32px)",
                fontWeight: 700, marginTop: 4, lineHeight: 1.1 }}>
                {convLine}
              </div>
            )}
          </div>

          {/* ÉQUIVALENCES */}
          {convert && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexShrink: 0 }}>
              {CUR_ORDER.map(c => {
                const v = convertTo(res ?? 0, from, c);
                const isFrom = c === from;
                return (
                  <div key={c} style={{ flex: 1, textAlign: "center", padding: "6px 4px", borderRadius: 14,
                    background: `${CUR_COLOR[c]}${isFrom ? "29" : "12"}`,
                    border: `1px solid ${CUR_COLOR[c]}${isFrom ? "bf" : "40"}` }}>
                    <div style={{ color: CUR_COLOR[c], fontWeight: 700, fontSize: 11 }}>{CUR_LABEL[c]}</div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2, wordBreak: "break-all" }}>
                      {fmt(v, decFor(v))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* CLAVIER (grille qui remplit l'espace restant) */}
          <div style={{ flex: 5, minHeight: 260, display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
            gridTemplateRows: "repeat(5, 1fr)", gap: 8, marginTop: 10 }}>
            {rows.flat().map(k => (
              <button key={k} onClick={() => press(k)} style={keyStyle(k)}
                onContextMenu={e => { if (k === "⌫") { e.preventDefault(); press("C"); } }}>
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>

      {snack && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: snack.color, color: "#fff", padding: "10px 20px", borderRadius: 12,
          fontWeight: 600, zIndex: 999, fontSize: 13, maxWidth: "90vw", textAlign: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>{snack.msg}</div>
      )}
    </main>
  );
}