"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import { collection, doc, getDocs, onSnapshot, setDoc } from "firebase/firestore";
import BestSellerBanner from "../../../lib/BestSellerBanner";

// =============================================================================
// RAPPORT — Rezime • Facture • Pwodwi • Vendeur • Founisè • Kòmand • Itilizatè
// Chak tab parèt selon pèmisyon itilizatè a (menm lojik ak app Flutter a).
// =============================================================================

// ─── 1. TYPES & CONSTANTES ───────────────────────────────────────────────────
interface UserSession {
  uid?: string; username: string; displayName: string; isAdmin: boolean;
  localId: string; permissions: Record<string, boolean>;
}
type Raw = Record<string, unknown>;
type TabId = "rezime" | "facture" | "produit" | "vendeur" | "fourn" | "cmd" | "user";
interface StockDay { date: string; nb: number; stock: number; updatedAt?: string; }

const BG = "#0F1117", CARD = "#1A1D2E", ORANGE = "#FF9800";
const TAB_LABEL: Record<TabId, string> = {
  rezime: "REZIME", facture: "FACTURE", produit: "PWODWI", vendeur: "VENDEUR",
  fourn: "FOUNISÈ", cmd: "KÒMAND", user: "ITILIZATÈ",
};
const PERIODS = ["Jodi a", "Yè", "Semèn", "Mwa", "Tout", "Dat"] as const;
type Period = typeof PERIODS[number];

const CMD_STATUTS = ["En attente", "Confirmé", "En livraison", "Livré", "Annulé"];
const CMD_COLOR: Record<string, string> = {
  "En attente": "#F57C00", "Confirmé": "#2E7D32", "En livraison": "#1565C0",
  "Livré": "#6A1B9A", "Annulé": "#C0392B",
};
const CMD_ICON: Record<string, string> = {
  "En attente": "⏳", "Confirmé": "✅", "En livraison": "🚚", "Livré": "📦", "Annulé": "❌",
};
const PALETTE = ["#FF9800", "#2196F3", "#4CAF50", "#9C27B0", "#F44336", "#009688"];

