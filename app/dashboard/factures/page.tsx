"use client";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, onSnapshot, updateDoc,
} from "firebase/firestore";
import {
  ShoppingCart, Package, History, ArrowLeft, Plus, Minus,
  Trash2, User, Users, X, Check, Calculator, DollarSign,
  CreditCard, Smartphone, Printer, Search, Receipt,
  ChevronDown, Edit2, AlertCircle, Clock, RefreshCw,
  CheckCircle, XCircle, Wifi, WifiOff, BadgeCheck, Loader,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface UserSession {
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  selectedLocalId?: string;
}

interface Ligne {
  productId: string;
  marque: string;
  modele: string;
  category: string;
  serialImei: string;
  description: string;
  prixAchat: number;
  prix: number;
  qty: number;
}

interface Product {
  id: string;
  marque: string;
  modele: string;
  category: string;
  serialImei: string;
  description: string;
  prixVente: number;
  prixAchat: number;
  stock: number;
  isDeleted?: boolean;
  localId: string;
}

interface Client {
  id: string;
  nom: string;
  telephone?: string;
  adresse?: string;
  nif?: string;
  clientAksepte?: boolean;
  createdAt?: string;
  localId: string;
  [key: string]: unknown;
}

interface Vendeur {
  id: string;
  nom: string;
  balance: number;
  ventes: VenteItem[];
  localId: string;
}

interface VenteItem {
  id?: string;
  billNo?: string;
  marque?: string;
  model?: string;
  categorie?: string;
  prixAchat?: number;
  prixVente?: number;
  commission?: number;
  benefis?: number;
  gainTotal?: number;
  qty?: number;
  date?: string;
  annule?: boolean;
}

interface Facture {
  id: string;
  billNo: string;
  date: string;
  localId: string;
  clientId: string;
  clientNom: string;
  vendeur: string;
  cashier: string;
  modePeman: string;
  devise: string;
  taux: number;
  taxPct: number;
  subtotalUSD: number;
  taxUSD: number;
  totalUSD: number;
  benefisUSD: number;
  lignes: LigneSaved[];
  annule?: boolean;
  annuleDate?: string;
  _pending?: boolean;
}

interface LigneSaved {
  productId: string;
  marque: string;
  modele: string;
  category: string;
  serialImei: string;
  description: string;
  prix: number;
  prixAchat: number;
  qty: number;
}

type Tab = "facture" | "produits" | "istwa";
type ModePeman = "Cash" | "Bancaire" | "Moncash" | "Natcash";

// ─── Constants ─────────────────────────────────────────────────────────────────
const K_PENDING = "pending_factures_";
const K_FACTURES = "factures_cache_";
const K_BILL = "bill_counter_";
const DEFAULT_COMMISSION: Record<string, number> = {
  Phone: 10, Ordinateur: 20, Desktop: 20, Accessoire: 5,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(raw?: string) {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}  ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  } catch { return ""; }
}

function fmtDateShort(raw?: string) {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 60) return `Sa gen ${diffMin} minit`;
    if (d.toDateString() === now.toDateString())
      return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  } catch { return ""; }
}

// ─── Sous-koleksyon helpers: locals/{localId}/{col}/{id} ─────────────────────
const subCol = (localId: string, col: string) => collection(db, "locals", localId, col);
const subDoc = (localId: string, col: string, id: string) => doc(db, "locals", localId, col, id);

