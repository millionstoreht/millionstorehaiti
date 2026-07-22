"use client";
import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  onSnapshot,
} from "firebase/firestore";
import {
  Package, History, ArrowLeft, Plus, Minus,
  Trash2, User, Users, X, Check, Calculator, DollarSign,
  CreditCard, Smartphone, Search, Receipt,
  Edit2, Clock, RefreshCw,
  CheckCircle, XCircle, Wifi, WifiOff, Loader, Archive, RotateCcw,
  Printer,
} from "lucide-react";

// ═════════════════════════════════════════════════════════════════════════════
// Tip: fichye sa a fèt pou matche FactureScreen.dart (Flutter) pi pre posib.
// Diferans sèl ki pa ka evite sou web:
//   • Bluetooth thermal printer pa egziste sou navigatè → ranplase ak
//     window.print() (fonksyon printReceipt anba a).
//   • SharedPreferences (Flutter) → localStorage (web).
// ═════════════════════════════════════════════════════════════════════════════

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

interface ClientArticle {
  categorie: string;
  marque: string;
  modele: string;
  couleur: string;
  description: string;
  sn: string;
  idNum: string;
  prix: string;
  prixDevise: "HTG" | "$";
  qte: string;
}

interface Client {
  id: string;
  nom: string;
  telephone?: string;
  adresse?: string;
  nif?: string;
  articles?: ClientArticle[];
  rabais?: string;
  rabaisDevise?: "HTG" | "$";
  balance?: string;
  balanceDevise?: "HTG" | "$";
  montantTotal?: string;
  montantDevise?: "HTG" | "$";
  nomVendeur?: string;
  nomCaissier?: string;
  clientAksepte?: boolean;
  createdAt?: string;
  localId: string;
  pendingSync?: boolean;
  [key: string]: unknown;
}

interface Vendeur {
  id: string;
  nom: string;
  balance: number;
  ventes: VenteItem[];
  historique?: HistEntry[];
  localId: string;
}

interface HistEntry {
  type: string;
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
}

interface VenteItem {
  id?: string;
  ventId?: string;
  factureId?: string;
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
  clientNom?: string;
  cashier?: string;
  description?: string;
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
  dansPoubel?: boolean;
  poubelDate?: string;
  wasAnnuleAvantPoubel?: boolean;
  _pending?: boolean;
  _skipVendeurSync?: boolean;
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

type Tab = "facture" | "produits" | "istwa" | "poubel";
type ModePeman = "Cash" | "Bancaire" | "Moncash" | "Natcash";

// ─── Constants (menm non varyab ak Flutter, adapte pou localStorage) ─────────
const K_PENDING = "pending_factures_";
const K_PENDING_DELETES = "pending_deletes_";
const K_FACTURES = "factures_cache_";
const K_CLIENTS = "clients_cache_";
const K_PRODUCTS = "products_cache_";
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

function readCache<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch { return []; }
}
function writeCache<T>(key: string, data: T[]) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

