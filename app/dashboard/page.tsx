"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { where } from "firebase/firestore";
import {
  Wallet, Users, Package, TrendingUp, ChevronRight, Wifi, WifiOff,
} from "lucide-react";
import BestSellerBanner from "../../lib/BestSellerBanner";
import { C, MenuItem, UserSession, readCol, useDash } from "./dashboard-shared";

// ══════════════════════════════════════════════════════════════════════════
// DONNÉES (Firestore réel)
// ══════════════════════════════════════════════════════════════════════════
const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
const DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const FACTURE_CATS = ["facture", "commande", "vendeur", "fournisseur"] as const;

type Pair = [string, number];

interface Snap {
  todayUSD: number; yesterdayUSD: number; weekUSD: number; prevWeekUSD: number;
  monthUSD: number; prevMonthUSD: number;
  last7: number[]; last7Labels: string[];
  monthLabels: string[]; monthRevenue: number[]; monthProfit: number[];
  topProducts: Pair[]; payModes: Pair[];
  productCount: number; lowStock: number; outStock: number; clientCount: number;
  scopedToOwn: boolean;
  hasFact: boolean; hasProd: boolean; hasCli: boolean;
  // phase 2
  full: boolean;
  activity: Record<number, Record<string, number>>;
  cmdByStatut: Record<string, number>; cmdTotal: number; hasCmd: boolean;
  vendTop: Pair[]; vendSolde: number; vendCount: number; hasVend: boolean;
  fourTop: Pair[]; fourBalance: number; fourCount: number; hasFour: boolean;
  livTop: Pair[]; liv30: number; livSolde: number; livCount: number; hasLiv: boolean;
  wAct: number; wIna: number; wSolde: number; wMasse: number; hasWork: boolean;
  rapMonths: number[]; rapTotal: number; rapToday: number; hasRap: boolean;
  months5: string[];
}

const toDate = (v: any): Date | null => {
  if (v == null || v === "") return null;
  if (typeof v?.toDate === "function") return v.toDate();
  if (typeof v === "number") return new Date(v);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return isNaN(n) ? 0 : n;
};
const dayKey = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function emptySnap(): Snap {
  const now = new Date();
  return {
    todayUSD: 0, yesterdayUSD: 0, weekUSD: 0, prevWeekUSD: 0, monthUSD: 0, prevMonthUSD: 0,
    last7: [0, 0, 0, 0, 0, 0, 0], last7Labels: [], monthLabels: [], monthRevenue: [], monthProfit: [],
    topProducts: [], payModes: [], productCount: 0, lowStock: 0, outStock: 0, clientCount: 0,
    scopedToOwn: false, hasFact: false, hasProd: false, hasCli: false, full: false,
    activity: {}, cmdByStatut: {}, cmdTotal: 0, hasCmd: false,
    vendTop: [], vendSolde: 0, vendCount: 0, hasVend: false,
    fourTop: [], fourBalance: 0, fourCount: 0, hasFour: false,
    livTop: [], liv30: 0, livSolde: 0, livCount: 0, hasLiv: false,
    wAct: 0, wIna: 0, wSolde: 0, wMasse: 0, hasWork: false,
    rapMonths: [0, 0, 0, 0, 0], rapTotal: 0, rapToday: 0, hasRap: false,
    months5: Array.from({ length: 5 }, (_, i) => MONTHS[new Date(now.getFullYear(), now.getMonth() - (4 - i), 1).getMonth()]),
  };
}

