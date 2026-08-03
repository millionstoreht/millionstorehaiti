"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, runTransaction,
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
  ventId?: string;
  factureId?: string;
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
  paye?: boolean;
  clientNom?: string;
  cashier?: string;
  description?: string;
}

interface HistEntry {
  type: string; // 'vente' | 'annulation' | 'suppression_definitive' | 'retrait' | 'restauration'
  date: string;
  montant: number;
  description: string;
  venteId?: string;
  marque?: string;
  modele?: string;
  billNo?: string;
  clientNom?: string;
  cashier?: string;
  produitDescription?: string;
  soldeApres?: number; // calculated client-side, not stored
}

interface Vendeur {
  id: string;
  nom: string;
  balance: number;
  ventes: Vente[];
  historique?: HistEntry[];
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

function initiale(nom?: string) {
  const s = (nom ?? "").trim();
  return s.length > 0 ? s[0].toUpperCase() : "?";
}

function histEntry(opts: {
  type: string; montant: number; description: string;
  venteId?: string; marque?: string; modele?: string; billNo?: string;
  clientNom?: string; cashier?: string; produitDescription?: string;
}): HistEntry {
  const e: HistEntry = {
    type: opts.type, date: new Date().toISOString(),
    montant: opts.montant, description: opts.description,
  };
  if (opts.venteId) e.venteId = opts.venteId;
  if (opts.marque) e.marque = opts.marque;
  if (opts.modele) e.modele = opts.modele;
  if (opts.billNo) e.billNo = opts.billNo;
  if (opts.clientNom) e.clientNom = opts.clientNom;
  if (opts.cashier) e.cashier = opts.cashier;
  if (opts.produitDescription) e.produitDescription = opts.produitDescription;
  return e;
}

/** Construit le relevé complet : historique trié, solde après chaque ligne
 *  calculé en arrière à partir du vrai solde actuel — pour que la ligne la
 *  plus récente corresponde toujours exactement au solde affiché en haut. */
function releveComplet(v: Vendeur): HistEntry[] {
  const lignes = [...(v.historique ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  let running = v.balance ?? 0;
  const withSolde: HistEntry[] = [];
  for (let i = lignes.length - 1; i >= 0; i--) {
    const l = { ...lignes[i], soldeApres: running };
    withSolde.unshift(l);
    running -= l.montant;
  }
  return withSolde.sort((a, b) => b.date.localeCompare(a.date));
}

function totalRetraits(v: Vendeur): number {
  return (v.historique ?? [])
    .filter(h => h.type === "retrait")
    .reduce((s, h) => s + Math.abs(h.montant), 0);
}

function phraseMouvement(type: string, montant: number, avant: number, apres: number) {
  const m = Math.abs(montant).toFixed(2);
  const a = avant.toFixed(2);
  const b = apres.toFixed(2);
  switch (type) {
    case "vente": return `Vente ajoutée de $${m}. Vous aviez $${a}, vous avez maintenant $${b}.`;
    case "restauration": return `Vente restaurée de $${m}. Vous aviez $${a}, vous avez maintenant $${b}.`;
    case "suppression_definitive": return `Vente enlevée de $${m}. Vous aviez $${a}, vous avez maintenant $${b}.`;
    case "annulation": return `Vente annulée de $${m}. Vous aviez $${a}, il vous reste $${b}.`;
    case "retrait": return `Retrait de $${m}. Vous aviez $${a}, il vous reste $${b}.`;
    case "depot": return `Dépôt effectué de $${m}. Vous aviez $${a}, vous avez maintenant $${b}.`;
    default: return `Solde actuel : $${b}.`;
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function VendeursPage() {
  const router = useRouter();
  const [user, setUser]         = useState<UserSession | null>(null);
  const [vendeurs, setVendeurs] = useState<Vendeur[]>([]);
  const [commission, setCommission] = useState<Record<string,number>>({
    "Téléphone": 10, Ordinateur: 20, Desktop: 20, Accessoire: 5,
  });
  const [tab, setTab]           = useState<"dashboard"|"vendeurs">("dashboard");
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [selectedVendeur, setSelectedVendeur] = useState<{v:Vendeur,color:string}|null>(null);
  const [releveVendeur, setReleveVendeur]     = useState<{v:Vendeur,color:string}|null>(null);
  const [showAddModal, setShowAddModal]       = useState(false);
  const [showCommModal, setShowCommModal]     = useState(false);
  const [showRetraitModal, setShowRetraitModal] = useState<Vendeur|null>(null);
  const [showDepotModal, setShowDepotModal] = useState<Vendeur|null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<Vendeur|null>(null);
  const [showDeleteBlocked, setShowDeleteBlocked] = useState<Vendeur|null>(null);
  const [showSiprimeConfirm, setShowSiprimeConfirm] = useState<{v:Vendeur,t:Vente}|null>(null);
  const [newNom, setNewNom]     = useState("");
  const [localId, setLocalId]   = useState("all");
  const [snackMsg, setSnackMsg] = useState("");
  const [snackColor, setSnackColor] = useState("#00C853");

  function snack(msg: string, color: string) {
    setSnackMsg(msg); setSnackColor(color);
    setTimeout(() => setSnackMsg(""), 2000);
  }

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

    if (localId === "all") {
      const fetchAll = async () => {
        try {
          const localsSnap = await getDocs(collection(db, "locals"));
          const allVendeurs: Vendeur[] = [];
          for (const localDoc of localsSnap.docs) {
            if (localDoc.id === "all") continue;
            const vendSnap = await getDocs(collection(db, "locals", localDoc.id, "vendeurs"));
            vendSnap.forEach(d => {
              const data = d.data();
              allVendeurs.push({
                id: d.id, nom: data.nom ?? "", balance: Number(data.balance ?? 0),
                ventes: data.ventes ?? [], historique: data.historique ?? [],
                localId: localDoc.id,
              });
            });
          }
          setVendeurs(allVendeurs);
          setLoading(false);
        } catch { setLoading(false); }
      };
      fetchAll();
      return;
    }

    const colRef = collection(db, "locals", localId, "vendeurs");
    const unsub = onSnapshot(colRef, snap => {
      const list: Vendeur[] = [];
      snap.forEach(d => {
        const data = d.data();
        list.push({
          id: d.id, nom: data.nom ?? "", balance: Number(data.balance ?? 0),
          ventes: data.ventes ?? [], historique: data.historique ?? [],
          localId: localId,
        });
      });
      setVendeurs(list);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [user, localId]);

  // ─── STATS ───────────────────────────────────────────────────────────────
  const totalGlobal = vendeurs.reduce((s,v) => s + v.balance, 0);
  const sorted = useMemo(() => [...vendeurs].sort((a,b) => b.balance - a.balance), [vendeurs]);
  const maxBalance = sorted[0]?.balance ?? 1;

  // ─── ACTIONS ─────────────────────────────────────────────────────────────
  const addVendeur = async () => {
    if (!newNom.trim() || localId === "all") return;
    const v: Vendeur = { id: Date.now().toString(), nom: newNom.trim(), balance: 0, ventes: [], historique: [], localId };
    await setDoc(doc(db, "locals", localId, "vendeurs", v.id), v);
    setNewNom(""); setShowAddModal(false);
  };

  /** Retrait — l'admin entre un montant, refusé s'il dépasse le solde. Écriture
   *  atomique (transaction) pour éviter une course avec une vente concurrente. */
  const retraitVendeur = async (v: Vendeur, montant: number) => {
    if (busy) return;
    setBusy(true);
    const lid = v.localId ?? localId;
    const ref = doc(db, "locals", lid, "vendeurs", v.id);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Vendeur introuvable");
        const current = snap.data() as Vendeur;
        const currentBalance = Number(current.balance ?? 0);
        if (montant > currentBalance) throw new Error("Le montant dépasse le solde actuel");
        const historique = [...(current.historique ?? []), histEntry({
          type: "retrait", montant: -montant, description: "Retrait effectué",
        })];
        tx.update(ref, { balance: currentBalance - montant, historique });
      });
      snack(`✅ Retrait de $${montant.toFixed(2)} effectué.`, "#00C853");
      setShowRetraitModal(null);
    } catch (e) {
      snack("❌ " + (e instanceof Error ? e.message : "Erè"), "red");
    } finally { setBusy(false); }
  };

  /** Dépôt — l'admin ajoute un montant manuellement au solde du vendeur.
   *  Même transaction atomique que Retrait, pour empêcher toute course
   *  si 2 appareils modifient le même vendeur en même temps. */
  const depotVendeur = async (v: Vendeur, montant: number) => {
    if (busy) return;
    setBusy(true);
    const lid = v.localId ?? localId;
    const ref = doc(db, "locals", lid, "vendeurs", v.id);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Vendeur introuvable");
        const current = snap.data() as Vendeur;
        const currentBalance = Number(current.balance ?? 0);
        const historique = [...(current.historique ?? []), histEntry({
          type: "depot", montant: montant, description: "Dépôt effectué par l'admin",
        })];
        tx.update(ref, { balance: currentBalance + montant, historique });
      });
      snack(`✅ Dépôt de $${montant.toFixed(2)} effectué.`, "#00C853");
      setShowDepotModal(null);
    } catch (e) {
      snack("❌ " + (e instanceof Error ? e.message : "Erè"), "red");
    } finally { setBusy(false); }
  };