// ─── 2. HELPERS ──────────────────────────────────────────────────────────────
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const p2 = (n: number) => String(n).padStart(2, "0");
const usd = (v: number) => `$${v.toFixed(2)}`;
const toDate = (raw: unknown): Date | null => {
  if (!raw) return null;
  // Safari n'aime pas plus de 3 décimales sur les secondes
  const d = new Date(String(raw).replace(/(\.\d{3})\d+/, "$1"));
  return isNaN(d.getTime()) ? null : d;
};
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayKey = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const fmtDate = (raw: unknown) => {
  const d = toDate(raw);
  return d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}  ${p2(d.getHours())}:${p2(d.getMinutes())}` : "";
};
const stockOf = (p: Raw) => Math.trunc(num(p.stock));
const withId = (d: { id: string; data: () => Raw }): Raw => ({ ...d.data(), id: d.id });

/** Disponib (15j+) ak an atant — menm kalkil ak FirestoreService.calcDisponibleEtAtente */
function calcDispo(c: Raw) {
  const now = Date.now();
  let disponible = 0, enAttente = 0;
  for (const e of (c.historique as Raw[] | undefined) ?? []) {
    const type = str(e.type);
    const delta = num(e.delta);
    if (type === "retrait" || type === "depot") { disponible += delta; continue; }
    const ref = type === "annulation" ? (e.venteDate ?? e.date) : e.date;
    const d = toDate(ref);
    if (!d || (now - d.getTime()) / 86400000 >= 15) disponible += delta; else enAttente += delta;
  }
  return { disponible, enAttente };
}

// ─── 3. PETITS COMPOSANTS ────────────────────────────────────────────────────
function Chip({ text, c }: { text: string; c: string }) {
  return <span style={{ background: `${c}26`, color: c, fontSize: 10, fontWeight: 700,
    padding: "3px 7px", borderRadius: 8, whiteSpace: "nowrap" }}>{text}</span>;
}
function BigCard({ label, value, c, icon }: { label: string; value: string; c: string; icon: string }) {
  return (
    <div style={{ flex: "1 1 150px", background: `${c}14`, border: `1px solid ${c}40`, borderRadius: 16, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ color: c, fontWeight: 700, fontSize: 16 }}>{value}</span>
      </div>
      <div style={{ color: "#777", fontSize: 11, marginTop: 6 }}>{label}</div>
    </div>
  );
}
function Title({ t }: { t: string }) {
  return <h3 style={{ margin: "18px 0 10px", fontSize: 14, fontWeight: 700 }}>{t}</h3>;
}
function Empty({ msg }: { msg: string }) {
  return <div style={{ textAlign: "center", color: "#666", padding: "50px 0" }}>
    <div style={{ fontSize: 44, opacity: 0.3 }}>📭</div>{msg}</div>;
}
function Row({ left, right, rc = "#fff" }: { left: React.ReactNode; right: React.ReactNode; rc?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
      background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "8px 12px", marginBottom: 6, fontSize: 13 }}>
      <span>{left}</span><span style={{ color: rc, fontWeight: 700 }}>{right}</span>
    </div>
  );
}
function Bars({ items, color = ORANGE }: { items: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(1, ...items.map(i => i.value));
  return (
    <div style={{ background: CARD, borderRadius: 16, padding: 14, overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 160, minWidth: items.length * 52 }}>
        {items.map((it, i) => (
          <div key={it.label + i} style={{ flex: 1, minWidth: 40, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 4 }}>
            <span style={{ fontSize: 9, color: "#aaa" }}>${it.value.toFixed(0)}</span>
            <div style={{ width: "100%", height: Math.max(4, (it.value / max) * 110), borderRadius: "6px 6px 0 0",
              background: items.length > 1 && color === "multi" ? PALETTE[i % PALETTE.length] : (color === "multi" ? ORANGE : color) }} />
            <span style={{ fontSize: 9, color: "#888", whiteSpace: "nowrap", overflow: "hidden",
              textOverflow: "ellipsis", maxWidth: 52 }}>{it.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 4. PAGE ─────────────────────────────────────────────────────────────────
export default function RapportsPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [locals, setLocals] = useState<{ id: string; name: string }[]>([]);
  const [lid, setLid] = useState("");
  const [loading, setLoading] = useState(true);

  const [factures, setFactures] = useState<Raw[]>([]);
  const [vendeurs, setVendeurs] = useState<Raw[]>([]);
  const [products, setProducts] = useState<Raw[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [comptes, setComptes] = useState<Raw[]>([]);
  const [commandes, setCommandes] = useState<Raw[]>([]);
  const [users, setUsers] = useState<Raw[]>([]);
  const [clients, setClients] = useState<Raw[]>([]);
  const [stockHist, setStockHist] = useState<Record<string, StockDay>>({});

  const [tab, setTab] = useState<TabId>("rezime");
  const [period, setPeriod] = useState<Period>("Jodi a");
  const [picked, setPicked] = useState("");
  const [fVendeur, setFVendeur] = useState("Tout");
  const [fUser, setFUser] = useState("Tout");
  const [searchFact, setSearchFact] = useState("");
  const [searchProd, setSearchProd] = useState("");
  const [cmdStatut, setCmdStatut] = useState("Tout");
  const [openFact, setOpenFact] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [openFourn, setOpenFourn] = useState<string | null>(null);

  // ─── PÈMISYON ──────────────────────────────────────────────────────────
  const perms = user?.permissions ?? {};
  const isAdmin = !!user?.isAdmin;
  const canFacture = isAdmin || perms.factureVoir === true || perms.factureVoirIstwa === true;
  const canProduit = isAdmin || perms.produitVoir === true;
  const canVendeur = isAdmin || perms.vendeurVoir === true;
  const canFourn = isAdmin || perms.fournisseurVoir === true;
  const canCmd = isAdmin || perms.commandeVoir === true;
  const canUser = isAdmin || perms.utilisateurVoir === true;

  const tabs: TabId[] = useMemo(() => [
    "rezime" as TabId,
    ...(canFacture ? ["facture" as TabId] : []),
    ...(canProduit ? ["produit" as TabId] : []),
    ...(canVendeur ? ["vendeur" as TabId] : []),
    ...(canFourn ? ["fourn" as TabId] : []),
    ...(canCmd ? ["cmd" as TabId] : []),
    ...(canUser ? ["user" as TabId] : []),
  ], [canFacture, canProduit, canVendeur, canFourn, canCmd, canUser]);

  // ─── AUTH + LOKAL ──────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const s = JSON.parse(raw) as UserSession;
      if (!s.isAdmin && !s.permissions?.rapportVoir) { router.push("/dashboard"); return; }
      setUser(s);
      if (s.localId && s.localId !== "all") setLid(s.localId);
      if (s.isAdmin) {
        getDocs(collection(db, "locals")).then(snap => {
          const list = snap.docs.filter(d => d.id !== "all")
            .map(d => ({ id: d.id, name: (d.data().name as string) ?? d.id }));
          setLocals(list);
          if (!s.localId || s.localId === "all") {
            if (list.length > 0) setLid(list[0].id); else setLoading(false);
          }
        }).catch(() => setLoading(false));
      }
    } catch { router.push("/login"); }
  }, [router]);

  // ─── DONE AN DIRÈK ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !lid) return;
    setLoading(true);
    const noop = () => {};
    const u1 = onSnapshot(collection(db, "locals", lid, "factures"),
      s => { setFactures(s.docs.map(withId)); setLoading(false); }, () => setLoading(false));
    const u2 = onSnapshot(collection(db, "locals", lid, "vendeurs"),
      s => setVendeurs(s.docs.map(withId)), () => {});
    const u3 = canProduit
      ? onSnapshot(collection(db, "locals", lid, "products"),
          s => { setProducts(s.docs.map(withId).filter(p => p.isDeleted !== true)); setProductsLoaded(true); }, () => {})
      : noop;
    const u4 = canFourn
      ? onSnapshot(collection(db, "locals", lid, "fournisseurs_comptes"),
          s => setComptes(s.docs.map(withId)), () => {})
      : noop;
    const u5 = canCmd
      ? onSnapshot(collection(db, "achats"), s => setCommandes(s.docs.map(withId)), () => {})
      : noop;
    if (canUser) {
      getDocs(collection(db, "users")).then(s =>
        setUsers(s.docs.map(d => ({ ...(d.data() as Raw), uid: d.id })))).catch(() => {});
    }
    if (canFacture) {
      getDocs(collection(db, "locals", lid, "clients")).then(s =>
        setClients(s.docs.map(withId))).catch(() => {});
    }
    return () => { u1(); u2(); u3(); u4(); u5(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, lid]);

  // ─── RAPÒ STOCK CHAK JOU (menm kolekyon ak app Flutter a) ──────────────
  useEffect(() => {
    if (!user || !lid || !canProduit) return;
    const lk = `rapport_stock_${lid}`;
    try {
      const h = JSON.parse(localStorage.getItem(lk) ?? "{}");
      if (h && typeof h === "object") setStockHist(h);
    } catch {}
    getDocs(collection(db, "locals", lid, "rapport_stock")).then(snap => {
      setStockHist(prev => {
        const merged = { ...prev };
        snap.forEach(d => { merged[d.id] = d.data() as StockDay; });
        try { localStorage.setItem(lk, JSON.stringify(merged)); } catch {}
        return merged;
      });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, lid, canProduit]);

  useEffect(() => {
    if (!user || !lid || !canProduit || !productsLoaded) return;
    const avail = products.filter(p => stockOf(p) > 0);
    const nb = avail.length;
    const stock = avail.reduce((s, p) => s + stockOf(p), 0);
    const key = dayKey(new Date());
    setStockHist(prev => {
      const cur = prev[key];
      if (cur && cur.nb === nb && cur.stock === stock) return prev; // pa chanje
      const entry: StockDay = { date: key, nb, stock, updatedAt: new Date().toISOString() };
      const merged = { ...prev, [key]: entry };
      try { localStorage.setItem(`rapport_stock_${lid}`, JSON.stringify(merged)); } catch {}
      setDoc(doc(db, "locals", lid, "rapport_stock", key), entry).catch(() => {});
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, productsLoaded, lid]);

  // ─── PERYÒD ────────────────────────────────────────────────────────────
  const inPeriod = (d: Date | null) => {
    if (period === "Tout") return true;
    if (!d) return false;
    const now = new Date();
    if (period === "Jodi a") return sameDay(d, now);
    if (period === "Yè") return sameDay(d, new Date(now.getTime() - 86400000));
    if (period === "Semèn") return (now.getTime() - d.getTime()) / 86400000 <= 7;
    if (period === "Mwa") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (period === "Dat") return !!picked && sameDay(d, new Date(`${picked}T00:00:00`));
    return true;
  };
  const periodLabel = period === "Dat" && picked
    ? `${picked.split("-").reverse().join("/")}` : period;

  // ─── FACTURES FILTRE ───────────────────────────────────────────────────
  const fil = useMemo(() => factures.filter(f => {
    if (f.annule === true || f.dansPoubel === true) return false;
    if (!inPeriod(toDate(f.date))) return false;
    if (fVendeur !== "Tout" && str(f.vendeur) !== fVendeur) return false;
    if (fUser !== "Tout" && str(f.cashier) !== fUser) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [factures, period, picked, fVendeur, fUser]);

  const totVente = fil.reduce((s, f) => s + num(f.totalUSD), 0);
  const totBenef = fil.reduce((s, f) => s + Math.max(0, num(f.benefisUSD)), 0);

  const vendeurNames = useMemo(() => {
    const set = new Set<string>();
    vendeurs.forEach(v => str(v.nom) && set.add(str(v.nom)));
    factures.forEach(f => str(f.vendeur) && set.add(str(f.vendeur)));
    return ["Tout", ...[...set].sort()];
  }, [vendeurs, factures]);
  const userNames = useMemo(() => {
    const set = new Set<string>();
    users.forEach(u => str(u.username) && set.add(str(u.username)));
    factures.forEach(f => str(f.cashier) && set.add(str(f.cashier)));
    return ["Tout", ...[...set].sort()];
  }, [users, factures]);

  if (!user) return null;

  const currentTab: TabId = tabs.includes(tab) ? tab : "rezime";

  // ═══════════════════ TAB: REZIME ═══════════════════
  const renderRezime = () => {
    const nFact = fil.length;
    const totQty = fil.reduce((s, f) =>
      s + ((f.lignes as Raw[] | undefined) ?? []).reduce((q, l) => q + (num(l.qty) || 1), 0), 0);
    const byDay = new Map<string, number>();
    fil.forEach(f => {
      const d = toDate(f.date); if (!d) return;
      const k = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
      byDay.set(k, (byDay.get(k) ?? 0) + num(f.totalUSD));
    });
    const cmds = canCmd ? commandes.filter(c => inPeriod(toDate(c.createdAt))) : [];
    const cmdRev = cmds.filter(c => (str(c.statut) || "En attente") !== "Annulé")
      .reduce((s, c) => s + num(c.total), 0);

    const cats = new Map<string, number>();
    const catsHtg = new Map<string, number>();
    fil.forEach(f => {
      const taux = num(f.taux) > 0 ? num(f.taux) : 1;
      ((f.lignes as Raw[] | undefined) ?? []).forEach(l => {
        const c = str(l.category) || "Lòt";
        const t = num(l.prix) * (num(l.qty) || 1);
        cats.set(c, (cats.get(c) ?? 0) + t);
        if (str(f.devise) === "HTG") catsHtg.set(c, (catsHtg.get(c) ?? 0) + t * taux);
      });
    });
    const modes = new Map<string, number>();
    fil.forEach(f => { const m = str(f.modePeman) || "Cash"; modes.set(m, (modes.get(m) ?? 0) + num(f.totalUSD)); });
    const vs = new Map<string, number>();
    fil.forEach(f => { const v = str(f.vendeur); if (v) vs.set(v, (vs.get(v) ?? 0) + num(f.totalUSD)); });

    return (
      <>
        <BestSellerBanner localId={lid} compact={false} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <BigCard label="Vente Total" value={usd(totVente)} c="#4CAF50" icon="💵" />
          <BigCard label="Benefis" value={usd(totBenef)} c={ORANGE} icon="📈" />
          <BigCard label="Nòm Facture" value={String(nFact)} c="#2196F3" icon="🧾" />
          <BigCard label="Mwayèn/Facture" value={usd(nFact ? totVente / nFact : 0)} c="#9C27B0" icon="🧮" />
          <BigCard label="Total Atik Vann" value={String(totQty)} c="#009688" icon="📦" />
          <BigCard label="Maj Benefis" value={totVente > 0 ? `${(totBenef / totVente * 100).toFixed(1)}%` : "0%"} c="#E91E63" icon="％" />
          {canCmd && <BigCard label="Kòmand" value={String(cmds.length)} c="#6C63FF" icon="🛍️" />}
          {canCmd && <BigCard label="Kòmand ($)" value={usd(cmdRev)} c="#6C63FF" icon="💰" />}
        </div>

        {byDay.size > 0 && (<><Title t="📈 Vant pa Jou" />
          <Bars items={[...byDay.entries()].map(([label, value]) => ({ label, value }))} /></>)}

        <Title t="📦 Vant pa Kategori" />
        {cats.size === 0 ? <p style={{ color: "#666" }}>Okenn done</p>
          : [...cats.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => (
            <Row key={c} left={c} right={<>{usd(v)}{catsHtg.get(c) ? <span style={{ color: "#9C27B0", marginLeft: 8 }}>HTG {catsHtg.get(c)!.toFixed(0)}</span> : null}</>} rc={ORANGE} />
          ))}

        <Title t="💳 Mode Peman" />
        {modes.size === 0 ? <p style={{ color: "#666" }}>Okenn done</p>
          : [...modes.entries()].map(([m, v]) => <Row key={m} left={m} right={usd(v)} rc="#2196F3" />)}

        <Title t="🏷️ Vant pa Vendeur" />
        {vs.size === 0 ? <p style={{ color: "#666" }}>Okenn done</p>
          : [...vs.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => <Row key={n} left={n} right={usd(v)} rc="#4CAF50" />)}
      </>
    );
  };

  // ═══════════════════ TAB: FACTURE ═══════════════════
  const clientOf = (f: Raw) => clients.find(c => str(c.id) === str(f.clientId)) ?? {};

  const renderFacture = () => {
    const q = searchFact.toLowerCase().trim();
    const list = fil.filter(f => {
      if (!q) return true;
      const cl = clientOf(f);
      const inLines = ((f.lignes as Raw[] | undefined) ?? []).some(l =>
        `${l.marque} ${l.modele} ${l.description} ${l.serialImei} ${l.productId} ${l.category}`.toLowerCase().includes(q));
      return str(f.billNo).toLowerCase().includes(q) || str(f.clientNom).toLowerCase().includes(q)
        || str(cl.telephone).toLowerCase().includes(q) || str(f.vendeur).toLowerCase().includes(q)
        || str(f.cashier).toLowerCase().includes(q) || inLines;
    }).sort((a, b) => str(b.date).localeCompare(str(a.date)));

    return (
      <>
        <input value={searchFact} onChange={e => setSearchFact(e.target.value)}
          placeholder="Chèche #Bill, kliyan, pwodwi, S/N, vendeur..." style={inputStyle} />
        <p style={{ color: ORANGE, fontSize: 12, margin: "8px 2px" }}>
          {list.length} facture • {usd(list.reduce((s, f) => s + num(f.totalUSD), 0))}
        </p>
        {list.length === 0 ? <Empty msg="Pa gen facture" /> : list.map(f => {
          const id = str(f.id);
          const open = openFact === id;
          const tot = num(f.totalUSD), ben = num(f.benefisUSD);
          const sub = num(f.subtotalUSD), tax = num(f.taxUSD);
          const devise = str(f.devise) || "$";
          const isHtg = devise === "HTG";
          const taux = num(f.taux) > 0 ? num(f.taux) : 1;
          const cur = isHtg ? "HTG " : "$";
          const lignes = (f.lignes as Raw[] | undefined) ?? [];
          const cl = clientOf(f);
          const qtyTot = lignes.reduce((s, l) => s + (num(l.qty) || 1), 0);
          return (
            <div key={id} style={{ background: CARD, borderRadius: 16, marginBottom: 10, overflow: "hidden" }}>
              <div onClick={() => setOpenFact(open ? null : id)}
                style={{ padding: "12px 16px", cursor: "pointer", display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Chip text={`#${str(f.billNo)}`} c={ORANGE} />
                    {str(f.clientNom) && str(f.clientNom) !== "Anònim" && (
                      <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        👤 {str(f.clientNom)}</span>)}
                  </div>
                  <div style={{ color: "#777", fontSize: 10, margin: "4px 0" }}>{fmtDate(f.date)}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {str(f.vendeur) && <Chip text={`🟠 ${str(f.vendeur)}`} c={ORANGE} />}
                    {str(f.cashier) && <Chip text={`🔵 ${str(f.cashier)}`} c="#2196F3" />}
                    <Chip text={str(f.modePeman) || "Cash"} c="#9E9E9E" />
                    <Chip text={devise} c={isHtg ? "#9C27B0" : "#4CAF50"} />
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "#4CAF50", fontWeight: 700 }}>{isHtg ? `HTG ${(tot * taux).toFixed(0)}` : usd(tot)}</div>
                  {isHtg && <div style={{ color: "#4CAF50", fontSize: 10 }}>{usd(tot)}</div>}
                  <div style={{ color: ORANGE, fontSize: 10 }}>Ben: {usd(ben)}</div>
                </div>
                <span style={{ color: "#555" }}>{open ? "▲" : "▼"}</span>
              </div>

              {open && (
                <div style={{ padding: "0 16px 14px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 10, margin: "10px 0", fontSize: 11 }}>
                    {[
                      ["Kliyan", str(f.clientNom) || "Anònim"],
                      ...(str(cl.telephone) ? [["Telefòn", str(cl.telephone)]] : []),
                      ...(str(cl.adresse) ? [["Adrès", str(cl.adresse)]] : []),
                      ["Vendeur", str(f.vendeur) || "-"],
                      ["Caissier", str(f.cashier) || "-"],
                      ["Mode peman", str(f.modePeman) || "Cash"],
                      ["Dat ak lè", fmtDate(f.date)],
                      ...(isHtg ? [["Taux", `1 $ = ${taux.toFixed(2)} HTG`]] : []),
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                        <span style={{ color: "#777" }}>{k}</span><span style={{ color: "#ccc", fontWeight: 600 }}>{v}</span>
                      </div>
                    ))}
                  </div>

                  {lignes.map((l, i) => {
                    const prixUsd = num(l.prix), qty = num(l.qty) || 1;
                    const shown = isHtg ? prixUsd * taux : prixUsd;
                    const pa = num(l.prixAchat);
                    const lineBen = (prixUsd - pa) * qty;
                    return (
                      <div key={i} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 10, marginBottom: 6 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <Chip text={`ID: ${str(l.productId)}`} c={ORANGE} />
                          {str(l.category) && <Chip text={str(l.category)} c="#009688" />}
                          <span style={{ flex: 1 }} />
                          <span style={{ color: "#999", fontSize: 11 }}>{qty} × {cur}{shown.toFixed(isHtg ? 0 : 2)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                          <b style={{ fontSize: 13 }}>{str(l.marque)} {str(l.modele)}</b>
                          <b style={{ color: "#4CAF50", fontSize: 12 }}>{cur}{(shown * qty).toFixed(isHtg ? 0 : 2)}</b>
                        </div>
                        {str(l.description) && <div style={{ color: "#aaa", fontSize: 11, marginTop: 4 }}>📝 {str(l.description)}</div>}
                        {str(l.serialImei) && <div style={{ color: ORANGE, fontSize: 11, marginTop: 3 }}>S/N: {str(l.serialImei)}</div>}
                        {isAdmin && (
                          <div style={{ color: lineBen >= 0 ? "#FFB74D" : "#EF5350", fontSize: 10, marginTop: 4 }}>
                            Acha: {usd(pa)} • Benefis: {usd(lineBen)}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                    <span style={{ color: "#777", fontSize: 11 }}>{lignes.length} pwodwi • {qtyTot} atik</span>
                    <div style={{ textAlign: "right", fontSize: 11 }}>
                      {sub > 0 && tax > 0 && (<>
                        <div style={{ color: "#999" }}>Sou-total: {isHtg ? `HTG ${(sub * taux).toFixed(0)}` : usd(sub)}</div>
                        <div style={{ color: "#999" }}>Taks: {isHtg ? `HTG ${(tax * taux).toFixed(0)}` : usd(tax)}</div>
                      </>)}
                      {isHtg && <div style={{ color: "#4CAF50", fontWeight: 700, fontSize: 13 }}>TOTAL: HTG {(tot * taux).toFixed(0)}</div>}
                      <div style={{ color: "#4CAF50", fontWeight: 700 }}>TOTAL: {usd(tot)}</div>
                      <div style={{ color: ORANGE }}>Benefis: {usd(ben)}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  // ═══════════════════ TAB: PWODWI ═══════════════════
  const renderProduit = () => {
    const avail = products.filter(p => stockOf(p) > 0)
      .sort((a, b) => `${str(a.marque)} ${str(a.modele)}`.localeCompare(`${str(b.marque)} ${str(b.modele)}`));
    const nb = avail.length;
    const totalStock = avail.reduce((s, p) => s + stockOf(p), 0);
    const valVente = avail.reduce((s, p) => s + num(p.prixVente) * stockOf(p), 0);
    const valAchat = avail.reduce((s, p) => s + num(p.prixAchat) * stockOf(p), 0);

    const q = searchProd.toLowerCase().trim();
    const shown = q ? avail.filter(p =>
      `${p.marque} ${p.modele} ${p.category} ${p.serialImei} ${p.id} ${p.description}`.toLowerCase().includes(q)) : avail;

    const cats = new Map<string, [number, number]>();
    avail.forEach(p => {
      const c = str(p.category) || "Lòt";
      const e = cats.get(c) ?? [0, 0];
      cats.set(c, [e[0] + 1, e[1] + stockOf(p)]);
    });

    // Rapò chak jou
    const hist = { ...stockHist, [dayKey(new Date())]: { date: dayKey(new Date()), nb, stock: totalStock } as StockDay };
    const keys = Object.keys(hist).sort((a, b) => b.localeCompare(a)).slice(0, 30);

    return (
      <>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <BigCard label="Pwodwi disponib" value={String(nb)} c="#4CAF50" icon="📦" />
          <BigCard label="Stock total" value={String(totalStock)} c="#2196F3" icon="🧱" />
          <BigCard label="Valè (vant)" value={usd(valVente)} c={ORANGE} icon="🏷️" />
          <BigCard label={isAdmin ? "Valè (acha)" : "Benefis posib"} value={usd(isAdmin ? valAchat : valVente - valAchat)} c="#9C27B0" icon="💰" />
        </div>

        {cats.size > 0 && (<><Title t="🗂️ Pa Kategori" />
          {[...cats.entries()].sort((a, b) => b[1][1] - a[1][1]).map(([c, [n, s]]) =>
            <Row key={c} left={c} right={`${n} pwodwi • stock ${s}`} rc="#009688" />)}</>)}

        <Title t="🗓️ Rapò Stock chak Jou" />
        <div style={{ background: CARD, borderRadius: 16, padding: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr 2fr 2fr", fontSize: 10, color: "#777", paddingBottom: 6 }}>
            <span>Jou</span><span style={{ textAlign: "center" }}>Pwodwi</span>
            <span style={{ textAlign: "center" }}>Stock</span><span style={{ textAlign: "right" }}>Chanjman</span>
          </div>
          {keys.map((k, i) => {
            const cur = hist[k];
            const prev = i + 1 < keys.length ? hist[keys[i + 1]] : null;
            const d = prev ? cur.stock - prev.stock : null;
            const today = k === dayKey(new Date());
            const [y, m, dd] = k.split("-");
            return (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "3fr 2fr 2fr 2fr", padding: "5px 0",
                borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 12 }}>
                <span style={{ color: today ? ORANGE : "#bbb", fontWeight: today ? 700 : 400 }}>{dd}/{m}/{y}{today ? " (jodi a)" : ""}</span>
                <span style={{ textAlign: "center", color: "#4CAF50", fontWeight: 700 }}>{cur.nb}</span>
                <span style={{ textAlign: "center", color: "#2196F3", fontWeight: 700 }}>{cur.stock}</span>
                <span style={{ textAlign: "right", fontWeight: 700,
                  color: d == null || d === 0 ? "#666" : d > 0 ? "#69F0AE" : "#FF5252" }}>
                  {d == null ? "—" : d > 0 ? `+${d}` : d}</span>
              </div>
            );
          })}
          {keys.length < 2 && <p style={{ color: "#666", fontSize: 10, margin: "8px 0 0" }}>
            Rapò a anrejistre stock la chak jou ou louvri paj sa a.</p>}
        </div>

        <Title t="📋 Lis Pwodwi Disponib" />
        <input value={searchProd} onChange={e => setSearchProd(e.target.value)}
          placeholder="Chèche mak, modèl, S/N, ID..." style={inputStyle} />
        <div style={{ height: 10 }} />
        {shown.length === 0 ? <Empty msg="Pa gen pwodwi disponib" /> : shown.map(p => {
          const stock = stockOf(p), pa = num(p.prixAchat), pv = num(p.prixVente), ben = pv - pa;
          return (
            <div key={str(p.id)} style={{ background: CARD, borderRadius: 14, padding: 12, marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Chip text={`ID: ${str(p.id)}`} c={ORANGE} />
                <b style={{ flex: 1, fontSize: 13 }}>{str(p.marque)} {str(p.modele)}</b>
                <Chip text={`Stock: ${stock}`} c={stock <= 2 ? ORANGE : "#4CAF50"} />
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "6px 0", fontSize: 11 }}>
                {str(p.category) && <span style={{ color: "#009688" }}>🗂 {str(p.category)}</span>}
                {str(p.serialImei) && <span style={{ color: ORANGE }}>S/N: {str(p.serialImei)}</span>}
              </div>
              {str(p.description) && <div style={{ color: "#999", fontSize: 11 }}>{str(p.description)}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <Chip text={`Achat ${usd(pa)}`} c="#9E9E9E" />
                <Chip text={`Vente ${usd(pv)}`} c="#4CAF50" />
                <Chip text={`Benefis ${ben >= 0 ? "+" : ""}${usd(ben)}`} c={ben >= 0 ? ORANGE : "#F44336"} />
              </div>
              {stock > 1 && <div style={{ color: "#64B5F6", fontSize: 11, marginTop: 6, fontWeight: 600 }}>
                Valè stock: {stock} × {usd(pv)} = {usd(pv * stock)}</div>}
            </div>
          );
        })}
      </>
    );
  };

  // ═══════════════════ TAB: VENDEUR ═══════════════════
  const renderVendeur = () => {
    const stats = new Map<string, { total: number; n: number; ben: number }>();
    vendeurs.forEach(v => { const n = str(v.nom); if (n) stats.set(n, { total: 0, n: 0, ben: 0 }); });
    const perDay = new Map<string, Map<string, { total: number; n: number }>>();
    fil.forEach(f => {
      const nom = str(f.vendeur); if (!nom) return;
      const s = stats.get(nom) ?? { total: 0, n: 0, ben: 0 };
      s.total += num(f.totalUSD); s.n += 1; s.ben += num(f.benefisUSD);
      stats.set(nom, s);
      const d = toDate(f.date);
      if (d) {
        const dk = dayKey(d);
        if (!perDay.has(dk)) perDay.set(dk, new Map());
        const m = perDay.get(dk)!;
        const r = m.get(nom) ?? { total: 0, n: 0 };
        r.total += num(f.totalUSD); r.n += 1; m.set(nom, r);
      }
    });
    const sorted = [...stats.entries()].sort((a, b) => b[1].total - a[1].total);
    const days = [...perDay.keys()].sort((a, b) => b.localeCompare(a));

    return (
      <>
        <BestSellerBanner localId={lid} compact={false} />
        {sorted.length > 0 && (<><Title t={`📊 Klasman Vendeur — ${periodLabel}`} />
          <Bars color="multi" items={sorted.map(([label, s]) => ({ label: label.slice(0, 8), value: s.total }))} /></>)}

        {days.length > 0 && (<><Title t="🗓️ Vendeur ki vann chak Jou" />
          {days.map(dk => {
            const rows = [...perDay.get(dk)!.entries()].sort((a, b) => b[1].total - a[1].total);
            const dayTotal = rows.reduce((s, [, r]) => s + r.total, 0);
            const [y, m, d] = dk.split("-");
            const open = openDay === dk;
            return (
              <div key={dk} style={{ background: CARD, borderRadius: 14, marginBottom: 8 }}>
                <div onClick={() => setOpenDay(open ? null : dk)}
                  style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between" }}>
                  <div><b style={{ fontSize: 13 }}>{d}/{m}/{y}</b>
                    <div style={{ color: "#777", fontSize: 11 }}>{rows.length} vendeur • {usd(dayTotal)}</div></div>
                  <span style={{ color: "#555" }}>{open ? "▲" : "▼"}</span>
                </div>
                {open && rows.map(([nom, r], i) => (
                  <div key={nom} style={{ display: "flex", gap: 8, padding: "4px 16px 8px", alignItems: "center", fontSize: 12 }}>
                    <span>{i === 0 ? "🥇" : "•"}</span><span style={{ flex: 1 }}>{nom}</span>
                    <span style={{ color: "#777", fontSize: 11 }}>{r.n} fakti</span>
                    <b style={{ color: "#4CAF50" }}>{usd(r.total)}</b>
                  </div>
                ))}
              </div>
            );
          })}</>)}

        <Title t="👥 Detay pa Vendeur" />
        {sorted.length === 0 ? <Empty msg="Pa gen vendeur" /> : sorted.map(([nom, s], i) => {
          const c = PALETTE[i % PALETTE.length];
          return (
            <div key={nom} style={{ background: CARD, border: `1px solid ${c}33`, borderRadius: 14, padding: 14,
              marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${c}26`, color: c, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center" }}>{nom[0]?.toUpperCase()}</div>
              <div style={{ flex: 1 }}><b>{nom}</b><div style={{ color: "#888", fontSize: 11 }}>{s.n} facture</div></div>
              <div style={{ textAlign: "right" }}><b style={{ color: c }}>{usd(s.total)}</b>
                <div style={{ color: ORANGE, fontSize: 10 }}>Ben: {usd(s.ben)}</div></div>
            </div>
          );
        })}
      </>
    );
  };

  // ═══════════════════ TAB: FOUNISÈ ═══════════════════
  const renderFourn = () => {
    const byKey = new Map<string, Raw>();
    comptes.forEach(c => { const k = str(c.id).toLowerCase(); if (k) byKey.set(k, c); });
    products.forEach(p => {
      const nom = str(p.nomDealer); if (!nom) return;
      if (!byKey.has(nom.toLowerCase())) byKey.set(nom.toLowerCase(), { id: nom.toLowerCase(), nom, balance: 0, historique: [] });
    });
    let list = [...byKey.values()];
    if (!isAdmin) list = list.filter(c => str(c.id).toLowerCase() === user.username.toLowerCase());
    list.sort((a, b) => str(a.nom).toLowerCase().localeCompare(str(b.nom).toLowerCase()));

    let totVentes = 0, totRetr = 0, totSolde = 0, totDispo = 0;
    const rows = list.map(c => {
      let ventes = 0, annul = 0, retr = 0, dep = 0, nV = 0;
      const moves: Raw[] = [];
      ((c.historique as Raw[] | undefined) ?? []).forEach(m => {
        if (!inPeriod(toDate(m.date))) return;
        const delta = num(m.delta);
        switch (str(m.type)) {
          case "vente": ventes += delta; nV++; break;
          case "annulation": annul += delta; break;
          case "retrait": retr += -delta; break;
          case "depot": dep += delta; break;
        }
        moves.push(m);
      });
      moves.sort((a, b) => str(b.date).localeCompare(str(a.date)));
      const calc = calcDispo(c);
      totVentes += ventes; totRetr += retr; totSolde += num(c.balance); totDispo += calc.disponible;
      return { c, ventes, annul, retr, dep, nV, moves, solde: num(c.balance), ...calc };
    });

    return (
      <>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <BigCard label="Founisè" value={String(rows.length)} c={ORANGE} icon="🚚" />
          <BigCard label={`Vant (${periodLabel})`} value={usd(totVentes)} c="#4CAF50" icon="🛒" />
          <BigCard label="Solde total" value={usd(totSolde)} c="#2196F3" icon="🏦" />
          <BigCard label="Disponib" value={usd(totDispo)} c="#009688" icon="✅" />
          <BigCard label={`Retrè (${periodLabel})`} value={usd(totRetr)} c="#FF5252" icon="⬆️" />
        </div>
        <Title t="🚚 Kont Founisè yo" />
        {rows.length === 0 ? <Empty msg="Pa gen founisè" /> : rows.map(r => {
          const nom = str(r.c.nom) || str(r.c.id);
          const prods = products.filter(p => str(p.nomDealer).toLowerCase() === nom.toLowerCase());
          const dispoProd = prods.filter(p => stockOf(p) > 0).length;
          const open = openFourn === nom;
          return (
            <div key={nom} style={{ background: CARD, borderRadius: 16, marginBottom: 10 }}>
              <div onClick={() => setOpenFourn(open ? null : nom)}
                style={{ padding: "12px 16px", cursor: "pointer", display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(255,152,0,0.15)", color: ORANGE,
                  fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{nom[0]?.toUpperCase()}</div>
                <div style={{ flex: 1 }}><b style={{ fontSize: 14 }}>{nom}</b>
                  <div style={{ color: "#777", fontSize: 11 }}>Solde {usd(r.solde)} • Disponib {usd(r.disponible)}</div></div>
                <b style={{ color: "#4CAF50", fontSize: 13 }}>{usd(r.ventes)}</b>
                <span style={{ color: "#555" }}>{open ? "▲" : "▼"}</span>
              </div>
              {open && (
                <div style={{ padding: "0 14px 14px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    <Chip text={`${r.nV} vant`} c="#4CAF50" />
                    <Chip text={`Anilasyon ${usd(r.annul)}`} c="#F44336" />
                    <Chip text={`Retrè ${usd(r.retr)}`} c="#FF5252" />
                    <Chip text={`Dépôt ${usd(r.dep)}`} c="#2196F3" />
                    <Chip text={`An atant ${usd(r.enAttente)}`} c="#FFC107" />
                    <Chip text={`${prods.length} pwodwi (${dispoProd} disponib)`} c="#009688" />
                  </div>
                  {r.moves.length === 0 ? <p style={{ color: "#666", fontSize: 12 }}>Pa gen mouvman nan peryòd sa a</p>
                    : r.moves.slice(0, 60).map((m, i) => {
                      const delta = num(m.delta);
                      const t = str(m.type);
                      const prod = `${str(m.marque)} ${str(m.modele)}`.trim();
                      const extra = [prod, str(m.billNo) && `#${str(m.billNo)}`,
                        str(m.clientNom) && `Kliyan: ${str(m.clientNom)}`,
                        str(m.vendeurNom) && `Vendeur: ${str(m.vendeurNom)}`].filter(Boolean).join(" • ");
                      return (
                        <div key={i} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 10, marginBottom: 6,
                          display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <span>{t === "vente" ? "🛒" : t === "annulation" ? "🚫" : t === "retrait" ? "⬆️" : "⬇️"}</span>
                          <div style={{ flex: 1 }}>
                            <b style={{ fontSize: 12 }}>{t === "vente" ? "Vant" : t === "annulation" ? "Anilasyon" : t === "retrait" ? "Retrè" : "Dépôt"}</b>
                            {extra && <div style={{ color: "#999", fontSize: 11 }}>{extra}</div>}
                            <div style={{ color: "#555", fontSize: 10 }}>{fmtDate(m.date)}</div>
                          </div>
                          <b style={{ color: delta >= 0 ? "#69F0AE" : "#FF5252", fontSize: 12 }}>
                            {delta >= 0 ? "+" : "-"}{usd(Math.abs(delta))}</b>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  // ═══════════════════ TAB: KÒMAND ═══════════════════
  const renderCmd = () => {
    const st = (c: Raw) => str(c.statut) || "En attente";
    const inP = commandes.filter(c => inPeriod(toDate(c.createdAt)));
    const list = inP.filter(c => cmdStatut === "Tout" || st(c) === cmdStatut)
      .sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)));
    const rev = inP.filter(c => st(c) !== "Annulé").reduce((s, c) => s + num(c.total), 0);
    const count = (s: string) => inP.filter(c => st(c) === s).length;

    return (
      <>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <BigCard label="Total" value={String(inP.length)} c="#6C63FF" icon="🛍️" />
          <BigCard label="Revenu" value={usd(rev)} c="#4CAF50" icon="💰" />
          <BigCard label="⏳ En attente" value={String(count("En attente"))} c="#FF9800" icon="" />
          <BigCard label="✅ Confirmé" value={String(count("Confirmé"))} c="#4CAF50" icon="" />
          <BigCard label="🚚 En livraison" value={String(count("En livraison"))} c="#2196F3" icon="" />
          <BigCard label="📦 Livré" value={String(count("Livré"))} c="#9C27B0" icon="" />
        </div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", margin: "14px 0" }}>
          {["Tout", ...CMD_STATUTS].map(s => (
            <button key={s} onClick={() => setCmdStatut(s)}
              style={{ padding: "7px 14px", borderRadius: 20, border: "none", cursor: "pointer", whiteSpace: "nowrap",
                fontWeight: 700, fontSize: 12, fontFamily: "inherit",
                background: cmdStatut === s ? (CMD_COLOR[s] ?? "#6C63FF") : "rgba(255,255,255,0.08)",
                color: cmdStatut === s ? "#fff" : "#999" }}>
              {s === "Tout" ? "Tout" : `${CMD_ICON[s]} ${s}`}</button>
          ))}
        </div>
        {list.length === 0 ? <Empty msg="Pa gen kòmand nan peryòd sa a" /> : list.map(c => {
          const s = st(c), col = CMD_COLOR[s] ?? "#999";
          const prods = (c.produits as Raw[] | undefined) ?? [];
          return (
            <div key={str(c.id)} style={{ background: CARD, border: `1px solid ${col}4d`, borderRadius: 16, padding: 14, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <b style={{ fontSize: 13 }}>👤 {str(c.clientNom) || "Client inconnu"}</b>
                  {str(c.clientTelephone) && <div style={{ color: "#999", fontSize: 11 }}>📞 {str(c.clientTelephone)}</div>}
                  {str(c.clientEmail) && <div style={{ color: "#777", fontSize: 10 }}>{str(c.clientEmail)}</div>}
                  <div style={{ color: "#555", fontSize: 10 }}>{fmtDate(c.createdAt)}</div>
                </div>
                <div><Chip text={`${CMD_ICON[s] ?? "❓"} ${s}`} c={col} /></div>
              </div>
              <div style={{ margin: "8px 0" }}>
                {prods.map((p, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#ccc", marginBottom: 3 }}>
                    <span>• {str(p.marque)} {str(p.modele)}{str(p.id) ? ` (ID: ${str(p.id)})` : ""}</span>
                    <b>{usd(num(p.prix))}</b>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
                <span style={{ color: "#777", fontSize: 11 }}>Via {str(c.methode)}{str(c.banque) ? ` (${str(c.banque)})` : ""}</span>
                <b style={{ color: "#4CAF50", fontSize: 15 }}>{usd(num(c.total))}</b>
              </div>
            </div>
          );
        })}
      </>
    );
  };

  // ═══════════════════ TAB: ITILIZATÈ ═══════════════════
  const renderUser = () => {
    if (users.length === 0) return <Empty msg="Pa gen itilizatè" />;
    const now = Date.now();
    const withDate = users.map(u => ({ u, d: toDate(u.createdAt) }))
      .sort((a, b) => (b.d?.getTime() ?? -1) - (a.d?.getTime() ?? -1));
    const age = (d: Date | null) => (d ? (now - d.getTime()) / 86400000 : Infinity);
    const new7 = withDate.filter(e => age(e.d) < 7).length;
    const new30 = withDate.filter(e => age(e.d) < 30).length;
    const admins = users.filter(u => u.isAdmin === true).length;
    const blocked = users.filter(u => u.isBlocked === true).length;

    const stats = new Map<string, { total: number; n: number; ben: number }>();
    users.forEach(u => { const k = str(u.username); if (k) stats.set(k, { total: 0, n: 0, ben: 0 }); });
    fil.forEach(f => {
      const k = str(f.cashier); const s = stats.get(k); if (!s) return;
      s.total += num(f.totalUSD); s.n += 1; s.ben += num(f.benefisUSD);
    });
    const sorted = [...stats.entries()].sort((a, b) => b[1].total - a[1].total);

    return (
      <>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <BigCard label="Total itilizatè" value={String(users.length)} c="#2196F3" icon="👥" />
          <BigCard label="Nouvo (7 jou)" value={String(new7)} c="#4CAF50" icon="🆕" />
          <BigCard label="Nouvo (30 jou)" value={String(new30)} c="#009688" icon="➕" />
          <BigCard label="Admin / Bloke" value={`${admins} / ${blocked}`} c={ORANGE} icon="🛡️" />
        </div>

        <Title t="🆕 Enskripsyon — Nouvo Itilizatè" />
        {withDate.map(({ u, d }) => {
          const isNew = age(d) < 7;
          const name = str(u.displayName) || str(u.username);
          return (
            <div key={str(u.uid)} style={{ background: CARD, borderRadius: 14, padding: 12, marginBottom: 8,
              border: `1px solid ${isNew ? "rgba(76,175,80,0.4)" : "rgba(255,255,255,0.06)"}`,
              display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(33,150,243,0.15)", color: "#2196F3",
                fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{name[0]?.toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <b style={{ fontSize: 13 }}>{name}</b>
                  {isNew && <Chip text="NOUVO" c="#4CAF50" />}
                  {u.isAdmin === true && <Chip text="ADMIN" c={ORANGE} />}
                  {u.isBlocked === true && <Chip text="BLOKE" c="#F44336" />}
                </div>
                <div style={{ color: "#777", fontSize: 11 }}>@{str(u.username)}{str(u.email) ? ` • ${str(u.email)}` : ""}</div>
                {str(u.telephone) && <div style={{ color: "#777", fontSize: 11 }}>📞 {str(u.telephone)}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#555", fontSize: 9 }}>Enskri</div>
                <b style={{ fontSize: 11, color: "#ccc" }}>{d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` : "—"}</b>
              </div>
            </div>
          );
        })}

        <Title t={`👤 Aktivite pa Itilizatè (Caissier) — ${periodLabel}`} />
        {sorted.map(([nom, s], i) => {
          const c = PALETTE[(i + 1) % PALETTE.length];
          return (
            <div key={nom} style={{ background: CARD, border: `1px solid ${c}33`, borderRadius: 14, padding: 14, marginBottom: 10,
              display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${c}26`, color: c, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center" }}>{nom[0]?.toUpperCase()}</div>
              <div style={{ flex: 1 }}><b>{nom}</b><div style={{ color: "#888", fontSize: 11 }}>{s.n} facture fè</div></div>
              <div style={{ textAlign: "right" }}><b style={{ color: c }}>{usd(s.total)}</b>
                <div style={{ color: ORANGE, fontSize: 10 }}>Ben: {usd(s.ben)}</div></div>
            </div>
          );
        })}
      </>
    );
  };

  // ─── RENDER ────────────────────────────────────────────────────────────
  const body: Record<TabId, () => React.ReactNode> = {
    rezime: renderRezime, facture: renderFacture, produit: renderProduit,
    vendeur: renderVendeur, fourn: renderFourn, cmd: renderCmd, user: renderUser,
  };

  return (
    <main style={{ minHeight: "100vh", background: BG, color: "#fff", fontFamily: "'Segoe UI',sans-serif" }}>
      {/* HEADER */}
      <div style={{ background: CARD, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px" }}>
          <button onClick={() => router.push("/dashboard")} title="Retounen"
            style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#aaa", width: 36, height: 36,
              borderRadius: 10, cursor: "pointer", fontSize: 16 }}>←</button>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Rapport</h1>
        </div>
        <div style={{ display: "flex", overflowX: "auto", padding: "0 12px" }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "12px 16px", border: "none", background: "none", cursor: "pointer", whiteSpace: "nowrap",
                fontWeight: 700, fontSize: 12, fontFamily: "inherit",
                color: currentTab === t ? ORANGE : "#777",
                borderBottom: `2px solid ${currentTab === t ? ORANGE : "transparent"}` }}>
              {TAB_LABEL[t]}</button>
          ))}
        </div>
        {/* Filtres */}
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "8px 16px 10px", alignItems: "center" }}>
          {isAdmin && locals.length > 1 && (
            <select value={lid} onChange={e => setLid(e.target.value)} style={selectStyle}>
              {locals.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              style={{ padding: "6px 14px", borderRadius: 20, border: "none", cursor: "pointer", whiteSpace: "nowrap",
                fontWeight: 700, fontSize: 12, fontFamily: "inherit",
                background: period === p ? ORANGE : "rgba(255,255,255,0.08)", color: period === p ? "#fff" : "#888" }}>
              {p === "Dat" ? "📅 Dat" : p}</button>
          ))}
          {period === "Dat" && (
            <input type="date" value={picked} onChange={e => setPicked(e.target.value)}
              style={{ ...selectStyle, colorScheme: "dark" }} />
          )}
          <select value={fVendeur} onChange={e => setFVendeur(e.target.value)} style={selectStyle}>
            {vendeurNames.map(v => <option key={v} value={v}>{v === "Tout" ? "🟠 Tout vendeur" : v}</option>)}
          </select>
          <select value={fUser} onChange={e => setFUser(e.target.value)} style={selectStyle}>
            {userNames.map(u => <option key={u} value={u}>{u === "Tout" ? "🔵 Tout itilizatè" : u}</option>)}
          </select>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 16px 60px" }}>
        {loading ? <p style={{ textAlign: "center", color: "#888", padding: 60 }}>Chajman...</p> : body[currentTab]()}
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "11px 14px", background: CARD, border: "1px solid #2a2d3e", borderRadius: 12,
  color: "#fff", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};
const selectStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)", color: "#fff", border: "none", borderRadius: 20,
  padding: "6px 12px", fontSize: 12, fontFamily: "inherit", outline: "none",
};