/** Phase 1 (rapide): factures, produits, clients.  Phase 2 (full): tout le reste en parallèle. */
async function loadSnapshot(localId: string, user: UserSession, full: boolean): Promise<Snap> {
  const admin = user.isAdmin;
  const p = user.permissions || {};
  const can = (k: string) => admin || p[k] === true;

  const allowFact = can("factureVoir") || can("factureVoirIstwa");
  const allowProd = can("produitVoir");
  const allowCli = can("clientVoir");
  const allowRap = can("rapportVoir");
  const needF = allowFact || allowRap;

  const now = new Date();
  const today = startOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth() - 7, 1);
  const base = ["locals", localId];

  const [factures, products, clients] = await Promise.all([
    needF ? readCol([...base, "factures"], 12000, [where("date", ">=", monthStart.toISOString())]) : Promise.resolve([]),
    allowProd ? readCol([...base, "products"]) : Promise.resolve([]),
    allowCli ? readCol([...base, "clients"]) : Promise.resolve([]),
  ]);

  const viewAll = admin || can("factureVoirIstwa") || allowRap;
  const me = (user.username || "").trim().toLowerCase();
  const valid = factures.filter((f: any) => f.annule !== true)
    .filter((f: any) => viewAll || String(f.cashier ?? "").trim().toLowerCase() === me);

  const s = emptySnap();
  s.hasFact = allowFact || allowRap; s.hasProd = allowProd; s.hasCli = allowCli;
  s.scopedToOwn = !viewAll;

  // 7 jours
  const last7 = [0, 0, 0, 0, 0, 0, 0];
  const labels: string[] = [];
  for (let i = 6; i >= 0; i--) labels.push(DAYS[new Date(today.getTime() - i * 86400000).getDay()]);
  s.last7Labels = labels;
  // 8 mois
  const monthLabels: string[] = [];
  const monthIdx: number[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthLabels.push(MONTHS[d.getMonth()]);
    monthIdx.push(d.getFullYear() * 12 + d.getMonth());
  }
  const mRev = new Array(8).fill(0), mProf = new Array(8).fill(0);
  let prevWeek = 0, countMonth = 0;
  const pay: Record<string, number> = {};
  const top: Record<string, number> = {};
  const curIdx = now.getFullYear() * 12 + now.getMonth();

  for (const f of valid) {
    const d = toDate(f.date);
    if (!d) continue;
    const tot = num(f.totalUSD);
    const ben = num(f.benefisUSD);
    const mi = monthIdx.indexOf(d.getFullYear() * 12 + d.getMonth());
    if (mi >= 0) { mRev[mi] += tot; mProf[mi] += ben; }
    const diff = Math.round((today.getTime() - startOfDay(d).getTime()) / 86400000);
    if (diff >= 0 && diff < 7) last7[6 - diff] += tot;
    else if (diff >= 7 && diff < 14) prevWeek += tot;
    if (d.getFullYear() * 12 + d.getMonth() === curIdx) {
      countMonth++;
      const m = String(f.modePeman || "Autre");
      pay[m] = (pay[m] || 0) + tot;
    }
    if (diff >= 0 && diff < 30 && Array.isArray(f.lignes)) {
      for (const l of f.lignes) {
        const nom = `${l?.marque ?? ""} ${l?.modele ?? ""}`.trim() || "Produit";
        top[nom] = (top[nom] || 0) + (num(l?.qty) || 1);
      }
    }
  }
  s.last7 = last7;
  s.todayUSD = last7[6]; s.yesterdayUSD = last7[5];
  s.weekUSD = last7.reduce((a, b) => a + b, 0); s.prevWeekUSD = prevWeek;
  s.monthLabels = monthLabels; s.monthRevenue = mRev; s.monthProfit = mProf;
  s.monthUSD = mRev[7]; s.prevMonthUSD = mRev[6];
  s.topProducts = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 4);
  s.payModes = Object.entries(pay).sort((a, b) => b[1] - a[1]);
  void countMonth;

  s.productCount = products.length;
  s.lowStock = products.filter((x: any) => num(x.stock) >= 1 && num(x.stock) <= 2).length;
  s.outStock = products.filter((x: any) => num(x.stock) <= 0).length;
  s.clientCount = clients.length;

  if (!full) return s;

  // ───────── Phase 2 ─────────
  const allowCmd = admin; // même règle que le menu (adminOnly)
  const allowVend = can("vendeurVoir");
  const allowFour = can("fournisseurVoir");
  const allowLiv = can("livreurVoir");
  const allowWork = can("workersVoir");
  const allowRapp = can("rapportageVoir");
  const needCal = can("calendrierVoir");

  const [commandes, vendeurs, comptes, livreurs, workers, rapports] = await Promise.all([
    allowCmd ? readCol(["achats"]) : Promise.resolve([]),
    allowVend || needCal ? readCol([...base, "vendeurs"]) : Promise.resolve([]),
    allowFour || needCal ? readCol([...base, "fournisseurs_comptes"]) : Promise.resolve([]),
    allowLiv ? readCol([...base, "livreurs"]) : Promise.resolve([]),
    allowWork
      ? readCol(["workers"], 9000, admin ? [] : [where("linkedUsername", "==", me)])
      : Promise.resolve([]),
    allowRapp
      ? readCol(["rapportage_rapports"], 9000, admin ? [] : [where("authorUid", "==", user.uid)])
      : Promise.resolve([]),
  ]);

  s.full = true;
  s.hasCmd = allowCmd; s.hasVend = allowVend; s.hasFour = allowFour;
  s.hasLiv = allowLiv; s.hasWork = allowWork; s.hasRap = allowRapp;

  // Calendrier
  const act: Record<number, Record<string, number>> = {};
  const bump = (d: Date | null, cat: string) => {
    if (!d || d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return;
    const k = d.getDate();
    act[k] = act[k] || {};
    act[k][cat] = (act[k][cat] || 0) + 1;
  };
  if (needCal) {
    for (const f of factures) if (f.annule !== true && (viewAll || String(f.cashier ?? "").trim().toLowerCase() === me)) bump(toDate(f.date), "facture");
    for (const c of commandes) bump(toDate(c.createdAt), "commande");
    for (const v of vendeurs) for (const h of v.historique || []) bump(toDate(h?.date), "vendeur");
    for (const c of comptes) for (const h of c.historique || []) bump(toDate(h?.date), "fournisseur");
  }
  s.activity = act;

  // Commandes (30 jours)
  const cs: Record<string, number> = {};
  let ct = 0;
  for (const c of commandes) {
    const d = toDate(c.createdAt);
    if (!d || (now.getTime() - d.getTime()) / 86400000 >= 30) continue;
    const st = String(c.statut || "").trim() || "En attente";
    cs[st] = (cs[st] || 0) + 1;
    if (st !== "Annulé") ct += num(c.total);
  }
  s.cmdByStatut = cs; s.cmdTotal = ct;

  // Vendeurs
  const vl: Pair[] = [];
  let vSolde = 0;
  for (const v of vendeurs) {
    vSolde += num(v.balance);
    let tot = 0;
    for (const t of v.ventes || []) {
      if (!t || t.annule === true) continue;
      const d = toDate(t.date);
      if (!d || d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) continue;
      tot += num(t.prixVente);
    }
    vl.push([String(v.nom || "Vendeur"), tot]);
  }
  s.vendTop = vl.sort((a, b) => b[1] - a[1]).slice(0, 4); s.vendSolde = vSolde; s.vendCount = vendeurs.length;

  // Fournisseurs
  const seeAllFour = admin || p.fournisseurDepot === true || p.fournisseurRetrait === true;
  const vis = comptes.filter((c: any) => seeAllFour || String(c.id).toLowerCase() === me);
  s.fourTop = vis.map((c: any) => [String(c.nom || c.id), num(c.balance)] as Pair).sort((a: Pair, b: Pair) => b[1] - a[1]).slice(0, 4);
  s.fourBalance = vis.reduce((a: number, c: any) => a + num(c.balance), 0);
  s.fourCount = vis.length;

  // Livraison
  const ll: Pair[] = [];
  let l30 = 0, lSolde = 0;
  for (const l of livreurs) {
    lSolde += num(l.balance);
    let n = 0;
    for (const h of l.historique || []) {
      if (!h || h.type !== "livraison" || h.annule === true) continue;
      const d = toDate(h.date);
      if (!d || (now.getTime() - d.getTime()) / 86400000 >= 30) continue;
      n++;
    }
    l30 += n;
    ll.push([String(l.nom || "Livreur"), n]);
  }
  s.livTop = ll.sort((a, b) => b[1] - a[1]).slice(0, 4); s.liv30 = l30; s.livSolde = lSolde; s.livCount = livreurs.length;

  // Employés
  for (const w of workers) {
    s.wSolde += num(w.balance);
    if (w.isActive === false) s.wIna++; else { s.wAct++; s.wMasse += num(w.salary); }
  }

  // Rapports
  const m5 = new Array(5).fill(0);
  let rToday = 0;
  const idx5: number[] = [];
  for (let i = 4; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); idx5.push(d.getFullYear() * 12 + d.getMonth()); }
  for (const r of rapports) {
    const d = toDate(r.createdAt);
    if (!d) continue;
    const i = idx5.indexOf(d.getFullYear() * 12 + d.getMonth());
    if (i >= 0) m5[i]++;
    if (dayKey(d) === dayKey(now)) rToday++;
  }
  s.rapMonths = m5; s.rapTotal = rapports.length; s.rapToday = rToday;
  return s;
}