  /** Un vendeur ne peut être supprimé que si son solde est à $0. */
  const requestDeleteVendeur = (v: Vendeur) => {
    if (v.balance !== 0) { setShowDeleteBlocked(v); return; }
    setShowDeleteModal(v);
  };

  const deleteVendeur = async (v: Vendeur) => {
    const lid = v.localId ?? localId;
    await deleteDoc(doc(db, "locals", lid, "vendeurs", v.id));
    setShowDeleteModal(null);
  };

  /** Siprime yon vant : DEFINITIF, direct. Retire du solde SEULEMENT si la
   *  transaction confirme que le solde couvre encore ce montant, et laisse
   *  une trace dans le relevé (jamais de removeWhere silencieux).
   *  Appelé seulement après confirmation via SiprimeConfirmModal. */
  const doSiprimeVente = async (v: Vendeur, t: Vente) => {
    if (busy) return;
    setBusy(true);
    const lid = v.localId ?? localId;
    const ref = doc(db, "locals", lid, "vendeurs", v.id);
    try {
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Vendeur introuvable");
        const current = snap.data() as Vendeur;
        const ventes = [...(current.ventes ?? [])];
        const idx = ventes.findIndex(x =>
          t.ventId ? x.ventId === t.ventId
          : (x.id === t.id && (t.factureId ? x.factureId === t.factureId : x.billNo === t.billNo))
        );
        if (idx === -1) throw new Error("Vente introuvable (déjà retirée ?)");
        const gain = Number(ventes[idx].gainTotal ?? 0);
        const currentBalance = Number(current.balance ?? 0);
        if (gain > currentBalance) throw new Error("Le solde actuel est inférieur au montant de cette vente");
        const removed = ventes[idx];
        ventes.splice(idx, 1);
        const historique = [...(current.historique ?? []), histEntry({
          type: "suppression_definitive", montant: -gain,
          description: "Retrait — produit retiré définitivement",
          venteId: (removed.id ?? "").toString(), marque: removed.marque, modele: removed.modele ?? removed.model,
          billNo: (removed.billNo ?? "").toString(), clientNom: removed.clientNom, cashier: removed.cashier,
          produitDescription: removed.description,
        })];
        const updated = { ...current, ventes, balance: currentBalance - gain, historique };
        tx.set(ref, updated);
        return updated as Vendeur;
      });
      setSelectedVendeur(prev => prev && prev.v.id === v.id ? { ...prev, v: result } : prev);
      snack("✅ Retrait effectué.", "#00C853");
    } catch (e) {
      snack("❌ " + (e instanceof Error ? e.message : "Erè"), "red");
    } finally { setBusy(false); }
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
          <button onClick={() => router.push("/dashboard")} title="Retour"
            style={{ background:"#1A1D2E", border:"none", color:"#aaa",
              width:36, height:36, borderRadius:10, cursor:"pointer", fontSize:16,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
            ←
          </button>
          <h1 style={{ margin:0, fontSize:20, fontWeight:700 }}>Vendeurs</h1>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {user.isAdmin && (
            <button onClick={() => setShowCommModal(true)} title="Commission"
              style={{ background:"#1A1D2E", border:"none",
                color:"#aaa", width:36, height:36, borderRadius:10,
                cursor:"pointer", fontSize:16,
                display:"flex", alignItems:"center", justifyContent:"center" }}>
              ⚙️
            </button>
          )}
          {user.isAdmin && localId !== "all" && (
            <button onClick={() => setShowAddModal(true)} title="Ajouter un vendeur"
              style={{ background:"rgba(0,200,83,0.2)", border:"none",
                color:"#00C853", width:36, height:36, borderRadius:10,
                cursor:"pointer", fontSize:18, fontWeight:700,
                display:"flex", alignItems:"center", justifyContent:"center" }}>
              +
            </button>
          )}
        </div>
      </div>

      {/* ── TABS ── */}
      <div style={{ display:"flex", borderBottom:"1px solid #1e1e2e", background:"#0F1117" }}>
        {(["dashboard","vendeurs"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex:1, padding:"14px", border:"none", background:"none",
              color: tab===t ? "#00C853" : "#555", fontWeight:700, fontSize:13,
              cursor:"pointer", borderBottom: tab===t ? "2px solid #00C853" : "2px solid transparent",
              transition:"all 0.2s" }}>
            {t === "dashboard" ? "TABLEAU DE BORD" : "VENDEURS"}
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
              <p style={{ color:"#555", marginTop:12 }}>Ajoutez un vendeur pour voir le tableau de bord</p>
            </div>
          ) : (
            <>
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

              <p style={{ margin:"0 0 12px", fontWeight:700, fontSize:14 }}>Solde par vendeur</p>
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
                          borderRadius:"6px 6px 0 0", minHeight:4, transition:"height 0.5s" }}/>
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

              <p style={{ margin:"0 0 12px", fontWeight:700, fontSize:14 }}>Classement des vendeurs</p>
              {sorted.map((v,i) => {
                const color = colorOf(i);
                const activeVentes = v.ventes.filter(t => !t.annule);
                const totalGagne = activeVentes.reduce((s,t) => s+Number(t.gainTotal??0),0);
                const retraits = totalRetraits(v);
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
                        {activeVentes.length} vente(s)  •  Total généré : ${totalGagne.toFixed(2)}
                        {retraits > 0 && ` (déjà retiré : $${retraits.toFixed(2)})`}
                        {localId === "all" && v.localId && (
                          <span style={{ marginLeft:6, color:"#2979FF", fontSize:10 }}>[{v.localId}]</span>
                        )}
                      </p>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <p style={{ margin:0, color, fontWeight:700, fontSize:15 }}>
                        ${v.balance.toFixed(2)}
                      </p>
                      {user.isAdmin && (
                        <div style={{ display:"flex", gap:4, marginTop:4, justifyContent:"flex-end" }}>
                          <button onClick={e => { e.stopPropagation(); setShowDepotModal(v); }}
                            style={{ background:"rgba(41,121,255,0.2)", border:"none",
                              color:"#2979FF", padding:"2px 8px", borderRadius:8,
                              cursor:"pointer", fontSize:10, fontWeight:700 }}>
                            Dépôt
                          </button>
                          {v.balance > 0 && (
                            <button onClick={e => { e.stopPropagation(); setShowRetraitModal(v); }}
                              style={{ background:"rgba(0,200,83,0.2)", border:"none",
                                color:"#00C853", padding:"2px 8px", borderRadius:8,
                                cursor:"pointer", fontSize:10, fontWeight:700 }}>
                              Retrait
                            </button>
                          )}
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
              <p style={{ color:"#888", fontWeight:600, marginBottom:4 }}>Aucun vendeur pour le moment</p>
              <p style={{ color:"#444", fontSize:12 }}>Ajoutez votre première équipe de vente</p>
              {user.isAdmin && localId !== "all" && (
                <button onClick={() => setShowAddModal(true)}
                  style={{ background:"#00C853", border:"none", color:"#fff",
                    padding:"12px 24px", borderRadius:12, cursor:"pointer",
                    fontSize:14, fontWeight:700, marginTop:16 }}>
                  Ajouter un vendeur
                </button>
              )}
            </div>
          ) : (
            vendeurs.map((v,i) => {
              const color = colorOf(i);
              const active = v.ventes.filter(t => !t.annule);
              const totalGagne = active.reduce((s,t) => s+Number(t.gainTotal??0),0);
              const retraits = totalRetraits(v);
              const alertes = releveComplet(v).filter(l => l.type === "suppression_definitive");
              const derniereAlerte = alertes[0];
              const nbVente = active.length;

              return (
                <div key={v.id} style={{ background:"#181B2A", borderRadius:16,
                  border:`1px solid ${color}2e`, overflow:"hidden" }}>
                  <div onClick={() => setReleveVendeur({v,color})}
                    style={{ display:"flex", alignItems:"center", gap:12,
                      padding:14, cursor:"pointer" }}>
                    <div style={{ width:44, height:44, borderRadius:"50%",
                      background:`${color}2e`, display:"flex", alignItems:"center",
                      justifyContent:"center", color, fontWeight:700, fontSize:16, flexShrink:0 }}>
                      {initiale(v.nom)}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:0, fontWeight:700, fontSize:15 }}>{v.nom}</p>
                      <p style={{ margin:"2px 0 0", color:"#555", fontSize:11 }}>
                        {nbVente} vente{nbVente > 1 ? "s" : ""}  •  Généré : ${totalGagne.toFixed(2)}
                        {retraits > 0 && ` (retiré : $${retraits.toFixed(2)})`}
                        {localId === "all" && v.localId && (
                          <span style={{ marginLeft:6, color:"#2979FF", fontSize:10 }}>[{v.localId}]</span>
                        )}
                      </p>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <p style={{ margin:0, color, fontWeight:700, fontSize:17 }}>
                        ${v.balance.toFixed(2)}
                      </p>
                      <p style={{ margin:0, color:"#3a3a3a", fontSize:10 }}>solde</p>
                    </div>
                    {user.isAdmin ? (
                      <button onClick={e => { e.stopPropagation(); requestDeleteVendeur(v); }}
                        title={v.balance === 0 ? "Supprimer" : "Solde non nul — paiement requis"}
                        style={{ background:"none", border:"none", cursor:"pointer",
                          color: v.balance === 0 ? "#ff4444" : "#2a2a2a", fontSize:20 }}>
                        🗑
                      </button>
                    ) : (
                      <span style={{ color:"#333", fontSize:18 }}>›</span>
                    )}
                  </div>
                  {derniereAlerte && (
                    <div style={{ padding:"0 14px 14px" }}>
                      <AlerteVente alerte={derniereAlerte} balance={v.balance} nbAlertes={alertes.length} />
                    </div>
                  )}
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
              <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
                <div style={{ width:40, height:4, background:"#333", borderRadius:2 }}/>
              </div>
              <div style={{ padding:"16px 20px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                  <div style={{ width:48, height:48, borderRadius:"50%",
                    background:`${color}22`, display:"flex", alignItems:"center",
                    justifyContent:"center", color, fontWeight:700, fontSize:20 }}>
                    {initiale(v.nom)}
                  </div>
                  <div>
                    <p style={{ margin:0, fontWeight:700, fontSize:16 }}>{v.nom}</p>
                    <p style={{ margin:0, color:"#555", fontSize:12 }}>{active.length} vente(s)</p>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  {[
                    { label:"Bénéfice", val:`$${totalBen.toFixed(2)}`, c:"#00e676" },
                    { label:"Commission", val:`$${totalKom.toFixed(2)}`, c:"orange" },
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
                    const isPaye = t.paye === true;
                    return (
                      <div key={i} style={{ background:"rgba(255,255,255,0.03)",
                        border:`1px solid ${color}18`, borderRadius:14,
                        padding:12, marginBottom:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between",
                          alignItems:"flex-start", marginBottom:6 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, minWidth:0 }}>
                            <div style={{ width:8, height:8, borderRadius:"50%", background:color, flexShrink:0 }}/>
                            {t.id && (
                              <span style={{ background:"rgba(255,165,0,0.1)", color:"orange",
                                fontSize:9, padding:"2px 6px", borderRadius:6, fontWeight:700, flexShrink:0 }}>
                                ID : {t.id}
                              </span>
                            )}
                            <span style={{ fontWeight:700, fontSize:13, overflow:"hidden",
                              textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {t.marque} {t.modele ?? t.model}
                            </span>
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                            {isPaye && (
                              <span style={{ background:"rgba(0,200,83,0.2)", color:"#00C853",
                                fontSize:9, padding:"2px 6px", borderRadius:6, fontWeight:700 }}>
                                PAYÉ
                              </span>
                            )}
                            <span style={{ color, fontWeight:700, fontSize:13 }}>${(kom+ben).toFixed(2)}</span>
                            {user.isAdmin && (
                              <button onClick={() => setShowSiprimeConfirm({v,t})} disabled={busy}
                                style={{ background:"rgba(255,0,0,0.15)", border:"none",
                                  color: busy ? "#666" : "#ff4444", width:24, height:24, borderRadius:"50%",
                                  cursor: busy ? "default" : "pointer", fontSize:12, display:"flex",
                                  alignItems:"center", justifyContent:"center" }}>
                                🗑
                              </button>
                            )}
                          </div>
                        </div>
                        {cat && <p style={{ margin:"0 0 4px", color:"#00BCD4", fontSize:11 }}>📦 {cat}</p>}
                        <p style={{ margin:"0 0 4px", color:"#444", fontSize:10 }}>
                          🕐 {fmt(t.date)} &nbsp;&nbsp; 🧾 N° {t.billNo ?? ""} &nbsp;&nbsp; Qté : {qty}
                        </p>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                          {[
                            { label:`Achat: $${pa.toFixed(2)}`, c:"#555" },
                            { label:`Vente: $${pv.toFixed(2)}`, c:"#888" },
                            { label:`Bén : $${ben.toFixed(2)}`, c:"#00C853" },
                            { label:`Com : $${kom.toFixed(2)}`, c:"orange" },
                            { label:`Total : $${(ben+kom).toFixed(2)}`, c:color },
                          ].map(b => (
                            <span key={b.label} style={{ background:`${b.c}22`,
                              color:b.c, fontSize:10, padding:"2px 6px", borderRadius:6, fontWeight:700 }}>
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

      {/* ═══════════════ MODAL: RELEVÉ DE COMPTE ═══════════════ */}
      {releveVendeur && (() => {
        const { v, color } = releveVendeur;
        const lignes = releveComplet(v);
        return (
          <div style={{ position:"fixed", inset:0, background:"#0F1117", zIndex:250,
            overflowY:"auto" }}>
            <div style={{ position:"sticky", top:0, background:"#0F1117",
              borderBottom:"1px solid #1e1e2e", padding:"14px 16px",
              display:"flex", alignItems:"center", gap:10, zIndex:10 }}>
              <button onClick={() => setReleveVendeur(null)}
                style={{ background:"#1A1D2E", border:"none", color:"#aaa",
                  padding:"8px 12px", borderRadius:10, cursor:"pointer" }}>←</button>
              <div style={{ width:36, height:36, borderRadius:"50%",
                background:`${color}22`, display:"flex", alignItems:"center",
                justifyContent:"center", color, fontWeight:700 }}>{initiale(v.nom)}</div>
              <div>
                <p style={{ margin:0, color, fontSize:10, fontWeight:700, letterSpacing:1 }}>RELEVÉ DE COMPTE</p>
                <p style={{ margin:0, fontWeight:700, fontSize:15 }}>{v.nom}</p>
              </div>
            </div>

            <div style={{ maxWidth:700, margin:"0 auto", padding:16 }}>
              <div style={{ background:`linear-gradient(135deg, ${color}, ${color}99)`,
                borderRadius:18, padding:20, marginBottom:20,
                display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <p style={{ margin:0, color:"rgba(255,255,255,0.8)", fontSize:11, letterSpacing:1, fontWeight:700 }}>SOLDE ACTUEL</p>
                  <p style={{ margin:"6px 0 2px", color:"#fff", fontSize:28, fontWeight:700 }}>${v.balance.toFixed(2)}</p>
                  <p style={{ margin:0, color:"rgba(255,255,255,0.8)", fontSize:11 }}>
                    {lignes.length} mouvement{lignes.length>1?"s":""} enregistré{lignes.length>1?"s":""}
                  </p>
                </div>
                <span style={{ fontSize:30 }}>🏦</span>
              </div>

              {lignes.length === 0 ? (
                <p style={{ textAlign:"center", color:"#555", marginTop:40 }}>Aucun mouvement pour le moment</p>
              ) : lignes.map((l, i) => {
                const isCredit = l.montant > 0;
                const isDebit = l.montant < 0;
                const soldeAvant = (l.soldeApres ?? 0) - l.montant;
                const phrase = phraseMouvement(l.type, l.montant, soldeAvant, l.soldeApres ?? 0);
                const iconMap: Record<string, string> = {
                  vente: "🛒", restauration: "♻️", annulation: "🚫", suppression_definitive: "🗑", retrait: "💸", depot: "💰",
                };
                const titreMap: Record<string, string> = {
                  vente: "Vente ajoutée", restauration: "Vente restaurée", annulation: "Vente annulée",
                  suppression_definitive: "Vente enlevée", retrait: "Retrait effectué", depot: "Dépôt effectué",
                };
                return (
                  <div key={i} style={{ background:"rgba(255,255,255,0.03)",
                    border:`1px solid ${color}26`, borderRadius:14, padding:12, marginBottom:10 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                      <div style={{ width:32, height:32, borderRadius:"50%",
                        background:`${color}22`, display:"flex", alignItems:"center",
                        justifyContent:"center", fontSize:15 }}>{iconMap[l.type] ?? "🧾"}</div>
                      <div style={{ flex:1 }}>
                        <p style={{ margin:0, fontWeight:700, fontSize:13 }}>{titreMap[l.type] ?? "Mouvement"}</p>
                        <p style={{ margin:0, color:"#555", fontSize:10 }}>🕐 {fmt(l.date)}</p>
                      </div>
                      <span style={{ fontWeight:700, fontSize:14,
                        color: isCredit ? "#00C853" : isDebit ? "#ff5252" : "#555" }}>
                        {isCredit ? `+$${l.montant.toFixed(2)}` : isDebit ? `-$${Math.abs(l.montant).toFixed(2)}` : "—"}
                      </span>
                    </div>
                    <p style={{ margin:"0 0 8px", color:"#999", fontSize:11, lineHeight:1.4 }}>{phrase}</p>
                    {(l.marque || l.modele || l.venteId || l.billNo) && (
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:6 }}>
                        {(l.marque || l.modele) && <Badge text={`${l.marque ?? ""} ${l.modele ?? ""}`.trim()} c="#aaa"/>}
                        {l.venteId && <Badge text={`ID : ${l.venteId}`} c="#555"/>}
                        {l.billNo && <Badge text={`N° ${l.billNo}`} c="#555"/>}
                      </div>
                    )}
                    {(l.produitDescription || l.clientNom || l.cashier) && (
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:6 }}>
                        {l.produitDescription && <Badge text={l.produitDescription} c="#555"/>}
                        {l.clientNom && <Badge text={`Client : ${l.clientNom}`} c="#26c6da"/>}
                        {l.cashier && <Badge text={`Caissier : ${l.cashier}`} c="#42a5f5"/>}
                      </div>
                    )}
                    <div style={{ textAlign:"right" }}>
                      <Badge text={`Solde après : $${(l.soldeApres ?? 0).toFixed(2)}`} c={color}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ═══════════════ MODAL: AJOUTE VENDEUR ═══════════════ */}
      {showAddModal && (
        <Modal title="Ajouter un vendeur" onClose={() => setShowAddModal(false)}>
          <input value={newNom} onChange={e => setNewNom(e.target.value)}
            placeholder="Nom du vendeur" autoFocus style={inputStyle} />
          <div style={{ display:"flex", gap:8, marginTop:16 }}>
            <button onClick={() => setShowAddModal(false)} style={btnSecondary}>Annuler</button>
            <button onClick={addVendeur} style={btnPrimary("#00C853")}>Ajouter</button>
          </div>
        </Modal>
      )}

      {/* ═══════════════ MODAL: RETRAIT ═══════════════ */}
      {showRetraitModal && (
        <RetraitModal v={showRetraitModal} busy={busy}
          onClose={() => setShowRetraitModal(null)}
          onConfirm={(m) => retraitVendeur(showRetraitModal, m)} />
      )}

      {/* ═══════════════ MODAL: DÉPÔT ═══════════════ */}
      {showDepotModal && (
        <DepotModal v={showDepotModal} busy={busy}
          onClose={() => setShowDepotModal(null)}
          onConfirm={(m) => depotVendeur(showDepotModal, m)} />
      )}

      {/* ═══════════════ MODAL: CONFIRMASYON SIPRIME ═══════════════ */}
      {showSiprimeConfirm && (
        <SiprimeConfirmModal
          marque={showSiprimeConfirm.t.marque}
          modele={showSiprimeConfirm.t.modele ?? showSiprimeConfirm.t.model}
          busy={busy}
          onClose={() => setShowSiprimeConfirm(null)}
          onConfirm={async () => {
            await doSiprimeVente(showSiprimeConfirm.v, showSiprimeConfirm.t);
            setShowSiprimeConfirm(null);
          }}
        />
      )}

      {/* ═══════════════ MODAL: EFASE ═══════════════ */}
      {showDeleteModal && (
        <Modal title="Supprimer ce vendeur ?" onClose={() => setShowDeleteModal(null)}>
          <p style={{ color:"#888", margin:"0 0 16px" }}>
            {showDeleteModal.nom}<br/>Solde : $0.00 — cette action est irréversible.
          </p>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => setShowDeleteModal(null)} style={btnSecondary}>Non</button>
            <button onClick={() => deleteVendeur(showDeleteModal)} style={btnPrimary("#ff4444")}>Oui, supprimer</button>
          </div>
        </Modal>
      )}

      {/* ═══════════════ MODAL: SUPPRESSION IMPOSSIBLE ═══════════════ */}
      {showDeleteBlocked && (
        <Modal title="Suppression impossible" onClose={() => setShowDeleteBlocked(null)}>
          <p style={{ color:"#888", margin:"0 0 16px" }}>
            Le solde de {showDeleteBlocked.nom} est de ${showDeleteBlocked.balance.toFixed(2)}.
            Un vendeur ne peut être supprimé que si son solde est à $0. Payez-le d&apos;abord.
          </p>
          <button onClick={() => setShowDeleteBlocked(null)} style={btnPrimary("#00C853")}>Compris</button>
        </Modal>
      )}

      {/* ═══════════════ MODAL: KOMISYON ═══════════════ */}
      {showCommModal && (
        <CommissionModal commission={commission} onClose={() => setShowCommModal(false)} onSave={saveCommission} />
      )}

      {/* ── Snack ── */}
      {snackMsg && (
        <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)",
          background:snackColor, color:"#fff", padding:"10px 20px", borderRadius:12,
          fontWeight:600, zIndex:999, fontSize:13, boxShadow:"0 4px 12px rgba(0,0,0,0.3)" }}>
          {snackMsg}
        </div>
      )}
    </main>
  );
}

/** Petite bannière d'alerte affichée sur la ligne du vendeur quand un retrait
 *  (Siprime) a été effectué — avec la date, les infos du produit, le solde
 *  actuel et le nombre d'autres retraits, comme dans _alerteVente (Flutter). */
function AlerteVente({ alerte, balance, nbAlertes }: { alerte: HistEntry; balance: number; nbAlertes: number }) {
  const marque = alerte.marque ?? "";
  const modele = alerte.modele ?? "";
  const venteId = alerte.venteId;
  const billNo = alerte.billNo;
  const details = [
    (marque || modele) ? `${marque} ${modele}`.trim() : null,
    venteId ? `ID : ${venteId}` : null,
    billNo ? `N° ${billNo}` : null,
  ].filter(Boolean).join(" • ");

  return (
    <div style={{ background:"rgba(255,0,0,0.08)", border:"1px solid rgba(255,0,0,0.25)",
      borderRadius:10, padding:"8px 10px", display:"flex", gap:8 }}>
      <span style={{ fontSize:14, color:"#ff4444", flexShrink:0 }}>🗑</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ flex:1, color:"#ff4444", fontSize:11, fontWeight:700,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            Retrait effectué — {fmt(alerte.date)}
          </span>
          {nbAlertes > 1 && (
            <span style={{ background:"rgba(255,0,0,0.2)", color:"#ff4444",
              fontSize:9, fontWeight:700, padding:"1px 6px", borderRadius:8, flexShrink:0 }}>
              +{nbAlertes-1} autre{nbAlertes-1>1?"s":""}
            </span>
          )}
        </div>
        {details && (
          <p style={{ margin:"2px 0 0", color:"#888", fontSize:10,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{details}</p>
        )}
        <p style={{ margin:"2px 0 0", color:"#ccc", fontSize:10, fontWeight:700 }}>
          Solde actuel : ${balance.toFixed(2)}
        </p>
      </div>
    </div>
  );
}

/** Dialog de confirmation "Siprime Definitif ?" — équivalent stylé du
 *  AlertDialog Flutter (pas de window.confirm() natif du navigateur). */
function SiprimeConfirmModal({ marque, modele, busy, onClose, onConfirm }: {
  marque?: string; modele?: string; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal title="Siprime Definitif ?" onClose={onClose}>
      <p style={{ color:"#888", margin:"0 0 16px", lineHeight:1.5 }}>
        {marque} {modele} ap retire definitivman nan kont vandè sa a.
        <br/><br/>
        Aksyon sa a PA KA anile.
      </p>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={onClose} style={btnSecondary}>Non</button>
        <button onClick={onConfirm} disabled={busy} style={btnPrimary("#ff4444")}>
          {busy ? "..." : "Wi, Siprime"}
        </button>
      </div>
    </Modal>
  );
}

function Badge({ text, c }: { text: string; c: string }) {
  return (
    <span style={{ background:`${c}22`, color:c, fontSize:10, padding:"2px 7px",
      borderRadius:6, fontWeight:700 }}>{text}</span>
  );
}

function RetraitModal({ v, busy, onClose, onConfirm }: {
  v: Vendeur; busy: boolean; onClose: () => void; onConfirm: (montant: number) => void;
}) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    const m = parseFloat(val);
    if (isNaN(m) || m <= 0) { setErr("Montant invalide"); return; }
    if (m > v.balance) { setErr("Le montant dépasse le solde disponible"); return; }
    onConfirm(m);
  };
  return (
    <Modal title="Retrait" onClose={onClose}>
      <p style={{ color:"#888", margin:"0 0 12px", fontSize:13 }}>
        Solde actuel de {v.nom} : ${v.balance.toFixed(2)}
      </p>
      <input type="number" value={val} autoFocus
        onChange={e => { setVal(e.target.value); setErr(null); }}
        placeholder="Montant du retrait" style={inputStyle} />
      {err && <p style={{ color:"#ff4444", fontSize:12, margin:"6px 0 0" }}>{err}</p>}
      <div style={{ display:"flex", gap:8, marginTop:16 }}>
        <button onClick={onClose} style={btnSecondary}>Annuler</button>
        <button onClick={submit} disabled={busy} style={btnPrimary("#00C853")}>
          {busy ? "..." : "Confirmer"}
        </button>
      </div>
    </Modal>
  );
}

function DepotModal({ v, busy, onClose, onConfirm }: {
  v: Vendeur; busy: boolean; onClose: () => void; onConfirm: (montant: number) => void;
}) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    const m = parseFloat(val);
    if (isNaN(m) || m <= 0) { setErr("Montant invalide"); return; }
    onConfirm(m);
  };
  return (
    <Modal title="Dépôt" onClose={onClose}>
      <p style={{ color:"#888", margin:"0 0 12px", fontSize:13 }}>
        Solde actuel de {v.nom} : ${v.balance.toFixed(2)}
      </p>
      <input type="number" value={val} autoFocus
        onChange={e => { setVal(e.target.value); setErr(null); }}
        placeholder="Montant du dépôt" style={inputStyle} />
      {err && <p style={{ color:"#ff4444", fontSize:12, margin:"6px 0 0" }}>{err}</p>}
      <div style={{ display:"flex", gap:8, marginTop:16 }}>
        <button onClick={onClose} style={btnSecondary}>Annuler</button>
        <button onClick={submit} disabled={busy} style={btnPrimary("#2979FF")}>
          {busy ? "..." : "Confirmer"}
        </button>
      </div>
    </Modal>
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
    <Modal title="Commission par catégorie" onClose={onClose}>
      <div style={{ maxHeight:300, overflowY:"auto" }}>
        {Object.entries(local).map(([cat, val]) => (
          <div key={cat} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <span style={{ flex:1, color:"#fff", fontSize:14 }}>{cat}</span>
            <input type="number" value={val}
              onChange={e => setLocal(p => ({ ...p, [cat]: Number(e.target.value) }))}
              style={{ ...inputStyle, width:100, textAlign:"center", margin:0 }}/>
            <button onClick={() => setLocal(p => { const n={...p}; delete n[cat]; return n; })}
              style={{ background:"rgba(255,0,0,0.15)", border:"none",
                color:"#ff4444", width:28, height:28, borderRadius:"50%",
                cursor:"pointer", fontSize:14 }}>−</button>
          </div>
        ))}
        <div style={{ height:1, background:"#ffffff11", margin:"12px 0" }}/>
        <p style={{ color:"#555", fontSize:12, margin:"0 0 8px" }}>Ajouter une catégorie</p>
        <div style={{ display:"flex", gap:8 }}>
          <input value={newCat} onChange={e => setNewCat(e.target.value)}
            placeholder="Nom (ex : Tablette)" style={{ ...inputStyle, flex:1, margin:0 }}/>
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
        <button onClick={onClose} style={btnSecondary}>Annuler</button>
        <button onClick={() => onSave(local)} style={btnPrimary("#00C853")}>Enregistrer</button>
      </div>
    </Modal>
  );
}

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