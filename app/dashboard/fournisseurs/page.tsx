"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import {
  collection, doc, getDoc, setDoc, deleteDoc, onSnapshot, getDocs,
} from "firebase/firestore";

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface UserSession {
  username: string; displayName: string;
  isAdmin: boolean; localId: string;
  permissions: Record<string, boolean>;
}
interface Product {
  id: string; marque: string; modele: string;
  category: string; prixAchat: number; prixVente: number;
  prixDealer: number; nomDealer: string; serialImei: string;
  isDeleted: boolean; benefisManuel?: number;
}
interface Facture {
  id: string; clientNom: string; date: string;
  billNo: string; annule: boolean;
  lignes: { productId: string; prix: number }[];
}

// ─── COLORS ──────────────────────────────────────────────────────────────────
const C = {
  dark:   "#0A0C14", card:  "#141828", card2: "#1C2035",
  accent: "#FF6B35", green: "#00E676", red:   "#FF5252",
  blue:   "#448AFF", gold:  "#FFD740",
};

const fmt = (v: number) =>
  v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(0);

const fmtDate = (raw?: string) => {
  if (!raw) return "";
  try {
    const dt = new Date(raw);
    return `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()}`;
  } catch { return ""; }
};

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function FournisseursPage() {
  const router = useRouter();
  const [user, setUser]           = useState<UserSession | null>(null);
  const [products, setProducts]   = useState<Product[]>([]);
  const [factures, setFactures]   = useState<Facture[]>([]);
  const [commissions, setCommissions] = useState<Record<string,number>>({});
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState<"dealers"|"resume">("dealers");
  const [localId, setLocalId]     = useState("all");
  const [snack, setSnack]         = useState<{msg:string;color:string}|null>(null);

  // Modals
  const [detailDealer, setDetailDealer] = useState<string|null>(null);
  const [showCommModal, setShowCommModal] = useState(false);

  // ─── AUTH ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const s = JSON.parse(raw) as UserSession;
      if (!s.isAdmin && !s.permissions?.fournisseurVoir) {
        router.push("/dashboard"); return;
      }
      setUser(s);
      setLocalId(s.localId === "all" ? "all" : s.localId);
    } catch { router.push("/login"); }
  }, [router]);

  // ─── LOAD ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    // Komisyon
    getDoc(doc(db, "config", `commissions_${localId}`)).then(snap => {
      if (snap.exists()) {
        const data = snap.data() ?? {};
        const comm: Record<string,number> = {};
        Object.entries(data).forEach(([k,v]) => {
          if (k !== "updatedAt") comm[k.toLowerCase()] = Number(v);
        });
        setCommissions(comm);
      }
    });

    // Products — si admin wè tout lokal
    const loadProducts = async () => {
      if (user.isAdmin) {
        const locSnap = await getDocs(collection(db, "locals"));
        const allProds: Product[] = [];
        for (const ld of locSnap.docs) {
          if (ld.id === "all") continue;
          const pSnap = await getDocs(collection(db, "locals", ld.id, "products"));
          pSnap.forEach(d => allProds.push({ ...d.data(), id: d.id } as Product));
        }
        // Tou pran nan "all" tou
        const allSnap = await getDocs(collection(db, "locals", "all", "products"));
        allSnap.forEach(d => allProds.push({ ...d.data(), id: d.id } as Product));
        setProducts(allProds.filter(p => !p.isDeleted && p.nomDealer?.trim()));
      } else {
        const pSnap = await getDocs(collection(db, "locals", localId, "products"));
        const list: Product[] = [];
        pSnap.forEach(d => list.push({ ...d.data(), id: d.id } as Product));
        setProducts(list.filter(p => !p.isDeleted && p.nomDealer?.trim()));
      }
    };

    // Factures
    const loadFactures = async () => {
      const fSnap = await getDocs(collection(db, "locals", localId, "factures"));
      const list: Facture[] = [];
      fSnap.forEach(d => list.push({ ...d.data(), id: d.id } as Facture));
      setFactures(list.filter(f => !f.annule));
    };

    Promise.all([loadProducts(), loadFactures()]).then(() => setLoading(false));

    // Realtime products
    const unsub = onSnapshot(
      collection(db, "locals", localId, "products"),
      snap => {
        const list: Product[] = [];
        snap.forEach(d => list.push({ ...d.data(), id: d.id } as Product));
        setProducts(list.filter(p => !p.isDeleted && p.nomDealer?.trim()));
      }
    );
    return () => unsub();
  }, [user, localId]);

  const showSnack = (msg: string, color: string) => {
    setSnack({ msg, color });
    setTimeout(() => setSnack(null), 2500);
  };

  // ─── KOMISYON ────────────────────────────────────────────────────────────
  const komisyon = (cat: string) => commissions[cat.toLowerCase()] ?? 0;

  const saveCommission = async (comm: Record<string,number>) => {
    setCommissions(comm);
    await setDoc(doc(db, "config", `commissions_${localId}`), {
      ...comm, updatedAt: new Date().toISOString(),
    });
    setShowCommModal(false);
    showSnack("✅ Komisyon sove!", C.accent);
  };

  // ─── VANT ────────────────────────────────────────────────────────────────
  const getVant = (productId: string) => {
    for (const fac of factures) {
      for (const l of fac.lignes ?? []) {
        if (l.productId === productId) {
          return { prixVant: l.prix, clientNom: fac.clientNom,
            date: fac.date, billNo: fac.billNo, facId: fac.id };
        }
      }
    }
    return null;
  };

  const calcBenefis = (p: Product) => {
    const vant = getVant(p.id);
    if (!vant) return 0;
    const pf = vant.prixVant;
    const ps = Number(p.prixAchat ?? 0);
    const pd = Number(p.prixDealer ?? 0);
    const kom = komisyon(p.category);
    if (pf < ps) return 0;
    const ben = ps - pd - kom;
    return ben < 0 ? 0 : ben;
  };

  const calcPert = (p: Product) => {
    const vant = getVant(p.id);
    if (!vant) return 0;
    const pf = vant.prixVant;
    const pd = Number(p.prixDealer ?? 0);
    const kom = komisyon(p.category);
    if (pf <= pd) return kom;
    return 0;
  };

  // ─── DEALERS ─────────────────────────────────────────────────────────────
  const byDealer = useMemo(() => {
    const map: Record<string, Product[]> = {};
    for (const p of products) {
      const dealer = p.nomDealer?.trim();
      if (!dealer) continue;
      if (!map[dealer]) map[dealer] = [];
      map[dealer].push(p);
    }
    return map;
  }, [products]);

  const statsDealer = (prods: Product[]) => {
    let totPrixDealer=0, totBenefis=0, totPert=0, vendu=0;
    for (const p of prods) {
      totPrixDealer += Number(p.prixDealer ?? 0);
      const vant = getVant(p.id);
      if (vant) {
        totBenefis += calcBenefis(p);
        totPert    += calcPert(p);
        vendu++;
      }
    }
    return { totPrixDealer, totBenefis, totPert,
      benefisNet: totBenefis - totPert, vendu, total: prods.length };
  };

  // ─── GLOBAL STATS ────────────────────────────────────────────────────────
  const globalStats = useMemo(() => {
    let totEnvesti=0, totBenefis=0, totPert=0, totVendu=0, totProd=0;
    Object.values(byDealer).forEach(prods => {
      const s = statsDealer(prods);
      totEnvesti += s.totPrixDealer;
      totBenefis += s.totBenefis;
      totPert    += s.totPert;
      totVendu   += s.vendu;
      totProd    += s.total;
    });
    return { totEnvesti, totBenefis, totPert,
      benefisNet: totBenefis-totPert, totVendu, totProd };
  }, [byDealer, factures, commissions]);

  if (loading || !user) return (
    <main style={{ minHeight:"100vh", background:C.dark, display:"flex",
      alignItems:"center", justifyContent:"center" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:48, height:48, border:`4px solid #333`,
          borderTop:`4px solid ${C.accent}`, borderRadius:"50%",
          animation:"spin 1s linear infinite", margin:"0 auto 16px" }}/>
        <p style={{ color:"#888" }}>Chajman...</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </main>
  );

  const dealerEntries = Object.entries(byDealer);
  const dealerDetail = detailDealer ? byDealer[detailDealer] ?? [] : [];

  return (
    <main style={{ minHeight:"100vh", background:C.dark,
      fontFamily:"'Segoe UI',sans-serif", color:"#fff" }}>

      {/* ── HEADER ── */}
      <div style={{ background:C.card, borderBottom:`1px solid #ffffff0a`,
        padding:"14px 20px", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center",
          justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <button onClick={() => router.push("/dashboard")}
              style={{ background:"#ffffff18", border:"none", color:"#aaa",
                padding:"8px 14px", borderRadius:10, cursor:"pointer", fontSize:13 }}>
              ← Retounen
            </button>
            <h1 style={{ margin:0, fontSize:20, fontWeight:700 }}>Dealers</h1>
          </div>
          {user.isAdmin && (
            <button onClick={() => setShowCommModal(true)}
              style={{ background:`${C.accent}22`, border:`1px solid ${C.accent}66`,
                color:C.accent, padding:"8px 14px", borderRadius:10,
                cursor:"pointer", fontSize:13, fontWeight:700 }}>
              % Komisyon
            </button>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", marginTop:12, gap:4 }}>
          {(["dealers","resume"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex:1, padding:"10px", border:"none",
                background: tab===t ? `${C.accent}22` : "transparent",
                color: tab===t ? C.accent : "#555",
                borderBottom: tab===t ? `2px solid ${C.accent}` : "2px solid transparent",
                fontWeight:700, fontSize:12, cursor:"pointer",
                letterSpacing:1 }}>
              {t === "dealers" ? "DEALERS" : "RÉSUMÉ"}
            </button>
          ))}
        </div>
      </div>

      {/* ── DEALERS TAB ── */}
      {tab === "dealers" && (
        <div style={{ maxWidth:860, margin:"0 auto", padding:"16px" }}>

          {/* Global stats bar */}
          {dealerEntries.length > 0 && (
            <div style={{ background:C.card, borderRadius:16, padding:"14px 8px",
              marginBottom:16, display:"flex",
              justifyContent:"space-around",
              border:"1px solid #ffffff06" }}>
              {[
                { label:"Dealers", val:`${dealerEntries.length}`, color:"#fff" },
                { label:"Vendu", val:`${globalStats.totVendu}/${globalStats.totProd}`, color:C.blue },
                { label:"Benefis", val:`$${fmt(globalStats.totBenefis)}`, color: globalStats.totBenefis>0?C.green:"#555" },
                { label:"Pèt", val:`$${fmt(globalStats.totPert)}`, color: globalStats.totPert>0?C.red:"#555" },
                { label:"Net", val:`$${fmt(globalStats.benefisNet)}`, color: globalStats.benefisNet>=0?C.green:C.red },
              ].map(s => (
                <div key={s.label} style={{ textAlign:"center" }}>
                  <p style={{ margin:0, color:s.color, fontWeight:700, fontSize:13 }}>{s.val}</p>
                  <p style={{ margin:0, color:"#444", fontSize:10 }}>{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Dealer list */}
          {dealerEntries.length === 0 ? (
            <div style={{ textAlign:"center", marginTop:80 }}>
              <div style={{ fontSize:64, opacity:0.1 }}>🤝</div>
              <p style={{ color:"#444", marginTop:12 }}>Pa gen dealer toujou</p>
              <p style={{ color:"#333", fontSize:12 }}>
                Ajoute "Nom Dealer" nan yon pwodwi pou li parèt isit
              </p>
            </div>
          ) : (
            dealerEntries.map(([nom, prods]) => {
              const s = statsDealer(prods);
              return (
                <div key={nom} onClick={() => setDetailDealer(nom)}
                  style={{ background:C.card, borderRadius:16, padding:16,
                    marginBottom:10, cursor:"pointer",
                    border:"1px solid #ffffff05",
                    display:"flex", alignItems:"center", gap:14 }}>
                  <Avatar nom={nom} size={48} />
                  <div style={{ flex:1 }}>
                    <p style={{ margin:"0 0 6px", fontWeight:700, fontSize:16 }}>{nom}</p>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      <Badge text={`${s.total} pwodwi`} color="#555" bg="#ffffff0a" />
                      <Badge text={`${s.vendu} vann`} color={C.green} bg={`${C.green}18`} />
                    </div>
                    <div style={{ display:"flex", gap:12, marginTop:6 }}>
                      {user.isAdmin && (
                        <span style={{ color:C.gold, fontSize:11, fontWeight:700 }}>
                          Env: ${fmt(s.totPrixDealer)}
                        </span>
                      )}
                      <span style={{ color: s.totBenefis>0?C.green:"#555",
                        fontSize:11, fontWeight:700 }}>
                        Ben: ${fmt(s.totBenefis)}
                      </span>
                      {s.totPert > 0 && (
                        <span style={{ color:C.red, fontSize:11, fontWeight:700 }}>
                          Pèt: ${fmt(s.totPert)}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ color:"#333" }}>›</span>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── RESUME TAB ── */}
      {tab === "resume" && (
        <div style={{ maxWidth:860, margin:"0 auto", padding:"16px" }}>
          {[
            ...(user.isAdmin ? [{ label:"Total Envesti (Dealers)", val:globalStats.totEnvesti, color:C.gold }] : []),
            { label:"Total Benefis", val:globalStats.totBenefis, color: globalStats.totBenefis>0?C.green:"#555" },
            { label:"Total Pèt", val:globalStats.totPert, color: globalStats.totPert>0?C.red:"#555" },
            { label:"Benefis Net", val:globalStats.benefisNet, color: globalStats.benefisNet>=0?C.green:C.red },
          ].map(r => (
            <div key={r.label} style={{ background:C.card, borderRadius:16,
              padding:16, marginBottom:10,
              border:`1px solid ${r.color}33`,
              display:"flex", alignItems:"center", gap:14 }}>
              <div style={{ width:44, height:44, borderRadius:"50%",
                background:`${r.color}18`, display:"flex",
                alignItems:"center", justifyContent:"center", fontSize:20 }}>
                💰
              </div>
              <span style={{ flex:1, color:"#888", fontSize:13 }}>{r.label}</span>
              <span style={{ color:r.color, fontWeight:700, fontSize:18 }}>
                ${r.val.toFixed(2)}
              </span>
            </div>
          ))}

          {dealerEntries.length > 0 && (
            <>
              <p style={{ color:"#555", fontWeight:700, fontSize:13,
                letterSpacing:1, margin:"20px 0 12px" }}>PA DEALER</p>
              {dealerEntries.map(([nom, prods]) => {
                const s = statsDealer(prods);
                return (
                  <div key={nom} onClick={() => { setDetailDealer(nom); setTab("dealers"); }}
                    style={{ background:C.card, borderRadius:14, padding:14,
                      marginBottom:8, cursor:"pointer",
                      display:"flex", alignItems:"center", gap:12 }}>
                    <Avatar nom={nom} size={40} />
                    <div style={{ flex:1 }}>
                      <p style={{ margin:0, fontWeight:700 }}>{nom}</p>
                      <p style={{ margin:0, color:"#444", fontSize:11 }}>
                        {s.vendu}/{s.total} vann
                      </p>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <p style={{ margin:0, color: s.totBenefis>0?C.green:"#555",
                        fontWeight:700, fontSize:14 }}>
                        ${fmt(s.totBenefis)}
                      </p>
                      {user.isAdmin && (
                        <p style={{ margin:0, color:"#444", fontSize:11 }}>
                          Env: ${fmt(s.totPrixDealer)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ── MODAL: DETAIL DEALER ── */}
      {detailDealer && (
        <DealerDetail
          nom={detailDealer}
          prods={dealerDetail}
          isAdmin={user.isAdmin}
          getVant={getVant}
          calcBenefis={calcBenefis}
          calcPert={calcPert}
          komisyon={komisyon}
          onClose={() => setDetailDealer(null)}
          onDeleteVant={async (facId) => {
            await deleteDoc(doc(db, "locals", localId, "factures", facId));
            const fSnap = await getDocs(collection(db, "locals", localId, "factures"));
            const list: Facture[] = [];
            fSnap.forEach(d => list.push({ ...d.data(), id: d.id } as Facture));
            setFactures(list.filter(f => !f.annule));
            showSnack("✅ Vant siprime!", C.green);
          }}
          onSaveBenefis={async (p, val) => {
            await setDoc(doc(db, "locals", localId, "products", p.id),
              { ...p, benefisManuel: val });
            showSnack("✅ Benefis mete ajou!", C.accent);
          }}
        />
      )}

      {/* ── MODAL: KOMISYON ── */}
      {showCommModal && (
        <CommissionModal
          commissions={commissions}
          categories={[...new Set(products.map(p => p.category).filter(Boolean))]}
          onClose={() => setShowCommModal(false)}
          onSave={saveCommission}
        />
      )}

      {snack && (
        <div style={{ position:"fixed", bottom:24, left:"50%",
          transform:"translateX(-50%)", background:snack.color,
          color:"#fff", padding:"12px 24px", borderRadius:12,
          fontWeight:600, fontSize:14, zIndex:999,
          boxShadow:"0 4px 20px rgba(0,0,0,0.4)", whiteSpace:"nowrap" }}>
          {snack.msg}
        </div>
      )}
    </main>
  );
}

// ─── DEALER DETAIL MODAL ──────────────────────────────────────────────────────
function DealerDetail({ nom, prods, isAdmin, getVant, calcBenefis, calcPert, komisyon, onClose, onDeleteVant, onSaveBenefis }: {
  nom: string; prods: Product[]; isAdmin: boolean;
  getVant: (id: string) => any;
  calcBenefis: (p: Product) => number;
  calcPert: (p: Product) => number;
  komisyon: (cat: string) => number;
  onClose: () => void;
  onDeleteVant: (facId: string) => void;
  onSaveBenefis: (p: Product, val: number) => void;
}) {
  const [confirmVant, setConfirmVant] = useState<any>(null);
  const [editBenefis, setEditBenefis] = useState<{p:Product;val:string}|null>(null);

  let totPrixDealer=0, totBenefis=0, totPert=0, vendu=0;
  for (const p of prods) {
    totPrixDealer += Number(p.prixDealer ?? 0);
    const vant = getVant(p.id);
    if (vant) {
      totBenefis += calcBenefis(p);
      totPert    += calcPert(p);
      vendu++;
    }
  }
  const benefisNet = totBenefis - totPert;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)",
      zIndex:200, display:"flex", alignItems:"flex-end",
      justifyContent:"center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:C.dark, borderRadius:"24px 24px 0 0",
          width:"100%", maxWidth:700, maxHeight:"93vh",
          display:"flex", flexDirection:"column" as const, overflow:"hidden" }}>

        {/* Handle */}
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0",
          background:C.card, flexShrink:0 }}>
          <div style={{ width:40, height:4, background:"#444", borderRadius:2 }}/>
        </div>

        {/* Header */}
        <div style={{ background:C.card, padding:"16px 20px", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
            <Avatar nom={nom} size={52} />
            <div>
              <p style={{ margin:0, fontWeight:700, fontSize:20 }}>{nom}</p>
              <p style={{ margin:0, color:"#555", fontSize:12 }}>
                {prods.length} pwodwi • {vendu} vann
              </p>
            </div>
          </div>
          {/* Stats */}
          <div style={{ display:"flex", gap:8 }}>
            {isAdmin && (
              <StatChip label="Envesti" val={`$${fmt(totPrixDealer)}`} color={C.gold} />
            )}
            <StatChip label="Benefis" val={`$${fmt(totBenefis)}`}
              color={totBenefis>0?C.green:"#444"} />
            <StatChip label="Pèt" val={`$${fmt(totPert)}`}
              color={totPert>0?C.red:"#444"} />
            <StatChip label="Net" val={`$${fmt(benefisNet)}`}
              color={benefisNet>=0?C.green:C.red} />
          </div>
        </div>

        {/* Product list */}
        <div style={{ overflowY:"auto", flex:1, padding:14 }}>
          {prods.map(p => {
            const vant = getVant(p.id);
            const sold = !!vant;
            const ps   = Number(p.prixAchat ?? 0);
            const pd   = Number(p.prixDealer ?? 0);
            const pf   = sold ? Number(vant.prixVant ?? 0) : 0;
            const kom  = komisyon(p.category);
            const ben  = sold ? calcBenefis(p) : 0;

            return (
              <div key={p.id}
                style={{ background:C.card2, borderRadius:16, padding:14,
                  marginBottom:12,
                  border:`1px solid ${sold ? C.green+"33" : "#ffffff08"}` }}>
                {/* Badges */}
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                  <Badge text={sold?"✅ Vann":"⏳ Stock"}
                    color={sold?C.green:"#555"} bg={sold?`${C.green}18`:"#ffffff08"} />
                  <Badge text={`ID: ${p.id}`} color={C.accent} bg={`${C.accent}18`} />
                  {p.category && (
                    <Badge text={p.category} color={C.blue} bg={`${C.blue}18`} />
                  )}
                </div>

                <p style={{ margin:"0 0 4px", fontWeight:700, fontSize:15 }}>
                  {p.marque} {p.modele}
                </p>
                {p.serialImei && (
                  <p style={{ margin:"0 0 10px", color:"#444", fontSize:11 }}>
                    S/N: {p.serialImei}
                  </p>
                )}

                {/* Calc table */}
                <div style={{ background:C.dark, borderRadius:10, padding:10 }}>
                  {[
                    { label:"Prix Dealer", val:`$${pd.toFixed(2)}`, color:C.gold },
                    { label:"Prix Store",  val:`$${ps.toFixed(2)}`, color:C.blue },
                    { label:`Komisyon (${p.category})`, val:`$${kom.toFixed(2)}`, color:C.red },
                    ...(sold ? [
                      { label:"Prix Facture", val:`$${pf.toFixed(2)}`, color:"#ccc" },
                      { label:"Ben. Store", val:`$${(pf-ps).toFixed(2)}`, color:"#888" },
                    ] : []),
                  ].map((r,i) => (
                    <div key={i} style={{ display:"flex", justifyContent:"space-between",
                      padding:"3px 0", borderBottom: i===2&&sold?"1px solid #ffffff0a":"none" }}>
                      <span style={{ color:"#444", fontSize:11 }}>{r.label}</span>
                      <span style={{ color:r.color, fontSize:11 }}>{r.val}</span>
                    </div>
                  ))}
                  {sold && (
                    <div style={{ display:"flex", justifyContent:"space-between",
                      padding:"4px 0", marginTop:2 }}>
                      <span style={{ color:"#888", fontSize:12, fontWeight:700 }}>
                        {ben>=0?"Ben. Dealer":"⚠️ Pèt Dealer"}
                      </span>
                      <span style={{ color:ben>0?C.green:ben<0?C.red:"#555",
                        fontSize:13, fontWeight:700 }}>
                        {ben>=0?"+":"-"}${Math.abs(ben).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {!sold && (
                    <div style={{ display:"flex", justifyContent:"space-between",
                      padding:"4px 0", marginTop:2 }}>
                      <span style={{ color:"#555", fontSize:11 }}>Ben. Dealer</span>
                      <span style={{ color:"#444", fontSize:11 }}>Ap kalkile apre vant</span>
                    </div>
                  )}
                </div>

                {sold && (
                  <div style={{ marginTop:10 }}>
                    <p style={{ margin:0, color:"#444", fontSize:11 }}>
                      👤 {vant.clientNom} &nbsp; 🧾 #{vant.billNo} &nbsp; 📅 {fmtDate(vant.date)}
                    </p>
                    {isAdmin && (
                      <div style={{ display:"flex", gap:8, marginTop:8 }}>
                        <button onClick={() => setConfirmVant({ p, facId: vant.facId })}
                          style={{ background:`${C.red}18`, border:`1px solid ${C.red}44`,
                            color:C.red, padding:"4px 10px", borderRadius:8,
                            cursor:"pointer", fontSize:11, fontWeight:700 }}>
                          🗑 Siprime Vant
                        </button>
                        <button onClick={() => setEditBenefis({ p, val: ben.toFixed(2) })}
                          style={{ background:`${C.accent}18`, border:`1px solid ${C.accent}44`,
                            color:C.accent, padding:"4px 10px", borderRadius:8,
                            cursor:"pointer", fontSize:11, fontWeight:700 }}>
                          ✏️ Modifye Benefis
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Confirm siprime vant */}
      {confirmVant && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)",
          zIndex:300, display:"flex", alignItems:"center",
          justifyContent:"center", padding:20 }} onClick={() => setConfirmVant(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:C.card, borderRadius:20, padding:24,
              maxWidth:380, width:"100%" }}>
            <h3 style={{ margin:"0 0 12px", fontSize:16 }}>⚠️ Siprime Vant?</h3>
            <p style={{ margin:"0 0 20px", color:"#888", fontSize:13 }}>
              Vant sa ap retire nan istwa. Benefis ap retounen 0.
            </p>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setConfirmVant(null)}
                style={{ flex:1, padding:12, background:"#ffffff0a",
                  border:"none", borderRadius:12, cursor:"pointer", color:"#888" }}>
                Non
              </button>
              <button onClick={() => { onDeleteVant(confirmVant.facId); setConfirmVant(null); }}
                style={{ flex:1, padding:12, background:C.red,
                  border:"none", borderRadius:12, cursor:"pointer",
                  color:"#fff", fontWeight:700 }}>
                Wi, Siprime
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit benefis */}
      {editBenefis && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)",
          zIndex:300, display:"flex", alignItems:"center",
          justifyContent:"center", padding:20 }} onClick={() => setEditBenefis(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:C.card, borderRadius:20, padding:24,
              maxWidth:380, width:"100%" }}>
            <h3 style={{ margin:"0 0 8px", fontSize:16, color:C.accent }}>
              ✏️ Modifye Benefis
            </h3>
            <p style={{ margin:"0 0 16px", color:"#555", fontSize:13 }}>
              {editBenefis.p.marque} {editBenefis.p.modele}
            </p>
            <input type="number" value={editBenefis.val}
              onChange={e => setEditBenefis(p => p ? {...p, val:e.target.value} : null)}
              autoFocus
              style={{ width:"100%", padding:"12px 14px",
                background:"#ffffff0a", border:"1px solid #333",
                borderRadius:12, color:"#fff", fontSize:14,
                outline:"none", boxSizing:"border-box" as const }}/>
            <div style={{ display:"flex", gap:10, marginTop:16 }}>
              <button onClick={() => setEditBenefis(null)}
                style={{ flex:1, padding:12, background:"#ffffff0a",
                  border:"none", borderRadius:12, cursor:"pointer", color:"#888" }}>
                Anile
              </button>
              <button onClick={() => {
                onSaveBenefis(editBenefis.p, parseFloat(editBenefis.val)||0);
                setEditBenefis(null);
              }} style={{ flex:1, padding:12, background:C.accent,
                border:"none", borderRadius:12, cursor:"pointer",
                color:"#fff", fontWeight:700 }}>
                Sove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── COMMISSION MODAL ─────────────────────────────────────────────────────────
function CommissionModal({ commissions, categories, onClose, onSave }: {
  commissions: Record<string,number>;
  categories: string[];
  onClose: () => void;
  onSave: (c: Record<string,number>) => void;
}) {
  const [local, setLocal] = useState({ ...commissions });

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)",
      zIndex:200, display:"flex", alignItems:"flex-end",
      justifyContent:"center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:C.card, borderRadius:"20px 20px 0 0",
          width:"100%", maxWidth:500, padding:"20px 20px 40px" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}>
          <div style={{ width:40, height:4, background:"#444", borderRadius:2 }}/>
        </div>
        <p style={{ margin:"0 0 4px", fontWeight:700, fontSize:16, color:C.accent }}>
          % Komisyon pa Kategori
        </p>
        <p style={{ margin:"0 0 16px", color:"#444", fontSize:11 }}>
          Sove nan Firestore — tout telefòn wè menm komisyon
        </p>
        {categories.length === 0 ? (
          <p style={{ color:"#444" }}>Pa gen kategori toujou</p>
        ) : (
          categories.map(cat => (
            <div key={cat} style={{ display:"flex", alignItems:"center",
              gap:12, marginBottom:12 }}>
              <span style={{ flex:1, fontSize:14 }}>{cat}</span>
              <input type="number"
                value={local[cat.toLowerCase()] ?? 0}
                onChange={e => setLocal(p => ({
                  ...p, [cat.toLowerCase()]: Number(e.target.value)
                }))}
                style={{ width:100, padding:"8px 12px",
                  background:"#ffffff0a", border:"1px solid #333",
                  borderRadius:10, color:"#fff", fontSize:14,
                  outline:"none", textAlign:"center" }}/>
            </div>
          ))
        )}
        <div style={{ display:"flex", gap:10, marginTop:16 }}>
          <button onClick={onClose}
            style={{ flex:1, padding:12, background:"#ffffff0a",
              border:"none", borderRadius:12, cursor:"pointer", color:"#888" }}>
            Anile
          </button>
          <button onClick={() => onSave(local)}
            style={{ flex:1, padding:12, background:C.accent,
              border:"none", borderRadius:12, cursor:"pointer",
              color:"#fff", fontWeight:700 }}>
            Sove
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SMALL COMPONENTS ────────────────────────────────────────────────────────
function Avatar({ nom, size }: { nom: string; size: number }) {
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", flexShrink:0,
      background:`${C.accent}18`, border:`1px solid ${C.accent}44`,
      display:"flex", alignItems:"center", justifyContent:"center",
      color:C.accent, fontWeight:700, fontSize:size*0.37 }}>
      {nom?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span style={{ background:bg, color, padding:"3px 8px",
      borderRadius:6, fontSize:10, fontWeight:700 }}>
      {text}
    </span>
  );
}

function StatChip({ label, val, color }: { label: string; val: string; color: string }) {
  return (
    <div style={{ flex:1, background:`${color}10`,
      border:`1px solid ${color}30`, borderRadius:10,
      padding:"8px 4px", textAlign:"center" }}>
      <p style={{ margin:0, color, fontWeight:700, fontSize:12 }}>{val}</p>
      <p style={{ margin:0, color:"#444", fontSize:9 }}>{label}</p>
    </div>
  );
}