// ─── Sous-koleksyon: locals/{localId}/{col}/{id} — menm estriktu ak Flutter ──
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
async function loadFactures(localId: string): Promise<Facture[]> {
  const snap = await getDocs(subCol(localId, "factures"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Facture));
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
async function saveTauxDb(v: number) {
  await setDoc(doc(db, "parametres", "taux"), { taux: v }, { merge: true });
}
async function loadCommission(): Promise<Record<string, number>> {
  const snap = await getDoc(doc(db, "locals", "all"));
  return (snap.data()?.commission as Record<string, number>) ?? DEFAULT_COMMISSION;
}

function histEntry(opts: {
  type: string; montant: number; description: string;
  venteId?: string; marque?: string; modele?: string; billNo?: string;
  clientNom?: string; cashier?: string; produitDescription?: string;
}): HistEntry {
  const e: HistEntry = { type: opts.type, date: new Date().toISOString(), montant: opts.montant, description: opts.description };
  if (opts.venteId) e.venteId = opts.venteId;
  if (opts.marque) e.marque = opts.marque;
  if (opts.modele) e.modele = opts.modele;
  if (opts.billNo) e.billNo = opts.billNo;
  if (opts.clientNom) e.clientNom = opts.clientNom;
  if (opts.cashier) e.cashier = opts.cashier;
  if (opts.produitDescription) e.produitDescription = opts.produitDescription;
  return e;
}

// ─── Enprime resi — ranplase Bluetooth printer Flutter a sou web ────────────
function printReceipt(facture: Facture, client: Client | undefined, businessName = "MillionStore Haiti") {
  const win = window.open("", "_blank", "width=380,height=600");
  if (!win) return;
  const devise = facture.devise || "$";
  const total = devise === "HTG" ? facture.totalUSD * facture.taux : facture.totalUSD;
  const rows = facture.lignes.map(l => {
    const prixDisp = devise === "HTG" ? l.prix * facture.taux : l.prix;
    return `
      <tr>
        <td style="padding:2px 0;">${l.marque} ${l.modele}${l.description ? `<br/><span style="font-size:10px;color:#555">${l.description}</span>` : ""}${l.serialImei ? `<br/><span style="font-size:10px;color:#555">S/N: ${l.serialImei}</span>` : ""}</td>
        <td style="padding:2px 0;text-align:center;">${l.qty}</td>
        <td style="padding:2px 0;text-align:right;">${devise === "HTG" ? prixDisp.toFixed(0) : prixDisp.toFixed(2)}</td>
      </tr>`;
  }).join("");

  win.document.write(`
    <html>
      <head>
        <title>Facture #${facture.billNo}</title>
        <style>
          body { font-family: 'Courier New', monospace; font-size: 12px; width: 300px; margin: 0 auto; padding: 12px; color: #000; }
          h2 { text-align:center; margin: 4px 0; font-size:16px; }
          .center { text-align:center; }
          hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
          table { width: 100%; border-collapse: collapse; }
          .total { font-weight: bold; font-size: 14px; }
        </style>
      </head>
      <body>
        <h2>${businessName}</h2>
        <p class="center">Facture #${facture.billNo}</p>
        <p class="center">${fmtDate(facture.date)}</p>
        <hr/>
        <p>Client : ${facture.clientNom || "Anonyme"}${client?.telephone ? `<br/>Tel: ${client.telephone}` : ""}</p>
        <p>Caissier : ${facture.cashier} — Vendeur : ${facture.vendeur}</p>
        <hr/>
        <table>
          <thead><tr><th style="text-align:left;">Article</th><th>Qty</th><th style="text-align:right;">Prix</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <hr/>
        <p>Mode de Paiement : ${facture.modePeman}</p>
        <p class="total">TOTAL: ${devise} ${devise === "HTG" ? total.toFixed(0) : total.toFixed(2)}</p>
        <hr/>
        <p class="center">Merci pour votre confiance !</p>
        <script>window.onload = () => { window.print(); }</script>
      </body>
    </html>
  `);
  win.document.close();
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function FacturePage() {
  const router = useRouter();

  const [user, setUser] = useState<UserSession | null>(null);
  const [localId, setLocalId] = useState("");

  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [vendeurs, setVendeurs] = useState<Vendeur[]>([]);
  const [factures, setFactures] = useState<Facture[]>([]);
  const [commission, setCommission] = useState<Record<string, number>>(DEFAULT_COMMISSION);

  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [devise, setDevise] = useState<"$" | "HTG">("$");
  const [taux, setTaux] = useState(1);
  const [taxPct] = useState(0);
  const [modePeman, setModePeman] = useState<ModePeman>("Cash");
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientNom, setClientNom] = useState("");
  const [vendeur, setVendeur] = useState("");
  const [billCnt, setBillCnt] = useState(1);

  const [tab, setTab] = useState<Tab>("facture");
  const [search, setSearch] = useState("");
  const [searchIstwa, setSearchIstwa] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // ── Anpeche double-klik sou Annule/Restore/Siprime (= _busyFactureIds Flutter) ──
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  function isBusy(id: string) { return busyIds.has(id); }
  function addBusy(id: string) { setBusyIds(prev => new Set(prev).add(id)); }
  function removeBusy(id: string) { setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n; }); }

  const [showClientPicker, setShowClientPicker] = useState(false);
  const [showVendeurPicker, setShowVendeurPicker] = useState(false);
  const [showModePeman, setShowModePeman] = useState(false);
  const [showDevise, setShowDevise] = useState(false);
  const [showTaux, setShowTaux] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showEditPrix, setShowEditPrix] = useState<number | null>(null);
  const [showAnnuler, setShowAnnuler] = useState<Facture | null>(null);
  const [showRestaurer, setShowRestaurer] = useState<Facture | null>(null);
  const [showSiprimeDefinitif, setShowSiprimeDefinitif] = useState<Facture | null>(null);
  const [vendeurPickerCallback, setVendeurPickerCallback] = useState<((v: string) => void) | null>(null);

  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const billNo = String(billCnt).padStart(4, "0");
  const subtotal = lignes.reduce((s, l) => s + l.prix * l.qty, 0);
  const taxAmt = subtotal * taxPct / 100;
  const total = subtotal + taxAmt;

  // ─────────────────────────────────────────────────────────────────────────
  // INIT SESSION
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const u = JSON.parse(raw) as UserSession;
      setUser(u);
      if (u.isAdmin) {
        getDocs(collection(db, "locals")).then(snap => {
          const ids = snap.docs.map(d => d.id).filter(id => id !== "all");
          setLocalId(u.selectedLocalId || ids[0] || "");
        });
      } else {
        setLocalId(u.localId);
      }
    } catch { router.push("/login"); }
  }, [router]);

  // ─────────────────────────────────────────────────────────────────────────
  // INIT DATA — cache lokal ANVAN, apre chaje/koute Firestore an tan reyèl
  // (menm lojik ak _load() nan FactureScreen.dart)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!localId) return;
    let unsubFactures: (() => void) | undefined;
    let unsubProducts: (() => void) | undefined;
    let unsubClients: (() => void) | undefined;
    let unsubVendeurs: (() => void) | undefined;
    let unsubTaux: (() => void) | undefined;

    setIsOnline(navigator.onLine);
    const onOn = () => setIsOnline(true);
    const onOff = () => setIsOnline(false);
    window.addEventListener("online", onOn);
    window.addEventListener("offline", onOff);

    (async () => {
      setLoading(true);
      const savedTaux = parseFloat(localStorage.getItem("taux_dollar_htg") ?? "1") || 1;
      setTaux(savedTaux);
      const savedBill = parseInt(localStorage.getItem(K_BILL + localId) ?? "1") || 1;
      setBillCnt(savedBill);

      // 1) Cache lokal la parèt imedyatman — UI pa janm vid menm offline
      loadCachedAll();

      // 2) Chaje fre depi Firestore
      try {
        const [prods, clts, vends, facts, comm, tauxOnline] = await Promise.all([
          loadProducts(localId), loadClients(localId), loadVendeurs(localId),
          loadFactures(localId), loadCommission(), loadTaux(),
        ]);
        const filteredProds = prods.filter(p => !p.isDeleted && (p.stock ?? 0) > 0);
        setProducts(filteredProds);
        writeCache(K_PRODUCTS + localId, filteredProds);

        const sortedClients = clts.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
        setClients(sortedClients);
        writeCache(K_CLIENTS + localId, sortedClients);

        setVendeurs(vends);
        setCommission(comm);
        setTaux(tauxOnline);
        localStorage.setItem("taux_dollar_htg", String(tauxOnline));

        const merged = mergeFacturesWithPending(filterDeleted(facts));
        setFactures(merged);
        writeCache(K_FACTURES + localId, merged);
      } catch {
        loadCachedAll();
      }
      setLoading(false);

      // 3) STREAMS an tan reyèl (menm jan ak _subProd/_subClients/_subVendeurs/_subTaux/_subFactures)
      unsubProducts = onSnapshot(subCol(localId, "products"), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Product))
          .filter(p => !p.isDeleted && (p.stock ?? 0) > 0);
        setProducts(data);
        writeCache(K_PRODUCTS + localId, data);
      }, () => {});

      unsubClients = onSnapshot(subCol(localId, "clients"), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Client));
        setClients(prevMergeClients(data));
        writeCache(K_CLIENTS + localId, data);
      }, () => {});

      unsubVendeurs = onSnapshot(subCol(localId, "vendeurs"), snap => {
        setVendeurs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Vendeur)));
      }, () => {});

      unsubTaux = onSnapshot(doc(db, "parametres", "taux"), snap => {
        const v = snap.data()?.taux as number | undefined;
        if (v && v > 0) { setTaux(v); localStorage.setItem("taux_dollar_htg", String(v)); }
      });

      unsubFactures = onSnapshot(subCol(localId, "factures"), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Facture));
        const merged = mergeFacturesWithPending(filterDeleted(data));
        setFactures(merged);
        writeCache(K_FACTURES + localId, merged);
      }, () => { loadCachedAll(); });

      syncTimerRef.current = setInterval(() => {
        syncPendingFactures();
        syncPendingDeletes();
      }, 10000);
    })();

    return () => {
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      unsubFactures?.(); unsubProducts?.(); unsubClients?.(); unsubVendeurs?.(); unsubTaux?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localId]);

  function prevMergeClients(fresh: Client[]): Client[] {
    // Kenbe kliyan lokal ki poko sync (pendingSync) — pa pèdi yo si stream ranmpli anvan sync
    setClients(prevList => {
      const freshIds = new Set(fresh.map(c => c.id));
      const merged = [...fresh];
      for (const local of prevList) {
        if (!freshIds.has(local.id) || local.pendingSync) {
          const idx = merged.findIndex(c => c.id === local.id);
          if (idx !== -1) merged[idx] = local; else merged.unshift(local);
        }
      }
      merged.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      return merged;
    });
    return fresh; // valè pa itilize dirèkteman, setClients anndan an fè travay la
  }

  function loadCachedAll() {
    const pRaw = readCache<Product>(K_PRODUCTS + localId);
    if (pRaw.length) setProducts(pRaw);
    const cRaw = readCache<Client>(K_CLIENTS + localId);
    if (cRaw.length) setClients(cRaw);
    const fRaw = readCache<Facture>(K_FACTURES + localId);
    if (fRaw.length) setFactures(mergeFacturesWithPending(fRaw));
  }

  function filterDeleted(base: Facture[]): Facture[] {
    const delIds = new Set(readCache<string>(K_PENDING_DELETES + localId));
    if (!delIds.size) return base;
    return base.filter(f => !delIds.has(f.id));
  }

  function mergeFacturesWithPending(base: Facture[]): Facture[] {
    const pending = readCache<Facture>(K_PENDING + localId);
    if (!pending.length) return base;
    const merged = [...base];
    for (const p of pending) {
      const idx = merged.findIndex(f => f.id === p.id);
      if (idx !== -1) merged[idx] = p; // vèsyon pending pran priyorite
      else merged.unshift(p);
    }
    return merged;
  }

  function addToPending(facture: Facture) {
    const list = readCache<Facture>(K_PENDING + localId);
    const idx = list.findIndex(f => f.id === facture.id);
    if (idx !== -1) list[idx] = facture; else list.push(facture);
    writeCache(K_PENDING + localId, list);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SYNC PENDING → FIRESTORE (menm jan ak _syncPendingFactures + _syncVendeurAfterPending)
  // ─────────────────────────────────────────────────────────────────────────
  async function syncPendingFactures() {
    if (!navigator.onLine) return;
    const pending = readCache<Facture>(K_PENDING + localId);
    if (!pending.length) return;
    const stillPending: Facture[] = [];
    for (const f of pending) {
      try {
        const toSave: Facture = { ...f };
        const skipVendeurSync = toSave._skipVendeurSync === true;
        delete toSave._pending;
        delete toSave._skipVendeurSync;

        await saveFacture(toSave, localId);

        if (!skipVendeurSync) {
          if (!toSave.annule) await syncVendeurAfterPending(toSave);
          else await syncVendeurAnnulationAfterPending(toSave);
        }
        setFactures(prev => prev.map(fac => fac.id === toSave.id ? toSave : fac));
      } catch { stillPending.push(f); }
    }
    if (!stillPending.length) localStorage.removeItem(K_PENDING + localId);
    else writeCache(K_PENDING + localId, stillPending);
  }

  async function syncPendingDeletes() {
    if (!navigator.onLine) return;
    const delList = readCache<string>(K_PENDING_DELETES + localId);
    if (!delList.length) return;
    const stillPending: string[] = [];
    for (const fid of delList) {
      try { await deleteFactureDb(fid, localId); } catch { stillPending.push(fid); }
    }
    if (!stillPending.length) localStorage.removeItem(K_PENDING_DELETES + localId);
    else writeCache(K_PENDING_DELETES + localId, stillPending);
  }

  async function syncVendeurAfterPending(facture: Facture) {
    if (!facture.vendeur) return;
    const vends = await loadVendeurs(localId);
    const idx = vends.findIndex(v => v.nom === facture.vendeur);
    if (idx === -1) return;
    const ventes = [...(vends[idx].ventes ?? [])];
    const alreadyAdded = ventes.some(v => v.factureId ? v.factureId === facture.id : v.billNo === facture.billNo);
    if (alreadyAdded) return;
    const hist = [...(vends[idx].historique ?? [])];
    let totalGain = 0;
    for (const l of facture.lignes) {
      const pvUSD = facture.devise === "HTG" ? l.prix / facture.taux : l.prix;
      const benefis = Math.max(0, (pvUSD - l.prixAchat) * l.qty);
      const catKey = Object.keys(commission).find(k => k.toLowerCase() === l.category.toLowerCase()) ?? "";
      const gainKom = catKey ? commission[catKey] * l.qty : 0;
      totalGain += benefis + gainKom;
      ventes.push({ ventId: `${Date.now()}_${l.productId}`, factureId: facture.id, id: l.productId, marque: l.marque, model: l.modele, categorie: l.category, prixAchat: l.prixAchat, prixVente: pvUSD, commission: gainKom, benefis, gainTotal: benefis + gainKom, qty: l.qty, billNo: facture.billNo, date: facture.date, clientNom: facture.clientNom, cashier: facture.cashier, description: l.description });
      hist.push(histEntry({ type: "vente", montant: benefis + gainKom, description: "Vente ajoutée", venteId: l.productId, marque: l.marque, modele: l.modele, billNo: facture.billNo, clientNom: facture.clientNom, cashier: facture.cashier, produitDescription: l.description }));
    }
    vends[idx].ventes = ventes;
    vends[idx].historique = hist;
    vends[idx].balance = (vends[idx].balance ?? 0) + totalGain;
    await saveVendeur(vends[idx], localId);
  }

  async function syncVendeurAnnulationAfterPending(facture: Facture) {
    if (!facture.vendeur) return;
    const vends = await loadVendeurs(localId);
    const idx = vends.findIndex(v => v.nom === facture.vendeur);
    if (idx === -1) return;
    let gainRetire = 0;
    const hist = [...(vends[idx].historique ?? [])];
    vends[idx].ventes = (vends[idx].ventes ?? []).filter(v => {
      const match = v.factureId ? v.factureId === facture.id : v.billNo === facture.billNo;
      if (match) {
        gainRetire += v.gainTotal ?? 0;
        hist.push(histEntry({ type: "annulation", montant: -(v.gainTotal ?? 0), description: "Vente annulée", venteId: v.id, marque: v.marque, modele: v.model, billNo: facture.billNo, clientNom: v.clientNom, cashier: v.cashier, produitDescription: v.description }));
        return false;
      }
      return true;
    });
    vends[idx].historique = hist;
    vends[idx].balance = Math.max(0, (vends[idx].balance ?? 0) - gainRetire);
    await saveVendeur(vends[idx], localId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CART
  // ─────────────────────────────────────────────────────────────────────────
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
    snack("✅ Ajouté à la facture !", "#00C853");
  }

  function removeLigne(idx: number) { setLignes(prev => prev.filter((_, i) => i !== idx)); }
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
    setLignes(prev => { const next = [...prev]; next[idx] = { ...next[idx], prix: newPrix }; return next; });
  }
  function switchDevise(newDevise: "$" | "HTG") {
    if (newDevise === devise) return;
    setLignes(prev => prev.map(l => ({ ...l, prix: devise === "$" ? l.prix * taux : l.prix / taux })));
    setDevise(newDevise);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VALIDATE & SAVE (san verifikasyon printer — pa gen sans sou web)
  // ─────────────────────────────────────────────────────────────────────────
  function onValidate() {
    if (!lignes.length) return;
    if (!clientId && !clientNom) { snack("⚠️ Sélectionnez un client avant !", "orange"); setShowClientPicker(true); return; }
    setVendeurPickerCallback(() => (v: string) => { setVendeur(v); setShowVendeurPicker(false); setShowConfirm(true); });
    setShowVendeurPicker(true);
  }

  async function saveAndFinish(vendeurNom: string) {
    if (isSaving) return;
    setIsSaving(true);
    setShowConfirm(false);
    try {
      const factureId = Date.now().toString();
      const facture: Facture = {
        id: factureId, billNo, date: new Date().toISOString(), localId,
        clientId: clientId ?? "", clientNom: clientNom || "Anonyme", vendeur: vendeurNom,
        cashier: user?.username ?? "", modePeman, devise, taux, taxPct,
        subtotalUSD: devise === "HTG" ? subtotal / taux : subtotal,
        taxUSD: devise === "HTG" ? taxAmt / taux : taxAmt,
        totalUSD: devise === "HTG" ? total / taux : total,
        benefisUSD: lignes.reduce((s, l) => {
          const pvUSD = devise === "HTG" ? l.prix / taux : l.prix;
          return s + Math.max(0, (pvUSD - l.prixAchat) * l.qty);
        }, 0),
        lignes: lignes.map(l => ({
          productId: l.productId, marque: l.marque, modele: l.modele, category: l.category,
          serialImei: l.serialImei, description: l.description,
          prix: devise === "HTG" ? l.prix / taux : l.prix, prixAchat: l.prixAchat, qty: l.qty,
        })),
      };

      setFactures(prev => [facture, ...prev]);

      if (navigator.onLine) {
        await saveFacture(facture, localId);
        const freshProds = await loadProducts(localId);
        for (const l of lignes) {
          const idx = freshProds.findIndex(p => p.id === l.productId);
          if (idx !== -1) {
            const updated = { ...freshProds[idx], stock: Math.max(0, (freshProds[idx].stock ?? 0) - l.qty) };
            await saveProduct(updated, localId);
          }
        }
        await addVenteVendeur(vendeurNom, facture);
      } else {
        addToPending({ ...facture, _pending: true });
        snack("📴 Hors ligne — Facture enregistrée localement. Synchronisation automatique.", "orange");
      }

      const newBill = billCnt + 1;
      setBillCnt(newBill);
      localStorage.setItem(K_BILL + localId, String(newBill));

      const clientData = clients.find(c => c.id === clientId);
      setLignes([]); setClientId(null); setClientNom(""); setVendeur("");
      snack(`✅ Facture #${billNo} créée !`, "#00C853");
      setTab("istwa");

      // Ouvri fenèt enprime (ranplase Bluetooth printer Flutter a)
      printReceipt(facture, clientData);
    } catch (e) {
      snack("❌ Erreur : " + e, "red");
    } finally { setIsSaving(false); }
  }

  async function addVenteVendeur(vendeurNom: string, facture: Facture) {
    const vends = await loadVendeurs(localId);
    const idx = vends.findIndex(v => v.nom === vendeurNom);
    if (idx === -1) return;
    const newVentes = [...(vends[idx].ventes ?? [])];
    const newHist = [...(vends[idx].historique ?? [])];
    let totalGain = 0;
    for (const l of lignes) {
      const pvUSD = devise === "HTG" ? l.prix / taux : l.prix;
      const benefis = Math.max(0, (pvUSD - l.prixAchat) * l.qty);
      const catKey = Object.keys(commission).find(k => k.toLowerCase() === l.category.toLowerCase()) ?? "";
      const gainKom = catKey ? commission[catKey] * l.qty : 0;
      totalGain += benefis + gainKom;
      const ventId = `${Date.now()}_${l.productId}_${Math.random().toString(36).slice(2,7)}`;
      newVentes.push({ ventId, factureId: facture.id, id: l.productId, marque: l.marque, model: l.modele, categorie: l.category, prixAchat: l.prixAchat, prixVente: pvUSD, commission: gainKom, benefis, gainTotal: benefis + gainKom, qty: l.qty, billNo: facture.billNo, date: facture.date, clientNom: facture.clientNom, cashier: facture.cashier, description: l.description });
      newHist.push(histEntry({ type: "vente", montant: benefis + gainKom, description: "Vente ajoutée", venteId: l.productId, marque: l.marque, modele: l.modele, billNo: facture.billNo, clientNom: facture.clientNom, cashier: facture.cashier, produitDescription: l.description }));
    }
    vends[idx].ventes = newVentes;
    vends[idx].historique = newHist;
    vends[idx].balance = (vends[idx].balance ?? 0) + totalGain;
    await saveVendeur(vends[idx], localId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ANNULE
  // ─────────────────────────────────────────────────────────────────────────
  async function annulerFacture(f: Facture) {
    if (isBusy(f.id)) return;
    addBusy(f.id);
    try {
      const diffMin = Math.floor((Date.now() - new Date(f.date).getTime()) / 60000);
      if (!user?.isAdmin && diffMin > 30) { snack("❌ 30 minutes écoulées ! Annulation impossible.", "red"); return; }

      const prods = await loadProducts(localId);
      for (const l of f.lignes) {
        const idx = prods.findIndex(p => p.id === l.productId);
        if (idx !== -1) {
          const updated = { ...prods[idx], stock: (prods[idx].stock ?? 0) + l.qty, isDeleted: false };
          await saveProduct(updated, localId);
        }
      }

      if (f.vendeur) {
        const vends = await loadVendeurs(localId);
        const idx = vends.findIndex(v => v.nom === f.vendeur);
        if (idx !== -1) {
          let gainRetire = 0;
          const hist = [...(vends[idx].historique ?? [])];
          vends[idx].ventes = (vends[idx].ventes ?? []).filter((v: VenteItem) => {
            const match = v.factureId ? v.factureId === f.id : v.billNo === f.billNo;
            if (match) {
              gainRetire += v.gainTotal ?? 0;
              hist.push(histEntry({ type: "annulation", montant: -(v.gainTotal ?? 0), description: "Vente annulée", venteId: v.id, marque: v.marque, modele: v.model, billNo: f.billNo, clientNom: v.clientNom, cashier: v.cashier, produitDescription: v.description }));
              return false;
            }
            return true;
          });
          vends[idx].historique = hist;
          vends[idx].balance = Math.max(0, (vends[idx].balance ?? 0) - gainRetire);
          await saveVendeur(vends[idx], localId);
        }
      }

      // Menm jan ak Flutter: Annule voye fakti a DIRÈKTEMAN nan Poubèl,
      // nan menm aksyon an (pa gen bouton "Siprime" separe nan Istwa tab).
      const updated: Facture = {
        ...f, annule: true, annuleDate: new Date().toISOString(),
        dansPoubel: true, poubelDate: new Date().toISOString(),
        wasAnnuleAvantPoubel: true,
      };
      delete updated._pending;

      if (navigator.onLine) {
        await saveFacture(updated, localId);
        snack(`✅ Facture #${f.billNo} annulée ! Stock restitué.`, "green");
      } else {
        addToPending({ ...updated, _skipVendeurSync: true });
        snack("📴 Hors ligne — Annulation enregistrée localement.", "orange");
      }

      setFactures(prev => prev.map(fac => fac.id === f.id ? updated : fac));
    } catch (e) {
      snack("❌ Erreur : " + e, "red");
    } finally {
      removeBusy(f.id);
      setShowAnnuler(null);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POUBÈL — restore / siprime definitif
  // (Annule voye deja fakti a nan Poubèl pi wo a — pa gen aksyon separe isit)
  // ─────────────────────────────────────────────────────────────────────────
  async function restaurerFacture(f: Facture) {
    if (isBusy(f.id)) return;
    addBusy(f.id);
    try {
      const wasAnnule = f.wasAnnuleAvantPoubel === true;
      const updated: Facture = { ...f };

      if (wasAnnule) {
        const prods = await loadProducts(localId);
        for (const l of f.lignes) {
          const idx = prods.findIndex(p => p.id === l.productId);
          if (idx !== -1) {
            const qty = l.qty ?? 1;
            const p = { ...prods[idx], stock: Math.max(0, (prods[idx].stock ?? 0) - qty) };
            await saveProduct(p, localId);
          }
        }
        if (f.vendeur) {
          const vends = await loadVendeurs(localId);
          const idx = vends.findIndex(v => v.nom === f.vendeur);
          if (idx !== -1) {
            const newVentes = [...(vends[idx].ventes ?? [])];
            const hist = [...(vends[idx].historique ?? [])];
            let gainRemet = 0;
            for (const l of f.lignes) {
              const pvUSD = l.prix;
              const benefis = Math.max(0, (pvUSD - l.prixAchat) * l.qty);
              const catKey = Object.keys(commission).find(k => k.toLowerCase() === l.category.toLowerCase()) ?? "";
              const gainKom = catKey ? commission[catKey] * l.qty : 0;
              gainRemet += benefis + gainKom;
              const ventId = `${Date.now()}_${l.productId}_${Math.random().toString(36).slice(2,7)}`;
              newVentes.push({ ventId, factureId: f.id, id: l.productId, marque: l.marque, model: l.modele, categorie: l.category, prixAchat: l.prixAchat, prixVente: pvUSD, commission: gainKom, benefis, gainTotal: benefis + gainKom, qty: l.qty, billNo: f.billNo, date: new Date().toISOString(), clientNom: f.clientNom, cashier: f.cashier, description: l.description });
              hist.push(histEntry({ type: "restauration", montant: benefis + gainKom, description: "Vente restaurée", venteId: l.productId, marque: l.marque, modele: l.modele, billNo: f.billNo, clientNom: f.clientNom, cashier: f.cashier, produitDescription: l.description }));
            }
            vends[idx].ventes = newVentes;
            vends[idx].historique = hist;
            vends[idx].balance = (vends[idx].balance ?? 0) + gainRemet;
            await saveVendeur(vends[idx], localId);
          }
        }
        updated.annule = false;
        delete updated.annuleDate;
      }

      delete updated.dansPoubel;
      delete updated.poubelDate;
      delete updated.wasAnnuleAvantPoubel;
      delete updated._pending;

      if (navigator.onLine) await saveFacture(updated, localId);
      else addToPending({ ...updated, _skipVendeurSync: true });

      setFactures(prev => prev.map(fac => fac.id === f.id ? updated : fac));
      snack(navigator.onLine ? `✅ Facture #${f.billNo} restaurée !` : "📴 Hors ligne — Facture restaurée localement. Synchronisation automatique.", "green");
    } catch (e) {
      snack("❌ Erreur : " + e, "red");
    } finally {
      removeBusy(f.id);
      setShowRestaurer(null);
    }
  }

  async function siprimeDefinitif(f: Facture) {
    if (isBusy(f.id)) return;
    addBusy(f.id);
    try {
      const pendingList = readCache<Facture>(K_PENDING + localId).filter(p => p.id !== f.id);
      writeCache(K_PENDING + localId, pendingList);

      setFactures(prev => prev.filter(fac => fac.id !== f.id));

      if (navigator.onLine) {
        await deleteFactureDb(f.id, localId);
        snack(`✅ Facture #${f.billNo} supprimée définitivement !`, "green");
      } else {
        const delList = readCache<string>(K_PENDING_DELETES + localId);
        if (!delList.includes(f.id)) delList.push(f.id);
        writeCache(K_PENDING_DELETES + localId, delList);
        snack("📴 Hors ligne — retirée localement, sera supprimée définitivement au retour du réseau.", "orange");
      }
    } catch (e) {
      snack("❌ Erreur : " + e, "red");
    } finally {
      removeBusy(f.id);
      setShowSiprimeDefinitif(null);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADD CLIENT
  // ─────────────────────────────────────────────────────────────────────────
  async function addNewClient(data: Partial<Client>) {
    const newClient: Client = {
      id: Date.now().toString(), nom: data.nom ?? "", telephone: data.telephone ?? "",
      adresse: data.adresse ?? "", nif: data.nif ?? "",
      articles: data.articles ?? [], rabais: data.rabais ?? "0", rabaisDevise: data.rabaisDevise ?? "HTG",
      balance: data.balance ?? "0", balanceDevise: data.balanceDevise ?? "HTG",
      montantTotal: data.montantTotal ?? "", montantDevise: data.montantDevise ?? "HTG",
      nomVendeur: data.nomVendeur ?? "", nomCaissier: data.nomCaissier ?? "",
      clientAksepte: data.clientAksepte ?? false,
      createdAt: new Date().toISOString(), localId, pendingSync: true,
    };
    setClients(prev => [newClient, ...prev]);
    setClientId(newClient.id);
    setClientNom(newClient.nom);
    try {
      await saveClient(newClient, localId);
    } catch {
      snack("📴 Hors ligne — Client enregistré localement, synchronisation à venir.", "orange");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SNACK
  // ─────────────────────────────────────────────────────────────────────────
  const [snackMsg, setSnackMsg] = useState("");
  const [snackColor, setSnackColor] = useState("#00C853");
  function snack(msg: string, color: string) {
    setSnackMsg(msg); setSnackColor(color);
    setTimeout(() => setSnackMsg(""), 3000);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#1A1D2E", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <Loader size={40} color="#00C853" style={{ animation: "spin 1s linear infinite" }} />
      <p style={{ color: "#fff", fontFamily: "Segoe UI, sans-serif" }}>Chargement...</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const poubel = factures.filter(f => f.dansPoubel === true)
    .sort((a, b) => (b.poubelDate ?? "").localeCompare(a.poubelDate ?? ""));

  return (
    <div style={{ minHeight: "100vh", background: "#F4F5F7", fontFamily: "'Segoe UI', sans-serif", display: "flex", flexDirection: "column" }}>

      {/* ── AppBar ── */}
      <div style={{ background: "#1A1D2E", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 12px", gap: 6 }}>
          <button onClick={() => router.back()} style={iconBtnW}><ArrowLeft size={18} /></button>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 14, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.displayName}
          </span>

          <button onClick={() => setShowCalc(true)} style={iconBtnW} title="Calculatrice"><Calculator size={18} /></button>
          <button onClick={() => setShowClientPicker(true)} style={{ ...iconBtnW, position: "relative" }} title="Client">
            <User size={18} />
            {clientNom && <span style={{ position: "absolute", top: 4, right: 4, width: 7, height: 7, borderRadius: "50%", background: "#00C853" }} />}
          </button>
          <button onClick={() => setShowModePeman(true)} style={iconBtnW} title="Mode de paiement">
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
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", borderRadius: 16, background: isOnline ? "rgba(0,200,83,0.15)" : "rgba(255,87,34,0.15)", border: `1px solid ${isOnline ? "rgba(0,200,83,0.4)" : "rgba(255,87,34,0.4)"}` }}>
            {isOnline ? <Wifi size={12} color="#00C853" /> : <WifiOff size={12} color="#FF5722" />}
          </div>
          <button onClick={onValidate} disabled={!lignes.length || isSaving} style={{ width: 34, height: 34, borderRadius: "50%", background: lignes.length ? "#00C853" : "#666", border: "none", cursor: lignes.length ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isSaving ? <Loader size={16} color="#fff" style={{ animation: "spin 1s linear infinite" }} /> : <Check size={18} color="#fff" />}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex" }}>
          {(["facture", "produits", "istwa"] as Tab[]).concat(user?.isAdmin ? ["poubel"] : []).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "11px 0", background: "none", border: "none", color: tab === t ? "#00C853" : "rgba(255,255,255,0.5)", fontWeight: 700, fontSize: 11, letterSpacing: 1, borderBottom: tab === t ? "3px solid #00C853" : "3px solid transparent", cursor: "pointer", transition: "all .2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
              {t === "facture" && <Receipt size={13} />}
              {t === "produits" && <Package size={13} />}
              {t === "istwa" && <History size={13} />}
              {t === "poubel" && <Archive size={13} />}
              {t === "poubel" ? "CORBEILLE" : t === "istwa" ? "HISTORIQUE" : t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {tab === "facture" && <FactureTab lignes={lignes} devise={devise} total={total} modePeman={modePeman} clientNom={clientNom} onRemove={removeLigne} onQty={updateQty} onEditPrix={(i) => setShowEditPrix(i)} onClientPick={() => setShowClientPicker(true)} />}
        {tab === "produits" && <ProduitsTab products={products} lignes={lignes} devise={devise} taux={taux} search={search} setSearch={setSearch} onAdd={addToCart} />}
        {tab === "istwa" && <IstwaTab factures={factures.filter(f => !f.dansPoubel)} clients={clients} devise={devise} taux={taux} searchIstwa={searchIstwa} setSearchIstwa={setSearchIstwa} isAdmin={user?.isAdmin ?? false} busyIds={busyIds} onAnnuler={(f) => setShowAnnuler(f)} onReprint={(f) => printReceipt(f, clients.find(c => c.id === f.clientId))} />}
        {tab === "poubel" && <PoubelTab poubel={poubel} devise={devise} taux={taux} busyIds={busyIds} onRestore={(f) => setShowRestaurer(f)} onDeleteDef={(f) => setShowSiprimeDefinitif(f)} />}
      </div>

      {/* ── Snack ── */}
      {snackMsg && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: snackColor, color: "#fff", padding: "10px 20px", borderRadius: 12, fontWeight: 600, zIndex: 999, fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
          {snackMsg}
        </div>
      )}

      {/* ═══════════════════ MODALS ═══════════════════ */}

      {showModePeman && (
        <BottomSheet onClose={() => setShowModePeman(false)} title="Mode de paiement">
          {(["Cash", "Bancaire", "Moncash", "Natcash"] as ModePeman[]).map(m => (
            <button key={m} onClick={() => { setModePeman(m); setShowModePeman(false); }} style={{ ...listItem, background: modePeman === m ? "rgba(0,200,83,0.08)" : "none" }}>
              <span style={{ flex: 1, fontWeight: 700 }}>{m}</span>
              {modePeman === m && <CheckCircle size={18} color="#00C853" />}
            </button>
          ))}
        </BottomSheet>
      )}

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

      {showTaux && <TauxModal taux={taux} onSave={async (v) => { setTaux(v); localStorage.setItem("taux_dollar_htg", String(v)); setShowTaux(false); try { await saveTauxDb(v); } catch {} snack(`✅ Taux sove: 1$ = ${v.toFixed(2)} HTG`, "#00C853"); }} onClose={() => setShowTaux(false)} />}
      {showCalc && <CalculatorModal onClose={() => setShowCalc(false)} />}
      {showClientPicker && <ClientPickerModal clients={clients} clientId={clientId} onSelect={(id, nom) => { setClientId(id); setClientNom(nom); setShowClientPicker(false); }} onAdd={addNewClient} onClose={() => setShowClientPicker(false)} />}
      {showVendeurPicker && <VendeurPickerModal vendeurs={vendeurs} vendeur={vendeur} onSelect={(v) => { if (vendeurPickerCallback) vendeurPickerCallback(v); }} onClose={() => setShowVendeurPicker(false)} />}

      {showConfirm && (
        <DarkModal onClose={() => setShowConfirm(false)} title={`Facture #${billNo}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {[["Vendeur", vendeur], ["Client", clientNom || "Anonyme"], ["Mode de Paiement", modePeman], [`${lignes.length} produit(s)`, ""], ["TOTAL", `${devise} ${total.toFixed(2)}`]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#ffffff80", fontSize: 13 }}>{k}</span>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowConfirm(false)} style={cancelBtn}>Annuler</button>
            <button onClick={() => saveAndFinish(vendeur)} style={greenBtn}>✅ Confirmer + Imprimer</button>
          </div>
        </DarkModal>
      )}

      {showEditPrix !== null && (
        <EditPrixModal prix={lignes[showEditPrix]?.prix ?? 0} devise={devise} onSave={(v) => { updatePrix(showEditPrix, v); setShowEditPrix(null); }} onClose={() => setShowEditPrix(null)} label={`${lignes[showEditPrix]?.marque} ${lignes[showEditPrix]?.modele}`} />
      )}

      {showAnnuler && (
        <DarkModal onClose={() => setShowAnnuler(null)} title="Annuler la Facture ?">
          <p style={{ fontWeight: 700, color: "#fff", marginBottom: 8 }}>Facture #{showAnnuler.billNo}</p>
          <div style={{ background: "rgba(255,152,0,0.08)", borderRadius: 10, padding: 12, marginBottom: 16 }}>
            {["Les produits seront remis en stock", "Le rapport sera mis à jour automatiquement", "Le solde du vendeur sera corrigé"].map(t => (
              <div key={t} style={{ color: "#FF9800", fontSize: 12, marginBottom: 4 }}>⚠️ {t}</div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowAnnuler(null)} style={cancelBtn}>Non</button>
            <button onClick={() => annulerFacture(showAnnuler)} style={{ ...greenBtn, background: "#F44336" }}>Oui, Annuler</button>
          </div>
        </DarkModal>
      )}

      {showRestaurer && (
        <DarkModal onClose={() => setShowRestaurer(null)} title="Restaurer la Facture ?">
          <p style={{ color: "#ffffff80", marginBottom: 16 }}>Facture #{showRestaurer.billNo} ap retounen nan plas li normal.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowRestaurer(null)} style={cancelBtn}>Non</button>
            <button onClick={() => restaurerFacture(showRestaurer)} style={greenBtn}>Oui, Restaurer</button>
          </div>
        </DarkModal>
      )}

      {showSiprimeDefinitif && (
        <DarkModal onClose={() => setShowSiprimeDefinitif(null)} title="Supprimer Définitivement ?">
          <p style={{ color: "#ffffff80", marginBottom: 16 }}>
            Facture #{showSiprimeDefinitif.billNo} ap siprime pou toujou.<br/><br/>
            Cette action est IRRÉVERSIBLE — vous ne pourrez plus restaurer cette facture.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowSiprimeDefinitif(null)} style={cancelBtn}>Non</button>
            <button onClick={() => siprimeDefinitif(showSiprimeDefinitif)} style={{ ...greenBtn, background: "#F44336" }}>Oui, Supprimer Définitivement</button>
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
  lignes: Ligne[]; devise: string; total: number;
  modePeman: string; clientNom: string;
  onRemove: (i: number) => void; onQty: (i: number, d: number) => void;
  onEditPrix: (i: number) => void; onClientPick: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{ background: "#1A1D2E", padding: "12px 16px 20px", textAlign: "center" }}>
        <button onClick={onClientPick} style={{ background: "none", border: "none", cursor: "pointer", color: clientNom ? "#fff" : "rgba(255,255,255,0.54)", fontSize: 13, fontWeight: 600, letterSpacing: 1, display: "flex", alignItems: "center", gap: 6, margin: "0 auto 12px" }}>
          <User size={14} />
          {clientNom ? `CLIENT: ${clientNom.toUpperCase()}` : "CLIENT : NON SÉLECTIONNÉ"}
        </button>
        <div style={{ color: "#00C853", fontSize: 42, fontWeight: 900, letterSpacing: 1 }}>{total.toFixed(2)} {devise}</div>
        <div style={{ color: "rgba(255,255,255,0.54)", fontSize: 14, marginTop: 4 }}>Mode: {modePeman}</div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {!lignes.length ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60%", gap: 12 }}>
            <Receipt size={64} color="#ddd" />
            <p style={{ color: "#aaa", fontSize: 16 }}>La facture est vide</p>
            <p style={{ color: "#aaa", fontSize: 12 }}>Allez dans « PRODUITS » pour ajouter</p>
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
    const cat = p.category || "Autre";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(p);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{ padding: 12 }}>
        <div style={{ position: "relative" }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#aaa" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher (marque, modèle, S/N, ID...)" style={{ width: "100%", padding: "10px 12px 10px 36px", borderRadius: 12, border: "1px solid #e0e0e0", background: "#fff", fontSize: 14, boxSizing: "border-box", outline: "none" }} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
        {!products.length ? (
          <div style={{ textAlign: "center", padding: 60, color: "#aaa" }}>
            <Package size={64} color="#ddd" />
            <p>Aucun produit disponible</p>
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
                          + Ajouter
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
function IstwaTab({ factures, clients, devise, taux, searchIstwa, setSearchIstwa, isAdmin, busyIds, onAnnuler, onReprint }: {
  factures: Facture[]; clients: Client[]; devise: string; taux: number;
  searchIstwa: string; setSearchIstwa: (v: string) => void;
  isAdmin: boolean; busyIds: Set<string>;
  onAnnuler: (f: Facture) => void; onReprint: (f: Facture) => void;
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
      <div style={{ background: "#1A1D2E", padding: "10px 12px 12px" }}>
        <div style={{ position: "relative", marginBottom: 10 }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.38)" }} />
          <input value={searchIstwa} onChange={e => setSearchIstwa(e.target.value)} placeholder="Rechercher : #facture, client, tél, ID, S/N, date..." style={{ width: "100%", padding: "10px 12px 10px 36px", borderRadius: 12, border: "none", background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 13, boxSizing: "border-box", outline: "none" }} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <StatPill icon={<Receipt size={12} />} color="#4CAF50" label={`${active.length} Active(s)`} />
          <StatPill icon={<DollarSign size={12} />} color="#FFD600" label={devise === "HTG" ? `HTG ${totalVant.toFixed(0)}` : `$${totalVant.toFixed(2)}`} />
          {annule.length > 0 && <StatPill icon={<XCircle size={12} />} color="#F44336" label={`${annule.length} Annulée(s)`} />}
          {pending.length > 0 && <StatPill icon={<WifiOff size={12} />} color="#FF9800" label={`${pending.length} 📴`} />}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 8, background: "rgba(0,200,83,0.15)", border: "1px solid rgba(0,200,83,0.4)" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00C853" }} />
            <span style={{ color: "#00C853", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>LIVE</span>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 10px 20px" }}>
        {!factures.length ? (
          <EmptyState icon={<Receipt size={56} color="#ddd" />} msg="Aucune facture pour le moment" />
        ) : !filtered.length ? (
          <EmptyState icon={<Search size={56} color="#ddd" />} msg={`Aucun résultat pour "${searchIstwa}"`} />
        ) : (
          <>
            {active.length > 0 && (
              <>
                <SectionHeader icon={<Receipt size={14} />} color="#4CAF50" label="Factures Actives" count={active.length} />
                {active.map(f => <FactureCard key={f.id} f={f} clients={clients} devise={devise} taux={taux} isAdmin={isAdmin} busy={busyIds.has(f.id)} onAnnuler={onAnnuler} onReprint={onReprint} />)}
              </>
            )}
            {annule.length > 0 && (
              <>
                <SectionHeader icon={<XCircle size={14} />} color="#F44336" label="Factures Annulées" count={annule.length} />
                {annule.map(f => <FactureCard key={f.id} f={f} clients={clients} devise={devise} taux={taux} isAdmin={isAdmin} busy={busyIds.has(f.id)} onAnnuler={onAnnuler} onReprint={onReprint} />)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FactureCard({ f, clients, devise, taux, isAdmin, busy, onAnnuler, onReprint }: {
  f: Facture; clients: Client[]; devise: string; taux: number;
  isAdmin: boolean; busy: boolean;
  onAnnuler: (f: Facture) => void; onReprint: (f: Facture) => void;
}) {
  const isAnnule = f.annule === true;
  const isPending = f._pending === true;
  const clientData = clients.find(c => c.id === f.clientId);
  const clientTel = clientData?.telephone ?? "";
  const tot = f.totalUSD ?? 0;

  let canAnnule = false;
  let minRestant = 0;
  if (!isAnnule) {
    if (isAdmin) canAnnule = true;
    else {
      const diffMin = Math.floor((Date.now() - new Date(f.date).getTime()) / 60000);
      canAnnule = diffMin <= 30;
      minRestant = 30 - diffMin;
    }
  }

  const borderColor = isPending ? "rgba(255,152,0,0.4)" : isAnnule ? "rgba(244,67,54,0.25)" : "rgba(0,0,0,0.08)";
  const bgColor = isPending ? "rgba(255,152,0,0.04)" : isAnnule ? "rgba(244,67,54,0.04)" : "#fff";

  return (
    <div style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 16, padding: 14, marginBottom: 10, boxShadow: isAnnule ? "none" : "0 2px 6px rgba(0,0,0,0.06)", opacity: busy ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: (isPending ? "rgba(255,152,0,0.12)" : isAnnule ? "rgba(244,67,54,0.12)" : "rgba(0,200,83,0.12)"), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {isPending ? <WifiOff size={17} color="#FF9800" /> : isAnnule ? <XCircle size={17} color="#F44336" /> : <Receipt size={17} color="#00C853" />}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: isAnnule ? "#999" : "#1A1D2E" }}>#{f.billNo}</span>
            {isPending && <span style={{ background: "rgba(255,152,0,0.15)", color: "#FF9800", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5, border: "1px solid rgba(255,152,0,0.4)" }}>📴 OFFLINE</span>}
            {isAnnule && !isPending && <span style={{ background: "rgba(244,67,54,0.12)", color: "#F44336", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5 }}>ANNULÉE</span>}
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
          {isPending && <div style={{ fontSize: 10, color: "#FF9800" }}>⏳ Synchronisation...</div>}
        </div>
      </div>

      <div style={{ borderTop: "1px solid #eee", margin: "10px 0" }} />

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: isAnnule ? "#aaa" : "#1A1D2E" }}>
            <User size={13} color={isAnnule ? "#bbb" : "#009688"} /> {f.clientNom ?? "Anonyme"}
          </div>
          {clientTel && <div style={{ fontSize: 11, color: "#999", marginTop: 2, paddingLeft: 17 }}>📞 {clientTel}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          {f.vendeur && <div style={{ fontSize: 11, color: "#FF9800" }}>🏷️ {f.vendeur}</div>}
          {f.cashier && <div style={{ fontSize: 11, color: "#2196F3" }}>💼 {f.cashier}</div>}
          <div style={{ fontSize: 11, color: "#999" }}>{f.modePeman}</div>
        </div>
      </div>

      <div style={{ background: isAnnule ? "rgba(0,0,0,0.02)" : "rgba(26,29,46,0.03)", borderRadius: 10, padding: 10, border: "1px solid rgba(0,0,0,0.06)", marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: isAnnule ? "#aaa" : "#1A1D2E", marginBottom: (f.lignes ?? []).length ? 8 : 0, display: "flex", alignItems: "center", gap: 5 }}>
          <Package size={12} /> {(f.lignes ?? []).length} Produit(s)
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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => onReprint(f)} style={{ background: "rgba(33,150,243,0.08)", border: "1px solid rgba(33,150,243,0.3)", borderRadius: 10, padding: "7px 12px", color: "#2196F3", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
          <Printer size={14} /> Réimprimer
        </button>

        {canAnnule && !isAdmin && (
          <div style={{ background: "rgba(255,152,0,0.08)", borderRadius: 10, padding: "7px 8px", display: "flex", alignItems: "center", gap: 4 }}>
            <Clock size={12} color="#FF9800" />
            <span style={{ fontSize: 11, color: "#FF9800", fontWeight: 700 }}>{minRestant} min</span>
          </div>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canAnnule && (
            <button onClick={() => onAnnuler(f)} disabled={busy} style={{ background: "rgba(244,67,54,0.08)", border: "1px solid rgba(244,67,54,0.3)", borderRadius: 10, padding: "7px 12px", color: "#F44336", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              <XCircle size={14} /> Annuler
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POUBÈL TAB
// ─────────────────────────────────────────────────────────────────────────────
function PoubelTab({ poubel, devise, taux, busyIds, onRestore, onDeleteDef }: {
  poubel: Facture[]; devise: string; taux: number; busyIds: Set<string>;
  onRestore: (f: Facture) => void; onDeleteDef: (f: Facture) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{ background: "#1A1D2E", padding: "14px 16px", display: "flex", alignItems: "center", gap: 8 }}>
        <Archive size={20} color="#FF9800" />
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>{poubel.length} Facture(s) dans la Corbeille</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
        {poubel.length === 0 ? (
          <EmptyState icon={<Archive size={56} color="#ddd" />} msg="La corbeille est vide" />
        ) : poubel.map(f => {
          const tot = f.totalUSD ?? 0;
          const busy = busyIds.has(f.id);
          return (
            <div key={f.id} style={{ background: "rgba(255,152,0,0.04)", border: "1px solid rgba(255,152,0,0.3)", borderRadius: 16, padding: 14, marginBottom: 10, opacity: busy ? 0.6 : 1 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,152,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Trash2 size={17} color="#FF9800" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>#{f.billNo}</span>
                    {f.wasAnnuleAvantPoubel && <span style={{ background: "rgba(244,67,54,0.12)", color: "#F44336", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5 }}>ÉTAIT ANNULÉE</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#FF9800", fontWeight: 700, marginTop: 4 }}>🗑️ Mise à la corbeille : {fmtDate(f.poubelDate)}</div>
                  <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>🕐 Date d'origine : {fmtDate(f.date)}</div>
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#FF9800" }}>
                  {devise === "HTG" ? `HTG ${(tot * taux).toFixed(0)}` : `$${tot.toFixed(2)}`}
                </span>
              </div>
              <p style={{ margin: "0 0 10px", fontSize: 12, color: "#666" }}>
                Client : {f.clientNom ?? "Anonyme"} • Vendeur : {f.vendeur ?? "-"}
                {f.cashier && <><br/>Caissier : {f.cashier}</>}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => onRestore(f)} disabled={busy} style={{ flex: 2, background: "#00C853", border: "none", borderRadius: 10, padding: 10, color: "#fff", fontWeight: 700, fontSize: 13, cursor: busy ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <RotateCcw size={15} /> Restaurer
                </button>
                <button onClick={() => onDeleteDef(f)} disabled={busy} style={{ flex: 1, background: "none", border: "1px solid #F44336", borderRadius: 10, padding: 10, color: "#F44336", fontWeight: 700, fontSize: 13, cursor: busy ? "default" : "pointer" }}>
                  Supprimer
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT PICKER MODAL
// ─────────────────────────────────────────────────────────────────────────────
function emptyArticle(): ClientArticle {
  return { categorie: "", marque: "", modele: "", couleur: "", description: "", sn: "", idNum: "", prix: "", prixDevise: "HTG", qte: "1" };
}

function DevizToggle({ current, onChange }: { current: "HTG" | "$"; onChange: (v: "HTG" | "$") => void }) {
  return (
    <div style={{ display: "flex", background: "#F0F4F8", border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
      {(["HTG", "$"] as const).map(cur => (
        <button key={cur} onClick={() => onChange(cur)} type="button" style={{
          border: "none", cursor: "pointer", padding: "6px 10px", fontSize: 11, fontWeight: 700,
          background: current === cur ? "#009688" : "transparent", color: current === cur ? "#fff" : "#666",
        }}>{cur}</button>
      ))}
    </div>
  );
}

function fieldStyle(color: string): React.CSSProperties {
  return { width: "100%", padding: "9px 12px", borderRadius: 10, border: `1px solid ${color}26`, background: `${color}09`, fontSize: 13, boxSizing: "border-box", outline: "none", marginBottom: 9 };
}

function SectionLabel({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 10px" }}>
      <span style={{ fontWeight: 700, fontSize: 12, color }}>{text}</span>
      <div style={{ flex: 1, height: 1, background: `${color}30` }} />
    </div>
  );
}

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
  const [nif, setNif] = useState("");
  const [aksepte, setAksepte] = useState(false);

  const [articles, setArticles] = useState<ClientArticle[]>([emptyArticle()]);

  const [rabais, setRabais] = useState("0");
  const [rabaisDevise, setRabaisDevise] = useState<"HTG" | "$">("HTG");
  const [balance, setBalance] = useState("0");
  const [balanceDevise, setBalanceDevise] = useState<"HTG" | "$">("HTG");
  const [montant, setMontant] = useState("");
  const [montantDevise, setMontantDevise] = useState<"HTG" | "$">("HTG");

  const [nomVendeur, setNomVendeur] = useState("");
  const [nomCaissier, setNomCaissier] = useState("");

  const [saving, setSaving] = useState(false);

  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2,"0")}/${String(now.getMonth()+1).padStart(2,"0")}/${now.getFullYear()}  ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  const filtered = clients.filter(c => !search || `${c.nom} ${c.telephone} ${c.adresse}`.toLowerCase().includes(search.toLowerCase()));

  function updateArticle(i: number, patch: Partial<ClientArticle>) {
    setArticles(prev => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  }

  async function handleAdd() {
    if (!nom.trim()) return;
    setSaving(true);
    await onAdd({
      nom: nom.trim(), telephone: tel.trim(), adresse: adr.trim(), nif: nif.trim(),
      articles, rabais, rabaisDevise, balance, balanceDevise,
      montantTotal: montant, montantDevise, nomVendeur: nomVendeur.trim(), nomCaissier: nomCaissier.trim(),
      clientAksepte: aksepte,
    });
    setSaving(false);
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      <div style={{ position: "relative", background: "#F8F9FF", borderRadius: "20px 20px 0 0", height: "93vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{showAdd ? "Nouveau Client" : "Choisir un Client"}</span>
          <button onClick={() => setShowAdd(!showAdd)} style={{ background: showAdd ? "#f5f5f5" : "rgba(0,184,148,0.1)", border: `1px solid ${showAdd ? "#ddd" : "#00B894"}`, borderRadius: 20, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: showAdd ? "#888" : "#00B894", fontWeight: 700, fontSize: 12 }}>
            {showAdd ? <><Users size={13} /> Liste des Clients</> : <><User size={13} /> Nouveau Client</>}
          </button>
        </div>

        {showAdd ? (
          <>
            <div style={{ padding: "10px 16px 0" }}>
              <div style={{ background: "linear-gradient(135deg,#00B894,#00CEC9)", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 3px 10px rgba(0,184,148,0.3)" }}>
                <Receipt size={20} color="#fff" />
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>Nouvelle Fiche Client</div>
                  <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 9 }}>Date : {dateStr}</div>
                </div>
                <span style={{ background: "rgba(255,255,255,0.2)", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 8 }}>MillionStore</span>
              </div>
            </div>

            <div style={{ padding: "10px 16px", overflowY: "auto", flex: 1 }}>
              <button onClick={() => setAksepte(!aksepte)} style={{ width: "100%", background: aksepte ? "#E8F8F2" : "#fff", border: `${aksepte ? 2 : 1}px solid ${aksepte ? "#00B894" : "#ddd"}`, borderRadius: 12, padding: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <CheckCircle size={26} color={aksepte ? "#00B894" : "#ccc"} />
                <div style={{ textAlign: "left", flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: aksepte ? "#00B894" : "#666" }}>{aksepte ? "Client Accepté ✅" : "Client non accepté"}</div>
                  <div style={{ fontSize: 10, color: "#999" }}>{aksepte ? "Le client confirme son accord avec les conditions" : "Cliquez pour confirmer l'acceptation du client"}</div>
                </div>
              </button>

              <div style={{ background: "#fff", borderRadius: 12, padding: 12, marginBottom: 10, boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}>
                <SectionLabel text="Informations Client" color="#009688" />
                <input value={nom} onChange={e => setNom(e.target.value)} placeholder="Nom du Client *" style={fieldStyle("#009688")} />
                <input value={tel} onChange={e => setTel(e.target.value)} placeholder="Téléphone" style={fieldStyle("#2196F3")} />
                <input value={adr} onChange={e => setAdr(e.target.value)} placeholder="Adresse" style={fieldStyle("#FF9800")} />
                <input value={nif} onChange={e => setNif(e.target.value)} placeholder="NIF / CIN" style={{ ...fieldStyle("#9C27B0"), marginBottom: 0 }} />
              </div>

              <div style={{ background: "#fff", borderRadius: 12, padding: 12, marginBottom: 10, boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}>
                <SectionLabel text="Produits" color="#FF5722" />
                {articles.map((art, i) => (
                  <div key={i} style={{ background: "#FFF9F6", border: "1px solid rgba(255,87,34,0.15)", borderRadius: 12, padding: 12, marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#FF5722", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
                      <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: "#FF5722", flex: 1 }}>Article {i + 1}</span>
                      {articles.length > 1 && (
                        <button onClick={() => setArticles(prev => prev.filter((_, idx) => idx !== i))} style={{ background: "rgba(255,0,0,0.08)", border: "none", borderRadius: "50%", width: 22, height: 22, cursor: "pointer", color: "red", fontSize: 12 }}>×</button>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input value={art.categorie} onChange={e => updateArticle(i, { categorie: e.target.value })} placeholder="Catégorie" style={{ ...fieldStyle("#FF5722"), flex: 1 }} />
                      <input value={art.marque} onChange={e => updateArticle(i, { marque: e.target.value })} placeholder="Marque" style={{ ...fieldStyle("#FF5722"), flex: 1 }} />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input value={art.modele} onChange={e => updateArticle(i, { modele: e.target.value })} placeholder="Modèle" style={{ ...fieldStyle("#FF5722"), flex: 1 }} />
                      <input value={art.couleur} onChange={e => updateArticle(i, { couleur: e.target.value })} placeholder="Couleur" style={{ ...fieldStyle("#795548"), flex: 1 }} />
                    </div>
                    <input value={art.description} onChange={e => updateArticle(i, { description: e.target.value })} placeholder="Description" style={fieldStyle("#607D8B")} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <input value={art.sn} onChange={e => updateArticle(i, { sn: e.target.value })} placeholder="S/N" style={{ ...fieldStyle("#607D8B"), flex: 1 }} />
                      <input value={art.idNum} onChange={e => updateArticle(i, { idNum: e.target.value })} placeholder="ID" style={{ ...fieldStyle("#607D8B"), flex: 1 }} />
                    </div>
                    <input value={art.qte} onChange={e => updateArticle(i, { qte: e.target.value })} type="number" placeholder="Quantité" style={fieldStyle("#009688")} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <input value={art.prix} onChange={e => updateArticle(i, { prix: e.target.value })} type="number" placeholder="Prix" style={{ ...fieldStyle("#009688"), flex: 1, marginBottom: 0 }} />
                      <DevizToggle current={art.prixDevise} onChange={(v) => updateArticle(i, { prixDevise: v })} />
                    </div>
                  </div>
                ))}
                <button onClick={() => setArticles(prev => [...prev, emptyArticle()])} style={{ width: "100%", background: "none", border: "1px solid #FF5722", color: "#FF5722", borderRadius: 10, padding: 11, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                  + Nouvel Article
                </button>
              </div>

              <div style={{ background: "#fff", borderRadius: 12, padding: 12, marginBottom: 10, boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}>
                <SectionLabel text="Totaux du Contrat" color="#009688" />
                <div style={{ display: "flex", gap: 8, marginBottom: 9 }}>
                  <input value={rabais} onChange={e => setRabais(e.target.value)} type="number" placeholder="Rabais" style={{ ...fieldStyle("#009688"), flex: 1, marginBottom: 0 }} />
                  <DevizToggle current={rabaisDevise} onChange={setRabaisDevise} />
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 9 }}>
                  <input value={balance} onChange={e => setBalance(e.target.value)} type="number" placeholder="Balance" style={{ ...fieldStyle("#009688"), flex: 1, marginBottom: 0 }} />
                  <DevizToggle current={balanceDevise} onChange={setBalanceDevise} />
                </div>
                <div style={{ background: "#F0FFF8", border: "1.5px solid rgba(0,150,136,0.4)", borderRadius: 10, padding: 9, display: "flex", alignItems: "center", gap: 8 }}>
                  <DollarSign size={17} color="#009688" />
                  <input value={montant} onChange={e => setMontant(e.target.value)} type="number" placeholder="Montant Total"
                    style={{ flex: 1, border: "none", outline: "none", background: "none", fontWeight: 700, fontSize: 14, color: "#00B894" }} />
                  <DevizToggle current={montantDevise} onChange={setMontantDevise} />
                </div>
              </div>

              <div style={{ background: "#fff", borderRadius: 12, padding: 12, marginBottom: 12, boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}>
                <SectionLabel text="Responsable" color="#673AB7" />
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={nomVendeur} onChange={e => setNomVendeur(e.target.value)} placeholder="Nom Vendeur" style={{ ...fieldStyle("#673AB7"), flex: 1 }} />
                  <input value={nomCaissier} onChange={e => setNomCaissier(e.target.value)} placeholder="Nom Caissier" style={{ ...fieldStyle("#673AB7"), flex: 1 }} />
                </div>
                <div style={{ background: "#F8F9FF", border: "1px solid #eee", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                  <Clock size={14} color="#607D8B" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: "#999" }}>Date & Heure</div>
                    <div style={{ fontWeight: 700, fontSize: 11, color: "#607D8B" }}>{dateStr}</div>
                  </div>
                  <span style={{ background: "rgba(0,150,136,0.1)", color: "#009688", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6 }}>Automatique</span>
                </div>
              </div>

              <button onClick={handleAdd} disabled={!nom.trim() || saving} style={{ ...greenBtnLight, width: "100%", padding: 14 }}>
                {saving ? "Enregistrement..." : "Sauvegarder et Choisir le Client"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: "10px 16px" }}>
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#009688" }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher par nom, téléphone, adresse..." style={{ width: "100%", padding: "9px 10px 9px 32px", borderRadius: 12, border: "none", background: "#f0f0f0", fontSize: 13, boxSizing: "border-box", outline: "none" }} />
              </div>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              <button onClick={() => onSelect(null, "")} style={{ ...listItem, borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12 }}><User size={18} color="#aaa" /></div>
                <span style={{ flex: 1, fontWeight: 600 }}>Client Anonyme</span>
                {!clientId && <CheckCircle size={18} color="#00C853" />}
              </button>
              {filtered.map(c => {
                const nbArticles = (c.articles ?? []).length;
                return (
                  <button key={c.id} onClick={() => onSelect(c.id, c.nom)} style={{ ...listItem, borderBottom: "1px solid #f0f0f0", alignItems: "flex-start" }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(0,150,136,0.15)", display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12, flexShrink: 0, marginTop: 2 }}>
                      <span style={{ color: "#009688", fontWeight: 700 }}>{c.nom[0]?.toUpperCase()}</span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 600 }}>{c.nom}</span>
                        <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: c.clientAksepte ? "#E8F8F2" : "#fff3e0", color: c.clientAksepte ? "#00B894" : "orange" }}>
                          {c.clientAksepte ? "Accepté" : "En attente"}
                        </span>
                      </div>
                      {c.telephone && <div style={{ fontSize: 12, color: "#888" }}>📞 {c.telephone}</div>}
                      {c.adresse && <div style={{ fontSize: 11, color: "#aaa" }}>📍 {c.adresse}</div>}
                      {nbArticles > 0 && <div style={{ fontSize: 11, color: "#FF5722" }}>📦 {nbArticles} article(s)</div>}
                      {c.montantTotal && <div style={{ fontSize: 11, color: "#009688", fontWeight: 700 }}>{c.montantTotal} {c.montantDevise}</div>}
                    </div>
                    {clientId === c.id && <CheckCircle size={18} color="#00C853" style={{ marginLeft: 8, marginTop: 2 }} />}
                  </button>
                );
              })}
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
    <DarkModal onClose={onClose} title="Quel Vendeur ?">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {vendeurs.map(v => (
          <button key={v.id} onClick={() => setSelected(v.nom)} style={{ background: selected === v.nom ? "#1A1D2E" : "#f5f5f5", border: `1px solid ${selected === v.nom ? "#00C853" : "#ddd"}`, borderRadius: 20, padding: "7px 14px", cursor: "pointer", color: selected === v.nom ? "#fff" : "#333", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            {selected === v.nom && <CheckCircle size={13} color="#00C853" />} {v.nom}
          </button>
        ))}
      </div>
      <input value={selected} onChange={e => setSelected(e.target.value)} placeholder="Nom du vendeur" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #ddd", marginBottom: 16, fontSize: 14, boxSizing: "border-box", outline: "none", color: "#333" }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClose} style={cancelBtn}>Annuler</button>
        <button onClick={() => selected.trim() && onSelect(selected.trim())} disabled={!selected.trim()} style={{ ...greenBtn, opacity: selected.trim() ? 1 : 0.5 }}>Continuer</button>
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
          <button onClick={onClose} style={cancelBtnLight}>Annuler</button>
          <button onClick={() => { const v = parseFloat(val); if (v > 0) onSave(v); }} style={greenBtnLight}>Enregistrer le Taux</button>
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
        <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 14 }}>Modifier le Prix</p>
        <p style={{ margin: "0 0 16px", color: "#888", fontSize: 13 }}>{label}</p>
        <input type="number" value={val} onChange={e => setVal(e.target.value)} placeholder={`Nouveau prix (${devise})`} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #ddd", marginBottom: 16, fontSize: 15, boxSizing: "border-box", outline: "none" }} autoFocus />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={cancelBtnLight}>Annuler</button>
          <button onClick={() => { const v = parseFloat(val); if (!isNaN(v) && v >= 0) onSave(v); onClose(); }} style={greenBtnLight}>Enregistrer</button>
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

function EmptyState({ icon, msg }: { icon: React.ReactNode; msg: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", gap: 12 }}>
      {icon}
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