async function loadProducts(localId: string): Promise<Product[]> {
  const snap = await getDocs(subCol(localId, "products"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
}

async function loadClients(localId: string): Promise<Client[]> {
  const snap = await getDocs(subCol(localId, "clients"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Client));
}

async function loadVendeurs(localId: string): Promise<Vendeur[]> {
  const snap = await getDocs(subCol(localId, "vendeurs"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Vendeur));
}

async function saveFacture(facture: Facture, localId: string) {
  await setDoc(subDoc(localId, "factures", facture.id), facture);
}

async function deleteFactureDb(id: string, localId: string) {
  await deleteDoc(subDoc(localId, "factures", id));
}

async function saveProduct(p: Product, localId: string) {
  await setDoc(subDoc(localId, "products", p.id), p);
}

async function saveVendeur(v: Vendeur, localId: string) {
  await setDoc(subDoc(localId, "vendeurs", v.id), v);
}

async function saveClient(c: Client, localId: string) {
  await setDoc(subDoc(localId, "clients", c.id), c);
}

async function loadTaux(): Promise<number> {
  const snap = await getDoc(doc(db, "parametres", "taux"));
  return (snap.data()?.taux as number) ?? 1;
}

async function loadCommission(): Promise<Record<string, number>> {
  const snap = await getDoc(doc(db, "locals", "all"));
  return (snap.data()?.commission as Record<string, number>) ?? DEFAULT_COMMISSION;
}

async function loadFactures(localId: string): Promise<Facture[]> {
  const snap = await getDocs(subCol(localId, "factures"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Facture));
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function FacturePage() {
  const router = useRouter();

  // ── Session ──
  const [user, setUser] = useState<UserSession | null>(null);
  const [localId, setLocalId] = useState("");

  // ── Data ──
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [vendeurs, setVendeurs] = useState<Vendeur[]>([]);
  const [factures, setFactures] = useState<Facture[]>([]);
  const [commission, setCommission] = useState<Record<string, number>>(DEFAULT_COMMISSION);

  // ── Cart ──
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [devise, setDevise] = useState<"$" | "HTG">("$");
  const [taux, setTaux] = useState(1);
  const [taxPct] = useState(0);
  const [modePeman, setModePeman] = useState<ModePeman>("Cash");
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientNom, setClientNom] = useState("");
  const [vendeur, setVendeur] = useState("");
  const [billCnt, setBillCnt] = useState(1);

  // ── UI State ──
  const [tab, setTab] = useState<Tab>("facture");
  const [search, setSearch] = useState("");
  const [searchIstwa, setSearchIstwa] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // ── Modals ──
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [showVendeurPicker, setShowVendeurPicker] = useState(false);
  const [showModePeman, setShowModePeman] = useState(false);
  const [showDevise, setShowDevise] = useState(false);
  const [showTaux, setShowTaux] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showEditPrix, setShowEditPrix] = useState<number | null>(null);
  const [showAnnuler, setShowAnnuler] = useState<Facture | null>(null);
  const [showDeleteFacture, setShowDeleteFacture] = useState<Facture | null>(null);
  const [vendeurPickerCallback, setVendeurPickerCallback] = useState<((v: string) => void) | null>(null);

  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Computed ──
  const billNo = String(billCnt).padStart(4, "0");
  const subtotal = lignes.reduce((s, l) => s + l.prix * l.qty, 0);
  const taxAmt = subtotal * taxPct / 100;
  const total = subtotal + taxAmt;

  // ─────────────────────────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const u = JSON.parse(raw) as UserSession;
      setUser(u);

      if (u.isAdmin) {
        // Admin: chaje premye lokal reyèl depi Firestore
        getDocs(collection(db, "locals")).then(snap => {
          const ids = snap.docs.map(d => d.id).filter(id => id !== "all");
          const lid = ids[0] ?? "";
          setLocalId(lid);
        });
      } else {
        setLocalId(u.localId);
      }
    } catch { router.push("/login"); }
  }, [router]);

  useEffect(() => {
    if (!localId) return;
    init();
    setIsOnline(navigator.onLine);
    window.addEventListener("online", () => setIsOnline(true));
    window.addEventListener("offline", () => setIsOnline(false));
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, [localId]);

  async function init() {
    setLoading(true);
    // Taux
    const savedTaux = parseFloat(localStorage.getItem("taux_dollar_htg") ?? "1") || 1;
    setTaux(savedTaux);
    const savedBill = parseInt(localStorage.getItem(K_BILL + localId) ?? "1") || 1;
    setBillCnt(savedBill);

    // Cache lokal
    loadCachedFactures();

    // Firestore
    try {
      const [prods, clts, vends, facts, comm, tauxOnline] = await Promise.all([
        loadProducts(localId),
        loadClients(localId),
        loadVendeurs(localId),
        loadFactures(localId),
        loadCommission(),
        loadTaux(),
      ]);
      setProducts(prods.filter(p => !p.isDeleted && (p.stock ?? 0) > 0));
      setClients(clts.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
      setVendeurs(vends);
      setCommission(comm);
      setTaux(tauxOnline);
      localStorage.setItem("taux_dollar_htg", String(tauxOnline));

      // Merge pending
      const merged = mergeWithPending(facts);
      setFactures(merged);
      localStorage.setItem(K_FACTURES + localId, JSON.stringify(merged));
    } catch {
      loadCachedFactures();
    }

    setLoading(false);

    // Real-time factures
    const unsub = onSnapshot(subCol(localId, "factures"), snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Facture));
      const merged = mergeWithPending(data);
      setFactures(merged);
      localStorage.setItem(K_FACTURES + localId, JSON.stringify(merged));
    });

    // Auto-sync timer
    syncTimerRef.current = setInterval(syncPending, 10000);

    return unsub;
  }

  function loadCachedFactures() {
    const raw = localStorage.getItem(K_FACTURES + localId);
    if (raw) {
      try {
        const cached = JSON.parse(raw) as Facture[];
        setFactures(mergeWithPending(cached));
      } catch {}
    }
  }

  function mergeWithPending(base: Facture[]): Facture[] {
    const pendingRaw = localStorage.getItem(K_PENDING + localId);
    if (!pendingRaw) return base;
    try {
      const pending = JSON.parse(pendingRaw) as Facture[];
      const baseIds = new Set(base.map(f => f.id));
      const extra = pending.filter(p => !baseIds.has(p.id));
      return [...base, ...extra];
    } catch { return base; }
  }

  async function syncPending() {
    if (!navigator.onLine) return;
    const raw = localStorage.getItem(K_PENDING + localId);
    if (!raw) return;
    const pending = JSON.parse(raw) as Facture[];
    if (!pending.length) return;

    const stillPending: Facture[] = [];
    for (const f of pending) {
      try {
        const toSave = { ...f };
        delete toSave._pending;
        await saveFacture(toSave, localId);
        if (!f.annule) await syncVendeurAfterPending(toSave);
        else await syncVendeurAnnulationAfterPending(toSave);
      } catch {
        stillPending.push(f);
      }
    }
    if (stillPending.length === 0) localStorage.removeItem(K_PENDING + localId);
    else localStorage.setItem(K_PENDING + localId, JSON.stringify(stillPending));
  }

  async function syncVendeurAfterPending(facture: Facture) {
    if (!facture.vendeur) return;
    const vends = await loadVendeurs(localId);
    const idx = vends.findIndex(v => v.nom === facture.vendeur);
    if (idx === -1) return;
    const existingBillNos = new Set((vends[idx].ventes ?? []).map((v: VenteItem) => v.billNo));
    if (existingBillNos.has(facture.billNo)) return;

    const newVentes = [...(vends[idx].ventes ?? [])];
    let totalGain = 0;
    for (const l of facture.lignes) {
      const pvUSD = facture.devise === "HTG" ? l.prix / facture.taux : l.prix;
      const benefis = Math.max(0, (pvUSD - l.prixAchat) * l.qty);
      const catKey = Object.keys(commission).find(k => k.toLowerCase() === l.category.toLowerCase()) ?? "";
      const gainKom = catKey ? commission[catKey] * l.qty : 0;
      totalGain += benefis + gainKom;
      newVentes.push({ id: l.productId, marque: l.marque, model: l.modele, categorie: l.category, prixAchat: l.prixAchat, prixVente: pvUSD, commission: gainKom, benefis, gainTotal: benefis + gainKom, qty: l.qty, billNo: facture.billNo, date: facture.date });
    }
    vends[idx].ventes = newVentes;
    vends[idx].balance = (vends[idx].balance ?? 0) + totalGain;
    await saveVendeur(vends[idx], localId);
  }

  async function syncVendeurAnnulationAfterPending(facture: Facture) {
    if (!facture.vendeur) return;
    const vends = await loadVendeurs(localId);
    const idx = vends.findIndex(v => v.nom === facture.vendeur);
    if (idx === -1) return;
    let gainRetire = 0;
    vends[idx].ventes = (vends[idx].ventes ?? []).filter((v: VenteItem) => {
      if (v.billNo === facture.billNo) { gainRetire += v.gainTotal ?? 0; return false; }
      return true;
    });
    vends[idx].balance = Math.max(0, (vends[idx].balance ?? 0) - gainRetire);
    await saveVendeur(vends[idx], localId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CART
  // ─────────────────────────────────────────────────────────────────────────────
  function addToCart(p: Product) {
    const idx = lignes.findIndex(l => l.productId === p.id);
    let prix = p.prixVente ?? 0;
    if (devise === "HTG") prix *= taux;
    setLignes(prev => {
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { productId: p.id, marque: p.marque ?? "", modele: p.modele ?? "", category: p.category ?? "", serialImei: p.serialImei ?? "", description: p.description ?? "", prixAchat: p.prixAchat ?? 0, prix, qty: 1 }];
    });
    setTab("facture");
    snack("✅ Ajoute nan fakti!", "#00C853");
  }

  function removeLigne(idx: number) {
    setLignes(prev => prev.filter((_, i) => i !== idx));
  }

  function updateQty(idx: number, delta: number) {
    setLignes(prev => {
      const next = [...prev];
      const newQty = next[idx].qty + delta;
      if (newQty <= 0) return prev.filter((_, i) => i !== idx);
      next[idx] = { ...next[idx], qty: newQty };
      return next;
    });
  }

  function updatePrix(idx: number, newPrix: number) {
    setLignes(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], prix: newPrix };
      return next;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DEVISE SWITCH
  // ─────────────────────────────────────────────────────────────────────────────
  function switchDevise(newDevise: "$" | "HTG") {
    if (newDevise === devise) return;
    setLignes(prev => prev.map(l => ({
      ...l,
      prix: devise === "$" ? l.prix * taux : l.prix / taux,
    })));
    setDevise(newDevise);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VALIDATE & SAVE
  // ─────────────────────────────────────────────────────────────────────────────
  function onValidate() {
    if (!lignes.length) return;
    if (!clientId && !clientNom) { snack("⚠️ Chwazi yon kliyan anvan!", "orange"); setShowClientPicker(true); return; }
    setVendeurPickerCallback(() => (v: string) => {
      setVendeur(v);
      setShowVendeurPicker(false);
      setShowConfirm(true);
    });
    setShowVendeurPicker(true);
  }

  async function saveAndFinish(vendeurNom: string) {
    if (isSaving) return;
    setIsSaving(true);
    setShowConfirm(false);
    try {
      const factureId = Date.now().toString();
      const facture: Facture = {
        id: factureId,
        billNo,
        date: new Date().toISOString(),
        localId,
        clientId: clientId ?? "",
        clientNom: clientNom || "Anònim",
        vendeur: vendeurNom,
        cashier: user?.username ?? "",
        modePeman,
        devise,
        taux,
        taxPct,
        subtotalUSD: devise === "HTG" ? subtotal / taux : subtotal,
        taxUSD: devise === "HTG" ? taxAmt / taux : taxAmt,
        totalUSD: devise === "HTG" ? total / taux : total,
        benefisUSD: lignes.reduce((s, l) => {
          const pvUSD = devise === "HTG" ? l.prix / taux : l.prix;
          return s + Math.max(0, (pvUSD - l.prixAchat) * l.qty);
        }, 0),
        lignes: lignes.map(l => ({
          productId: l.productId,
          marque: l.marque,
          modele: l.modele,
          category: l.category,
          serialImei: l.serialImei,
          description: l.description,
          prix: devise === "HTG" ? l.prix / taux : l.prix,
          prixAchat: l.prixAchat,
          qty: l.qty,
        })),
      };

      // Sove lokal + Firestore
      setFactures(prev => [facture, ...prev]);
      if (navigator.onLine) {
        await saveFacture(facture, localId);
        // Stock
        const freshProds = await loadProducts(localId);
        for (const l of lignes) {
          const idx = freshProds.findIndex(p => p.id === l.productId);
          if (idx !== -1) {
            const updated = { ...freshProds[idx], stock: Math.max(0, (freshProds[idx].stock ?? 0) - l.qty) };
            await saveProduct(updated, localId);
          }
        }
        // Vendeur
        await addVenteVendeur(vendeurNom, facture);
      } else {
        addToPending({ ...facture, _pending: true });
        snack("📴 Offline — Facture sove lokal. Sync ap fèt otomatik.", "orange");
      }

      const newBill = billCnt + 1;
      setBillCnt(newBill);
      localStorage.setItem(K_BILL + localId, String(newBill));

      setLignes([]);
      setClientId(null);
      setClientNom("");
      setVendeur("");
      snack(`✅ Facture #${billNo} kreye!`, "#00C853");
      setTab("istwa");
    } catch (e) {
      snack("❌ Erè: " + e, "red");
    } finally {
      setIsSaving(false);
    }
  }

  function addToPending(facture: Facture) {
    const raw = localStorage.getItem(K_PENDING + localId) ?? "[]";
    const list: Facture[] = JSON.parse(raw);
    if (!list.find(f => f.id === facture.id)) list.push(facture);
    localStorage.setItem(K_PENDING + localId, JSON.stringify(list));
  }

  async function addVenteVendeur(vendeurNom: string, facture: Facture) {
    const vends = await loadVendeurs(localId);
    const idx = vends.findIndex(v => v.nom === vendeurNom);
    if (idx === -1) return;
    const newVentes = [...(vends[idx].ventes ?? [])];
    let totalGain = 0;
    for (const l of lignes) {
      const pvUSD = devise === "HTG" ? l.prix / taux : l.prix;
      const benefis = Math.max(0, (pvUSD - l.prixAchat) * l.qty);
      const catKey = Object.keys(commission).find(k => k.toLowerCase() === l.category.toLowerCase()) ?? "";
      const gainKom = catKey ? commission[catKey] * l.qty : 0;
      totalGain += benefis + gainKom;
      newVentes.push({ id: l.productId, marque: l.marque, model: l.modele, categorie: l.category, prixAchat: l.prixAchat, prixVente: pvUSD, commission: gainKom, benefis, gainTotal: benefis + gainKom, qty: l.qty, billNo: facture.billNo, date: new Date().toISOString() });
    }
    vends[idx].ventes = newVentes;
    vends[idx].balance = (vends[idx].balance ?? 0) + totalGain;
    await saveVendeur(vends[idx], localId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ANNULE
  // ─────────────────────────────────────────────────────────────────────────────
  async function annulerFacture(f: Facture) {
    try {
      const date = new Date(f.date);
      const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
      if (!user?.isAdmin && diffMin > 30) { snack("❌ 30 minit pase! Pa ka annule ankò.", "red"); return; }

      // Stock retounen
      const prods = await loadProducts(localId);
      for (const l of f.lignes) {
        const idx = prods.findIndex(p => p.id === l.productId);
        if (idx !== -1) {
          const updated = { ...prods[idx], stock: (prods[idx].stock ?? 0) + l.qty, isDeleted: false };
          await saveProduct(updated, localId);
        }
      }

      // Vendeur balance korije
      if (f.vendeur) {
        const vends = await loadVendeurs(localId);
        const idx = vends.findIndex(v => v.nom === f.vendeur);
        if (idx !== -1) {
          let gainRetire = 0;
          vends[idx].ventes = (vends[idx].ventes ?? []).filter((v: VenteItem) => {
            if (v.billNo === f.billNo) { gainRetire += v.gainTotal ?? 0; return false; }
            return true;
          });
          vends[idx].balance = Math.max(0, (vends[idx].balance ?? 0) - gainRetire);
          await saveVendeur(vends[idx], localId);
        }
      }

      const updated: Facture = { ...f, annule: true, annuleDate: new Date().toISOString() };
      delete updated._pending;

      if (navigator.onLine) {
        await saveFacture(updated, localId);
        snack(`✅ Facture #${f.billNo} annule! Stock retounen.`, "green");
      } else {
        addToPending(updated);
        snack("📴 Offline — Annulasyon sove lokal.", "orange");
      }

      setFactures(prev => prev.map(fac => fac.id === f.id ? updated : fac));
      localStorage.setItem(K_FACTURES + localId, JSON.stringify(factures.map(fac => fac.id === f.id ? updated : fac)));
    } catch (e) {
      snack("❌ Erè: " + e, "red");
    }
    setShowAnnuler(null);
  }

  async function deleteFacture(f: Facture) {
    const raw = localStorage.getItem(K_PENDING + localId) ?? "[]";
    const list: Facture[] = JSON.parse(raw).filter((p: Facture) => p.id !== f.id);
    localStorage.setItem(K_PENDING + localId, JSON.stringify(list));
    await deleteFactureDb(f.id, localId);
    setFactures(prev => prev.filter(fac => fac.id !== f.id));
    snack(`✅ Facture #${f.billNo} siprime!`, "green");
    setShowDeleteFacture(null);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADD CLIENT
  // ─────────────────────────────────────────────────────────────────────────────
  async function addNewClient(data: Partial<Client>) {
    const newClient: Client = {
      id: Date.now().toString(),
      nom: data.nom ?? "",
      telephone: data.telephone ?? "",
      adresse: data.adresse ?? "",
      nif: data.nif ?? "",
      clientAksepte: data.clientAksepte ?? false,
      createdAt: new Date().toISOString(),
      localId,
      pendingSync: true,
    };
    await saveClient(newClient, localId);
    setClients(prev => [newClient, ...prev]);
    setClientId(newClient.id);
    setClientNom(newClient.nom);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SNACK
  // ─────────────────────────────────────────────────────────────────────────────
  const [snackMsg, setSnackMsg] = useState("");
  const [snackColor, setSnackColor] = useState("#00C853");
  function snack(msg: string, color: string) {
    setSnackMsg(msg); setSnackColor(color);
    setTimeout(() => setSnackMsg(""), 3000);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#1A1D2E", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <Loader size={40} color="#00C853" style={{ animation: "spin 1s linear infinite" }} />
      <p style={{ color: "#fff", fontFamily: "Segoe UI, sans-serif" }}>Chajman...</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#F4F5F7", fontFamily: "'Segoe UI', sans-serif", display: "flex", flexDirection: "column" }}>

      {/* ── AppBar ── */}
      <div style={{ background: "#1A1D2E", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 12px", gap: 6 }}>
          <button onClick={() => router.back()} style={iconBtnW}>
            <ArrowLeft size={18} />
          </button>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 14, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.displayName}
          </span>

          {/* Action buttons */}
          <button onClick={() => setShowCalc(true)} style={iconBtnW} title="Kalkilatè"><Calculator size={18} /></button>

          <button onClick={() => setShowClientPicker(true)} style={{ ...iconBtnW, position: "relative" }} title="Kliyan">
            <User size={18} />
            {clientNom && <span style={{ position: "absolute", top: 4, right: 4, width: 7, height: 7, borderRadius: "50%", background: "#00C853" }} />}
          </button>

          <button onClick={() => setShowModePeman(true)} style={iconBtnW} title="Mode Peman">
            {modePeman === "Cash" ? <DollarSign size={18} /> : modePeman === "Bancaire" ? <CreditCard size={18} /> : <Smartphone size={18} />}
          </button>

          <button onClick={() => setShowDevise(true)} style={{ ...iconBtnW, background: "rgba(255,255,255,0.15)", padding: "5px 10px", borderRadius: 16, border: "none" }}>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{devise}</span>
          </button>

          {user?.isAdmin && devise === "HTG" && (
            <button onClick={() => setShowTaux(true)} style={{ background: "rgba(255,152,0,0.3)", border: "none", borderRadius: 16, padding: "5px 8px", cursor: "pointer" }}>
              <span style={{ color: "#FF9800", fontWeight: 700, fontSize: 12 }}>×{Math.round(taux)}</span>
            </button>
          )}

          {/* Online indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", borderRadius: 16, background: isOnline ? "rgba(0,200,83,0.15)" : "rgba(255,87,34,0.15)", border: `1px solid ${isOnline ? "rgba(0,200,83,0.4)" : "rgba(255,87,34,0.4)"}` }}>
            {isOnline ? <Wifi size={12} color="#00C853" /> : <WifiOff size={12} color="#FF5722" />}
          </div>

          {/* Validate button */}
          <button onClick={onValidate} disabled={!lignes.length || isSaving} style={{ width: 34, height: 34, borderRadius: "50%", background: lignes.length ? "#00C853" : "#666", border: "none", cursor: lignes.length ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isSaving ? <Loader size={16} color="#fff" style={{ animation: "spin 1s linear infinite" }} /> : <Check size={18} color="#fff" />}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex" }}>
          {(["facture", "produits", "istwa"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "11px 0", background: "none", border: "none", color: tab === t ? "#00C853" : "rgba(255,255,255,0.5)", fontWeight: 700, fontSize: 12, letterSpacing: 1, borderBottom: tab === t ? "3px solid #00C853" : "3px solid transparent", cursor: "pointer", transition: "all .2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {t === "facture" && <Receipt size={13} />}
              {t === "produits" && <Package size={13} />}
              {t === "istwa" && <History size={13} />}
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {tab === "facture" && <FactureTab lignes={lignes} devise={devise} total={total} subtotal={subtotal} taxAmt={taxAmt} modePeman={modePeman} clientNom={clientNom} onRemove={removeLigne} onQty={updateQty} onEditPrix={(i) => setShowEditPrix(i)} onClientPick={() => setShowClientPicker(true)} />}
        {tab === "produits" && <ProduitsTab products={products} lignes={lignes} devise={devise} taux={taux} search={search} setSearch={setSearch} onAdd={addToCart} />}
        {tab === "istwa" && <IstwaTab factures={factures} clients={clients} devise={devise} taux={taux} searchIstwa={searchIstwa} setSearchIstwa={setSearchIstwa} isAdmin={user?.isAdmin ?? false} currentUser={user} onAnnuler={(f) => setShowAnnuler(f)} onDelete={(f) => setShowDeleteFacture(f)} />}
      </div>

      {/* ── Snack ── */}
      {snackMsg && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: snackColor, color: "#fff", padding: "10px 20px", borderRadius: 12, fontWeight: 600, zIndex: 999, fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
          {snackMsg}
        </div>
      )}

      {/* ═══════════════════ MODALS ═══════════════════ */}

      {/* Mode Peman */}
      {showModePeman && (
        <BottomSheet onClose={() => setShowModePeman(false)} title="Mode Peman">
          {(["Cash", "Bancaire", "Moncash", "Natcash"] as ModePeman[]).map(m => (
            <button key={m} onClick={() => { setModePeman(m); setShowModePeman(false); }} style={{ ...listItem, background: modePeman === m ? "rgba(0,200,83,0.08)" : "none" }}>
              <span style={{ flex: 1, fontWeight: 700 }}>{m}</span>
              {modePeman === m && <CheckCircle size={18} color="#00C853" />}
            </button>
          ))}
        </BottomSheet>
      )}

      {/* Devise */}
      {showDevise && (
        <BottomSheet onClose={() => setShowDevise(false)} title="Devise">
          {(["$", "HTG"] as ("$" | "HTG")[]).map(d => (
            <button key={d} onClick={() => { switchDevise(d); setShowDevise(false); }} style={{ ...listItem, background: devise === d ? "rgba(0,200,83,0.08)" : "none" }}>
              <span style={{ flex: 1, fontWeight: 700, fontSize: 18 }}>{d}</span>
              {devise === d && <CheckCircle size={18} color="#00C853" />}
            </button>
          ))}
        </BottomSheet>
      )}

      {/* Taux */}
      {showTaux && <TauxModal taux={taux} onSave={async (v) => { setTaux(v); localStorage.setItem("taux_dollar_htg", String(v)); setShowTaux(false); snack(`✅ Taux sove: 1$ = ${v.toFixed(2)} HTG`, "#00C853"); }} onClose={() => setShowTaux(false)} />}

      {/* Calculator */}
      {showCalc && <CalculatorModal onClose={() => setShowCalc(false)} />}

      {/* Client Picker */}
      {showClientPicker && <ClientPickerModal clients={clients} clientId={clientId} onSelect={(id, nom) => { setClientId(id); setClientNom(nom); setShowClientPicker(false); }} onAdd={addNewClient} onClose={() => setShowClientPicker(false)} />}

      {/* Vendeur Picker */}
      {showVendeurPicker && <VendeurPickerModal vendeurs={vendeurs} vendeur={vendeur} onSelect={(v) => { if (vendeurPickerCallback) vendeurPickerCallback(v); }} onClose={() => setShowVendeurPicker(false)} />}

      {/* Confirm */}
      {showConfirm && (
        <DarkModal onClose={() => setShowConfirm(false)} title={`Facture #${billNo}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {[["Vendeur", vendeur], ["Kliyan", clientNom || "Anònim"], ["Mode Peman", modePeman], [`${lignes.length} pwodwi`, ""], ["TOTAL", `${devise} ${total.toFixed(2)}`]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#ffffff80", fontSize: 13 }}>{k}</span>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowConfirm(false)} style={cancelBtn}>Anile</button>
            <button onClick={() => saveAndFinish(vendeur)} style={greenBtn}>✅ Konfime</button>
          </div>
        </DarkModal>
      )}

      {/* Edit Prix */}
      {showEditPrix !== null && (
        <EditPrixModal prix={lignes[showEditPrix]?.prix ?? 0} devise={devise} onSave={(v) => { updatePrix(showEditPrix, v); setShowEditPrix(null); }} onClose={() => setShowEditPrix(null)} label={`${lignes[showEditPrix]?.marque} ${lignes[showEditPrix]?.modele}`} />
      )}

      {/* Annule Confirm */}
      {showAnnuler && (
        <DarkModal onClose={() => setShowAnnuler(null)} title="Annule Facture?">
          <p style={{ fontWeight: 700, color: "#fff", marginBottom: 8 }}>Facture #{showAnnuler.billNo}</p>
          <div style={{ background: "rgba(255,152,0,0.08)", borderRadius: 10, padding: 12, marginBottom: 16 }}>
            {["Pwodwi yo ap retounen nan stock", "Rapport ap mete ajou otomatik", "Vendeur balance ap korije"].map(t => (
              <div key={t} style={{ color: "#FF9800", fontSize: 12, marginBottom: 4 }}>⚠️ {t}</div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowAnnuler(null)} style={cancelBtn}>Non</button>
            <button onClick={() => annulerFacture(showAnnuler)} style={{ ...greenBtn, background: "#F44336" }}>Wi, Annule</button>
          </div>
        </DarkModal>
      )}

      {/* Delete Facture */}
      {showDeleteFacture && (
        <DarkModal onClose={() => setShowDeleteFacture(null)} title="Siprime Definitif?">
          <p style={{ color: "#ffffff80", marginBottom: 16 }}>Facture #{showDeleteFacture.billNo} ap siprime pou toujou.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowDeleteFacture(null)} style={cancelBtn}>Non</button>
            <button onClick={() => deleteFacture(showDeleteFacture)} style={{ ...greenBtn, background: "#F44336" }}>Wi, Siprime</button>
          </div>
        </DarkModal>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTURE TAB
// ─────────────────────────────────────────────────────────────────────────────
function FactureTab({ lignes, devise, total, modePeman, clientNom, onRemove, onQty, onEditPrix, onClientPick }: {
  lignes: Ligne[]; devise: string; total: number; subtotal: number; taxAmt: number;
  modePeman: string; clientNom: string;
  onRemove: (i: number) => void; onQty: (i: number, d: number) => void;
  onEditPrix: (i: number) => void; onClientPick: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: "#1A1D2E", padding: "12px 16px 20px", textAlign: "center" }}>
        <button onClick={onClientPick} style={{ background: "none", border: "none", cursor: "pointer", color: clientNom ? "#fff" : "rgba(255,255,255,0.54)", fontSize: 13, fontWeight: 600, letterSpacing: 1, display: "flex", alignItems: "center", gap: 6, margin: "0 auto 12px" }}>
          <User size={14} />
          {clientNom ? `CLIENT: ${clientNom.toUpperCase()}` : "CLIENT: NON SÉLECTIONNÉ"}
        </button>
        <div style={{ color: "#00C853", fontSize: 42, fontWeight: 900, letterSpacing: 1 }}>{total.toFixed(2)} {devise}</div>
        <div style={{ color: "rgba(255,255,255,0.54)", fontSize: 14, marginTop: 4 }}>Mode: {modePeman}</div>
      </div>

      {/* Lines */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {!lignes.length ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60%", gap: 12 }}>
            <Receipt size={64} color="#ddd" />
            <p style={{ color: "#aaa", fontSize: 16 }}>Fakti a vid</p>
            <p style={{ color: "#aaa", fontSize: 12 }}>Ale nan "PRODUITS" pou ajoute</p>
          </div>
        ) : lignes.map((l, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 14, padding: 12, marginBottom: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#1A1D2E", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>{i + 1}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#FF9800", fontWeight: 700 }}>ID: {l.productId}</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#1A1D2E" }}>{l.marque} {l.modele}</div>
                {l.category && <div style={{ fontSize: 11, color: "#009688" }}>📦 {l.category}</div>}
                {l.description && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{l.description}</div>}
                {l.serialImei && <div style={{ fontSize: 11, color: "#FF9800" }}>S/N: {l.serialImei}</div>}
              </div>
              <button onClick={() => onRemove(i)} style={{ background: "rgba(244,67,54,0.08)", border: "none", borderRadius: "50%", width: 26, height: 26, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={13} color="#F44336" />
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onDoubleClick={() => onEditPrix(i)} style={{ background: "#f5f5f5", border: "1px solid #e0e0e0", borderRadius: 8, padding: "5px 10px", fontSize: 12, color: "#555", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                {devise} {l.prix.toFixed(2)} <Edit2 size={10} color="#aaa" />
              </button>
              <span style={{ color: "#bbb", fontSize: 12 }}>×</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => onQty(i, -1)} style={qtyBtn}><Minus size={12} /></button>
                <span style={{ fontWeight: 700, fontSize: 14, minWidth: 24, textAlign: "center" }}>{l.qty}</span>
                <button onClick={() => onQty(i, 1)} style={qtyBtn}><Plus size={12} /></button>
              </div>
              <div style={{ marginLeft: "auto", background: "rgba(26,29,46,0.06)", borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: 14, color: "#1A1D2E" }}>
                {devise} {(l.prix * l.qty).toFixed(2)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      {lignes.length > 0 && (
        <div style={{ background: "#fff", padding: "12px 16px", boxShadow: "0 -2px 8px rgba(0,0,0,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#666", fontSize: 13 }}>{lignes.length} atik  •  {lignes.reduce((s, l) => s + l.qty, 0)} qty</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1A1D2E" }}>TOTAL: {devise} {total.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUITS TAB
// ─────────────────────────────────────────────────────────────────────────────
function ProduitsTab({ products, lignes, devise, taux, search, setSearch, onAdd }: {
  products: Product[]; lignes: Ligne[]; devise: string; taux: number;
  search: string; setSearch: (v: string) => void; onAdd: (p: Product) => void;
}) {
  const byCategory: Record<string, Product[]> = {};
  products.forEach(p => {
    const cat = p.category || "Lòt";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(p);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{ padding: 12 }}>
        <div style={{ position: "relative" }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#aaa" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Chèche (mak, modèl, S/N, ID...)" style={{ width: "100%", padding: "10px 12px 10px 36px", borderRadius: 12, border: "1px solid #e0e0e0", background: "#fff", fontSize: 14, boxSizing: "border-box", outline: "none" }} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
        {!products.length ? (
          <div style={{ textAlign: "center", padding: 60, color: "#aaa" }}>
            <Package size={64} color="#ddd" />
            <p>Pa gen pwodwi disponib</p>
          </div>
        ) : Object.entries(byCategory).map(([cat, prods]) => {
          const filtered = prods.filter(p => !search || `${p.marque} ${p.modele} ${p.category} ${p.serialImei} ${p.id}`.toLowerCase().includes(search.toLowerCase()));
          if (!filtered.length) return null;
          return (
            <div key={cat}>
              <p style={{ fontWeight: 700, fontSize: 11, color: "#1A1D2E", letterSpacing: 1.5, margin: "12px 0 8px", textTransform: "uppercase" }}>{cat}</p>
              {filtered.map(p => {
                const inCart = lignes.some(l => l.productId === p.id);
                const pv = p.prixVente ?? 0;
                const pa = p.prixAchat ?? 0;
                const disp = devise === "HTG" ? pv * taux : pv;
                const stock = p.stock ?? 0;
                return (
                  <div key={p.id} style={{ background: inCart ? "#E8F5E9" : "#fff", borderRadius: 14, padding: 12, marginBottom: 10, boxShadow: inCart ? "0 2px 8px rgba(0,200,83,0.2)" : "0 1px 4px rgba(0,0,0,0.06)", border: inCart ? "1px solid rgba(0,200,83,0.3)" : "1px solid transparent" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <span style={{ background: "rgba(255,152,0,0.1)", color: "#FF9800", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5 }}>ID: {p.id}</span>
                        <span style={{ background: stock <= 0 ? "rgba(244,67,54,0.1)" : stock <= 2 ? "rgba(255,152,0,0.1)" : "rgba(76,175,80,0.1)", color: stock <= 0 ? "#F44336" : stock <= 2 ? "#FF9800" : "#4CAF50", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5 }}>Stock: {stock}</span>
                      </div>
                      {inCart ? (
                        <span style={{ background: "rgba(0,200,83,0.15)", color: "#00C853", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, display: "flex", alignItems: "center", gap: 4 }}>
                          <CheckCircle size={13} /> Ajoute
                        </span>
                      ) : (
                        <button onClick={() => onAdd(p)} disabled={stock <= 0} style={{ background: "#1A1D2E", color: "#fff", border: "none", borderRadius: 20, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: stock <= 0 ? "default" : "pointer", opacity: stock <= 0 ? 0.5 : 1 }}>
                          + Ajoute
                        </button>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <div style={{ width: 44, height: 44, background: "#1A1D2E", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <span style={{ color: "#fff", fontWeight: 700, fontSize: 18 }}>{(p.marque ?? "?")[0]?.toUpperCase()}</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#1A1D2E" }}>{p.marque} {p.modele}</div>
                        {p.category && <div style={{ fontSize: 11, color: "#009688" }}>📦 {p.category}</div>}
                        {p.description && <div style={{ fontSize: 11, color: "#888" }}>{p.description}</div>}
                        {p.serialImei && <div style={{ fontSize: 11, color: "#FF9800" }}>S/N: {p.serialImei}</div>}
                      </div>
                    </div>
                    <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#999" }}>Achat: ${pa.toFixed(2)}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1D2E" }}>Vente: {devise} {disp.toFixed(2)}</span>
                      {taux > 1 && devise === "$" && <span style={{ fontSize: 11, color: "#2196F3" }}>≈ HTG {(pv * taux).toFixed(0)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ISTWA TAB
// ─────────────────────────────────────────────────────────────────────────────
function IstwaTab({ factures, clients, devise, taux, searchIstwa, setSearchIstwa, isAdmin, currentUser, onAnnuler, onDelete }: {
  factures: Facture[]; clients: Client[]; devise: string; taux: number;
  searchIstwa: string; setSearchIstwa: (v: string) => void;
  isAdmin: boolean; currentUser: UserSession | null;
  onAnnuler: (f: Facture) => void; onDelete: (f: Facture) => void;
}) {
  const q = searchIstwa.toLowerCase().trim();
  const filtered = factures.filter(f => {
    if (!q) return true;
    const fields = [f.billNo, f.clientNom, f.vendeur, f.cashier, f.modePeman, fmtDate(f.date)].join(" ").toLowerCase();
    const inLignes = (f.lignes ?? []).some(l => `${l.marque} ${l.modele} ${l.description} ${l.serialImei} ${l.productId} ${l.category}`.toLowerCase().includes(q));
    const clientData = clients.find(c => c.id === f.clientId);
    const clientTel = (clientData?.telephone ?? "").toLowerCase();
    return fields.includes(q) || inLignes || clientTel.includes(q);
  }).sort((a, b) => b.date.localeCompare(a.date));

  const active = filtered.filter(f => !f.annule);
  const annule = filtered.filter(f => f.annule);
  const pending = filtered.filter(f => f._pending && !f.annule);
  const totalVant = active.reduce((s, f) => s + (devise === "HTG" ? f.totalUSD * taux : f.totalUSD), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Search + Stats */}
      <div style={{ background: "#1A1D2E", padding: "10px 12px 12px" }}>
        <div style={{ position: "relative", marginBottom: 10 }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.38)" }} />
          <input value={searchIstwa} onChange={e => setSearchIstwa(e.target.value)} placeholder="Chèche: #facture, kliyan, tel, ID, S/N, dat..." style={{ width: "100%", padding: "10px 12px 10px 36px", borderRadius: 12, border: "none", background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 13, boxSizing: "border-box", outline: "none" }} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <StatPill icon={<Receipt size={12} />} color="#4CAF50" label={`${active.length} Aktif`} />
          <StatPill icon={<DollarSign size={12} />} color="#FFD600" label={devise === "HTG" ? `HTG ${totalVant.toFixed(0)}` : `$${totalVant.toFixed(2)}`} />
          {annule.length > 0 && <StatPill icon={<XCircle size={12} />} color="#F44336" label={`${annule.length} Annule`} />}
          {pending.length > 0 && <StatPill icon={<WifiOff size={12} />} color="#FF9800" label={`${pending.length} 📴`} />}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 8, background: "rgba(0,200,83,0.15)", border: "1px solid rgba(0,200,83,0.4)" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00C853" }} />
            <span style={{ color: "#00C853", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>LIVE</span>
          </div>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 10px 20px" }}>
        {!factures.length ? (
          <EmptyIstwa msg="Pa gen facture toujou" />
        ) : !filtered.length ? (
          <EmptyIstwa msg={`Okenn rezilta pou "${searchIstwa}"`} />
        ) : (
          <>
            {active.length > 0 && (
              <>
                <SectionHeader icon={<Receipt size={14} />} color="#4CAF50" label="Facture Aktif" count={active.length} />
                {active.map(f => <FactureCard key={f.id} f={f} clients={clients} devise={devise} taux={taux} isAdmin={isAdmin} currentUser={currentUser} onAnnuler={onAnnuler} onDelete={onDelete} />)}
              </>
            )}
            {annule.length > 0 && (
              <>
                <SectionHeader icon={<XCircle size={14} />} color="#F44336" label="Facture Annule" count={annule.length} />
                {annule.map(f => <FactureCard key={f.id} f={f} clients={clients} devise={devise} taux={taux} isAdmin={isAdmin} currentUser={currentUser} onAnnuler={onAnnuler} onDelete={onDelete} />)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FactureCard({ f, clients, devise, taux, isAdmin, currentUser, onAnnuler, onDelete }: {
  f: Facture; clients: Client[]; devise: string; taux: number;
  isAdmin: boolean; currentUser: UserSession | null;
  onAnnuler: (f: Facture) => void; onDelete: (f: Facture) => void;
}) {
  const isAnnule = f.annule === true;
  const isPending = f._pending === true;
  const clientData = clients.find(c => c.id === f.clientId);
  const clientTel = clientData?.telephone ?? "";
  const tot = f.totalUSD ?? 0;

  let canAnnule = false;
  let minRestant = 0;
  if (!isAnnule) {
    if (isAdmin) {
      canAnnule = true;
    } else {
      const diffMin = Math.floor((Date.now() - new Date(f.date).getTime()) / 60000);
      canAnnule = diffMin <= 30;
      minRestant = 30 - diffMin;
    }
  }

  const borderColor = isPending ? "rgba(255,152,0,0.4)" : isAnnule ? "rgba(244,67,54,0.25)" : "rgba(0,0,0,0.08)";
  const bgColor = isPending ? "rgba(255,152,0,0.04)" : isAnnule ? "rgba(244,67,54,0.04)" : "#fff";

  return (
    <div style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 16, padding: 14, marginBottom: 10, boxShadow: isAnnule ? "none" : "0 2px 6px rgba(0,0,0,0.06)" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: (isPending ? "rgba(255,152,0,0.12)" : isAnnule ? "rgba(244,67,54,0.12)" : "rgba(0,200,83,0.12)"), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {isPending ? <WifiOff size={17} color="#FF9800" /> : isAnnule ? <XCircle size={17} color="#F44336" /> : <Receipt size={17} color="#00C853" />}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: isAnnule ? "#999" : "#1A1D2E" }}>#{f.billNo}</span>
            {isPending && <span style={{ background: "rgba(255,152,0,0.15)", color: "#FF9800", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5, border: "1px solid rgba(255,152,0,0.4)" }}>📴 OFFLINE</span>}
            {isAnnule && !isPending && <span style={{ background: "rgba(244,67,54,0.12)", color: "#F44336", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5 }}>ANNULE</span>}
          </div>
          <div style={{ fontSize: 11, color: "#999", display: "flex", alignItems: "center", gap: 4 }}>
            <Clock size={11} /> {fmtDate(f.date)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: isPending ? "#FF9800" : isAnnule ? "#bbb" : "#00C853", textDecoration: isAnnule ? "line-through" : "none" }}>
            {devise === "HTG" ? `HTG ${(tot * taux).toFixed(0)}` : `$${tot.toFixed(2)}`}
          </div>
          {devise === "$" && taux > 1 && !isAnnule && <div style={{ fontSize: 10, color: "#2196F3" }}>≈ HTG {(tot * taux).toFixed(0)}</div>}
          {isPending && <div style={{ fontSize: 10, color: "#FF9800" }}>⏳ Ap sync...</div>}
        </div>
      </div>

      <div style={{ borderTop: "1px solid #eee", margin: "10px 0" }} />

      {/* Client + Vendeur */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: isAnnule ? "#aaa" : "#1A1D2E" }}>
            <User size={13} color={isAnnule ? "#bbb" : "#009688"} /> {f.clientNom ?? "Anònim"}
          </div>
          {clientTel && <div style={{ fontSize: 11, color: "#999", marginTop: 2, paddingLeft: 17 }}>📞 {clientTel}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          {f.vendeur && <div style={{ fontSize: 11, color: "#FF9800" }}>🏷️ {f.vendeur}</div>}
          {f.cashier && <div style={{ fontSize: 11, color: "#2196F3" }}>💼 {f.cashier}</div>}
          <div style={{ fontSize: 11, color: "#999" }}>{f.modePeman}</div>
        </div>
      </div>

      {/* Products */}
      <div style={{ background: isAnnule ? "rgba(0,0,0,0.02)" : "rgba(26,29,46,0.03)", borderRadius: 10, padding: 10, border: "1px solid rgba(0,0,0,0.06)", marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: isAnnule ? "#aaa" : "#1A1D2E", marginBottom: (f.lignes ?? []).length ? 8 : 0, display: "flex", alignItems: "center", gap: 5 }}>
          <Package size={12} /> {(f.lignes ?? []).length} Pwodwi
        </div>
        {(f.lignes ?? []).map((l, i) => {
          const prixDisp = devise === "HTG" ? l.prix * taux : l.prix;
          return (
            <div key={i} style={{ background: isAnnule ? "rgba(255,255,255,0.4)" : "#fff", borderRadius: 8, padding: 9, marginTop: i > 0 ? 8 : 0, border: "1px solid rgba(0,0,0,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <span style={{ background: "rgba(255,152,0,0.1)", color: "#FF9800", fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 4 }}>ID: {l.productId}</span>
                  {l.category && <span style={{ background: "rgba(0,150,136,0.1)", color: "#009688", fontSize: 9, fontWeight: 500, padding: "2px 5px", borderRadius: 4 }}>{l.category}</span>}
                </div>
                <span style={{ fontWeight: 700, fontSize: 11, color: isAnnule ? "#aaa" : "#1A1D2E" }}>{devise === "HTG" ? "HTG" : "$"}{prixDisp.toFixed(devise === "HTG" ? 0 : 2)} × {l.qty}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: isAnnule ? "#aaa" : "#1A1D2E", display: "flex", alignItems: "center", gap: 5 }}>
                <Smartphone size={11} /> {l.marque} {l.modele}
              </div>
              {l.description && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{l.description}</div>}
              {l.serialImei && <div style={{ fontSize: 11, color: "#FF5722", marginTop: 2 }}>S/N: {l.serialImei}</div>}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {canAnnule && !isAdmin && (
          <div style={{ background: "rgba(255,152,0,0.08)", borderRadius: 10, padding: "7px 8px", display: "flex", alignItems: "center", gap: 4 }}>
            <Clock size={12} color="#FF9800" />
            <span style={{ fontSize: 11, color: "#FF9800", fontWeight: 700 }}>{minRestant} min</span>
          </div>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canAnnule && (
            <button onClick={() => onAnnuler(f)} style={{ background: "rgba(244,67,54,0.08)", border: "1px solid rgba(244,67,54,0.3)", borderRadius: 10, padding: "7px 12px", color: "#F44336", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              <XCircle size={14} /> Annule
            </button>
          )}
          {isAdmin && (
            <button onClick={() => onDelete(f)} style={{ background: "rgba(244,67,54,0.06)", border: "1px solid rgba(244,67,54,0.2)", borderRadius: 10, padding: "7px 12px", color: "#F44336", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              <Trash2 size={14} /> Siprime
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT PICKER MODAL
// ─────────────────────────────────────────────────────────────────────────────
function ClientPickerModal({ clients, clientId, onSelect, onAdd, onClose }: {
  clients: Client[]; clientId: string | null;
  onSelect: (id: string | null, nom: string) => void;
  onAdd: (data: Partial<Client>) => Promise<void>;
  onClose: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [nom, setNom] = useState("");
  const [tel, setTel] = useState("");
  const [adr, setAdr] = useState("");
  const [aksepte, setAksepte] = useState(false);
  const [saving, setSaving] = useState(false);

  const filtered = clients.filter(c => !search || `${c.nom} ${c.telephone} ${c.adresse}`.toLowerCase().includes(search.toLowerCase()));

  async function handleAdd() {
    if (!nom.trim()) return;
    setSaving(true);
    await onAdd({ nom: nom.trim(), telephone: tel.trim(), adresse: adr.trim(), clientAksepte: aksepte });
    setSaving(false);
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      <div style={{ position: "relative", background: "#F8F9FF", borderRadius: "20px 20px 0 0", height: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Chwazi Kliyan</span>
          <button onClick={() => setShowAdd(!showAdd)} style={{ background: showAdd ? "#f5f5f5" : "rgba(0,184,148,0.1)", border: `1px solid ${showAdd ? "#ddd" : "#00B894"}`, borderRadius: 20, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: showAdd ? "#888" : "#00B894", fontWeight: 700, fontSize: 12 }}>
            {showAdd ? <><Users size={13} /> Lis Kliyan</> : <><User size={13} /> Nouvo Kliyan</>}
          </button>
        </div>

        {showAdd ? (
          <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
            <button onClick={() => setAksepte(!aksepte)} style={{ width: "100%", background: aksepte ? "#E8F8F2" : "#fff", border: `${aksepte ? 2 : 1}px solid ${aksepte ? "#00B894" : "#ddd"}`, borderRadius: 12, padding: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <CheckCircle size={28} color={aksepte ? "#00B894" : "#ccc"} />
              <div style={{ textAlign: "left" }}>
                <div style={{ fontWeight: 700, color: aksepte ? "#00B894" : "#666" }}>{aksepte ? "Kliyan Aksepte ✅" : "Kliyan pa Aksepte Toujou"}</div>
                <div style={{ fontSize: 11, color: "#999" }}>Klike pou kliyan konfime akseptasyon</div>
              </div>
            </button>
            {[{ label: "Non Kliyan *", val: nom, set: setNom }, { label: "Telefòn", val: tel, set: setTel }, { label: "Adrès", val: adr, set: setAdr }].map(f => (
              <input key={f.label} value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.label} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #ddd", marginBottom: 10, fontSize: 14, boxSizing: "border-box", outline: "none" }} />
            ))}
            <button onClick={handleAdd} disabled={!nom.trim() || saving} style={{ ...greenBtnLight, width: "100%", padding: 14, marginTop: 8 }}>
              {saving ? "Ap sove..." : "Sove epi Chwazi Kliyan"}
            </button>
          </div>
        ) : (
          <>
            <div style={{ padding: "10px 16px" }}>
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#009688" }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Chèche pa non, telefòn, adrès..." style={{ width: "100%", padding: "9px 10px 9px 32px", borderRadius: 12, border: "none", background: "#f0f0f0", fontSize: 13, boxSizing: "border-box", outline: "none" }} />
              </div>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              <button onClick={() => onSelect(null, "")} style={{ ...listItem, borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12 }}><User size={18} color="#aaa" /></div>
                <span style={{ flex: 1, fontWeight: 600 }}>Client Anònim</span>
                {!clientId && <CheckCircle size={18} color="#00C853" />}
              </button>
              {filtered.map(c => (
                <button key={c.id} onClick={() => onSelect(c.id, c.nom)} style={{ ...listItem, borderBottom: "1px solid #f0f0f0" }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(0,150,136,0.15)", display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12, flexShrink: 0 }}>
                    <span style={{ color: "#009688", fontWeight: 700 }}>{c.nom[0]?.toUpperCase()}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{c.nom}</div>
                    {c.telephone && <div style={{ fontSize: 12, color: "#888" }}>📞 {c.telephone}</div>}
                    {c.adresse && <div style={{ fontSize: 11, color: "#aaa" }}>📍 {c.adresse}</div>}
                  </div>
                  <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 5px", borderRadius: 4, background: c.clientAksepte ? "#E8F8F2" : "#fff3e0", color: c.clientAksepte ? "#00B894" : "orange" }}>
                    {c.clientAksepte ? "Aksepte" : "Annatant"}
                  </span>
                  {clientId === c.id && <CheckCircle size={18} color="#00C853" style={{ marginLeft: 8 }} />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VENDEUR PICKER MODAL
// ─────────────────────────────────────────────────────────────────────────────
function VendeurPickerModal({ vendeurs, vendeur, onSelect, onClose }: {
  vendeurs: Vendeur[]; vendeur: string;
  onSelect: (v: string) => void; onClose: () => void;
}) {
  const [selected, setSelected] = useState(vendeur);
  return (
    <DarkModal onClose={onClose} title="Ki Vendeur?">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {vendeurs.map(v => (
          <button key={v.id} onClick={() => setSelected(v.nom)} style={{ background: selected === v.nom ? "#1A1D2E" : "#f5f5f5", border: `1px solid ${selected === v.nom ? "#00C853" : "#ddd"}`, borderRadius: 20, padding: "7px 14px", cursor: "pointer", color: selected === v.nom ? "#fff" : "#333", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            {selected === v.nom && <CheckCircle size={13} color="#00C853" />} {v.nom}
          </button>
        ))}
      </div>
      <input value={selected} onChange={e => setSelected(e.target.value)} placeholder="Non vendeur" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #ddd", marginBottom: 16, fontSize: 14, boxSizing: "border-box", outline: "none", color: "#333" }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClose} style={cancelBtn}>Anile</button>
        <button onClick={() => selected.trim() && onSelect(selected.trim())} disabled={!selected.trim()} style={{ ...greenBtn, opacity: selected.trim() ? 1 : 0.5 }}>Kontinye</button>
      </div>
    </DarkModal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATOR MODAL
// ─────────────────────────────────────────────────────────────────────────────
function CalculatorModal({ onClose }: { onClose: () => void }) {
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState("0");

  function evalExpr(e: string): number {
    e = e.replace(/×/g, "*").replace(/÷/g, "/");
    if (e.includes("+")) { const p = e.lastIndexOf("+"); return evalExpr(e.slice(0,p)) + evalExpr(e.slice(p+1)); }
    if (e.includes("-") && e.indexOf("-") > 0) { const p = e.lastIndexOf("-"); return evalExpr(e.slice(0,p)) - evalExpr(e.slice(p+1)); }
    if (e.includes("*")) { const p = e.lastIndexOf("*"); return evalExpr(e.slice(0,p)) * evalExpr(e.slice(p+1)); }
    if (e.includes("/")) { const p = e.lastIndexOf("/"); const d = evalExpr(e.slice(p+1)); return d === 0 ? 0 : evalExpr(e.slice(0,p)) / d; }
    if (e.includes("%")) return parseFloat(e) / 100;
    return parseFloat(e);
  }

  function fmt(v: number) { return v === Math.trunc(v) ? String(v) : v.toFixed(10).replace(/0+$/, "").replace(/\.$/, ""); }

  function calc(btn: string) {
    const ops = ["+", "-", "×", "÷", "%"];
    if (btn === "C") { setExpr(""); setResult("0"); return; }
    if (btn === "⌫") { setExpr(p => p.slice(0, -1)); return; }
    if (btn === "=") {
      try { const r = fmt(evalExpr(expr)); setResult(r); setExpr(r); } catch { setResult("Erè"); }
      return;
    }
    const isOp = ops.includes(btn);
    setExpr(p => {
      const lastIsOp = p.length > 0 && ops.includes(p[p.length - 1]);
      const next = isOp && lastIsOp ? p.slice(0, -1) + btn : p + btn;
      try { setResult(fmt(evalExpr(next))); } catch {}
      return next;
    });
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "flex-end", padding: 12 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "relative", width: "100%", background: "#1A1D2E", borderRadius: 24, padding: 16, maxWidth: 400, margin: "0 auto" }}>
        <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: 16, marginBottom: 12, textAlign: "right" }}>
          <div style={{ color: "rgba(255,255,255,0.54)", fontSize: 14, minHeight: 20 }}>{expr || "0"}</div>
          <div style={{ color: "#fff", fontSize: 36, fontWeight: 700 }}>{result}</div>
        </div>
        {[["C", "⌫", "%", "÷"], ["7", "8", "9", "×"], ["4", "5", "6", "-"], ["1", "2", "3", "+"], ["0", ".", "=", ""]].map((row, ri) => (
          <div key={ri} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            {row.map(btn => btn ? (
              <button key={btn} onClick={() => calc(btn)} style={{ flex: 1, height: 56, borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 20, background: btn === "=" ? "#FFD600" : ["÷","×","-","+","C","⌫","%"].includes(btn) ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)", color: btn === "=" ? "#000" : "#fff", transition: "background .1s" }}>
                {btn}
              </button>
            ) : <div key="empty" style={{ flex: 1 }} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function BottomSheet({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: "20px 20px 0 0", padding: 20, animation: "slideUp .2s ease" }}>
        <p style={{ margin: "0 0 16px", fontWeight: 700, fontSize: 16, textAlign: "center" }}>{title}</p>
        {children}
      </div>
    </div>
  );
}

function DarkModal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)" }} />
      <div style={{ position: "relative", background: "#1A1D2E", borderRadius: 20, padding: 24, width: "100%", maxWidth: 400, border: "1px solid rgba(255,255,255,0.1)" }}>
        <p style={{ margin: "0 0 16px", fontWeight: 700, fontSize: 16, color: "#fff" }}>{title}</p>
        {children}
      </div>
    </div>
  );
}

function TauxModal({ taux, onSave, onClose }: { taux: number; onSave: (v: number) => void; onClose: () => void }) {
  const [val, setVal] = useState(String(taux.toFixed(2)));
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 360 }}>
        <p style={{ margin: "0 0 16px", fontWeight: 700, fontSize: 16 }}>Taux du Jour</p>
        <input type="number" value={val} onChange={e => setVal(e.target.value)} placeholder="1 $ = ? HTG" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #ddd", marginBottom: 16, fontSize: 15, boxSizing: "border-box", outline: "none" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={cancelBtnLight}>Anile</button>
          <button onClick={() => { const v = parseFloat(val); if (v > 0) onSave(v); }} style={greenBtnLight}>Sove Taux</button>
        </div>
      </div>
    </div>
  );
}

function EditPrixModal({ prix, devise, onSave, onClose, label }: { prix: number; devise: string; onSave: (v: number) => void; onClose: () => void; label: string }) {
  const [val, setVal] = useState(String(prix.toFixed(2)));
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 360 }}>
        <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 14 }}>Chanje Pri</p>
        <p style={{ margin: "0 0 16px", color: "#888", fontSize: 13 }}>{label}</p>
        <input type="number" value={val} onChange={e => setVal(e.target.value)} placeholder={`Nouvo pri (${devise})`} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #ddd", marginBottom: 16, fontSize: 15, boxSizing: "border-box", outline: "none" }} autoFocus />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={cancelBtnLight}>Anile</button>
          <button onClick={() => { const v = parseFloat(val); if (!isNaN(v) && v >= 0) onSave(v); onClose(); }} style={greenBtnLight}>Sove</button>
        </div>
      </div>
    </div>
  );
}

function StatPill({ icon, color, label }: { icon: React.ReactNode; color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 8, background: `${color}26` }}>
      {React.cloneElement(icon as React.ReactElement<{ color?: string }>, { color })}
      <span style={{ color, fontSize: 11, fontWeight: 700 }}>{label}</span>
    </div>
  );
}

function SectionHeader({ icon, color, label, count }: { icon: React.ReactNode; color: string; label: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
      {React.cloneElement(icon as React.ReactElement<{ color?: string }>, { color })}
      <span style={{ fontWeight: 700, fontSize: 13, color: "#1A1D2E" }}>{label}</span>
      <span style={{ background: `${color}26`, color, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 8 }}>{count}</span>
    </div>
  );
}

function EmptyIstwa({ msg }: { msg: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", gap: 12 }}>
      <Receipt size={56} color="#ddd" />
      <p style={{ color: "#aaa", fontSize: 15 }}>{msg}</p>
    </div>
  );
}

// ─── Shared Styles ────────────────────────────────────────────────────────────
const iconBtnW: React.CSSProperties = { background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 8, width: 34, height: 34, cursor: "pointer", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" };
const listItem: React.CSSProperties = { width: "100%", background: "none", border: "none", padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", textAlign: "left", fontSize: 15 };
const qtyBtn: React.CSSProperties = { width: 24, height: 24, background: "#eeeeee", border: "none", borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
const greenBtn: React.CSSProperties = { flex: 1, background: "#00C853", border: "none", borderRadius: 12, padding: 12, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" };
const cancelBtn: React.CSSProperties = { flex: 1, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 12, padding: 12, color: "rgba(255,255,255,0.7)", fontWeight: 600, fontSize: 14, cursor: "pointer" };
const greenBtnLight: React.CSSProperties = { flex: 1, background: "#00C853", border: "none", borderRadius: 12, padding: 12, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" };
const cancelBtnLight: React.CSSProperties = { flex: 1, background: "#f5f5f5", border: "none", borderRadius: 12, padding: 12, color: "#666", fontWeight: 600, fontSize: 14, cursor: "pointer" };