// ══════════════════════════════════════════════════════════════════════════
// FORMAT
// ══════════════════════════════════════════════════════════════════════════
const usdShort = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(0)}`);
const usdFull = (v: number) => "$" + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (cur: number, prev: number): number | null => (prev <= 0 ? null : ((cur - prev) / prev) * 100);
const deltaLabel = (cur: number, prev: number, suffix = ""): string => {
  const p = pct(cur, prev);
  if (p === null) return cur > 0 ? "nouveau" : "—";
  return `${p >= 0 ? "↑" : "↓"} ${Math.abs(p).toFixed(0)}%${suffix}`;
};

// ══════════════════════════════════════════════════════════════════════════
// COMPOSANTS GRAPHIQUES (sans librairie)
// ══════════════════════════════════════════════════════════════════════════
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: "#fff", borderRadius: 20, padding: 18, boxShadow: "0 4px 12px rgba(0,0,0,0.06)", ...style }}>{children}</div>;
}

function StatCard({ label, value, delta, up, color, icon }: { label: string; value: string; delta: string; up: boolean; color: string; icon: React.ReactNode }) {
  return (
    <Card style={{ borderTop: `4px solid ${color}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: C.grey, fontWeight: 600 }}>{label}</span>
        <span style={{ color, background: color + "1A", borderRadius: 10, padding: 6, display: "flex" }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color: C.text, margin: "8px 0 2px" }}>{value}</div>
      {delta && <div style={{ fontSize: 12, fontWeight: 700, color: up ? C.green : C.red }}>{delta}</div>}
    </Card>
  );
}

