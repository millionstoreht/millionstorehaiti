"use client";
import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import { collection, getDocs, onSnapshot, deleteDoc, doc, getDoc } from "firebase/firestore";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  ArrowLeft, Receipt, Package, Badge, User, TrendingUp,
  DollarSign, Calculator, Percent, ShoppingBag, Search,
  X, Trash2, ChevronDown, ChevronUp, CreditCard, Smartphone, Wallet,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface UserSession {
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  selectedLocalId?: string;
}

interface Facture {
  id: string;
  billNo: string;
  date: string;
  localId: string;
  clientNom: string;
  vendeur: string;
  cashier: string;
  modePeman: string;
  devise: string;
  taux: number;
  totalUSD: number;
  benefisUSD: number;
  annule?: boolean;
  lignes: LigneSaved[];
}

interface LigneSaved {
  productId: string;
  marque: string;
  modele: string;
  category: string;
  serialImei: string;
  prix: number;
  prixAchat: number;
  qty: number;
}

interface Product {
  id: string;
  marque: string;
  modele: string;
  category: string;
  serialImei: string;
  prixAchat: number;
  prixVente: number;
  stock: number;
  isDeleted?: boolean;
}

interface Vendeur { id: string; nom: string; }
interface UserDoc { username: string; }

type Tab = "rezime" | "facture" | "pwodwi" | "vendeur" | "itilizate";
type Period = "Jodi a" | "Semèn" | "Mwa" | "Tout";

const COLORS = ["#FF9800","#2196F3","#4CAF50","#9C27B0","#F44336","#00BCD4","#FFD600","#FF5722"];
const col = (i: number) => COLORS[i % COLORS.length];

