"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot,
} from "firebase/firestore";

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface UserSession {
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  permissions: Record<string, boolean>;
}

interface Vente {
  id?: string;
  billNo?: string;
  marque?: string;
  modele?: string;
  model?: string;
  categorie?: string;
  category?: string;
  prixVente?: number;
  prixAchat?: number;
  commission?: number;
  benefis?: number;
  gainTotal?: number;
  qty?: number;
  date?: string;
  annule?: boolean;
}

interface Vendeur {
  id: string;
  nom: string;
  balance: number;
  ventes: Vente[];
  localId?: string;
}

const COLORS = [
  "#00C853","#2979FF","#FF6D00","#D500F9",
  "#FF1744","#00BCD4","#FFD600","#76FF03",
];
const colorOf = (i: number) => COLORS[i % COLORS.length];

const fmt = (d?: string) => {
  if (!d) return "";
  try {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()}  ${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}`;
  } catch { return ""; }
};

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function VendeursPage() {
  const router = useRouter();
  const [user, setUser]         = useState<UserSession | null>(null);
  const [vendeurs, setVendeurs] = useState<Vendeur[]>([]);
  const [commission, setCommission] = useState<Record<string,number>>({
    Phone: 10, Ordinateur: 20, Desktop: 20, Accessoire: 5,
  });
  const [tab, setTab]           = useState<"dashboard"|"vendeurs">("dashboard");
  const [loading, setLoading]   = useState(true);
  const [selectedVendeur, setSelectedVendeur] = useState<{v:Vendeur,color:string}|null>(null);
  const [showAddModal, setShowAddModal]       = useState(false);
  const [showCommModal, setShowCommModal]     = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState<Vendeur|null>(null);
  const [showPayModal, setShowPayModal]       = useState<Vendeur|null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<Vendeur|null>(null);
  const [newNom, setNewNom]     = useState("");
  const [newBalance, setNewBalance] = useState("");
  const [localId, setLocalId]   = useState("all");

  // ─── AUTH ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const session = JSON.parse(raw) as UserSession;
      if (!session.isAdmin && !session.permissions?.vendeurVoir) {
        router.push("/dashboard"); return;
      }
      setUser(session);
      const lid = session.localId === "all" ? "all" : session.localId;
      setLocalId(lid);
    } catch { router.push("/login"); }
  }, [router]);

  // ─── LOAD COMMISSION ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "locals", "all")).then(snap => {
      if (snap.exists() && snap.data()?.commission) {
        setCommission(snap.data()!.commission);
      }
    }).catch(() => {});
  }, [user]);

  // ─── LOAD VENDEURS ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const colRef = collection(db, "locals", localId, "vendeurs");
    const unsub = onSnapshot(colRef, snap => {
      const list: Vendeur[] = [];
      snap.forEach(d => {
        const data = d.data();
        list.push({
          id:      d.id,
          nom:     data.nom ?? "",
          balance: Number(data.balance ?? 0),
          ventes:  data.ventes ?? [],
          localId: data.localId,
        });
      });
      setVendeurs(list);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [user, localId]);

  // ─── STATS ───────────────────────────────────────────────────────────────
  const totalGlobal = vendeurs.reduce((s,v) => s + v.balance, 0);
  const sorted = useMemo(() =>
    [...vendeurs].sort((a,b) => b.balance - a.balance), [vendeurs]);
  const maxBalance = sorted[0]?.balance ?? 1;

  // ─── ACTIONS ─────────────────────────────────────────────────────────────
  const addVendeur = async () => {
    if (!newNom.trim()) return;
    const v: Vendeur = {
      id:      Date.now().toString(),
      nom:     newNom.trim(),
      balance: 0,
      ventes:  [],
      localId,
    };
    await setDoc(doc(db, "locals", localId, "vendeurs", v.id), v);
    setNewNom(""); setShowAddModal(false);
  };

  const payVendeur = async (v: Vendeur) => {
    await setDoc(doc(db, "locals", localId, "vendeurs", v.id),
      { ...v, balance: 0 });
    setShowPayModal(null);
  };

  const saveBalance = async (v: Vendeur) => {
    const val = parseFloat(newBalance);
    if (isNaN(val)) return;
    await setDoc(doc(db, "locals", localId, "vendeurs", v.id),
      { ...v, balance: val });
    setShowBalanceModal(null); setNewBalance("");
  };

  const deleteVendeur = async (v: Vendeur) => {
    await deleteDoc(doc(db, "locals", localId, "vendeurs", v.id));
    setShowDeleteModal(null);
  };

  const removeVente = async (v: Vendeur, vente: Vente) => {
    const newVentes = v.ventes.filter(x =>
      !(x.billNo === vente.billNo && x.id === vente.id));
    const gain = Number(vente.gainTotal ?? 0);
    const newBal = Math.max(0, v.balance - gain);
    await setDoc(doc(db, "locals", localId, "vendeurs", v.id),
      { ...v, ventes: newVentes, balance: newBal });
    setSelectedVendeur(prev =>
      prev ? { ...prev, v: { ...prev.v, ventes: newVentes, balance: newBal } } : null);
  };

  const saveCommission = async (comm: Record<string,number>) => {
    setCommission(comm);
    await setDoc(doc(db, "locals", "all"), { commission: comm }, { merge: true });
    setShowCommModal(false);
  };

  if (loading || !user) return (
    <main style={{ minHeight:"100vh", background:"#0F1117", display:"flex",
      alignItems:"center", justifyContent:"center", fontFamily:"'Segoe UI',sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:48, height:48, border:"4px solid #333",
          borderTop:"4px solid #00C853", borderRadius:"50%",
          animation:"spin 1s linear infinite", margin:"0 auto 16px" }}/>
        <p style={{ color:"#888" }}>Chajman...</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </main>
  );

  return (
    <main style={{ minHeight:"100vh", background:"#0F1117",
      fontFamily:"'Segoe UI',sans-serif", color:"#fff" }}>

      {/* ── HEADER ── */}
      <div style={{ background:"#0F1117", borderBottom:"1px solid #1e1e2e",
        padding:"14px 20px", display:"flex", alignItems:"center",
        justifyContent:"space-between", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <button onClick={() => router.push("/dashboard")}
            style={{ background:"#1A1D2E", border:"none", color:"#aaa",
              padding:"8px 14px", borderRadius:10, cursor:"pointer", fontSize:13 }}>
            ← Retounen
          </button>
          <h1 style={{ margin:0, fontSize:20, fontWeight:700 }}>Vendeurs</h1>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {user.isAdmin && (
            <button onClick={() => setShowCommModal(true)}
              style={{ background:"#1A1D2E", border:"1px solid #333",
                color:"#aaa", padding:"8px 14px", borderRadius:10,
                cursor:"pointer", fontSize:13 }}>
              ⚙️ Komisyon
            </button>
          )}
          {user.isAdmin && (
            <button onClick={() => setShowAddModal(true)}
              style={{ background:"rgba(0,200,83,0.15)", border:"1px solid #00C853",
                color:"#00C853", padding:"8px 14px", borderRadius:10,
                cursor:"pointer", fontSize:13, fontWeight:700 }}>
              + Ajoute
            </button>
          )}
        </div>
      </div>

      {/* ── TABS ── */}
      <div style={{ display:"flex", borderBottom:"1px solid #1e1e2e",
        background:"#0F1117" }}>
        {(["dashboard","vendeurs"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex:1, padding:"14px", border:"none", background:"none",
              color: tab===t ? "#00C853" : "#555", fontWeight:700, fontSize:13,
              cursor:"pointer", borderBottom: tab===t ? "2px solid #00C853" : "2px solid transparent",
              transition:"all 0.2s" }}>
            {t === "dashboard" ? "DASHBOARD" : "VENDEURS"}
          </button>
        ))}
      </div>

      {/* ── CONTENT ── */}
      <div style={{ maxWidth:860, margin:"0 auto", padding:"24px 16px" }}>

        {/* ═══════════════ DASHBOARD TAB ═══════════════ */}
        {tab === "dashboard" && (
          vendeurs.length === 0 ? (
            <div style={{ textAlign:"center", marginTop:80 }}>
              <div style={{ fontSize:64, opacity:0.2 }}>👥</div>
              <p style={{ color:"#555", marginTop:12 }}>Ajoute vendeur pou wè dashboard</p>
            </div>
          ) : (
            <>
              {/* Total Global */}
              <div style={{ background:"linear-gradient(135deg,#00C853,#009624)",
                borderRadius:20, padding:24, marginBottom:24,
                boxShadow:"0 8px 20px rgba(0,200,83,0.3)",
                display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <p style={{ margin:0, color:"rgba(255,255,255,0.7)", fontSize:11,
                    letterSpacing:1.5, fontWeight:700 }}>TOTAL GLOBAL À PAYER</p>
                  <p style={{ margin:"8px 0 4px", fontSize:36, fontWeight:700, color:"#fff" }}>
                    ${totalGlobal.toFixed(2)}
                  </p>
                  <p style={{ margin:0, color:"rgba(255,255,255,0.7)", fontSize:12 }}>
                    {vendeurs.length} vendeur{vendeurs.length>1?"s":""}
                  </p>
                </div>
                <div style={{ width:60, height:60, borderRadius:"50%",
                  background:"rgba(255,255,255,0.2)",
                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:28 }}>
                  💰
                </div>
              </div>

              {/* Bar Chart */}
              <p style={{ margin:"0 0 12px", fontWeight:700, fontSize:14 }}>Balans pa Vendeur</p>
              <div style={{ background:"#1A1D2E", borderRadius:16, padding:20,
                marginBottom:24, overflowX:"auto" }}>
                <div style={{ display:"flex", alignItems:"flex-end", gap:12,
                  height:160, minWidth: sorted.length * 60 }}>
                  {sorted.map((v,i) => {
                    const h = maxBalance > 0 ? (v.balance / maxBalance) * 130 : 4;
                    return (
                      <div key={v.id} style={{ flex:1, display:"flex",
                        flexDirection:"column", alignItems:"center", gap:6, minWidth:50 }}>
                        <span style={{ color:colorOf(i), fontSize:10, fontWeight:700 }}>
                          ${v.balance.toFixed(0)}
                        </span>
                        <div style={{ width:"100%", height:h, background:colorOf(i),
                          borderRadius:"6px 6px 0 0", minHeight:4,
                          transition:"height 0.5s" }}/>
                        <span style={{ color:colorOf(i), fontSize:9, fontWeight:700,
                          textAlign:"center", maxWidth:50, overflow:"hidden",
                          textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {v.nom.length>6 ? v.nom.substring(0,6) : v.nom}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Klasman */}
              <p style={{ margin:"0 0 12px", fontWeight:700, fontSize:14 }}>Klasman Vendeur</p>
              {sorted.map((v,i) => {
                const color = colorOf(i);
                const activeVentes = v.ventes.filter(t => !t.annule);
                const totalGagne = activeVentes.reduce((s,t) => s+Number(t.gainTotal??0),0);
                return (
                  <div key={v.id} onClick={() => setSelectedVendeur({v,color})}
                    style={{ background:"#1A1D2E", borderRadius:16, padding:16,
                      marginBottom:10, border:`1px solid ${color}33`, cursor:"pointer",
                      display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ width:32, height:32, borderRadius:"50%",
                      background:`${color}33`, display:"flex", alignItems:"center",
                      justifyContent:"center", color, fontWeight:700, flexShrink:0 }}>
                      {i+1}
                    </div>
                    <div style={{ flex:1 }}>
                      <p style={{ margin:0, fontWeight:700, fontSize:14 }}>{v.nom}</p>
                      <p style={{ margin:"2px 0 0", color:"#555", fontSize:11 }}>
                        {activeVentes.length} vant • Total gagnen: ${totalGagne.toFixed(2)}
                      </p>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <p style={{ margin:0, color, fontWeight:700, fontSize:15 }}>
                        ${v.balance.toFixed(2)}
                      </p>
                      {user.isAdmin && (
                        <div style={{ display:"flex", gap:6, marginTop:4, justifyContent:"flex-end" }}>
                          {v.balance > 0 && (
                            <button onClick={e => { e.stopPropagation(); setShowPayModal(v); }}
                              style={{ background:"rgba(0,200,83,0.2)", border:"none",
                                color:"#00C853", padding:"2px 8px", borderRadius:8,
                                cursor:"pointer", fontSize:10, fontWeight:700 }}>
                              Peye
                            </button>
                          )}
                          <button onClick={e => { e.stopPropagation(); setShowBalanceModal(v); setNewBalance(v.balance.toString()); }}
                            style={{ background:"rgba(255,165,0,0.2)", border:"none",
                              color:"orange", padding:"2px 8px", borderRadius:8,
                              cursor:"pointer", fontSize:10, fontWeight:700 }}>
                            Modifye
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )
        )}

        {/* ═══════════════ VENDEURS TAB ═══════════════ */}
        {tab === "vendeurs" && (
          vendeurs.length === 0 ? (
            <div style={{ textAlign:"center", marginTop:80 }}>
              <div style={{ fontSize:64, opacity:0.2 }}>👥</div>
              <p style={{ color:"#555" }}>Pa gen vendeur toujou</p>
              {user.isAdmin && (
                <button onClick={() => setShowAddModal(true)}
                  style={{ background:"#00C853", border:"none", color:"#fff",
                    padding:"12px 24px", borderRadius:12, cursor:"pointer",
                    fontSize:14, fontWeight:700, marginTop:16 }}>
                  + Ajoute Vendeur
                </button>
              )}
            </div>
          ) : (
            vendeurs.map((v,i) => {
              const color = colorOf(i);
              const active = v.ventes.filter(t => !t.annule);
              const totalKom = active.reduce((s,t) => s+Number(t.commission??0),0);
              const totalBen = active.reduce((s,t) => s+Number(t.benefis??0),0);
              return (
                <div key={v.id} style={{ background:"#1A1D2E", borderRadius:20,
                  padding:16, marginBottom:12, border:`1px solid ${color}22` }}>
                  {/* Row 1 */}
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                    <div style={{ width:44, height:44, borderRadius:"50%",
                      background:`${color}22`, display:"flex", alignItems:"center",
                      justifyContent:"center", color, fontWeight:700, fontSize:18, flexShrink:0 }}>
                      {v.nom[0]?.toUpperCase()}
                    </div>
                    <div style={{ flex:1 }}>
                      <p style={{ margin:0, fontWeight:700, fontSize:15 }}>{v.nom}</p>
                      <p style={{ margin:"2px 0 0", color:"#555", fontSize:12 }}>{active.length} vant</p>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <p style={{ margin:0, color, fontWeight:700, fontSize:16 }}>
                        ${v.balance.toFixed(2)}
                      </p>
                      <p style={{ margin:0, color:"#444", fontSize:10 }}>pou peye</p>
                    </div>
                  </div>
                  {/* Stats */}
                  <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                    {[
                      { label:"Benefis", val:`$${totalBen.toFixed(2)}`, color:"#00e676" },
                      { label:"Komisyon", val:`$${totalKom.toFixed(2)}`, color:"orange" },
                      { label:"Total", val:`$${(totalBen+totalKom).toFixed(2)}`, color },
                    ].map(s => (
                      <div key={s.label} style={{ flex:1, background:`${s.color}18`,
                        border:`1px solid ${s.color}44`, borderRadius:12,
                        padding:"8px 4px", textAlign:"center" }}>
                        <p style={{ margin:0, color:s.color, fontWeight:700, fontSize:13 }}>{s.val}</p>
                        <p style={{ margin:0, color:"#444", fontSize:10 }}>{s.label}</p>
                      </div>
                    ))}
                  </div>
                  {/* Actions */}
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {v.balance > 0 && user.isAdmin && (
                      <button onClick={() => setShowPayModal(v)}
                        style={{ flex:1, background:"rgba(0,200,83,0.15)",
                          border:"1px solid #00C853", color:"#00C853",
                          padding:"8px", borderRadius:10, cursor:"pointer",
                          fontSize:13, fontWeight:700, display:"flex",
                          alignItems:"center", justifyContent:"center", gap:6 }}>
                        💵 Peye
                      </button>
                    )}
                    {user.isAdmin && (
                      <button onClick={() => { setShowBalanceModal(v); setNewBalance(v.balance.toString()); }}
                        style={{ flex:1, background:"rgba(255,165,0,0.15)",
                          border:"1px solid orange", color:"orange",
                          padding:"8px", borderRadius:10, cursor:"pointer",
                          fontSize:13, fontWeight:700 }}>
                        ✏️ Balance
                      </button>
                    )}
                    <button onClick={() => setSelectedVendeur({v,color})}
                      style={{ flex:1, background:"none",
                        border:`1px solid ${color}66`, color,
                        padding:"8px", borderRadius:10, cursor:"pointer",
                        fontSize:13, fontWeight:700 }}>
                      👁 Wè Vant
                    </button>
                    {user.isAdmin && (
                      <button onClick={() => setShowDeleteModal(v)}
                        style={{ background:"rgba(255,0,0,0.1)", border:"1px solid #ff000044",
                          color:"#ff4444", padding:"8px 12px", borderRadius:10,
                          cursor:"pointer", fontSize:13 }}>
                        🗑
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )
        )}
      </div>

      {/* ═══════════════ MODAL: WÈ VANT ═══════════════ */}
      {selectedVendeur && (() => {
        const { v, color } = selectedVendeur;
        const active = v.ventes.filter(t => !t.annule);
        const totalKom = active.reduce((s,t) => s+Number(t.commission??0),0);
        const totalBen = active.reduce((s,t) => s+Number(t.benefis??0),0);
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)",
            zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
            onClick={() => setSelectedVendeur(null)}>
            <div onClick={e => e.stopPropagation()}
              style={{ background:"#1A1D2E", borderRadius:"20px 20px 0 0",
                width:"100%", maxWidth:700, maxHeight:"85vh",
                display:"flex", flexDirection:"column", overflow:"hidden" }}>
              {/* Handle */}
              <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
                <div style={{ width:40, height:4, background:"#333", borderRadius:2 }}/>
              </div>
              {/* Header */}
              <div style={{ padding:"16px 20px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                  <div style={{ width:48, height:48, borderRadius:"50%",
                    background:`${color}22`, display:"flex", alignItems:"center",
                    justifyContent:"center", color, fontWeight:700, fontSize:20 }}>
                    {v.nom[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p style={{ margin:0, fontWeight:700, fontSize:16 }}>{v.nom}</p>
                    <p style={{ margin:0, color:"#555", fontSize:12 }}>{active.length} vant</p>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  {[
                    { label:"Benefis", val:`$${totalBen.toFixed(2)}`, c:"#00e676" },
                    { label:"Komisyon", val:`$${totalKom.toFixed(2)}`, c:"orange" },
                    { label:"Total", val:`$${(totalBen+totalKom).toFixed(2)}`, c:color },
                  ].map(s => (
                    <div key={s.label} style={{ flex:1, background:`${s.c}18`,
                      border:`1px solid ${s.c}44`, borderRadius:12,
                      padding:"8px 4px", textAlign:"center" }}>
                      <p style={{ margin:0, color:s.c, fontWeight:700, fontSize:13 }}>{s.val}</p>
                      <p style={{ margin:0, color:"#444", fontSize:10 }}>{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ height:1, background:"#ffffff11" }}/>
              {/* Lis vant */}
              <div style={{ overflowY:"auto", flex:1, padding:"12px 16px" }}>
                {active.length === 0 ? (
                  <p style={{ textAlign:"center", color:"#444", marginTop:40 }}>Pa gen vant toujou</p>
                ) : (
                  [...active].reverse().map((t,i) => {
                    const kom = Number(t.commission??0);
                    const ben = Number(t.benefis??0);
                    const pv  = Number(t.prixVente??0);
                    const pa  = Number(t.prixAchat??0);
                    const qty = Number(t.qty??1);
                    const cat = t.categorie ?? t.category ?? "";
                    return (
                      <div key={i} style={{ background:"rgba(255,255,255,0.03)",
                        border:`1px solid ${color}18`, borderRadius:14,
                        padding:12, marginBottom:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between",
                          alignItems:"flex-start", marginBottom:6 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, flex:1 }}>
                            <div style={{ width:8, height:8, borderRadius:"50%",
                              background:color, flexShrink:0 }}/>
                            {t.id && (
                              <span style={{ background:"rgba(255,165,0,0.1)", color:"orange",
                                fontSize:9, padding:"2px 6px", borderRadius:6, fontWeight:700 }}>
                                ID: {t.id}
                              </span>
                            )}
                            <span style={{ fontWeight:700, fontSize:13 }}>
                              {t.marque} {t.modele ?? t.model}
                            </span>
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <span style={{ color, fontWeight:700, fontSize:13 }}>
                              ${(kom+ben).toFixed(2)}
                            </span>
                            {user.isAdmin && (
                              <button onClick={() => removeVente(v, t)}
                                style={{ background:"rgba(255,0,0,0.15)", border:"none",
                                  color:"#ff4444", width:24, height:24, borderRadius:"50%",
                                  cursor:"pointer", fontSize:12, display:"flex",
                                  alignItems:"center", justifyContent:"center" }}>
                                🗑
                              </button>
                            )}
                          </div>
                        </div>
                        {cat && (
                          <p style={{ margin:"0 0 4px", color:"#00BCD4", fontSize:11 }}>📦 {cat}</p>
                        )}
                        <p style={{ margin:"0 0 4px", color:"#444", fontSize:10 }}>
                          🕐 {fmt(t.date)} &nbsp;&nbsp; 🧾 #{t.billNo} &nbsp;&nbsp; Qty: {qty}
                        </p>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                          {[
                            { label:`Achat: $${pa.toFixed(2)}`, c:"#555" },
                            { label:`Vente: $${pv.toFixed(2)}`, c:"#888" },
                            { label:`Ben: $${ben.toFixed(2)}`, c:"#00C853" },
                            { label:`Kom: $${kom.toFixed(2)}`, c:"orange" },
                            { label:`Total: $${(ben+kom).toFixed(2)}`, c:color },
                          ].map(b => (
                            <span key={b.label} style={{ background:`${b.c}22`,
                              color:b.c, fontSize:10, padding:"2px 6px",
                              borderRadius:6, fontWeight:700 }}>
                              {b.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════ MODAL: AJOUTE VENDEUR ═══════════════ */}
      {showAddModal && (
        <Modal title="Ajoute Vendeur" onClose={() => setShowAddModal(false)}>
          <input value={newNom} onChange={e => setNewNom(e.target.value)}
            placeholder="Non Vendeur" autoFocus
            style={inputStyle} />
          <div style={{ display:"flex", gap:8, marginTop:16 }}>
            <button onClick={() => setShowAddModal(false)} style={btnSecondary}>Anile</button>
            <button onClick={addVendeur} style={btnPrimary("#00C853")}>Ajoute</button>
          </div>
        </Modal>
      )}

      {/* ═══════════════ MODAL: PEYE ═══════════════ */}
      {showPayModal && (
        <Modal title="Peye Vendeur?" onClose={() => setShowPayModal(null)}>
          <p style={{ color:"#888", margin:"0 0 16px" }}>
            Peye ${showPayModal.balance.toFixed(2)} bay {showPayModal.nom}?
          </p>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => setShowPayModal(null)} style={btnSecondary}>Non</button>
            <button onClick={() => payVendeur(showPayModal)} style={btnPrimary("#00C853")}>Wi, Paye</button>
          </div>
        </Modal>
      )}

      {/* ═══════════════ MODAL: MODIFYE BALANCE ═══════════════ */}
      {showBalanceModal && (
        <Modal title={`Balance — ${showBalanceModal.nom}`} onClose={() => setShowBalanceModal(null)}>
          <p style={{ color:"#888", margin:"0 0 12px" }}>
            Balance aktyèl: ${showBalanceModal.balance.toFixed(2)}
          </p>
          <input value={newBalance} onChange={e => setNewBalance(e.target.value)}
            placeholder="Nouvo Balance ($)" type="number" autoFocus style={inputStyle} />
          <div style={{ display:"flex", gap:8, marginTop:16 }}>
            <button onClick={() => setShowBalanceModal(null)} style={btnSecondary}>Anile</button>
            <button onClick={() => saveBalance(showBalanceModal)} style={btnPrimary("orange")}>Sove</button>
          </div>
        </Modal>
      )}

      {/* ═══════════════ MODAL: EFASE ═══════════════ */}
      {showDeleteModal && (
        <Modal title="Efase Vendeur?" onClose={() => setShowDeleteModal(null)}>
          <p style={{ color:"#888", margin:"0 0 16px" }}>{showDeleteModal.nom}</p>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => setShowDeleteModal(null)} style={btnSecondary}>Non</button>
            <button onClick={() => deleteVendeur(showDeleteModal)} style={btnPrimary("#ff4444")}>Wi, Efase</button>
          </div>
        </Modal>
      )}

      {/* ═══════════════ MODAL: KOMISYON ═══════════════ */}
      {showCommModal && (
        <CommissionModal
          commission={commission}
          onClose={() => setShowCommModal(false)}
          onSave={saveCommission}
        />
      )}
    </main>
  );
}

// ─── COMMISSION MODAL ────────────────────────────────────────────────────────
function CommissionModal({ commission, onClose, onSave }: {
  commission: Record<string,number>;
  onClose: () => void;
  onSave: (c: Record<string,number>) => void;
}) {
  const [local, setLocal] = useState<Record<string,number>>({ ...commission });
  const [newCat, setNewCat] = useState("");
  const [newVal, setNewVal] = useState("");

  return (
    <Modal title="⚙️ Komisyon pa Kategori" onClose={onClose}>
      <div style={{ maxHeight:300, overflowY:"auto" }}>
        {Object.entries(local).map(([cat, val]) => (
          <div key={cat} style={{ display:"flex", alignItems:"center",
            gap:8, marginBottom:10 }}>
            <span style={{ flex:1, color:"#fff", fontSize:14 }}>{cat}</span>
            <input type="number"
              value={val}
              onChange={e => setLocal(p => ({ ...p, [cat]: Number(e.target.value) }))}
              style={{ ...inputStyle, width:100, textAlign:"center", margin:0 }}/>
            <button onClick={() => setLocal(p => { const n={...p}; delete n[cat]; return n; })}
              style={{ background:"rgba(255,0,0,0.15)", border:"none",
                color:"#ff4444", width:28, height:28, borderRadius:"50%",
                cursor:"pointer", fontSize:14 }}>
              −
            </button>
          </div>
        ))}
        <div style={{ height:1, background:"#ffffff11", margin:"12px 0" }}/>
        <p style={{ color:"#555", fontSize:12, margin:"0 0 8px" }}>Ajoute Kategori</p>
        <div style={{ display:"flex", gap:8 }}>
          <input value={newCat} onChange={e => setNewCat(e.target.value)}
            placeholder="Non (ex: Tablette)" style={{ ...inputStyle, flex:1, margin:0 }}/>
          <input value={newVal} onChange={e => setNewVal(e.target.value)}
            placeholder="$" type="number" style={{ ...inputStyle, width:70, margin:0 }}/>
          <button onClick={() => {
            if (!newCat.trim()) return;
            setLocal(p => ({ ...p, [newCat.trim()]: Number(newVal)||0 }));
            setNewCat(""); setNewVal("");
          }} style={{ background:"rgba(0,200,83,0.2)", border:"none",
            color:"#00C853", width:32, height:32, borderRadius:"50%",
            cursor:"pointer", fontSize:18 }}>+</button>
        </div>
      </div>
      <div style={{ display:"flex", gap:8, marginTop:16 }}>
        <button onClick={onClose} style={btnSecondary}>Anile</button>
        <button onClick={() => onSave(local)} style={btnPrimary("#00C853")}>Sove</button>
      </div>
    </Modal>
  );
}

// ─── MODAL WRAPPER ───────────────────────────────────────────────────────────
function Modal({ title, children, onClose }: {
  title: string; children: React.ReactNode; onClose: () => void;
}) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)",
      zIndex:300, display:"flex", alignItems:"center", justifyContent:"center",
      padding:20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:"#1A1D2E", borderRadius:20, padding:24,
          width:"100%", maxWidth:420, boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>
        <h2 style={{ margin:"0 0 20px", fontSize:18, fontWeight:700 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width:"100%", padding:"12px 14px", background:"rgba(255,255,255,0.06)",
  border:"1px solid #333", borderRadius:12, color:"#fff", fontSize:14,
  outline:"none", boxSizing:"border-box", fontFamily:"'Segoe UI',sans-serif",
};
const btnPrimary = (bg: string): React.CSSProperties => ({
  flex:1, padding:"12px", background:bg, border:"none", color:"#fff",
  borderRadius:12, cursor:"pointer", fontSize:14, fontWeight:700,
});
const btnSecondary: React.CSSProperties = {
  flex:1, padding:"12px", background:"rgba(255,255,255,0.06)",
  border:"1px solid #333", color:"#aaa", borderRadius:12,
  cursor:"pointer", fontSize:14,
};