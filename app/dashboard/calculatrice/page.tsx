"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";

// =============================================================================
// CALCULATRICE + CONVERTISSEUR  ($ • HTG • $HT)
//  • Taux du jour en haut (l'admin clique sur le petit crayon)
//  • 1 $ = taux HTG   (ex. 135)
//  • 1 $HT = 5 HTG   (fixe)  →  1 $ = taux ÷ 5 $HT (ex. 27)
//  • Résultat automatique, historique, copier, équivalences, clavier physique
// =============================================================================

// ─── 1. TYPES & CONSTANTES ───────────────────────────────────────────────────
interface UserSession {
  username: string; displayName: string; isAdmin: boolean;
  localId: string; permissions: Record<string, boolean>;
}
interface HistItem { e: string; r: string; t: string; }
type Cur = "usd" | "htg" | "dh";

const NAVY = "#1A1D2E", VIOLET = "#4A3AA7", ORANGE = "#FF6B35";
const DEFAULT_TAUX = 135;
const DH_RATE = 5; // 1 $HT = 5 HTG
const HIST_KEY = "calc_history";
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

  const [expr, setExpr] = useState("");
  const [justEval, setJustEval] = useState(false);
  const [convert, setConvert] = useState(false);
  const [from, setFrom] = useState<Cur>("usd");
  const [to, setTo] = useState<Cur>("htg");

  const [taux, setTaux] = useState(DEFAULT_TAUX);
  const [history, setHistory] = useState<HistItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showTauxModal, setShowTauxModal] = useState(false);
  const [snack, setSnack] = useState<{ msg: string; color: string } | null>(null);
  const modalOpen = useRef(false);
  modalOpen.current = showTauxModal;

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

  // ─── TAUX (parametres/taux, mis à jour en direct) + HISTORIQUE ─────────
  useEffect(() => {
    if (!user) return;
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
  }, [user]);

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
      if (modalOpen.current) return;
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

  const saveTaux = async (v: number) => {
    try {
      await withTimeout(setDoc(doc(db, "parametres", "taux"),
        { taux: v, updatedAt: new Date().toISOString() }), 8000);
      setTaux(v);
      localStorage.setItem("taux_dollar_htg", String(v));
      setShowTauxModal(false);
      showSnack(`✅ Taux enregistré : 1 $ = ${fmt(v, 4)} HTG`);
    } catch {
      showSnack("❌ Pas sauvegardé. Connexion lente, réessayez.", "#ff4444");
    }
  };

  if (!user) return null;

  // ─── AFFICHAGE ─────────────────────────────────────────────────────────
  let main = !expr ? "0" : div0 ? "Division par 0"
    : res !== null ? fmt(res, convert ? decFor(res) : 8) : "0";
  if (convert && !div0) main = withCur(main, from);
  const convLine = `= ${withCur(fmt(converted, decFor(converted)), to)}`;

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
      height: 60, border: "none", borderRadius: 18, background: bg, color: fg, boxShadow: sh,
      fontSize: 24, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    };
  };

  const badge = (c: Cur, size: number): React.CSSProperties => ({
    width: size, height: size, borderRadius: "50%", flexShrink: 0,
    background: `linear-gradient(135deg, ${CUR_LIGHT[c]}, ${CUR_COLOR[c]})`,
    color: "#fff", fontWeight: 700, fontSize: size * 0.4,
    display: "flex", alignItems: "center", justifyContent: "center",
  });

  const pill = (c: string): React.CSSProperties => ({
    background: `${c}38`, border: `1px solid ${c}8c`, color: "#fff",
    padding: "4px 9px", borderRadius: 10, fontSize: 11, fontWeight: 600,
  });

  return (
    <main style={{ minHeight: "100vh", background: "#0F1117",
      fontFamily: "'Segoe UI',sans-serif", color: "#fff" }}>

      {/* HEADER */}
      <div style={{ borderBottom: "1px solid #1e1e2e", padding: "14px 20px",
        display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.push("/dashboard")} title="Retour"
          style={{ background: "#1A1D2E", border: "none", color: "#aaa", width: 36, height: 36,
            borderRadius: 10, cursor: "pointer", fontSize: 16 }}>←</button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Calculatrice</h1>
      </div>

      <div style={{ maxWidth: 460, margin: "24px auto", padding: "0 16px" }}>
        <div style={{ background: "#F4F5FA", color: NAVY, borderRadius: 28, padding: 18,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>

          {/* ── 1) TAUX DU JOUR (tout en haut) ── */}
          <div style={{ background: `linear-gradient(135deg, ${NAVY}, ${VIOLET})`, borderRadius: 22,
            padding: "12px 10px 12px 14px", display: "flex", alignItems: "center", gap: 12,
            boxShadow: `0 6px 16px ${VIOLET}59`, color: "#fff" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.14)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>💱</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 10, letterSpacing: 1.4, fontWeight: 700 }}>
                TAUX DU JOUR
              </div>
              <div style={{ fontSize: 21, fontWeight: 700, margin: "2px 0 6px" }}>
                1 $ = {fmt(taux, 4)} HTG
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span style={pill(CUR_COLOR.dh)}>1 $ = {fmt(taux / DH_RATE, 4)} $HT</span>
                <span style={pill(CUR_COLOR.htg)}>1 $HT = {fmt(DH_RATE)} HTG</span>
              </div>
            </div>
            {/* Seulement un petit crayon, visible pour l'admin */}
            {user.isAdmin && (
              <button onClick={() => setShowTauxModal(true)} title="Modifier le taux"
                style={{ width: 32, height: 32, borderRadius: "50%", border: "none",
                  background: "rgba(255,255,255,0.18)", color: "#fff", cursor: "pointer",
                  fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                ✏️
              </button>
            )}
          </div>

          {/* ── 2) TITRE + ACTIONS ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 8px" }}>
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
            <div style={{ background: "#fff", borderRadius: 14, padding: 10, marginBottom: 10,
              maxHeight: 200, overflowY: "auto", boxShadow: "0 3px 10px rgba(0,0,0,0.08)" }}>
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

          {/* ── 3) CALCUL / CONVERTIR ── */}
          <div style={{ display: "flex", background: "#E4E6F1", borderRadius: 16, padding: 4, marginBottom: 10 }}>
            {([[false, "🧮  Calcul"], [true, "💱  Convertir"]] as const).map(([val, label]) => (
              <button key={label} onClick={() => setConvert(val)}
                style={{ flex: 1, padding: "11px 4px", border: "none", borderRadius: 13, cursor: "pointer",
                  fontWeight: 700, fontSize: 13.5, fontFamily: "inherit",
                  background: convert === val ? "#fff" : "transparent",
                  color: convert === val ? NAVY : "#888",
                  boxShadow: convert === val ? "0 2px 6px rgba(0,0,0,0.1)" : "none" }}>
                {label}
              </button>
            ))}
          </div>

          {/* ── 4) DE → VERS ── */}
          {convert && (
            <div style={{ marginBottom: 10 }}>
              {([["DE", from, pickFrom], ["VERS", to, pickTo]] as const).map(([label, value, pick]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ width: 38, fontSize: 10, fontWeight: 700, color: "#888" }}>{label}</span>
                  {CUR_ORDER.map(c => {
                    const sel = value === c;
                    return (
                      <button key={c} onClick={() => pick(c)} title={CUR_NAME[c]}
                        style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, padding: "7px 8px",
                          background: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 700,
                          fontSize: 13, color: NAVY, borderRadius: 14,
                          border: `1.5px solid ${sel ? CUR_COLOR[c] : "#E4E6F1"}`,
                          boxShadow: sel ? `0 3px 8px ${CUR_COLOR[c]}38` : "none",
                          opacity: sel ? 1 : 0.65 }}>
                        <span style={badge(c, 24)}>{CUR_SHORT[c]}</span>
                        {CUR_LABEL[c]}
                      </button>
                    );
                  })}
                  {label === "DE" ? (
                    <button onClick={swap} title="Inverser"
                      style={{ width: 34, height: 34, borderRadius: "50%", border: "none", background: NAVY,
                        color: "#fff", cursor: "pointer", fontSize: 16 }}>⇅</button>
                  ) : <span style={{ width: 34 }} />}
                </div>
              ))}
            </div>
          )}

          {/* ── 5) ÉCRAN ── */}
          <div style={{ background: `linear-gradient(135deg, ${NAVY}, #262B4D)`, color: "#fff",
            borderRadius: 26, padding: "14px 18px", minHeight: 118, textAlign: "right",
            border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 6px 14px rgba(26,29,46,0.25)" }}>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 15, minHeight: 22, wordBreak: "break-all" }}>
              {expr ? pretty(expr) : " "}
            </div>
            <div style={{ fontSize: main.length > 12 ? 30 : 42, fontWeight: 700, marginTop: 6,
              color: div0 ? "#ff5252" : "#fff", overflowWrap: "anywhere" }}>{main}</div>
            {convert && !div0 && (
              <div style={{ color: CUR_LIGHT[to], fontSize: main.length > 14 ? 20 : 25, fontWeight: 700, marginTop: 4 }}>
                {convLine}
              </div>
            )}
          </div>

          {/* ── 6) ÉQUIVALENCES ── */}
          {convert && (
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {CUR_ORDER.map(c => {
                const v = convertTo(res ?? 0, from, c);
                const isFrom = c === from;
                return (
                  <div key={c} style={{ flex: 1, textAlign: "center", padding: "8px 4px", borderRadius: 14,
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

          {/* ── 7) CLAVIER ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 12 }}>
            {rows.flat().map(k => (
              <button key={k} onClick={() => press(k)} style={keyStyle(k)}
                onContextMenu={e => { if (k === "⌫") { e.preventDefault(); press("C"); } }}>
                {k}
              </button>
            ))}
          </div>
          <p style={{ margin: "12px 0 0", textAlign: "center", color: "#aaa", fontSize: 11 }}>
            Clavier accepté : 0-9 + - * / % Entrée Retour Échap
          </p>
        </div>
      </div>

      {showTauxModal && (
        <TauxModal taux={taux} onClose={() => setShowTauxModal(false)} onSave={saveTaux} />
      )}

      {snack && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: snack.color, color: "#fff", padding: "10px 20px", borderRadius: 12,
          fontWeight: 600, zIndex: 999, fontSize: 13, maxWidth: "90vw", textAlign: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>{snack.msg}</div>
      )}
    </main>
  );
}

// ─── 6. MODAL TAUX (admin) ───────────────────────────────────────────────────
function TauxModal({ taux, onClose, onSave }: {
  taux: number; onClose: () => void; onSave: (v: number) => Promise<void>;
}) {
  const [val, setVal] = useState(plain(taux, 4));
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const n = parseFloat(val.replace(",", "."));

  const submit = async () => {
    if (saving) return;
    if (isNaN(n) || n <= 0 || n > 100000) { setErr("Taux invalide"); return; }
    setSaving(true);
    await onSave(n);
    setSaving(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={saving ? undefined : onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#1A1D2E", borderRadius: 22, padding: 24, width: "100%", maxWidth: 400, color: "#fff" }}>
        <h2 style={{ margin: "0 0 14px", fontSize: 18 }}>💱 Taux du jour</h2>
        <input type="text" inputMode="decimal" autoFocus value={val} disabled={saving}
          onChange={e => { setVal(e.target.value); setErr(null); }}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          placeholder="1 $ = ? HTG"
          style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.06)",
            border: "1px solid #333", borderRadius: 12, color: "#fff", fontSize: 16,
            outline: "none", boxSizing: "border-box" }} />
        {err && <p style={{ color: "#ff4444", fontSize: 12, margin: "6px 0 0" }}>{err}</p>}
        {!isNaN(n) && n > 0 && (
          <div style={{ background: "rgba(170,0,255,0.12)", borderRadius: 12, padding: 10,
            marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
            1 $ = {fmt(n, 4)} HTG<br />
            1 $ = {fmt(n / DH_RATE, 4)} $HT<br />
            1 $HT = {fmt(DH_RATE)} HTG (fixe)
          </div>
        )}
        <p style={{ color: "#888", fontSize: 11, margin: "10px 0 0" }}>
          Ce taux est utilisé dans toute l&apos;application (facturation, produits) et sur le site.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} disabled={saving}
            style={{ flex: 1, padding: 12, background: "rgba(255,255,255,0.06)", border: "1px solid #333",
              color: "#aaa", borderRadius: 12, cursor: "pointer", fontSize: 14 }}>Annuler</button>
          <button onClick={submit} disabled={saving}
            style={{ flex: 1, padding: 12, background: saving ? "#555" : "#00C853", border: "none",
              color: "#fff", borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
            {saving ? "..." : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}