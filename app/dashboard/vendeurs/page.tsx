"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, runTransaction,
} from "firebase/firestore";
import BestSellerBanner from "../../../lib/BestSellerBanner";

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
  type: string; // 'vente' | 'annulation' | 'suppression_definitive' | 'retrait' | 'depot' | 'restauration'
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
  venteDate?: string;
  opId?: string;
  soldeApres?: number; // kalkile sou ekran, pa estoke
}

interface Vendeur {
  id: string;
  nom: string;
  telephone?: string;
  balance: number;
  ventes: Vente[];
  historique?: HistEntry[];
  localId?: string;
  archivedUntil?: string;
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
    if (isNaN(dt.getTime())) return "";
    return `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()}  ${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}`;
  } catch { return ""; }
};

function initiale(nom?: string) {
  const s = (nom ?? "").trim();
  return s.length > 0 ? s[0].toUpperCase() : "?";
}

/** Awondi a 2 desimal (evite 0.0000001). */
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

/** Kache Promise la si Firestore pa reponn nan [ms]. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

function histEntry(opts: {
  type: string; montant: number; description: string;
  venteId?: string; marque?: string; modele?: string; billNo?: string;
  clientNom?: string; cashier?: string; produitDescription?: string;
  venteDate?: string; opId?: string;
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
  if (opts.venteDate) e.venteDate = opts.venteDate;
  if (opts.opId) e.opId = opts.opId;
  return e;
}

/** Disponib = balans - sa ki poko gen 15 jou.
 *  Vant ak restorasyon konte depi dat yo. Annilasyon / siprime konte depi
 *  dat vant orijinal la (venteDate). Retrait ak Dépôt konte touswit. */
function calcDispo(v: { balance?: number; historique?: HistEntry[] }) {
  const balance = Number(v.balance ?? 0);
  const now = Date.now();
  let enAttente = 0;
  for (const e of v.historique ?? []) {
    const t = e.type;
    if (t !== "vente" && t !== "restauration" && t !== "annulation" && t !== "suppression_definitive") continue;
    const montant = Number(e.montant ?? 0);
    const isReverse = t === "annulation" || t === "suppression_definitive";
    const ref = isReverse ? (e.venteDate ?? e.date) : e.date;
    const dt = ref ? new Date(ref).getTime() : NaN;
    if (!isNaN(dt) && (now - dt) / 86400000 < 15) enAttente += montant;
  }
  if (enAttente < 0) enAttente = 0;
  const brut = balance - enAttente;
  return {
    disponible: r2(brut < 0 ? 0 : brut),
    enAttente: r2(enAttente),
    brut: r2(brut),
  };
}

/** Relevé: SÈLMAN historique (journal append-only). "Solde après" kalkile
 *  an rekile depi vrè balans aktyèl la. */