function BarChart({ labels, values, color, height = 130 }: { labels: string[]; values: number[]; color: string; height?: number }) {
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: height + 34 }}>
      {values.map((v, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", minWidth: 0 }}>
          <span style={{ fontSize: 10, color: C.grey, marginBottom: 2 }}>{v >= 1000 ? usdShort(v).replace("$", "") : Math.round(v)}</span>
          <div style={{ width: "100%", maxWidth: 34, height: Math.max((v / max) * height, 3), background: `linear-gradient(${color}, ${color}99)`, borderRadius: "6px 6px 2px 2px" }} />
          <span style={{ fontSize: 10, color: C.grey, marginTop: 4 }}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

function LineChart({ labels, values, color, height = 120 }: { labels: string[]; values: number[]; color: string; height?: number }) {
  const w = 300, h = height, pad = 8;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const rng = max - min || 1;
  const pts = values.map((v, i) => [pad + (i * (w - pad * 2)) / Math.max(values.length - 1, 1), h - pad - ((v - min) / rng) * (h - pad * 2)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1]?.[0] ?? 0},${h} L${pts[0]?.[0] ?? 0},${h} Z`;
  const gid = "g" + color.replace("#", "");
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height }} preserveAspectRatio="none">
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".3" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3} fill="#fff" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {labels.map((l, i) => <span key={i} style={{ fontSize: 10, color: C.grey }}>{l}</span>)}
      </div>
    </div>
  );
}

function Donut({ segments, centerValue, centerLabel }: { segments: { label: string; value: number; color: string }[]; centerValue: string; centerLabel: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = 42, circ = 2 * Math.PI * r;
  let off = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: 120, height: 120 }}>
        <svg viewBox="0 0 100 100" width="120" height="120" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="#f0f0f0" strokeWidth="14" />
          {segments.map((s, i) => {
            const len = (s.value / total) * circ;
            const el = <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="14" strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-off} />;
            off += len;
            return el;
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 20, fontWeight: 900, color: C.text }}>{centerValue}</span>
          <span style={{ fontSize: 10, color: C.grey }}>{centerLabel}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 120 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
            <span style={{ flex: 1, color: C.text }}>{s.label}</span>
            <b style={{ color: C.text }}>{s.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function HBars({ items, color }: { items: { label: string; ratio: number; value: string }[]; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((it, i) => (
        <div key={i}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: C.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "65%" }}>{it.label}</span>
            <span style={{ color: C.grey }}>{it.value}</span>
          </div>
          <div style={{ height: 8, background: "#f0f0f0", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(Math.min(it.ratio, 1), 0.02) * 100}%`, height: "100%", background: color, borderRadius: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StackBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div>
      <div style={{ display: "flex", height: 14, borderRadius: 8, overflow: "hidden", background: "#f0f0f0" }}>
        {segments.map((s, i) => <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />)}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
        {segments.map((s, i) => (
          <span key={i} style={{ fontSize: 12, color: C.text, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color }} />{s.label} <b>{s.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

const CAL_COLORS: Record<string, string> = { facture: C.green, commande: "#FF5722", vendeur: "#3F51B5", fournisseur: "#795548" };
const CAL_LABELS: Record<string, string> = { facture: "Factures", commande: "Commandes", vendeur: "Vendeurs", fournisseur: "Fournisseurs" };

function ActivityCalendar({ activity, color, href }: { activity: Record<number, Record<string, number>>; color: string; href: string }) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const nDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7; // lundi d'abord
  const totals = Object.keys(activity).map((k) => Object.values(activity[+k]).reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 1);
  const totalEvents = totals.reduce((a, b) => a + b, 0);
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: nDays }, (_, i) => i + 1)];
  return (
    <div>
      <div style={{ fontSize: 12, color: C.grey, marginBottom: 8 }}>
        {MONTHS[now.getMonth()]} {now.getFullYear()} · <b>{totalEvents}</b> activités · {totals.length} jours
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <div key={i} style={{ textAlign: "center", fontSize: 10, color: C.grey, fontWeight: 700 }}>{d}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const a = activity[d];
          const tot = a ? Object.values(a).reduce((x, y) => x + y, 0) : 0;
          const isToday = d === now.getDate();
          return (
            <Link key={i} href={href} title={a ? Object.entries(a).map(([k, v]) => `${CAL_LABELS[k]}: ${v}`).join(" · ") : ""}
              style={{ textDecoration: "none", aspectRatio: "1", borderRadius: 8, padding: 3, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                background: tot ? color + Math.round(18 + (tot / max) * 70).toString(16).padStart(2, "0") : "#f6f6f6",
                border: isToday ? `2px solid ${color}` : "2px solid transparent" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{d}</span>
              {tot > 0 && <span style={{ fontSize: 9, color: C.text }}>{tot}</span>}
              {a && <div style={{ display: "flex", gap: 2, marginTop: 1 }}>{Object.keys(a).slice(0, 4).map((k) => <span key={k} style={{ width: 4, height: 4, borderRadius: 4, background: CAL_COLORS[k] }} />)}</div>}
            </Link>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        {FACTURE_CATS.map((k) => (
          <span key={k} style={{ fontSize: 11, color: C.grey, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 8, background: CAL_COLORS[k] }} />{CAL_LABELS[k]}
          </span>
        ))}
      </div>
    </div>
  );
}

function ModuleCard({ item, title, big, delta, up = true, children }: { item: MenuItem; title?: string; big?: string; delta?: string; up?: boolean; children: React.ReactNode }) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ color: item.color, background: item.color + "1A", borderRadius: 12, padding: 8, display: "flex" }}>{item.icon(20)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{item.label}</div>
          {title && <div style={{ fontSize: 11, color: C.grey }}>{title}</div>}
        </div>
        <Link href={item.href} style={{ fontSize: 12, fontWeight: 700, color: item.color, textDecoration: "none", display: "flex", alignItems: "center" }}>
          Ouvrir <ChevronRight size={14} />
        </Link>
      </div>
      {big && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 26, fontWeight: 900, color: C.text }}>{big}</span>
          {delta && <span style={{ fontSize: 12, fontWeight: 700, color: up ? C.green : C.red }}>{delta}</span>}
        </div>
      )}
      {children}
    </Card>
  );
}

const Empty = ({ msg }: { msg: string }) => <div style={{ padding: "18px 0", textAlign: "center", color: C.grey, fontSize: 13 }}>{msg}</div>;

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD PAGE (kontni sèlman — header/meni/ba anba yo nan layout.tsx)
// ══════════════════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const { user, visibleItems, locals, localId, setLocalId, online } = useDash();

  const [snap, setSnap] = useState<Snap | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // ── Chargement des stats : phase 1 (rapide), puis phase 2 ──
  const refresh = useCallback(async () => {
    if (!user || !localId) return;
    setStatsLoading(true);
    try {
      const quick = await loadSnapshot(localId, user, false);
      setSnap((prev) => prev ?? quick);
    } catch { /* ignore */ }
    try {
      const full = await loadSnapshot(localId, user, true);
      setSnap(full);
    } catch { /* ignore */ }
    setStatsLoading(false);
  }, [user, localId]);

  useEffect(() => { setSnap(null); refresh(); }, [refresh]);

  if (!user) return null;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bonjour" : "Bonsoir";
  const item = (k: string) => visibleItems.find((i) => i.key === k);

  const s = snap;
  const p = user.permissions || {};
  const admin = !!user.isAdmin;
  const showRev = admin || p.rapportVoir === true;

  // ── Cartes de statistiques (selon permissions) ──
  const stats: React.ReactNode[] = [];
  if (s?.hasFact || (!s && (admin || p.factureVoir || p.factureVoirIstwa || p.rapportVoir)))
    stats.push(<StatCard key="v" label={s?.scopedToOwn ? "Mes ventes du jour" : "Ventes du jour"} value={s ? usdFull(s.todayUSD) : "—"} delta={s ? deltaLabel(s.todayUSD, s.yesterdayUSD, " vs hier") : ""} up={!s || s.todayUSD >= s.yesterdayUSD} color={C.green} icon={<Wallet size={18} />} />);
  if (admin || p.clientVoir === true)
    stats.push(<StatCard key="c" label="Clients" value={s ? String(s.clientCount) : "—"} delta="" up color={C.blue} icon={<Users size={18} />} />);
  if (admin || p.produitVoir === true)
    stats.push(<StatCard key="p" label="Stock bas" value={s ? String(s.lowStock) : "—"} delta={s ? `${s.outStock} épuisés` : ""} up={!s || (s.lowStock === 0 && s.outStock === 0)} color={C.orange} icon={<Package size={18} />} />);
  if (showRev)
    stats.push(<StatCard key="r" label="Revenu du mois" value={s ? usdShort(s.monthUSD) : "—"} delta={s ? deltaLabel(s.monthUSD, s.prevMonthUSD) : ""} up={!s || s.monthUSD >= s.prevMonthUSD} color={C.purple} icon={<TrendingUp size={18} />} />);

  // ── Cartes graphiques par page ──
  const modules: React.ReactNode[] = [];
  const it = {
    rapports: item("rapports"), vendeurs: item("vendeurs"), fournisseurs: item("fournisseurs"),
    commandes: item("commandes"), calendrier: item("calendrier"), livraison: item("livraison"),
    workers: item("workers"), rapportage: item("rapportage"),
  };
  const ds = s?.full ? s : null;

  if (it.rapports && s && s.hasFact) {
    modules.push(
      <ModuleCard key="rapports" item={it.rapports} title={s.scopedToOwn ? "Mes ventes (7 jours)" : "Ventes (7 jours)"} big={usdFull(s.weekUSD)} delta={`${deltaLabel(s.weekUSD, s.prevWeekUSD)} vs semaine dernière`} up={s.weekUSD >= s.prevWeekUSD}>
        <BarChart labels={s.last7Labels} values={s.last7} color={it.rapports.color} />
        {s.payModes.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>Modes de paiement (mois)</div>
            <Donut centerValue={String(s.payModes.length)} centerLabel="modes"
              segments={s.payModes.slice(0, 5).map(([label, value], i) => ({ label: `${label} · ${usdShort(value)}`, value: Math.round(value), color: [C.green, C.blue, C.orange, C.purple, C.teal][i % 5] }))} />
          </div>
        )}
        {s.topProducts.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>Produits les plus vendus (30 j)</div>
            <HBars color={it.rapports.color} items={s.topProducts.map(([label, v]) => ({ label, ratio: v / (s.topProducts[0][1] || 1), value: `${v} vendus` }))} />
          </div>
        )}
      </ModuleCard>,
    );
  }

  if (it.calendrier && ds)
    modules.push(
      <ModuleCard key="calendrier" item={it.calendrier} title="Activité du mois">
        <ActivityCalendar activity={ds.activity} color={it.calendrier.color} href={it.calendrier.href} />
      </ModuleCard>,
    );

  if (it.commandes && ds?.hasCmd) {
    const colors: Record<string, string> = { "En attente": C.orange, "Confirmé": C.blue, "En livraison": C.purple, "Livré": C.green, "Annulé": C.red };
    const entries = Object.entries(ds.cmdByStatut);
    const total = entries.reduce((a, [, v]) => a + v, 0);
    modules.push(
      <ModuleCard key="commandes" item={it.commandes} title="Commandes (30 jours)" big={String(total)} delta={usdFull(ds.cmdTotal)}>
        {total === 0 ? <Empty msg="Aucune commande sur les 30 derniers jours" /> :
          <Donut centerValue={String(total)} centerLabel="commandes" segments={entries.map(([label, value]) => ({ label, value, color: colors[label] || C.grey }))} />}
      </ModuleCard>,
    );
  }

  if (it.vendeurs && ds?.hasVend) {
    const max = ds.vendTop[0]?.[1] || 1;
    modules.push(
      <ModuleCard key="vendeurs" item={it.vendeurs} title="Ventes par vendeur (mois)" big={String(ds.vendCount)} delta={`solde total ${usdFull(ds.vendSolde)}`}>
        {ds.vendTop.length === 0 ? <Empty msg="Aucun vendeur" /> :
          <HBars color={it.vendeurs.color} items={ds.vendTop.map(([label, v]) => ({ label, ratio: v / max, value: usdFull(v) }))} />}
      </ModuleCard>,
    );
  }

  if (it.fournisseurs && ds?.hasFour) {
    const max = Math.max(...ds.fourTop.map((x) => Math.abs(x[1])), 1);
    modules.push(
      <ModuleCard key="fournisseurs" item={it.fournisseurs} title="Plus gros comptes" big={usdFull(ds.fourBalance)} delta={`${ds.fourCount} compte(s)`}>
        {ds.fourTop.length === 0 ? <Empty msg="Aucun compte" /> :
          <HBars color={it.fournisseurs.color} items={ds.fourTop.map(([label, v]) => ({ label, ratio: Math.abs(v) / max, value: usdFull(v) }))} />}
      </ModuleCard>,
    );
  }

  if (it.livraison && ds?.hasLiv) {
    const max = ds.livTop[0]?.[1] || 1;
    modules.push(
      <ModuleCard key="livraison" item={it.livraison} title="Livraisons (30 jours)" big={String(ds.liv30)} delta={`${ds.livCount} livreurs · solde ${usdFull(ds.livSolde)}`}>
        {ds.liv30 === 0 ? <Empty msg="Aucune livraison sur les 30 derniers jours" /> :
          <HBars color={it.livraison.color} items={ds.livTop.map(([label, v]) => ({ label, ratio: v / max, value: String(v) }))} />}
      </ModuleCard>,
    );
  }

  if (it.workers && ds?.hasWork) {
    const tot = ds.wAct + ds.wIna;
    modules.push(
      <ModuleCard key="workers" item={it.workers} title="Employés" big={String(tot)} delta={`${ds.wAct} actifs · masse ${usdFull(ds.wMasse)}/mois`}>
        {tot === 0 ? <Empty msg="Aucun employé" /> :
          <StackBar segments={[{ label: "Actifs", value: ds.wAct, color: C.green }, { label: "Inactifs", value: ds.wIna, color: C.red }]} />}
      </ModuleCard>,
    );
  }

  if (it.rapportage && ds?.hasRap)
    modules.push(
      <ModuleCard key="rapportage" item={it.rapportage} title="Rapports par mois" big={String(ds.rapTotal)} delta={`${ds.rapToday} aujourd'hui`}>
        <LineChart labels={ds.months5} values={ds.rapMonths} color={it.rapportage.color} />
      </ModuleCard>,
    );

  const noChart = visibleItems.filter((i) => !["rapports", "calendrier", "commandes", "vendeurs", "fournisseurs", "livraison", "workers", "rapportage"].includes(i.key));

  const localName = locals.find((l) => l.id === localId)?.name || "";

  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 24, color: C.text, fontWeight: 900 }}>👋 {greeting}, {user.displayName?.split(" ")[0]}!</h1>
        <p style={{ margin: 0, color: C.grey, fontSize: 14 }}>
          {admin ? "Vous avez un accès complet à tout le système." : `Vous avez accès à ${visibleItems.length} section(s).`}
        </p>
      </div>

      {/* Statut + local */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ color: online ? C.green : C.orange, display: "flex" }}>{online ? <Wifi size={16} /> : <WifiOff size={16} />}</span>
        <span style={{ fontSize: 13, color: C.grey, flex: 1 }}>{online ? "En ligne — données à jour" : "Hors ligne"}</span>
        {locals.length > 1 ? (
          <select value={localId} onChange={(e) => setLocalId(e.target.value)}
            style={{ padding: "6px 12px", borderRadius: 20, border: "none", background: C.primary + "1A", color: C.primary, fontWeight: 700, fontSize: 12, fontFamily: "inherit" }}>
            {locals.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        ) : localName ? (
          <span style={{ padding: "5px 12px", borderRadius: 20, background: C.primary + "1A", color: C.primary, fontWeight: 700, fontSize: 12 }}>{localName}</span>
        ) : null}
      </div>
      <div style={{ height: 3, marginBottom: 14, overflow: "hidden", borderRadius: 3, background: statsLoading ? "#ffe0b2" : "transparent" }}>
        {statsLoading && <div className="ms-bar" />}
      </div>

      <BestSellerBanner localId={user.localId === "all" ? localId || "all" : user.localId} compact />

      {/* Cartes stats */}
      {stats.length > 0 && <div className="ms-grid-stats">{stats}</div>}

      {/* Revenus + Profit (8 mois) */}
      {showRev && s && s.hasFact && (
        <div className="ms-grid-2" style={{ marginTop: 16 }}>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 2 }}>Revenus</div>
            <div style={{ fontSize: 11, color: C.grey, marginBottom: 10 }}>8 derniers mois (USD)</div>
            <BarChart labels={s.monthLabels} values={s.monthRevenue} color={C.purple} />
          </Card>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 2 }}>Profit</div>
            <div style={{ fontSize: 11, color: C.grey, marginBottom: 10 }}>8 derniers mois (USD)</div>
            <LineChart labels={s.monthLabels} values={s.monthProfit} color={C.green} height={140} />
          </Card>
        </div>
      )}

      {/* Graphiques par page */}
      {modules.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, color: C.text, margin: "26px 0 12px", fontWeight: 800 }}>Analyses par page</h2>
          <div className="ms-grid-2">{modules}</div>
        </>
      )}

      {/* Accès rapides (pages sans graphique) */}
      {visibleItems.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 20, padding: 60, textAlign: "center", border: "1px solid #eee", marginTop: 20 }}>
          <p style={{ fontSize: 48, margin: "0 0 12px" }}>🔒</p>
          <p style={{ color: "#666", fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>Aucun accès disponible</p>
          <p style={{ color: "#aaa", fontSize: 13, margin: 0 }}>Contactez un administrateur pour vos permissions.</p>
        </div>
      ) : noChart.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, color: C.text, margin: "26px 0 12px", fontWeight: 800 }}>Accès rapides</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
            {noChart.map((m) => (
              <Link key={m.key} href={m.href} style={{ textDecoration: "none" }}>
                <div className="ms-tile">
                  <div style={{ color: m.color, display: "flex" }}>{m.icon(40)}</div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>{m.label}</p>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <style>{`
        @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
        .ms-bar { width: 30%; height: 100%; background: ${C.primary}; border-radius: 3px; animation: slide 1.2s ease-in-out infinite; }
        .ms-grid-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
        .ms-grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; align-items: start; }
        .ms-tile { background: #fff; border-radius: 20px; padding: 22px 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.06); display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; transition: transform .15s; }
        .ms-tile:hover { transform: translateY(-4px); }
        @media (max-width: 860px) {
          .ms-grid-2 { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  );
}