function fmtUSD(v: number) { return `$${v.toFixed(2)}`; }
function fmtDate(raw?: string) {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}  ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  } catch { return ""; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function RapportsPage() {
  const router = useRouter();
  const [user, setUser]         = useState<UserSession | null>(null);
  const [localId, setLocalId]   = useState("");
  const [factures, setFactures] = useState<Facture[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [vendeurs, setVendeurs] = useState<Vendeur[]>([]);
  const [users, setUsers]       = useState<UserDoc[]>([]);
  const [taux, setTaux]         = useState(1);
  const [loading, setLoading]   = useState(true);

  const [tab, setTab]                   = useState<Tab>("rezime");
  const [period, setPeriod]             = useState<Period>("Jodi a");
  const [filterVendeur, setFilterVendeur] = useState("Tout");
  const [filterUser, setFilterUser]     = useState("Tout");
  const [searchFacture, setSearchFacture] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Facture | null>(null);

  // ── Init ──
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const u = JSON.parse(raw) as UserSession;
      setUser(u);
      if (u.isAdmin) {
        // Jwenn premye lokal reyèl
        getDocs(collection(db, "locals")).then(snap => {
          const ids = snap.docs.map(d => d.id).filter(id => id !== "all");
          setLocalId(ids[0] ?? u.localId);
        });
      } else {
        setLocalId(u.localId);
      }
    } catch { router.push("/login"); }
  }, [router]);

  useEffect(() => {
    if (!localId) return;
    load();

    // Real-time factures
    const unsub = onSnapshot(collection(db, "locals", localId, "factures"), snap => {
      setFactures(snap.docs.map(d => ({ id: d.id, ...d.data() } as Facture)));
    });
    // Real-time vendeurs
    const unsub2 = onSnapshot(collection(db, "locals", localId, "vendeurs"), snap => {
      setVendeurs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Vendeur)));
    });
    return () => { unsub(); unsub2(); };
  }, [localId]);

  async function load() {
    setLoading(true);
    try {
      const tauxSnap = await getDoc(doc(db, "parametres", "taux"));
      if (tauxSnap.exists()) setTaux(Number(tauxSnap.data()?.taux ?? 1));

      const [factSnap, prodSnap, vSnap, uSnap] = await Promise.all([
        getDocs(collection(db, "locals", localId, "factures")),
        getDocs(collection(db, "locals", localId, "products")),
        getDocs(collection(db, "locals", localId, "vendeurs")),
        getDocs(collection(db, "users")),
      ]);
      setFactures(factSnap.docs.map(d => ({ id: d.id, ...d.data() } as Facture)));
      setProducts(prodSnap.docs.map(d => ({ id: d.id, ...d.data() } as Product)).filter(p => !p.isDeleted));
      setVendeurs(vSnap.docs.map(d => ({ id: d.id, ...d.data() } as Vendeur)));
      setUsers(uSnap.docs.map(d => ({ ...d.data() } as UserDoc)));
    } catch {}
    setLoading(false);
  }

  // ── Filter ──
  const filtered = useMemo(() => {
    const now = new Date();
    return factures.filter(f => {
      if (f.annule) return false;
      try {
        const d = new Date(f.date);
        if (period === "Jodi a") {
          if (d.toDateString() !== now.toDateString()) return false;
        } else if (period === "Semèn") {
          if ((now.getTime() - d.getTime()) / 86400000 > 7) return false;
        } else if (period === "Mwa") {
          if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
        }
      } catch {}
      if (filterVendeur !== "Tout" && f.vendeur !== filterVendeur) return false;
      if (filterUser !== "Tout" && f.cashier !== filterUser) return false;
      return true;
    });
  }, [factures, period, filterVendeur, filterUser]);

  const totVente  = filtered.reduce((s, f) => s + (f.totalUSD ?? 0), 0);
  const totBenef  = filtered.reduce((s, f) => s + Math.max(0, f.benefisUSD ?? 0), 0);
  const vendeurNames = ["Tout", ...vendeurs.map(v => v.nom)];
  const userNames    = ["Tout", ...users.map(u => u.username)];

  async function handleDeleteFacture(f: Facture) {
    await deleteDoc(doc(db, "locals", localId, "factures", f.id));
    setShowDeleteConfirm(null);
  }

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#0F1117", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16, fontFamily:"'Segoe UI',sans-serif" }}>
      <div style={{ width:40, height:40, border:"3px solid rgba(255,255,255,0.1)", borderTop:"3px solid #FF9800", borderRadius:"50%", animation:"spin 1s linear infinite" }} />
      <p style={{ color:"#fff" }}>Chajman...</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#0F1117", fontFamily:"'Segoe UI',sans-serif", display:"flex", flexDirection:"column" }}>

      {/* ── AppBar ── */}
      <div style={{ background:"#1A1D2E", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", padding:"12px 12px 8px", gap:8 }}>
          <button onClick={() => router.back()} style={iconBtnW}><ArrowLeft size={18} /></button>
          <span style={{ color:"#fff", fontWeight:700, fontSize:18, flex:1 }}>Rapport</span>

          {/* Filtre Vendeur */}
          <select value={filterVendeur} onChange={e => setFilterVendeur(e.target.value)}
            style={{ background:"rgba(255,255,255,0.1)", border:"none", color:"#fff", padding:"6px 8px", borderRadius:8, fontSize:12, cursor:"pointer", outline:"none" }}>
            {vendeurNames.map(v => <option key={v} value={v} style={{ background:"#1A1D2E" }}>{v}</option>)}
          </select>

          {/* Filtre Utilisateur */}
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
            style={{ background:"rgba(255,255,255,0.1)", border:"none", color:"#fff", padding:"6px 8px", borderRadius:8, fontSize:12, cursor:"pointer", outline:"none" }}>
            {userNames.map(u => <option key={u} value={u} style={{ background:"#1A1D2E" }}>{u}</option>)}
          </select>
        </div>

        {/* Period filter */}
        <div style={{ display:"flex", gap:8, padding:"0 12px 8px", overflowX:"auto" }}>
          {(["Jodi a","Semèn","Mwa","Tout"] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{ background: period===p ? "#FF9800" : "rgba(255,255,255,0.08)", border:"none", color: period===p ? "#fff" : "rgba(255,255,255,0.54)", padding:"6px 16px", borderRadius:20, fontWeight:700, fontSize:12, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>
              {p}
            </button>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", overflowX:"auto" }}>
          {(["rezime","facture","pwodwi","vendeur","itilizate"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex:1, minWidth:80, padding:"10px 4px", background:"none", border:"none", color: tab===t ? "#FF9800" : "rgba(255,255,255,0.38)", fontWeight:700, fontSize:11, letterSpacing:0.8, borderBottom: tab===t ? "2px solid #FF9800" : "2px solid transparent", cursor:"pointer", whiteSpace:"nowrap" }}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex:1, overflowY:"auto" }}>
        {tab === "rezime"    && <RezimeTab filtered={filtered} totVente={totVente} totBenef={totBenef} taux={taux} />}
        {tab === "facture"   && <FactureTab filtered={filtered} taux={taux} search={searchFacture} setSearch={setSearchFacture} isAdmin={user?.isAdmin ?? false} onDelete={f => setShowDeleteConfirm(f)} />}
        {tab === "pwodwi"    && <PwodwiTab products={products} />}
        {tab === "vendeur"   && <VendeurTab filtered={filtered} vendeurs={vendeurs} />}
        {tab === "itilizate" && <ItilizateTab filtered={filtered} users={users} />}
      </div>

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"#1A1D2E", borderRadius:20, padding:24, width:"100%", maxWidth:360, border:"1px solid rgba(255,255,255,0.1)" }}>
            <p style={{ color:"#fff", fontWeight:700, fontSize:16, margin:"0 0 12px" }}>Siprime Facture?</p>
            <p style={{ color:"rgba(255,255,255,0.54)", margin:"0 0 20px" }}>#{showDeleteConfirm.billNo}</p>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => setShowDeleteConfirm(null)} style={{ flex:1, padding:12, background:"rgba(255,255,255,0.08)", border:"none", borderRadius:12, color:"rgba(255,255,255,0.7)", cursor:"pointer", fontWeight:600 }}>Non</button>
              <button onClick={() => handleDeleteFacture(showDeleteConfirm)} style={{ flex:1, padding:12, background:"#F44336", border:"none", borderRadius:12, color:"#fff", cursor:"pointer", fontWeight:700 }}>Wi, Siprime</button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — REZIME
// ─────────────────────────────────────────────────────────────────────────────
function RezimeTab({ filtered, totVente, totBenef, taux }: {
  filtered: Facture[]; totVente: number; totBenef: number; taux: number;
}) {
  const nFact     = filtered.length;
  const totQty    = filtered.reduce((s, f) => s + (f.lignes ?? []).reduce((q, l) => q + (l.qty ?? 1), 0), 0);
  const mwayenFact = nFact > 0 ? totVente / nFact : 0;
  const marj       = totVente > 0 ? (totBenef / totVente * 100) : 0;

  // Vant pa jou
  const byDay: Record<string, number> = {};
  filtered.forEach(f => {
    try {
      const d = new Date(f.date);
      const key = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
      byDay[key] = (byDay[key] ?? 0) + (f.totalUSD ?? 0);
    } catch {}
  });
  const chartData = Object.entries(byDay).map(([name, value]) => ({ name, value }));

  // Kategori stats
  const cats: Record<string, { usd: number; htg: number }> = {};
  filtered.forEach(f => {
    (f.lignes ?? []).forEach(l => {
      const cat = l.category || "Lòt";
      if (!cats[cat]) cats[cat] = { usd: 0, htg: 0 };
      const prix = l.prix ?? 0;
      const qty  = l.qty ?? 1;
      if (f.devise === "HTG") {
        cats[cat].htg += prix * qty;
        cats[cat].usd += f.taux > 0 ? (prix * qty) / f.taux : 0;
      } else {
        cats[cat].usd += prix * qty;
      }
    });
  });
  const catsSorted = Object.entries(cats).sort((a, b) => b[1].usd - a[1].usd);

  // Mode peman
  const modes: Record<string, number> = {};
  filtered.forEach(f => {
    const m = f.modePeman || "Cash";
    modes[m] = (modes[m] ?? 0) + (f.totalUSD ?? 0);
  });

  // Vendeur stats inline
  const vStats: Record<string, number> = {};
  filtered.forEach(f => {
    if (f.vendeur) vStats[f.vendeur] = (vStats[f.vendeur] ?? 0) + (f.totalUSD ?? 0);
  });

  return (
    <div style={{ padding:16, maxWidth:900, margin:"0 auto" }}>
      {/* 6 big cards */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:20 }}>
        <BigCard label="Vente Total"      value={fmtUSD(totVente)}       icon={<DollarSign size={18} />}  color="#4CAF50" />
        <BigCard label="Benefis"          value={fmtUSD(totBenef)}       icon={<TrendingUp size={18} />}  color="#FF9800" />
        <BigCard label="Nòm Facture"      value={String(nFact)}          icon={<Receipt size={18} />}     color="#2196F3" />
        <BigCard label="Mwayèn/Facture"   value={fmtUSD(mwayenFact)}     icon={<Calculator size={18} />}  color="#9C27B0" />
        <BigCard label="Total Atik Vann"  value={String(totQty)}         icon={<ShoppingBag size={18} />} color="#009688" />
        <BigCard label="Maj Benefis"      value={`${marj.toFixed(1)}%`}  icon={<Percent size={18} />}     color="#E91E63" />
      </div>

      {/* Bar chart */}
      {chartData.length > 0 && (
        <>
          <SectionTitle title="📈 Vant pa Jou" />
          <div style={{ background:"#1A1D2E", borderRadius:16, padding:16, marginBottom:20 }}>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} barCategoryGap="30%">
                <XAxis dataKey="name" tick={{ fill:"rgba(255,255,255,0.38)", fontSize:9 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={{ background:"#1A1D2E", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, color:"#fff" }} formatter={(v) => [`$${Number(v ?? 0).toFixed(2)}`, "Vente"]} />
                <Bar dataKey="value" radius={[6,6,0,0]} fill="#FF9800" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Kategori */}
      <SectionTitle title="📦 Vant pa Kategori" />
      {catsSorted.length === 0 ? <EmptyState msg="Okenn done" /> : catsSorted.map(([cat, v]) => (
        <div key={cat} style={{ background:"rgba(255,255,255,0.05)", borderRadius:10, padding:"10px 12px", marginBottom:6, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:"#fff", fontSize:13 }}>{cat}</span>
          <div style={{ textAlign:"right" }}>
            {v.usd > 0 && <div style={{ color:"#FF9800", fontWeight:700, fontSize:13 }}>${v.usd.toFixed(2)}</div>}
            {v.htg > 0 && <div style={{ color:"#9C27B0", fontWeight:700, fontSize:12 }}>HTG {v.htg.toFixed(0)}</div>}
          </div>
        </div>
      ))}

      {/* Mode peman */}
      <div style={{ marginTop:20 }}>
        <SectionTitle title="💳 Mode Peman" />
        {Object.entries(modes).map(([mode, val]) => (
          <div key={mode} style={{ background:"rgba(255,255,255,0.05)", borderRadius:10, padding:"10px 12px", marginBottom:6, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              {mode === "Cash" ? <DollarSign size={14} color="#2196F3" /> : mode === "Bancaire" ? <CreditCard size={14} color="#2196F3" /> : <Smartphone size={14} color="#2196F3" />}
              <span style={{ color:"#fff", fontSize:13 }}>{mode}</span>
            </div>
            <span style={{ color:"#2196F3", fontWeight:700, fontSize:13 }}>{fmtUSD(val)}</span>
          </div>
        ))}
      </div>

      {/* Vendeur stats */}
      <div style={{ marginTop:20 }}>
        <SectionTitle title="🏷️ Vant pa Vendeur" />
        {Object.entries(vStats).map(([nom, val]) => (
          <div key={nom} style={{ background:"rgba(255,255,255,0.05)", borderRadius:10, padding:"10px 12px", marginBottom:6, display:"flex", justifyContent:"space-between" }}>
            <span style={{ color:"#fff", fontSize:13 }}>{nom}</span>
            <span style={{ color:"#4CAF50", fontWeight:700, fontSize:13 }}>{fmtUSD(val)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — FACTURE
// ─────────────────────────────────────────────────────────────────────────────
function FactureTab({ filtered, taux, search, setSearch, isAdmin, onDelete }: {
  filtered: Facture[]; taux: number; search: string;
  setSearch: (v: string) => void; isAdmin: boolean;
  onDelete: (f: Facture) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const searched = search.trim()
    ? filtered.filter(f => {
        const q = search.toLowerCase();
        return [f.billNo, f.clientNom, f.vendeur, f.cashier].some(v => (v ?? "").toLowerCase().includes(q));
      })
    : filtered;
  const sorted = [...searched].reverse();

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      {/* Search */}
      <div style={{ padding:"12px 12px 4px" }}>
        <div style={{ position:"relative" }}>
          <Search size={16} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"#FF9800" }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Chèche #Bill, kliyan, vendeur..."
            style={{ width:"100%", padding:"10px 12px 10px 36px", borderRadius:12, border:"none", background:"#1A1D2E", color:"#fff", fontSize:13, boxSizing:"border-box", outline:"none" }} />
          {search && <button onClick={() => setSearch("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.38)", display:"flex" }}><X size={16} /></button>}
        </div>
        {search && <p style={{ color:"#FF9800", fontSize:12, margin:"6px 0 0 4px" }}>{sorted.length} rezilta</p>}
      </div>

      {/* List */}
      <div style={{ overflowY:"auto", flex:1, padding:"4px 12px 20px" }}>
        {sorted.length === 0 ? <EmptyState msg={search ? `Pa gen rezilta pou "${search}"` : "Pa gen facture"} /> :
          sorted.map(f => {
            const tot    = f.totalUSD ?? 0;
            const ben    = f.benefisUSD ?? 0;
            const isExp  = expanded === f.id;
            return (
              <div key={f.id} style={{ background:"#1A1D2E", borderRadius:16, marginBottom:10, overflow:"hidden", border:"1px solid rgba(255,255,255,0.06)" }}>
                {/* Header */}
                <button onClick={() => setExpanded(isExp ? null : f.id)} style={{ width:"100%", background:"none", border:"none", cursor:"pointer", padding:"12px 16px", display:"flex", alignItems:"flex-start", gap:12, textAlign:"left" }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                      <span style={{ background:"rgba(255,152,0,0.15)", color:"#FF9800", fontSize:12, fontWeight:700, padding:"2px 8px", borderRadius:8 }}>#{f.billNo}</span>
                      {f.clientNom && f.clientNom !== "Anònim" && <span style={{ color:"#fff", fontSize:12 }}>👤 {f.clientNom}</span>}
                    </div>
                    <div style={{ color:"rgba(255,255,255,0.38)", fontSize:10, marginBottom:4 }}>{fmtDate(f.date)}</div>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      {f.vendeur  && <Chip label={`🟠 ${f.vendeur}`}  color="#FF9800" />}
                      {f.cashier  && <Chip label={`🔵 ${f.cashier}`}  color="#2196F3" />}
                      {f.modePeman && <Chip label={f.modePeman}         color="#888" />}
                      <Chip label={f.devise ?? "$"} color={f.devise === "HTG" ? "#9C27B0" : "#4CAF50"} />
                    </div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ color:"#4CAF50", fontWeight:700, fontSize:14 }}>
                      {f.devise === "HTG" ? `HTG ${(tot * taux).toFixed(0)}` : fmtUSD(tot)}
                    </div>
                    {f.devise === "HTG" && <div style={{ color:"#4CAF50", fontSize:10 }}>{fmtUSD(tot)}</div>}
                    <div style={{ color:"#FF9800", fontSize:10 }}>Ben: {fmtUSD(ben)}</div>
                    {isExp ? <ChevronUp size={14} color="rgba(255,255,255,0.38)" /> : <ChevronDown size={14} color="rgba(255,255,255,0.38)" />}
                  </div>
                </button>

                {/* Expanded */}
                {isExp && (
                  <div style={{ padding:"0 16px 14px", borderTop:"1px solid rgba(255,255,255,0.08)" }}>
                    {(f.lignes ?? []).map((l, i) => (
                      <div key={i} style={{ padding:"8px 0", borderBottom:"1px solid rgba(255,255,255,0.06)", display:"flex", gap:10, alignItems:"flex-start" }}>
                        <span style={{ background:"rgba(255,152,0,0.1)", color:"#FF9800", fontSize:9, fontWeight:700, padding:"2px 5px", borderRadius:5, flexShrink:0 }}>ID: {l.productId}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ color:"#fff", fontWeight:700, fontSize:12 }}>{l.marque} {l.modele}</div>
                          {l.category   && <div style={{ color:"#009688", fontSize:10 }}>{l.category}</div>}
                          {l.serialImei && <div style={{ color:"#FF9800", fontSize:10 }}>S/N: {l.serialImei}</div>}
                        </div>
                        <div style={{ textAlign:"right", flexShrink:0 }}>
                          <div style={{ color:"rgba(255,255,255,0.54)", fontSize:11 }}>{l.qty} × {f.devise === "HTG" ? "HTG" : "$"}{(l.prix ?? 0).toFixed(2)}</div>
                          <div style={{ color:"#fff", fontWeight:700, fontSize:12 }}>{f.devise === "HTG" ? "HTG" : "$"}{((l.prix ?? 0) * (l.qty ?? 1)).toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:10 }}>
                      <span style={{ color:"rgba(255,255,255,0.38)", fontSize:11 }}>
                        {(f.lignes ?? []).length} pwodwi  •  {(f.lignes ?? []).reduce((s, l) => s + (l.qty ?? 1), 0)} atik
                      </span>
                      <div style={{ textAlign:"right" }}>
                        {f.devise === "HTG" && <div style={{ color:"#4CAF50", fontWeight:700, fontSize:12 }}>TOTAL: HTG {((f.totalUSD ?? 0) * taux).toFixed(0)}</div>}
                        <div style={{ color:"#4CAF50", fontWeight:700, fontSize: f.devise === "HTG" ? 11 : 13 }}>TOTAL: {fmtUSD(f.totalUSD ?? 0)}</div>
                      </div>
                    </div>
                    {isAdmin && (
                      <button onClick={() => onDelete(f)} style={{ marginTop:10, background:"rgba(244,67,54,0.1)", border:"1px solid rgba(244,67,54,0.3)", borderRadius:8, padding:"6px 12px", color:"#F44336", fontSize:12, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
                        <Trash2 size={13} /> Siprime
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        }
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3 — PWODWI
// ─────────────────────────────────────────────────────────────────────────────
function PwodwiTab({ products }: { products: Product[] }) {
  const sorted = [...products].sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));
  if (!sorted.length) return <EmptyState msg="Pa gen pwodwi" />;
  return (
    <div style={{ padding:"12px 12px 20px", maxWidth:900, margin:"0 auto" }}>
      {sorted.map(p => {
        const pa  = p.prixAchat ?? 0;
        const pv  = p.prixVente ?? 0;
        const ben = pv - pa;
        const stk = p.stock ?? 0;
        return (
          <div key={p.id} style={{ background:"#1A1D2E", borderRadius:14, padding:12, marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ background:"rgba(255,152,0,0.1)", color:"#FF9800", fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:6 }}>ID: {p.id}</span>
                <span style={{ color:"#fff", fontWeight:700, fontSize:13 }}>{p.marque} {p.modele}</span>
              </div>
              <span style={{ background: stk <= 0 ? "rgba(244,67,54,0.15)" : stk <= 2 ? "rgba(255,152,0,0.15)" : "rgba(76,175,80,0.15)", color: stk <= 0 ? "#F44336" : stk <= 2 ? "#FF9800" : "#4CAF50", fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:10 }}>
                Stock: {stk}
              </span>
            </div>
            {(p.category || p.serialImei) && (
              <div style={{ display:"flex", gap:12, marginBottom:8 }}>
                {p.category   && <span style={{ color:"#009688", fontSize:11 }}>📦 {p.category}</span>}
                {p.serialImei && <span style={{ color:"#FF9800", fontSize:11 }}>S/N: {p.serialImei}</span>}
              </div>
            )}
            <div style={{ display:"flex", gap:8 }}>
              <PriceChip label="Achat" value={`$${pa.toFixed(2)}`} color="rgba(255,255,255,0.54)" />
              <PriceChip label="Vente" value={`$${pv.toFixed(2)}`} color="#4CAF50" />
              <PriceChip label="Benefis" value={`${ben >= 0 ? "+" : ""}$${ben.toFixed(2)}`} color={ben >= 0 ? "#FF9800" : "#F44336"} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4 — VENDEUR
// ─────────────────────────────────────────────────────────────────────────────
function VendeurTab({ filtered, vendeurs }: { filtered: Facture[]; vendeurs: Vendeur[] }) {
  const stats = vendeurs.map(v => {
    const vFacts = filtered.filter(f => f.vendeur === v.nom);
    return {
      nom: v.nom,
      total: vFacts.reduce((s, f) => s + (f.totalUSD ?? 0), 0),
      benefis: vFacts.reduce((s, f) => s + Math.max(0, f.benefisUSD ?? 0), 0),
      nFact: vFacts.length,
    };
  }).sort((a, b) => b.total - a.total);

  const chartData = stats.map(s => ({ name: s.nom.length > 6 ? s.nom.slice(0,6) : s.nom, value: s.total }));
  const maxVal = stats[0]?.total ?? 0;

  if (!vendeurs.length) return <EmptyState msg="Pa gen vendeur" />;
  return (
    <div style={{ padding:16, maxWidth:900, margin:"0 auto" }}>
      <SectionTitle title="📊 Klasman Vendeur" />
      {maxVal > 0 && (
        <div style={{ background:"#1A1D2E", borderRadius:16, padding:16, marginBottom:20 }}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} barCategoryGap="30%">
              <XAxis dataKey="name" tick={{ fill:"rgba(255,255,255,0.38)", fontSize:9 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={{ background:"#1A1D2E", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, color:"#fff" }} formatter={(v) => [`$${Number(v ?? 0).toFixed(2)}`, "Vente"]} />
              <Bar dataKey="value" radius={[6,6,0,0]}>
                {chartData.map((_, i) => <Cell key={i} fill={col(i)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {stats.map((s, i) => (
        <div key={s.nom} style={{ background:"#1A1D2E", borderRadius:14, padding:14, marginBottom:10, border:`1px solid ${col(i)}33`, display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:40, height:40, borderRadius:"50%", background:`${col(i)}26`, display:"flex", alignItems:"center", justifyContent:"center", color:col(i), fontWeight:700, flexShrink:0 }}>
            {s.nom[0]?.toUpperCase()}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ color:"#fff", fontWeight:700 }}>{s.nom}</div>
            <div style={{ color:"rgba(255,255,255,0.54)", fontSize:11 }}>{s.nFact} facture</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ color:col(i), fontWeight:700 }}>{fmtUSD(s.total)}</div>
            <div style={{ color:"#FF9800", fontSize:10 }}>Ben: {fmtUSD(s.benefis)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 5 — ITILIZATÈ
// ─────────────────────────────────────────────────────────────────────────────
function ItilizateTab({ filtered, users }: { filtered: Facture[]; users: UserDoc[] }) {
  const stats = users.map(u => {
    const uFacts = filtered.filter(f => f.cashier === u.username);
    return {
      username: u.username,
      total: uFacts.reduce((s, f) => s + (f.totalUSD ?? 0), 0),
      benefis: uFacts.reduce((s, f) => s + Math.max(0, f.benefisUSD ?? 0), 0),
      nFact: uFacts.length,
    };
  }).sort((a, b) => b.total - a.total);

  if (!users.length) return <EmptyState msg="Pa gen itilizatè" />;
  return (
    <div style={{ padding:16, maxWidth:900, margin:"0 auto" }}>
      <SectionTitle title="👤 Aktivite pa Itilizatè (Caissier)" />
      {stats.map((s, i) => (
        <div key={s.username} style={{ background:"#1A1D2E", borderRadius:14, padding:14, marginBottom:10, border:`1px solid ${col(i)}33`, display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:40, height:40, borderRadius:"50%", background:`${col(i)}26`, display:"flex", alignItems:"center", justifyContent:"center", color:col(i), fontWeight:700, flexShrink:0 }}>
            {s.username[0]?.toUpperCase()}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ color:"#fff", fontWeight:700 }}>{s.username}</div>
            <div style={{ color:"rgba(255,255,255,0.54)", fontSize:11 }}>{s.nFact} facture fè</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ color:col(i), fontWeight:700 }}>{fmtUSD(s.total)}</div>
            <div style={{ color:"#FF9800", fontSize:10 }}>Ben: {fmtUSD(s.benefis)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function BigCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div style={{ background:`${color}14`, border:`1px solid ${color}40`, borderRadius:16, padding:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
        {React.cloneElement(icon as React.ReactElement<{ color?: string }>, { color })}
        <span style={{ color, fontWeight:700, fontSize:15 }}>{value}</span>
      </div>
      <div style={{ color:"rgba(255,255,255,0.38)", fontSize:11 }}>{label}</div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <p style={{ color:"#fff", fontWeight:700, fontSize:14, margin:"0 0 10px" }}>{title}</p>;
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ background:`${color}26`, color, fontSize:10, fontWeight:700, padding:"3px 7px", borderRadius:8 }}>
      {label}
    </span>
  );
}

function PriceChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background:`${color}14`, border:`1px solid ${color}33`, borderRadius:10, padding:"5px 10px", textAlign:"center" }}>
      <div style={{ color, fontWeight:700, fontSize:12 }}>{value}</div>
      <div style={{ color:"rgba(255,255,255,0.38)", fontSize:9 }}>{label}</div>
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"40vh", gap:12 }}>
      <Package size={48} color="rgba(255,255,255,0.12)" />
      <p style={{ color:"rgba(255,255,255,0.38)", fontSize:15 }}>{msg}</p>
    </div>
  );
}

const iconBtnW: React.CSSProperties = {
  background:"rgba(255,255,255,0.08)", border:"none", borderRadius:8,
  width:34, height:34, cursor:"pointer", color:"#fff",
  display:"flex", alignItems:"center", justifyContent:"center",
};