function releveComplet(v: Vendeur): HistEntry[] {
  const lignes = [...(v.historique ?? [])].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  let running = Number(v.balance ?? 0);
  const out: HistEntry[] = [];
  for (let i = lignes.length - 1; i >= 0; i--) {
    out.unshift({ ...lignes[i], soldeApres: running });
    running -= Number(lignes[i].montant ?? 0);
  }
  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

function totalRetraits(v: Vendeur): number {
  return (v.historique ?? [])
    .filter(h => h.type === "retrait")
    .reduce((s, h) => s + Math.abs(Number(h.montant ?? 0)), 0);
}

function phraseMouvement(type: string, montant: number, avant: number, apres: number) {
  const m = Math.abs(montant).toFixed(2);
  const a = avant.toFixed(2);
  const b = apres.toFixed(2);
  switch (type) {
    case "vente": return `Vente ajoutée de $${m}. Vous aviez $${a}, vous avez maintenant $${b}. Solde actuel : $${b}.`;
    case "restauration": return `Vente restaurée de $${m}. Vous aviez $${a}, vous avez maintenant $${b}. Solde actuel : $${b}.`;
    case "suppression_definitive": return `Vente enlevée de $${m}. Vous aviez $${a}, vous avez maintenant $${b}. Solde actuel : $${b}.`;
    case "annulation": return `Vente annulée de $${m}. Vous aviez $${a}, il vous reste $${b}. Solde actuel : $${b}.`;
    case "retrait": return `Retrait de $${m}. Vous aviez $${a}, il vous reste $${b}. Solde actuel : $${b}.`;
    case "depot": return `Dépôt effectué de $${m}. Vous aviez $${a}, vous avez maintenant $${b}. Solde actuel : $${b}.`;
    default: return `Solde actuel : $${b}.`;
  }
}

// ─── ACHIV (ansyen mouvman +90 jou) ──────────────────────────────────────────
const ARCHIVE_DAYS = 90;
const ARCHIVE_MIN_CHARS = 200000;

async function archiveVendeurOld(localId: string, vendeurId: string): Promise<number> {
  const ref = doc(db, "locals", localId, "vendeurs", vendeurId);
  const archCol = collection(db, "locals", localId, "vendeurs", vendeurId, "archive");
  const cutoff = Date.now() - ARCHIVE_DAYS * 86400000;
  const isOld = (raw?: string) => {
    const t = raw ? new Date(raw).getTime() : NaN;
    return !isNaN(t) && t < cutoff;
  };
  let archived = 0;
  await withTimeout(runTransaction(db, async (tx) => {
    archived = 0;
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const current = snap.data() as Record<string, unknown>;
    if (JSON.stringify(current).length < ARCHIVE_MIN_CHARS) return;

    const ventes = [...((current.ventes as Vente[]) ?? [])];
    const hist = [...((current.historique as HistEntry[]) ?? [])];
    const oldVentes = ventes.filter(x => isOld(x.date));
    const oldHist = hist.filter(x => isOld(x.date));
    if (oldVentes.length === 0 && oldHist.length === 0) return;

    const stamp = Date.now();
    const chunk = 300;
    let n = 0;
    for (let i = 0; i < oldHist.length; i += chunk) {
      tx.set(doc(archCol, `h_${stamp}_${n++}`), {
        kind: "historique", items: oldHist.slice(i, i + chunk),
        createdAt: new Date().toISOString(),
      });
    }
    for (let i = 0; i < oldVentes.length; i += chunk) {
      tx.set(doc(archCol, `v_${stamp}_${n++}`), {
        kind: "ventes", items: oldVentes.slice(i, i + chunk),
        createdAt: new Date().toISOString(),
      });
    }
    tx.set(ref, {
      ...current,
      ventes: ventes.filter(x => !isOld(x.date)),
      historique: hist.filter(x => !isOld(x.date)),
      archivedUntil: new Date(cutoff).toISOString(),
    });
    archived = oldVentes.length + oldHist.length;
  }), 20000);
  return archived;
}

async function loadVendeurArchive(localId: string, vendeurId: string): Promise<HistEntry[]> {
  const snap = await withTimeout(
    getDocs(collection(db, "locals", localId, "vendeurs", vendeurId, "archive")), 10000);
  const out: HistEntry[] = [];
  snap.forEach(d => {
    const data = d.data();
    if (data.kind !== "historique") return;
    for (const e of (data.items ?? []) as HistEntry[]) out.push(e);
  });
  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
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
  const busyRef = useRef(false); // verrou imedya (anti double-klik)
  const [selectedVendeur, setSelectedVendeur] = useState<{v:Vendeur,color:string}|null>(null);
  const [releveVendeur, setReleveVendeur]     = useState<{v:Vendeur,color:string}|null>(null);
  const [showAddModal, setShowAddModal]       = useState(false);
  const [showEditPhoneModal, setShowEditPhoneModal] = useState<Vendeur|null>(null);
  const [showCommModal, setShowCommModal]     = useState(false);
  const [showRetraitModal, setShowRetraitModal] = useState<Vendeur|null>(null);
  const [showDepotModal, setShowDepotModal] = useState<Vendeur|null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<Vendeur|null>(null);
  const [showDeleteBlocked, setShowDeleteBlocked] = useState<Vendeur|null>(null);
  const [showSiprimeConfirm, setShowSiprimeConfirm] = useState<{v:Vendeur,t:Vente}|null>(null);
  const [newNom, setNewNom]     = useState("");
  const [newTel, setNewTel]     = useState("");
  const [localId, setLocalId]   = useState("all");
  const [snackMsg, setSnackMsg] = useState("");
  const [snackColor, setSnackColor] = useState("#00C853");
  const archiveTried = useRef<Set<string>>(new Set());

  function snack(msg: string, color: string) {
    setSnackMsg(msg); setSnackColor(color);
    setTimeout(() => setSnackMsg(""), 2500);
  }

  /** Egzekite yon aksyon ak verrou anti double-klik. */
  async function guard<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (busyRef.current) return undefined;
    busyRef.current = true; setBusy(true);
    try { return await action(); }
    finally { busyRef.current = false; setBusy(false); }
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
      setLocalId(session.localId === "all" ? "all" : session.localId);
    } catch { router.push("/login"); }
  }, [router]);

  // ─── LOAD COMMISSION ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    withTimeout(getDoc(doc(db, "locals", "all")), 8000).then(snap => {
      if (snap.exists() && snap.data()?.commission) {
        setCommission(snap.data()!.commission);
      }
    }).catch(() => {});
  }, [user]);

  // ─── LOAD VENDEURS ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const toVendeur = (id: string, data: Record<string, unknown>, lid: string): Vendeur => ({
      id,
      nom: (data.nom as string) ?? "",
      telephone: (data.telephone as string) ?? "",
      balance: Number(data.balance ?? 0),
      ventes: (data.ventes as Vente[]) ?? [],
      historique: (data.historique as HistEntry[]) ?? [],
      localId: lid,
      archivedUntil: data.archivedUntil as string | undefined,
    });

    if (localId === "all") {
      const fetchAll = async () => {
        try {
          const localsSnap = await withTimeout(getDocs(collection(db, "locals")), 10000);
          const allVendeurs: Vendeur[] = [];
          for (const localDoc of localsSnap.docs) {
            if (localDoc.id === "all") continue;
            const vendSnap = await getDocs(collection(db, "locals", localDoc.id, "vendeurs"));
            vendSnap.forEach(d => allVendeurs.push(toVendeur(d.id, d.data(), localDoc.id)));
          }
          setVendeurs(allVendeurs);
        } catch {
          snack("Impossible de charger les vendeurs. Vérifiez la connexion.", "#e65100");
        } finally { setLoading(false); }
      };
      fetchAll();
      return;
    }

    const colRef = collection(db, "locals", localId, "vendeurs");
    const unsub = onSnapshot(colRef, snap => {
      const list: Vendeur[] = [];
      snap.forEach(d => list.push(toVendeur(d.id, d.data(), localId)));
      setVendeurs(list);
      setLoading(false);
    }, () => {
      setLoading(false);
      snack("Connexion perdue avec le serveur.", "#e65100");
    });
    return () => unsub();
  }, [user, localId]);

  // ─── ACHIV OTOMATIK (admin sèlman, dokiman gwo sèlman) ────────────────────
  useEffect(() => {
    if (!user?.isAdmin || localId === "all") return;
    for (const v of vendeurs) {
      if (archiveTried.current.has(v.id)) continue;
      let size = 0;
      try { size = JSON.stringify(v).length; } catch { continue; }
      if (size < ARCHIVE_MIN_CHARS) continue;
      archiveTried.current.add(v.id);
      archiveVendeurOld(localId, v.id)
        .then(n => { if (n > 0) snack("📦 Ansyen mouvman (+90 jou) achive. Balans pa chanje.", "#2979FF"); })
        .catch(() => {});
    }
  }, [vendeurs, user, localId]);

  // ─── STATS ───────────────────────────────────────────────────────────────
  const totalGlobal = vendeurs.reduce((s, v) => s + v.balance, 0);
  const totalDispo = vendeurs.reduce((s, v) => s + calcDispo(v).disponible, 0);
  const sorted = useMemo(() => [...vendeurs].sort((a, b) => b.balance - a.balance), [vendeurs]);
  const maxBalance = Math.max(sorted[0]?.balance ?? 1, 1); // pa janm ≤ 0

  // ─── ACTIONS ─────────────────────────────────────────────────────────────
  const addVendeur = async () => {
    const nom = newNom.trim();
    if (!nom || localId === "all") return;
    const exists = vendeurs.some(x => x.nom.trim().toLowerCase() === nom.toLowerCase());
    if (exists) { snack("Gen yon vandè ak non sa a deja.", "#e65100"); return; }
    await guard(async () => {
      const v: Vendeur = {
        id: Date.now().toString(), nom, telephone: newTel.trim(),
        balance: 0, ventes: [], historique: [], localId,
      };
      try {
        await withTimeout(setDoc(doc(db, "locals", localId, "vendeurs", v.id), v), 10000);
        setNewNom(""); setNewTel(""); setShowAddModal(false);
        snack("✅ Vandè ajoute.", "#00C853");
      } catch {
        snack("❌ Pa ajoute. Rezo a move, reeseye.", "red");
      }
    });
  };

  /** Retrait / Dépôt. opId inik: si w reeseye apre yon koupe rezo, menm
   *  operasyon an pa ekri de fwa. Retrè verifye "disponib" andedan tranzaksyon an. */
  const mouvementVendeur = async (v: Vendeur, montantBrut: number, retrait: boolean, opId: string) => {
    const m = r2(montantBrut);
    const lid = v.localId ?? localId;
    const ref = doc(db, "locals", lid, "vendeurs", v.id);
    return guard(async () => {
      try {
        await withTimeout(runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new Error("Vendeur introuvable");
          const current = snap.data() as Vendeur;
          const hist = [...(current.historique ?? [])];
          if (hist.some(e => e.opId === opId)) return; // deja fèt
          const bal = Number(current.balance ?? 0);
          if (retrait) {
            const d = calcDispo(current).disponible;
            if (m > d + 0.001) {
              throw new Error(`Le montant dépasse le disponible ($${d.toFixed(2)}). Le reste sera disponible après 15 jours.`);
            }
          }
          hist.push(histEntry({
            type: retrait ? "retrait" : "depot",
            montant: retrait ? -m : m,
            description: retrait ? "Retrait effectué" : "Dépôt effectué par l'admin",
            opId,
          }));
          tx.update(ref, { balance: r2(bal + (retrait ? -m : m)), historique: hist });
        }), 12000);
        snack(`✅ ${retrait ? "Retrait" : "Dépôt"} de $${m.toFixed(2)} effectué.`, "#00C853");
        setShowRetraitModal(null); setShowDepotModal(null);
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erè";
        if (msg === "TIMEOUT") {
          snack("Connexion trop lente — vérifiez le relevé avant de réessayer.", "red");
        } else {
          snack("❌ " + msg, "red");
        }
        return false;
      }
    });
  };

  /** Yon vandè pa ka siprime sèlman si balans FRE a ≈ 0. */
  const requestDeleteVendeur = async (v: Vendeur) => {
    if (busyRef.current) return;
    const lid = v.localId ?? localId;
    let balance = v.balance;
    try {
      const snap = await withTimeout(getDoc(doc(db, "locals", lid, "vendeurs", v.id)), 10000);
      if (snap.exists()) balance = Number(snap.data().balance ?? 0);
    } catch {
      snack("Impossible de vérifier le solde. Réessayez.", "red");
      return;
    }
    if (Math.abs(balance) >= 0.005) { setShowDeleteBlocked({ ...v, balance }); return; }
    setShowDeleteModal(v);
  };

  const deleteVendeur = async (v: Vendeur) => {
    const lid = v.localId ?? localId;
    await guard(async () => {
      try {
        await withTimeout(deleteDoc(doc(db, "locals", lid, "vendeurs", v.id)), 10000);
        setShowDeleteModal(null);
        snack("✅ Vendeur supprimé.", "#00C853");
      } catch {
        snack("❌ Pas de bonne connexion — vendeur non supprimé. Réessayez.", "red");
      }
    });
  };

  /** Siprime yon vant DEFINITIF. Matching pa ventId. Bloke si vandè a deja
   *  retire kòb la (disponib ta vin negatif). Trase: venteDate nan relevé. */
  const doSiprimeVente = async (v: Vendeur, t: Vente) => {
    const lid = v.localId ?? localId;
    const ref = doc(db, "locals", lid, "vendeurs", v.id);
    return guard(async () => {
      try {
        const result = await withTimeout(runTransaction(db, async (tx) => {
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
            venteId: (removed.id ?? "").toString(), marque: removed.marque,
            modele: removed.modele ?? removed.model,
            billNo: (removed.billNo ?? "").toString(), clientNom: removed.clientNom,
            cashier: removed.cashier, produitDescription: removed.description,
            venteDate: removed.date,
          })];
          const updated = { ...current, ventes, balance: r2(currentBalance - gain), historique };
          const avantBrut = calcDispo(current).brut;
          const apresBrut = calcDispo(updated).brut;
          if (apresBrut < -0.001 && apresBrut < avantBrut - 0.001) {
            throw new Error("Le vendeur a déjà retiré cet argent");
          }
          tx.set(ref, updated);
          return updated as Vendeur;
        }), 12000);
        setSelectedVendeur(prev => prev && prev.v.id === v.id ? { ...prev, v: { ...result, localId: lid } } : prev);
        snack("✅ Retrait effectué.", "#00C853");
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erè";
        snack(msg === "TIMEOUT" ? "Connexion trop lente — vérifiez avant de réessayer." : "❌ " + msg, "red");
        return false;
      }
    });
  };

  const editPhoneVendeur = async (v: Vendeur, telephone: string) => {
    const lid = v.localId ?? localId;
    const ref = doc(db, "locals", lid, "vendeurs", v.id);
    await guard(async () => {
      try {
        await withTimeout(runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new Error("Vendeur introuvable");
          tx.update(ref, { telephone });
        }), 12000);
        snack("✅ Numéro mis à jour.", "#00C853");
        setShowEditPhoneModal(null);
      } catch (e) {
        snack("❌ " + (e instanceof Error && e.message !== "TIMEOUT" ? e.message : "Connexion lente, réessayez."), "red");
      }
    });
  };

  const saveCommission = async (comm: Record<string,number>) => {
    await guard(async () => {
      try {
        // mergeFields: ranplase TOUT chan 'commission' (kategori efase yo disparèt vre)
        await withTimeout(
          setDoc(doc(db, "locals", "all"), { commission: comm }, { mergeFields: ["commission"] }), 8000);
        setCommission(comm);
        setShowCommModal(false);
        snack("✅ Komisyon sove.", "#00C853");
      } catch {
        snack("❌ Pa sove. Rezo a move, reeseye.", "red");
      }
    });
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
            <button onClick={() => setShowCommModal(true)} title="Commission" disabled={busy}
              style={{ background:"#1A1D2E", border:"none",
                color:"#aaa", width:36, height:36, borderRadius:10,
                cursor:"pointer", fontSize:16,
                display:"flex", alignItems:"center", justifyContent:"center" }}>
              ⚙️
            </button>
          )}
          {user.isAdmin && localId !== "all" && (
            <button onClick={() => setShowAddModal(true)} title="Ajouter un vendeur" disabled={busy}
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
      <BestSellerBanner localId={localId} compact />

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
                  <p style={{ margin:"4px 0 0", color:"#fff", fontSize:11, fontWeight:700 }}>
                    Disponible : ${totalDispo.toFixed(2)}  •  En attente : ${(totalGlobal - totalDispo).toFixed(2)}
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
                    const h = v.balance > 0 ? (v.balance / maxBalance) * 130 : 4;
                    return (
                      <div key={`${v.localId}-${v.id}`} style={{ flex:1, display:"flex",
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
                const dispo = calcDispo(v).disponible;
                return (
                  <div key={`${v.localId}-${v.id}`} onClick={() => setSelectedVendeur({v,color})}
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
                      <p style={{ margin:0, color:"#666", fontSize:10 }}>dispo ${dispo.toFixed(2)}</p>
                      {user.isAdmin && (
                        <div style={{ display:"flex", gap:4, marginTop:4, justifyContent:"flex-end" }}>
                          <button disabled={busy} onClick={e => { e.stopPropagation(); setShowDepotModal(v); }}
                            style={{ background:"rgba(41,121,255,0.2)", border:"none",
                              color:"#2979FF", padding:"2px 8px", borderRadius:8,
                              cursor:"pointer", fontSize:10, fontWeight:700 }}>
                            Dépôt
                          </button>
                          {dispo > 0 && (
                            <button disabled={busy} onClick={e => { e.stopPropagation(); setShowRetraitModal(v); }}
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
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {sorted.map((v,i) => {
              const color = colorOf(i);
              const active = v.ventes.filter(t => !t.annule);
              const totalGagne = active.reduce((s,t) => s+Number(t.gainTotal??0),0);
              const retraits = totalRetraits(v);
              const dispo = calcDispo(v).disponible;
              const alertes = releveComplet(v).filter(l => l.type === "suppression_definitive");
              const derniereAlerte = alertes[0];
              const nbVente = active.length;
              const zero = Math.abs(v.balance) < 0.005;

              return (
                <div key={`${v.localId}-${v.id}`} style={{ background:"#181B2A", borderRadius:16,
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
                      {/* Telefòn: ADMIN SÈLMAN */}
                      {user.isAdmin && v.telephone && (
                        <p style={{ margin:"2px 0 0", color:"#555", fontSize:11 }}>📞 {v.telephone}</p>
                      )}
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <p style={{ margin:0, color, fontWeight:700, fontSize:17 }}>
                        ${v.balance.toFixed(2)}
                      </p>
                      <p style={{ margin:0, color:"#666", fontSize:10 }}>dispo ${dispo.toFixed(2)}</p>
                    </div>
                    {user.isAdmin ? (
                      <>
                        <button onClick={e => { e.stopPropagation(); setShowEditPhoneModal(v); }}
                          title="Modifier le téléphone" disabled={busy}
                          style={{ background:"none", border:"none", cursor:"pointer",
                            color:"#2979FF", fontSize:16, marginRight:4 }}>
                          ✏️
                        </button>
                        <button onClick={e => { e.stopPropagation(); requestDeleteVendeur(v); }}
                          title={zero ? "Supprimer" : "Solde non nul — paiement requis"} disabled={busy}
                          style={{ background:"none", border:"none", cursor:"pointer",
                            color: zero ? "#ff4444" : "#2a2a2a", fontSize:20 }}>
                          🗑
                        </button>
                      </>
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
            })}
            </div>
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
                    { label:"Commission", val:`$${totalKom.toFixed(2)}`, c:"#ffa500" },
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
                      <div key={t.ventId ?? i} style={{ background:"rgba(255,255,255,0.03)",
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
                            { label:`Achat: $${pa.toFixed(2)}`, c:"#555555" },
                            { label:`Vente: $${pv.toFixed(2)}`, c:"#888888" },
                            { label:`Bén : $${ben.toFixed(2)}`, c:"#00C853" },
                            { label:`Com : $${kom.toFixed(2)}`, c:"#ffa500" },
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
      {releveVendeur && (
        <ReleveModal
          // toujou pran vèsyon pi fre a nan lis la (balans ka chanje an dirèk)
          v={vendeurs.find(x => x.id === releveVendeur.v.id && x.localId === releveVendeur.v.localId) ?? releveVendeur.v}
          color={releveVendeur.color}
          fallbackLocalId={localId}
          onClose={() => setReleveVendeur(null)}
        />
      )}

      {/* ═══════════════ MODAL: AJOUTE VENDEUR ═══════════════ */}
      {showAddModal && (
        <Modal title="Ajouter un vendeur" onClose={() => setShowAddModal(false)}>
          <input value={newNom} onChange={e => setNewNom(e.target.value)}
            placeholder="Nom du vendeur" autoFocus style={{ ...inputStyle, marginBottom:10 }} />
          <input value={newTel} onChange={e => setNewTel(e.target.value)}
            placeholder="Numéro de téléphone" style={inputStyle} />
          <div style={{ display:"flex", gap:8, marginTop:16 }}>
            <button onClick={() => setShowAddModal(false)} style={btnSecondary}>Annuler</button>
            <button onClick={addVendeur} disabled={busy} style={btnPrimary("#00C853")}>
              {busy ? "..." : "Ajouter"}
            </button>
          </div>
        </Modal>
      )}

      {/* ═══════════════ MODAL: RETRAIT ═══════════════ */}
      {showRetraitModal && (
        <MouvementModal retrait v={showRetraitModal} busy={busy}
          onClose={() => setShowRetraitModal(null)}
          onConfirm={(m, opId) => mouvementVendeur(showRetraitModal, m, true, opId)} />
      )}

      {/* ═══════════════ MODAL: DÉPÔT ═══════════════ */}
      {showDepotModal && (
        <MouvementModal retrait={false} v={showDepotModal} busy={busy}
          onClose={() => setShowDepotModal(null)}
          onConfirm={(m, opId) => mouvementVendeur(showDepotModal, m, false, opId)} />
      )}

      {/* ═══════════════ MODAL: TÉLÉPHONE ═══════════════ */}
      {showEditPhoneModal && (
        <EditPhoneModal v={showEditPhoneModal} busy={busy}
          onClose={() => setShowEditPhoneModal(null)}
          onConfirm={(tel) => editPhoneVendeur(showEditPhoneModal, tel)} />
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
            <button onClick={() => deleteVendeur(showDeleteModal)} disabled={busy} style={btnPrimary("#ff4444")}>
              {busy ? "..." : "Oui, supprimer"}
            </button>
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
        <CommissionModal commission={commission} busy={busy}
          onClose={() => setShowCommModal(false)} onSave={saveCommission} />
      )}

      {/* ── Snack ── */}
      {snackMsg && (
        <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)",
          background:snackColor, color:"#fff", padding:"10px 20px", borderRadius:12,
          fontWeight:600, zIndex:999, fontSize:13, boxShadow:"0 4px 12px rgba(0,0,0,0.3)",
          maxWidth:"90vw", textAlign:"center" }}>
          {snackMsg}
        </div>
      )}
    </main>
  );
}

// ─── RELEVÉ DE COMPTE (ak bouton "Voir archives") ───────────────────────────
function ReleveModal({ v, color, fallbackLocalId, onClose }: {
  v: Vendeur; color: string; fallbackLocalId: string; onClose: () => void;
}) {
  const lignes = releveComplet(v);
  const calc = calcDispo(v);
  const lid = v.localId ?? fallbackLocalId;
  const [archive, setArchive] = useState<HistEntry[] | null>(null);
  const [loadingArch, setLoadingArch] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadArch = async () => {
    if (loadingArch || lid === "all") return;
    setLoadingArch(true); setFailed(false);
    try {
      setArchive(await loadVendeurArchive(lid, v.id));
    } catch {
      setFailed(true);
    } finally { setLoadingArch(false); }
  };

  const iconMap: Record<string, string> = {
    vente: "🛒", restauration: "♻️", annulation: "🚫", suppression_definitive: "🗑", retrait: "💸", depot: "💰",
  };
  const titreMap: Record<string, string> = {
    vente: "Vente ajoutée", restauration: "Vente restaurée", annulation: "Vente annulée",
    suppression_definitive: "Vente enlevée", retrait: "Retrait effectué", depot: "Dépôt effectué",
  };

  const ligne = (l: HistEntry, i: number, isArchive: boolean) => {
    const montant = Number(l.montant ?? 0);
    const isCredit = montant > 0;
    const isDebit = montant < 0;
    const soldeApres = l.soldeApres ?? 0;
    const phrase = isArchive
      ? `Mouvement archivé (+90 jours) : $${Math.abs(montant).toFixed(2)}.`
      : phraseMouvement(l.type, montant, soldeApres - montant, soldeApres);
    return (
      <div key={`${isArchive ? "a" : "r"}${i}`} style={{ background:"rgba(255,255,255,0.03)",
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
            {isCredit ? `+$${montant.toFixed(2)}` : isDebit ? `-$${Math.abs(montant).toFixed(2)}` : "—"}
          </span>
        </div>
        <p style={{ margin:"0 0 8px", color:"#999", fontSize:11, lineHeight:1.4 }}>{phrase}</p>
        {(l.marque || l.modele || l.venteId || l.billNo) && (
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:6 }}>
            {(l.marque || l.modele) && <Badge text={`${l.marque ?? ""} ${l.modele ?? ""}`.trim()} c="#aaaaaa"/>}
            {l.venteId && <Badge text={`ID : ${l.venteId}`} c="#555555"/>}
            {l.billNo && <Badge text={`N° ${l.billNo}`} c="#555555"/>}
          </div>
        )}
        {(l.produitDescription || l.clientNom || l.cashier) && (
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:6 }}>
            {l.produitDescription && <Badge text={l.produitDescription} c="#555555"/>}
            {l.clientNom && <Badge text={`Client : ${l.clientNom}`} c="#26c6da"/>}
            {l.cashier && <Badge text={`Caissier : ${l.cashier}`} c="#42a5f5"/>}
          </div>
        )}
        {!isArchive && (
          <div style={{ textAlign:"right" }}>
            <Badge text={`Solde après : $${soldeApres.toFixed(2)}`} c={color}/>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"#0F1117", zIndex:250, overflowY:"auto" }}>
      <div style={{ position:"sticky", top:0, background:"#0F1117",
        borderBottom:"1px solid #1e1e2e", padding:"14px 16px",
        display:"flex", alignItems:"center", gap:10, zIndex:10 }}>
        <button onClick={onClose}
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
            <p style={{ margin:"4px 0 0", color:"#fff", fontSize:11, fontWeight:700 }}>
              Disponible : ${calc.disponible.toFixed(2)}  •  En attente : ${calc.enAttente.toFixed(2)}
            </p>
          </div>
          <span style={{ fontSize:30 }}>🏦</span>
        </div>

        {lignes.length === 0 ? (
          <p style={{ textAlign:"center", color:"#555", marginTop:30, marginBottom:30 }}>Aucun mouvement récent</p>
        ) : lignes.map((l, i) => ligne(l, i, false))}

        {/* ── Archives ── */}
        {lid !== "all" && (archive === null ? (
          <button onClick={loadArch} disabled={loadingArch}
            style={{ width:"100%", padding:12, background:"none", color,
              border:`1px solid ${color}99`, borderRadius:12, cursor:"pointer",
              fontWeight:700, fontSize:13, marginTop:8 }}>
            {loadingArch ? "Chargement..." : "📦 Voir archives (+90 jours)"}
          </button>
        ) : (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:8, margin:"14px 0 10px" }}>
              <span style={{ color:"#888", fontWeight:700, fontSize:12 }}>📦 Archives ({archive.length})</span>
              <div style={{ flex:1, height:1, background:"#ffffff1a" }}/>
            </div>
            {archive.length === 0
              ? <p style={{ textAlign:"center", color:"#555" }}>Aucun mouvement archivé</p>
              : archive.map((l, i) => ligne(l, i, true))}
          </>
        ))}
        {failed && (
          <p style={{ textAlign:"center", color:"#ff5252", fontSize:12, marginTop:8 }}>
            Impossible de charger les archives. Vérifiez la connexion.
          </p>
        )}
      </div>
    </div>
  );
}

/** Bannière d'alerte sur la ligne du vendeur après un retrait (Siprime). */
function AlerteVente({ alerte, balance, nbAlertes }: { alerte: HistEntry; balance: number; nbAlertes: number }) {
  const marque = alerte.marque ?? "";
  const modele = alerte.modele ?? "";
  const details = [
    (marque || modele) ? `${marque} ${modele}`.trim() : null,
    alerte.venteId ? `ID : ${alerte.venteId}` : null,
    alerte.billNo ? `N° ${alerte.billNo}` : null,
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

/** Retrait ak Dépôt nan yon sèl modal. opId kreye yon fwa lè modal la louvri:
 *  si w reeseye nan menm modal la, menm operasyon an pa ekri de fwa. */
function MouvementModal({ v, retrait, busy, onClose, onConfirm }: {
  v: Vendeur; retrait: boolean; busy: boolean; onClose: () => void;
  onConfirm: (montant: number, opId: string) => void;
}) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [opId] = useState(() => `${Date.now()}${Math.floor(Math.random() * 1e6)}`);
  const calc = calcDispo(v);

  const submit = () => {
    if (busy) return;
    const m = parseFloat(val.replace(",", "."));
    if (isNaN(m) || m <= 0) { setErr("Montant invalide"); return; }
    if (m > 1000000) { setErr("Montant trop élevé"); return; }
    if (retrait && m > calc.disponible + 0.001) {
      setErr(`Dépasse le disponible ($${calc.disponible.toFixed(2)})`); return;
    }
    onConfirm(m, opId);
  };

  return (
    <Modal title={retrait ? "Retrait" : "Dépôt"} onClose={busy ? () => {} : onClose}>
      <p style={{ color:"#888", margin:"0 0 6px", fontSize:13 }}>
        Solde de {v.nom} : ${v.balance.toFixed(2)}
      </p>
      {retrait && (
        <>
          <p style={{ color:"#00C853", margin:"0 0 2px", fontSize:13, fontWeight:700 }}>
            Disponible (15 jours+) : ${calc.disponible.toFixed(2)}
          </p>
          <p style={{ color:"#ffab40", margin:"0 0 10px", fontSize:12 }}>
            En attente (&lt; 15 jours) : ${calc.enAttente.toFixed(2)}
          </p>
        </>
      )}
      <input type="number" step="0.01" value={val} autoFocus disabled={busy}
        onChange={e => { setVal(e.target.value); setErr(null); }}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
        placeholder={retrait ? "Montant du retrait" : "Montant du dépôt"} style={inputStyle} />
      {err && <p style={{ color:"#ff4444", fontSize:12, margin:"6px 0 0" }}>{err}</p>}
      <div style={{ display:"flex", gap:8, marginTop:16 }}>
        <button onClick={onClose} disabled={busy} style={btnSecondary}>Annuler</button>
        <button onClick={submit} disabled={busy} style={btnPrimary(retrait ? "#00C853" : "#2979FF")}>
          {busy ? "..." : "Confirmer"}
        </button>
      </div>
    </Modal>
  );
}

function EditPhoneModal({ v, busy, onClose, onConfirm }: {
  v: Vendeur; busy: boolean; onClose: () => void; onConfirm: (telephone: string) => void;
}) {
  const [val, setVal] = useState(v.telephone ?? "");
  return (
    <Modal title="Numéro de téléphone" onClose={onClose}>
      <p style={{ color:"#888", margin:"0 0 12px", fontSize:13 }}>
        Vendeur : {v.nom}
      </p>
      <input value={val} autoFocus
        onChange={e => setVal(e.target.value)}
        placeholder="Numéro de téléphone" style={inputStyle} />
      <div style={{ display:"flex", gap:8, marginTop:16 }}>
        <button onClick={onClose} style={btnSecondary}>Annuler</button>
        <button onClick={() => onConfirm(val.trim())} disabled={busy} style={btnPrimary("#2979FF")}>
          {busy ? "..." : "Enregistrer"}
        </button>
      </div>
    </Modal>
  );
}

// ─── COMMISSION MODAL ────────────────────────────────────────────────────────
function CommissionModal({ commission, busy, onClose, onSave }: {
  commission: Record<string,number>;
  busy: boolean;
  onClose: () => void;
  onSave: (c: Record<string,number>) => void;
}) {
  // Kopi lokal: anyen pa chanje jiskaske w klike "Enregistrer"
  const [local, setLocal] = useState<Record<string,string>>(
    Object.fromEntries(Object.entries(commission).map(([k, v]) => [k, String(v)])));
  const [newCat, setNewCat] = useState("");
  const [newVal, setNewVal] = useState("");

  const toNum = (s: string) => {
    const n = parseFloat((s ?? "").replace(",", "."));
    return isNaN(n) || n < 0 ? 0 : r2(n);
  };

  return (
    <Modal title="Commission par catégorie" onClose={onClose}>
      <div style={{ maxHeight:300, overflowY:"auto" }}>
        {Object.entries(local).map(([cat, val]) => (
          <div key={cat} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <span style={{ flex:1, color:"#fff", fontSize:14 }}>{cat}</span>
            <input type="text" inputMode="decimal" value={val}
              onChange={e => setLocal(p => ({ ...p, [cat]: e.target.value }))}
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
            placeholder="$" type="text" inputMode="decimal" style={{ ...inputStyle, width:70, margin:0 }}/>
          <button onClick={() => {
            const nom = newCat.trim();
            if (!nom) return;
            setLocal(p => ({ ...p, [nom]: String(toNum(newVal)) }));
            setNewCat(""); setNewVal("");
          }} style={{ background:"rgba(0,200,83,0.2)", border:"none",
            color:"#00C853", width:32, height:32, borderRadius:"50%",
            cursor:"pointer", fontSize:18 }}>+</button>
        </div>
      </div>
      <div style={{ display:"flex", gap:8, marginTop:16 }}>
        <button onClick={onClose} style={btnSecondary}>Annuler</button>
        <button disabled={busy}
          onClick={() => onSave(Object.fromEntries(Object.entries(local).map(([k, v]) => [k, toNum(v)])))}
          style={btnPrimary("#00C853")}>
          {busy ? "..." : "Enregistrer"}
        </button>
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