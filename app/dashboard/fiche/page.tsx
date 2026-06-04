"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, setDoc, getDoc
} from "firebase/firestore";
import {
  FileText, Plus, Search, X, ChevronLeft, Trash2, Edit,
  User, Phone, MapPin, Package, DollarSign, History,
  BarChart2, CheckCircle, XCircle, Printer, RefreshCw,
  ShoppingCart, Tag
} from "lucide-react";

// ── COULÈ ──
const kPink  = "#E91E63";
const kMove  = "#2D2D2D";
const kGreen = "#00E676";
const kBg    = "#F2F2F2";

interface UserSession {
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  permissions: Record<string, boolean>;
}

interface FKliyan {
  id: string;
  nom: string;
  phone: string;
  adres: string;
  device: string;
  localId: string;
}

interface FProduit {
  id: string;
  mak: string;
  description: string;
  prix: number;
  localId: string;
}

interface Facture {
  id: string;
  docId?: string;
  billNo: string;
  date: string;
  localId: string;
  vendeur: string;
  modePeman: string;
  mone: string;
  taux: number;
  total: number;
  totalHTG: number;
  annule: boolean;
  kliyan: { nom: string; phone: string; adres: string; device: string };
  produits: { id: string; mak: string; description: string; prix: number; qty: number }[];
}

const MONE_OPTIONS = ["HTG", "$"];
const PEMAN_OPTIONS = ["Cash", "Bancaire", "MonCash", "NatCash"];
const TABS = ["Fiche", "Rapo", "Istwa"];

function fmtDate(raw: string) {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  } catch { return ""; }
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FichePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [tab, setTab] = useState(0);

  // ── DONE ──
  const [kliyanList, setKliyanList] = useState<FKliyan[]>([]);
  const [produitList, setProduitList] = useState<FProduit[]>([]);
  const [factures, setFactures] = useState<Facture[]>([]);
  const [taux, setTaux] = useState(135);
  const [loading, setLoading] = useState(true);

  // ── FICHE STATE ──
  const [selKliyan, setSelKliyan] = useState<FKliyan | null>(null);
  const [selProduits, setSelProduits] = useState<FProduit[]>([]);
  const [quantites, setQuantites] = useState<Record<string, number>>({});
  const [mone, setMone] = useState("HTG");
  const [modePeman, setModePeman] = useState("Cash");

  // ── MODALS ──
  const [showKliyanModal, setShowKliyanModal] = useState(false);
  const [showProduitModal, setShowProduitModal] = useState(false);
  const [showKliyanForm, setShowKliyanForm] = useState(false);
  const [showProduitForm, setShowProduitForm] = useState(false);
  const [editKliyan, setEditKliyan] = useState<FKliyan | null>(null);
  const [editProduit, setEditProduit] = useState<FProduit | null>(null);
  const [kliyanSearch, setKliyanSearch] = useState("");
  const [produitSearch, setProduitSearch] = useState("");
  const [istwaSearch, setIstwaSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [billCounter, setBillCounter] = useState(1);

  // ── FORM KLIYAN ──
  const [fkNom, setFkNom] = useState("");
  const [fkPhone, setFkPhone] = useState("");
  const [fkAdres, setFkAdres] = useState("");
  const [fkDevice, setFkDevice] = useState("");

  // ── FORM PWODWI ──
  const [fpId, setFpId] = useState("");
  const [fpMak, setFpMak] = useState("");
  const [fpDesc, setFpDesc] = useState("");
  const [fpPrix, setFpPrix] = useState("");

  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const session = JSON.parse(raw) as UserSession;
      if (!session.isAdmin && !session.permissions?.ficheVoir) {
        router.push("/dashboard"); return;
      }
      setUser(session);
      loadAll(session);
    } catch { router.push("/login"); }
  }, []);

  const canAddKliyan  = user?.isAdmin || user?.permissions?.ficheAjouteKliyan;
  const canEditKliyan = user?.isAdmin || user?.permissions?.ficheModifyeKliyan;
  const canDelKliyan  = user?.isAdmin || user?.permissions?.ficheSiprimeKliyan;
  const canAddProduit = user?.isAdmin || user?.permissions?.ficheAjoutePwodwi;
  const canEditProduit= user?.isAdmin || user?.permissions?.ficheModifyePwodwi;
  const canDelProduit = user?.isAdmin || user?.permissions?.ficheSiprimePwodwi;
  const canRapo       = user?.isAdmin || user?.permissions?.ficheRapo;
  const canIstwa      = user?.isAdmin || user?.permissions?.ficheIstwa;

  async function loadAll(session: UserSession) {
    setLoading(true);
    const localId = session.localId === "all" ? "" : session.localId;

    // Taux
    try {
      const snap = await getDoc(doc(db, "config", "taux"));
      if (snap.exists()) setTaux((snap.data().valeur as number) ?? 135);
    } catch {}

    // Bill counter
    const saved = parseInt(localStorage.getItem("fiche_bill_counter") ?? "0");
    setBillCounter(saved + 1);

    // Kliyan stream
    const kliyanQ = collection(db, "fiche_kliyan");
    onSnapshot(kliyanQ, snap => {
      let list = snap.docs.map(d => ({ id: d.id, ...d.data() } as FKliyan));
      if (localId) list = list.filter(k => k.localId === localId);
      list.sort((a, b) => a.nom.localeCompare(b.nom));
      setKliyanList(list);
    });

    // Produit stream
    const produitQ = collection(db, "fiche_produits");
    onSnapshot(produitQ, snap => {
      let list = snap.docs.map(d => ({ id: d.id, ...d.data() } as FProduit));
      if (localId) list = list.filter(p => p.localId === localId);
      list.sort((a, b) => a.mak.localeCompare(b.mak));
      setProduitList(list);
    });

    // Factures stream
    const factureQ = collection(db, "fiches_factures");
    onSnapshot(factureQ, snap => {
      let list = snap.docs.map(d => ({ id: d.id, docId: d.id, ...d.data() } as Facture));
      if (localId) list = list.filter(f => f.localId === localId);
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setFactures(list);
    });

    setLoading(false);
  }

  // ── KALKIL ──
  const totalDollar = selProduits.reduce((s, p) => s + p.prix * (quantites[p.id] ?? 1), 0);
  const totalHTG    = totalDollar * taux;
  const totalAff    = mone === "HTG" ? totalHTG : totalDollar;
  const totalFmt    = mone === "HTG" ? `HTG ${fmt(totalHTG)}` : `$ ${fmt(totalDollar)}`;

  // ── SOVE KLIYAN ──
  async function saveKliyan() {
    if (!fkNom.trim()) { alert("Non kliyan obligatwa!"); return; }
    setSaving(true);
    const localId = user?.localId === "all" ? "" : (user?.localId ?? "");
    const data = { nom: fkNom.trim(), phone: fkPhone.trim(), adres: fkAdres.trim(), device: fkDevice.trim(), localId };
    try {
      if (editKliyan) {
        await updateDoc(doc(db, "fiche_kliyan", editKliyan.id), data);
      } else {
        await addDoc(collection(db, "fiche_kliyan"), data);
      }
      setShowKliyanForm(false);
      resetKliyanForm();
    } catch (e) { alert("Erè: " + e); }
    setSaving(false);
  }

  function resetKliyanForm() {
    setFkNom(""); setFkPhone(""); setFkAdres(""); setFkDevice("");
    setEditKliyan(null);
  }

  function openEditKliyan(k: FKliyan) {
    setEditKliyan(k);
    setFkNom(k.nom); setFkPhone(k.phone); setFkAdres(k.adres); setFkDevice(k.device);
    setShowKliyanForm(true);
    setShowKliyanModal(false);
  }

  async function deleteKliyan(k: FKliyan) {
    if (!confirm(`Siprime ${k.nom}?`)) return;
    await deleteDoc(doc(db, "fiche_kliyan", k.id));
  }

  // ── SOVE PWODWI ──
  async function saveProduit() {
    if (!fpMak.trim() || !fpPrix) { alert("Mak ak prix obligatwa!"); return; }
    setSaving(true);
    const localId = user?.localId === "all" ? "" : (user?.localId ?? "");
    const data = { mak: fpMak.trim(), description: fpDesc.trim(), prix: parseFloat(fpPrix), localId };
    try {
      if (editProduit) {
        await updateDoc(doc(db, "fiche_produits", editProduit.id), data);
      } else {
        const newId = fpId.trim() || `p_${Date.now()}`;
        await setDoc(doc(db, "fiche_produits", newId), { ...data, id: newId });
      }
      setShowProduitForm(false);
      resetProduitForm();
    } catch (e) { alert("Erè: " + e); }
    setSaving(false);
  }

  function resetProduitForm() {
    setFpId(""); setFpMak(""); setFpDesc(""); setFpPrix("");
    setEditProduit(null);
  }

  function openEditProduit(p: FProduit) {
    setEditProduit(p);
    setFpId(p.id); setFpMak(p.mak); setFpDesc(p.description); setFpPrix(p.prix.toString());
    setShowProduitForm(true);
    setShowProduitModal(false);
  }

  async function deleteProduit(p: FProduit) {
    if (!confirm(`Siprime ${p.mak}?`)) return;
    await deleteDoc(doc(db, "fiche_produits", p.id));
  }

  // ── KREYE FACTURE ──
  async function createFacture() {
    if (!selKliyan) { alert("Chwazi yon kliyan!"); return; }
    if (selProduits.length === 0) { alert("Ajoute omwen yon pwodwi!"); return; }

    setSaving(true);
    const counter = billCounter;
    const billNo  = String(counter).padStart(3, "0");
    localStorage.setItem("fiche_bill_counter", String(counter));
    setBillCounter(counter + 1);

    const now     = new Date().toISOString();
    const localId = user?.localId === "all" ? "" : (user?.localId ?? "");
    const produits = selProduits.map(p => ({
      id: p.id, mak: p.mak, description: p.description,
      prix: p.prix * (quantites[p.id] ?? 1),
      qty: quantites[p.id] ?? 1,
    }));

    const facture = {
      billNo, date: now, localId,
      vendeur: user?.displayName ?? "",
      modePeman, mone, taux, total: totalAff, totalHTG,
      annule: false,
      kliyan: { nom: selKliyan.nom, phone: selKliyan.phone, adres: selKliyan.adres, device: selKliyan.device },
      produits,
      createdAt: now,
    };

    try {
      await addDoc(collection(db, "fiches_factures"), facture);
      setSelKliyan(null);
      setSelProduits([]);
      setQuantites({});
      setMone("HTG");
      setModePeman("Cash");
      alert(`✅ Facture #${billNo} kreye!`);
    } catch (e) { alert("Erè: " + e); }
    setSaving(false);
  }

  // ── ANILE FACTURE ──
  async function annuleFacture(f: Facture) {
    if (!confirm(`Anile Facture #${f.billNo}?`)) return;
    await updateDoc(doc(db, "fiches_factures", f.docId ?? f.id), { annule: true });
  }

  async function siprimeFacture(f: Facture) {
    if (!confirm(`Siprime Facture #${f.billNo} pou toujou?`)) return;
    await deleteDoc(doc(db, "fiches_factures", f.docId ?? f.id));
  }

  // ── FILTRE ──
  const filteredKliyan  = kliyanList.filter(k => k.nom.toLowerCase().includes(kliyanSearch.toLowerCase()) || k.phone.includes(kliyanSearch));
  const filteredProduit = produitList.filter(p => p.mak.toLowerCase().includes(produitSearch.toLowerCase()) || p.id.toLowerCase().includes(produitSearch.toLowerCase()));
  const nonAnnule       = factures.filter(f => !f.annule);
  const filteredIstwa   = factures.filter(f => {
    const q = istwaSearch.toLowerCase();
    return !q || f.billNo.includes(q) || (f.kliyan?.nom ?? "").toLowerCase().includes(q) || f.produits?.some(p => p.mak.toLowerCase().includes(q));
  });
  const grandTotal = nonAnnule.reduce((s, f) => s + (f.produits ?? []).reduce((ps, p) => ps + (p.prix ?? 0), 0), 0);

  if (loading) return (
    <main style={{ minHeight: "100vh", background: kBg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: "48px", height: "48px", border: `4px solid #eee`, borderTop: `4px solid ${kPink}`, borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ color: "#888" }}>Chajman...</p>
      </div>
    </main>
  );

  return (
    <main style={{ minHeight: "100vh", background: kBg, fontFamily: "'Segoe UI', sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{ background: kMove, padding: "0 16px", boxShadow: "0 2px 10px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button onClick={() => router.push("/dashboard")} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "8px", borderRadius: "8px", cursor: "pointer" }}>
              <ChevronLeft size={18} />
            </button>
            <div>
              <p style={{ margin: 0, color: "#fff", fontWeight: 700, fontSize: "16px" }}>Fiche Kliyan</p>
              <p style={{ margin: 0, color: "#aaa", fontSize: "11px" }}>{user?.displayName}</p>
            </div>
          </div>
          {/* Aksyon rapide */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button onClick={() => setShowKliyanModal(true)} style={{ background: selKliyan ? kPink : "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "8px 12px", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
              👤 {selKliyan ? selKliyan.nom.split(" ")[0] : "Kliyan"}
            </button>
            <button onClick={() => setShowProduitModal(true)} style={{ background: selProduits.length > 0 ? "#1565C0" : "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "8px 12px", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
              📦 {selProduits.length > 0 ? `${selProduits.length} pwodwi` : "Pwodwi"}
            </button>
            <select value={mone} onChange={e => setMone(e.target.value)} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "8px", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
              {MONE_OPTIONS.map(m => <option key={m} value={m} style={{ color: "#000" }}>{m}</option>)}
            </select>
            <select value={modePeman} onChange={e => setModePeman(e.target.value)} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "8px", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
              {PEMAN_OPTIONS.map(m => <option key={m} value={m} style={{ color: "#000" }}>{m}</option>)}
            </select>
            <button onClick={createFacture} disabled={saving} style={{ background: kGreen, border: "none", color: kMove, padding: "8px 16px", borderRadius: "8px", cursor: saving ? "not-allowed" : "pointer", fontSize: "12px", fontWeight: 900, opacity: saving ? 0.7 : 1 }}>
              ✅ TCHeK
            </button>
          </div>
        </div>

        {/* TABS */}
        <div style={{ display: "flex", gap: "4px", paddingBottom: "0" }}>
          {TABS.map((t, i) => (
            <button key={t} onClick={() => setTab(i)}
              style={{ padding: "10px 16px", background: "none", border: "none", color: tab === i ? kGreen : "#ffffff80", fontWeight: tab === i ? 700 : 400, borderBottom: tab === i ? `2px solid ${kGreen}` : "2px solid transparent", cursor: "pointer", fontSize: "13px" }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB 0 — FICHE ── */}
      {tab === 0 && (
        <div>
          {/* Total */}
          <div style={{ background: kMove, padding: "20px 16px", textAlign: "center" }}>
            <p style={{ margin: "0 0 4px", color: "#ffffff60", fontSize: "13px", fontWeight: 700, letterSpacing: "1px" }}>
              CLIENT: {selKliyan ? selKliyan.nom.toUpperCase() : "NON SELEKSYONE"}
            </p>
            <p style={{ margin: "0 0 8px", color: kGreen, fontSize: "42px", fontWeight: 900, letterSpacing: "1px" }}>{totalFmt}</p>
            <p style={{ margin: 0, color: "#ffffff60", fontSize: "14px" }}>Mode: {modePeman} • Taux: {taux} HTG/$</p>
          </div>

          {/* Lis pwodwi selekte */}
          <div style={{ maxWidth: "860px", margin: "0 auto", padding: "16px" }}>
            {selProduits.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: "16px", padding: "48px", textAlign: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <ShoppingCart size={48} color="#ddd" style={{ marginBottom: "12px" }} />
                <p style={{ color: "#aaa", marginBottom: "16px" }}>Fakti a vid — Ajoute pwodwi</p>
                <button onClick={() => setShowProduitModal(true)} style={{ background: kPink, color: "#fff", border: "none", padding: "12px 24px", borderRadius: "12px", cursor: "pointer", fontWeight: 700 }}>
                  + Ajoute Pwodwi
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {selProduits.map((p, i) => {
                  const q = quantites[p.id] ?? 1;
                  const prixAff = mone === "HTG" ? `HTG ${fmt(p.prix * taux * q)}` : `$ ${fmt(p.prix * q)}`;
                  return (
                    <div key={p.id} style={{ background: "#fff", borderRadius: "14px", padding: "14px 16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: kMove, display: "flex", alignItems: "center", justifyContent: "center", color: kGreen, fontWeight: 700, fontSize: "16px", flexShrink: 0 }}>
                        {(p.mak || "?")[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: "14px" }}>{p.mak}</p>
                        {p.description && <p style={{ margin: 0, color: "#888", fontSize: "11px" }}>{p.description}</p>}
                        <p style={{ margin: 0, color: kGreen, fontWeight: 700, fontSize: "13px" }}>{prixAff}</p>
                      </div>
                      {/* Quantite */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <button onClick={() => {
                          const nq = q - 1;
                          if (nq <= 0) {
                            setSelProduits(sp => sp.filter(x => x.id !== p.id));
                            setQuantites(qts => { const n = { ...qts }; delete n[p.id]; return n; });
                          } else {
                            setQuantites(qts => ({ ...qts, [p.id]: nq }));
                          }
                        }} style={{ width: "28px", height: "28px", background: "#ffebee", border: "none", borderRadius: "8px", cursor: "pointer", color: "#f44336", fontWeight: 700, fontSize: "16px" }}>−</button>
                        <span style={{ fontWeight: 700, fontSize: "16px", minWidth: "20px", textAlign: "center" }}>{q}</span>
                        <button onClick={() => setQuantites(qts => ({ ...qts, [p.id]: q + 1 }))} style={{ width: "28px", height: "28px", background: "#e8f5e9", border: "none", borderRadius: "8px", cursor: "pointer", color: kGreen, fontWeight: 700, fontSize: "16px" }}>+</button>
                      </div>
                    </div>
                  );
                })}
                <button onClick={() => setShowProduitModal(true)} style={{ background: "#fff", border: `2px dashed ${kPink}40`, color: kPink, padding: "12px", borderRadius: "14px", cursor: "pointer", fontWeight: 700, fontSize: "14px" }}>
                  + Ajoute plis pwodwi
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 1 — RAPO ── */}
      {tab === 1 && (
        <div style={{ maxWidth: "860px", margin: "0 auto", padding: "16px" }}>
          {!canRapo ? (
            <div style={{ background: "#fff", borderRadius: "16px", padding: "48px", textAlign: "center" }}>
              <p style={{ fontSize: "48px" }}>🔒</p>
              <p style={{ color: "#aaa" }}>Ou pa gen pèmisyon pou wè rapo.</p>
            </div>
          ) : (
            <>
              <div style={{ background: kMove, borderRadius: "16px", padding: "20px", marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ margin: 0, color: "#ffffff60", fontSize: "12px" }}>Grand Total</p>
                  <p style={{ margin: 0, color: kGreen, fontWeight: 900, fontSize: "24px" }}>$ {fmt(grandTotal)}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: 0, color: "#ffffff60", fontSize: "12px" }}>Nòm Facture</p>
                  <p style={{ margin: 0, color: "#fff", fontWeight: 900, fontSize: "32px" }}>{nonAnnule.length}</p>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {nonAnnule.map(f => <FactureCard key={f.id} f={f} isAdmin={user?.isAdmin ?? false} taux={taux} showActions={false} onAnnule={annuleFacture} onSiprime={siprimeFacture} />)}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── TAB 2 — ISTWA ── */}
      {tab === 2 && (
        <div style={{ maxWidth: "860px", margin: "0 auto", padding: "16px" }}>
          {!canIstwa ? (
            <div style={{ background: "#fff", borderRadius: "16px", padding: "48px", textAlign: "center" }}>
              <p style={{ fontSize: "48px" }}>🔒</p>
              <p style={{ color: "#aaa" }}>Ou pa gen pèmisyon pou wè istwa.</p>
            </div>
          ) : (
            <>
              <div style={{ position: "relative", marginBottom: "14px" }}>
                <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#aaa" }} />
                <input placeholder="Chèche #Bill, kliyan, pwodwi..." value={istwaSearch} onChange={e => setIstwaSearch(e.target.value)}
                  style={{ width: "100%", padding: "11px 14px 11px 38px", borderRadius: "12px", border: "none", fontSize: "14px", outline: "none", background: "#fff", boxSizing: "border-box", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {filteredIstwa.length === 0 ? (
                  <div style={{ background: "#fff", borderRadius: "16px", padding: "48px", textAlign: "center" }}>
                    <History size={48} color="#ddd" />
                    <p style={{ color: "#aaa" }}>Pa gen istwa toujou</p>
                  </div>
                ) : filteredIstwa.map(f => (
                  <FactureCard key={f.id} f={f} isAdmin={user?.isAdmin ?? false} taux={taux} showActions onAnnule={annuleFacture} onSiprime={siprimeFacture} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── MODAL KLIYAN ── */}
      {showKliyanModal && (
        <Modal onClose={() => setShowKliyanModal(false)} title="Chwazi Kliyan">
          <div style={{ padding: "0 0 12px" }}>
            <div style={{ position: "relative", marginBottom: "12px" }}>
              <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#aaa" }} />
              <input placeholder="Chèche..." value={kliyanSearch} onChange={e => setKliyanSearch(e.target.value)}
                style={{ width: "100%", padding: "9px 12px 9px 32px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "13px", outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontWeight: 700, color: "#333" }}>Kliyan ({kliyanList.length})</span>
              {canAddKliyan && (
                <button onClick={() => { resetKliyanForm(); setShowKliyanForm(true); setShowKliyanModal(false); }}
                  style={{ background: kPink, color: "#fff", border: "none", padding: "8px 14px", borderRadius: "8px", cursor: "pointer", fontWeight: 700, fontSize: "13px" }}>
                  + Nouvo
                </button>
              )}
            </div>
            <div style={{ maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
              {filteredKliyan.length === 0 ? (
                <p style={{ textAlign: "center", color: "#aaa", padding: "24px 0" }}>Pa gen kliyan</p>
              ) : filteredKliyan.map(k => (
                <div key={k.id} onClick={() => { setSelKliyan(k); setShowKliyanModal(false); }}
                  style={{ background: selKliyan?.id === k.id ? `${kPink}15` : "#f9f9f9", borderRadius: "12px", padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px", border: selKliyan?.id === k.id ? `1.5px solid ${kPink}` : "1.5px solid transparent" }}>
                  <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: kPink, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, flexShrink: 0 }}>
                    {(k.nom || "?")[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: "14px", color: selKliyan?.id === k.id ? kPink : "#333" }}>{k.nom}</p>
                    {k.phone && <p style={{ margin: 0, color: "#888", fontSize: "12px" }}>{k.phone}</p>}
                  </div>
                  <div style={{ display: "flex", gap: "6px" }} onClick={e => e.stopPropagation()}>
                    {canEditKliyan && <button onClick={() => openEditKliyan(k)} style={{ background: "#e3f2fd", border: "none", color: "#1976D2", padding: "6px", borderRadius: "6px", cursor: "pointer" }}><Edit size={13} /></button>}
                    {canDelKliyan && <button onClick={() => deleteKliyan(k)} style={{ background: "#ffebee", border: "none", color: "#f44336", padding: "6px", borderRadius: "6px", cursor: "pointer" }}><Trash2 size={13} /></button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL PWODWI ── */}
      {showProduitModal && (
        <Modal onClose={() => setShowProduitModal(false)} title="Chwazi Pwodwi">
          <div style={{ padding: "0 0 12px" }}>
            <div style={{ position: "relative", marginBottom: "12px" }}>
              <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#aaa" }} />
              <input placeholder="Chèche..." value={produitSearch} onChange={e => setProduitSearch(e.target.value)}
                style={{ width: "100%", padding: "9px 12px 9px 32px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "13px", outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontWeight: 700, color: "#333" }}>Pwodwi ({produitList.length})</span>
              {canAddProduit && (
                <button onClick={() => { resetProduitForm(); setShowProduitForm(true); setShowProduitModal(false); }}
                  style={{ background: kPink, color: "#fff", border: "none", padding: "8px 14px", borderRadius: "8px", cursor: "pointer", fontWeight: 700, fontSize: "13px" }}>
                  + Nouvo
                </button>
              )}
            </div>
            <div style={{ maxHeight: "320px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
              {filteredProduit.length === 0 ? (
                <p style={{ textAlign: "center", color: "#aaa", padding: "24px 0" }}>Pa gen pwodwi</p>
              ) : filteredProduit.map(p => {
                const prixAff = mone === "HTG" ? `HTG ${fmt(p.prix * taux)}` : `$ ${fmt(p.prix)}`;
                return (
                  <div key={p.id} style={{ background: "#f9f9f9", borderRadius: "12px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                      <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: kMove, display: "flex", alignItems: "center", justifyContent: "center", color: kGreen, fontWeight: 700, flexShrink: 0 }}>
                        {(p.mak || "?")[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: "14px" }}>{p.mak}</p>
                        {p.description && <p style={{ margin: 0, color: "#888", fontSize: "11px" }}>{p.description}</p>}
                        <p style={{ margin: 0, color: kGreen, fontWeight: 700, fontSize: "13px" }}>{prixAff}</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => {
                        if (!selProduits.find(x => x.id === p.id)) setSelProduits(sp => [...sp, p]);
                        setQuantites(qts => ({ ...qts, [p.id]: (qts[p.id] ?? 0) + 1 }));
                        setShowProduitModal(false);
                      }} style={{ flex: 1, background: `${kGreen}20`, border: `1px solid ${kGreen}40`, color: kGreen, padding: "8px", borderRadius: "8px", cursor: "pointer", fontWeight: 700, fontSize: "12px" }}>
                        + Ajoute
                      </button>
                      {canEditProduit && <button onClick={() => openEditProduit(p)} style={{ background: "#e3f2fd", border: "none", color: "#1976D2", padding: "8px 10px", borderRadius: "8px", cursor: "pointer" }}><Edit size={14} /></button>}
                      {canDelProduit && <button onClick={() => deleteProduit(p)} style={{ background: "#ffebee", border: "none", color: "#f44336", padding: "8px 10px", borderRadius: "8px", cursor: "pointer" }}><Trash2 size={14} /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Modal>
      )}

      {/* ── FORM KLIYAN ── */}
      {showKliyanForm && (
        <Modal onClose={() => { setShowKliyanForm(false); resetKliyanForm(); }} title={editKliyan ? "Modifye Kliyan" : "Ajoute Kliyan"}>
          <FormField label="Non Kliyan *" value={fkNom} onChange={setFkNom} icon={<User size={14} />} />
          <FormField label="Telefòn" value={fkPhone} onChange={setFkPhone} icon={<Phone size={14} />} type="tel" />
          <FormField label="Adrès" value={fkAdres} onChange={setFkAdres} icon={<MapPin size={14} />} />
          <FormField label="Device" value={fkDevice} onChange={setFkDevice} icon={<Package size={14} />} />
          <button onClick={saveKliyan} disabled={saving} style={{ width: "100%", padding: "13px", background: kPink, color: "#fff", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, marginTop: "8px" }}>
            {saving ? "⏳ Ap sove..." : editKliyan ? "✅ Sove" : "✅ Ajoute"}
          </button>
        </Modal>
      )}

      {/* ── FORM PWODWI ── */}
      {showProduitForm && (
        <Modal onClose={() => { setShowProduitForm(false); resetProduitForm(); }} title={editProduit ? "Modifye Pwodwi" : "Ajoute Pwodwi"}>
          <FormField label="ID Pwodwi" value={fpId} onChange={setFpId} icon={<Tag size={14} />} />
          <FormField label="Mak *" value={fpMak} onChange={setFpMak} icon={<Package size={14} />} />
          <FormField label="Description" value={fpDesc} onChange={setFpDesc} icon={<FileText size={14} />} />
          <FormField label="Prix ($US) *" value={fpPrix} onChange={setFpPrix} icon={<DollarSign size={14} />} type="number" />
          {parseFloat(fpPrix) > 0 && (
            <div style={{ background: `${kGreen}15`, borderRadius: "10px", padding: "10px 14px", marginBottom: "10px", display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: kPink, fontWeight: 700 }}>$ {fmt(parseFloat(fpPrix))}</span>
              <span style={{ color: kMove, fontWeight: 700 }}>HTG {fmt(parseFloat(fpPrix) * taux)}</span>
            </div>
          )}
          <button onClick={saveProduit} disabled={saving} style={{ width: "100%", padding: "13px", background: kPink, color: "#fff", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, marginTop: "4px" }}>
            {saving ? "⏳ Ap sove..." : editProduit ? "✅ Sove" : "✅ Ajoute"}
          </button>
        </Modal>
      )}
    </main>
  );
}

// ── FACTURE CARD ──
function FactureCard({ f, isAdmin, taux, showActions, onAnnule, onSiprime }: {
  f: Facture; isAdmin: boolean; taux: number; showActions: boolean;
  onAnnule: (f: Facture) => void; onSiprime: (f: Facture) => void;
}) {
  const produits  = f.produits ?? [];
  const total$    = produits.reduce((s, p) => s + (p.prix ?? 0), 0);
  const date      = f.date ? new Date(f.date) : null;
  const diffMin   = date ? Math.floor((Date.now() - date.getTime()) / 60000) : 999;
  const canAnnule = isAdmin || diffMin <= 30;

  return (
    <div style={{ background: "#fff", borderRadius: "16px", padding: "14px 16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: f.annule ? "1.5px solid #ffcdd2" : "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontWeight: 700, fontSize: "15px" }}>Bill #{f.billNo}</span>
          {f.annule && <span style={{ background: "#ffebee", color: "#f44336", padding: "2px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 700 }}>ANILE</span>}
        </div>
        <span style={{ color: "#aaa", fontSize: "11px" }}>{date ? `${String(date.getDate()).padStart(2,"0")}/${String(date.getMonth()+1).padStart(2,"0")} ${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}` : ""}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
        <User size={13} color="#aaa" />
        <span style={{ fontWeight: 600, fontSize: "13px" }}>{f.kliyan?.nom}</span>
        {f.kliyan?.phone && <><Phone size={11} color="#aaa" /><span style={{ color: "#888", fontSize: "12px" }}>{f.kliyan.phone}</span></>}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div>
          <p style={{ margin: 0, color: kPink, fontWeight: 900, fontSize: "17px" }}>$ {total$.toFixed(2)}</p>
          <p style={{ margin: 0, color: "#aaa", fontSize: "11px" }}>HTG {(total$ * taux).toFixed(0)}</p>
        </div>
        <span style={{ background: "#f5f5f5", color: "#555", padding: "4px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 600 }}>{f.modePeman}</span>
      </div>
      {produits.length > 0 && (
        <div style={{ borderTop: "1px solid #f5f5f5", paddingTop: "8px", marginBottom: "8px" }}>
          {produits.map((p, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: "12px" }}>{p.mak}</span>
                {p.description && <span style={{ color: "#aaa", fontSize: "11px" }}> — {p.description}</span>}
                <span style={{ color: "#aaa", fontSize: "11px" }}> x{p.qty ?? 1}</span>
              </div>
              <span style={{ color: kGreen, fontWeight: 700, fontSize: "12px" }}>$ {(p.prix ?? 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
      {f.vendeur && <p style={{ margin: 0, color: "#aaa", fontSize: "11px" }}>Vendeur: {f.vendeur}</p>}
      {showActions && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" }}>
          {isAdmin && <button onClick={() => onSiprime(f)} style={{ background: "#ffebee", border: "none", color: "#f44336", padding: "7px 12px", borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "12px" }}>🗑 Siprime</button>}
          {!f.annule && (
            <button onClick={() => canAnnule ? onAnnule(f) : null} disabled={!canAnnule}
              style={{ background: canAnnule ? "#ffebee" : "#f5f5f5", border: "none", color: canAnnule ? "#f44336" : "#aaa", padding: "7px 14px", borderRadius: "8px", cursor: canAnnule ? "pointer" : "not-allowed", fontWeight: 600, fontSize: "12px" }}>
              ✖ {isAdmin ? "Anile" : canAnnule ? `Anile (${30 - diffMin}min)` : "Ekspire"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── MODAL WRAPPER ──
function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: "24px 24px 0 0", width: "100%", maxWidth: "600px", maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #eee" }}>
          <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{ background: "#f5f5f5", border: "none", padding: "8px", borderRadius: "8px", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ overflowY: "auto", padding: "16px 20px 24px" }}>{children}</div>
      </div>
    </div>
  );
}

// ── FORM FIELD ──
function FormField({ label, value, onChange, icon, type = "text" }: { label: string; value: string; onChange: (v: string) => void; icon?: React.ReactNode; type?: string }) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <label style={{ display: "block", fontSize: "11px", color: "#888", marginBottom: "4px", fontWeight: 600, textTransform: "uppercase" }}>{label}</label>
      <div style={{ position: "relative" }}>
        {icon && <span style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", color: "#aaa" }}>{icon}</span>}
        <input type={type} value={value} onChange={e => onChange(e.target.value)}
          style={{ width: "100%", padding: icon ? "10px 14px 10px 34px" : "10px 14px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "14px", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
          onFocus={e => e.target.style.borderColor = kPink}
          onBlur={e => e.target.style.borderColor = "#eee"}
        />
      </div>
    </div>
  );
}