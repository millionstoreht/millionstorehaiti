"use client";
import React, { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import { collection, doc, getDocs, setDoc, deleteDoc, onSnapshot } from "firebase/firestore";
import {
  Search, X, Phone, MapPin, CreditCard, Package, DollarSign, Percent,
  Wallet, User, Calendar, Copy, Edit2, Trash2, UserPlus, CheckCircle,
  Clock, Save, Plus, ArrowRight, ChevronLeft,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────
interface UserSession {
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  permissions: Record<string, boolean>;
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
}

const COLORS = [
  "#6C63FF", "#00B894", "#E17055", "#0984E3", "#D63031",
  "#6D214F", "#1289A7", "#C4E538", "#F79F1F", "#5F27CD",
];
function colorOf(nom: string) {
  const s = nom || "";
  return COLORS[s.length === 0 ? 0 : s.charCodeAt(0) % COLORS.length];
}

function fmtDateShort(raw?: string) {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  } catch { return ""; }
}
function fmtDateFull(raw?: string) {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}  ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  } catch { return ""; }
}

function emptyArticle(): ClientArticle {
  return { categorie: "", marque: "", modele: "", couleur: "", description: "", sn: "", idNum: "", prix: "", prixDevise: "HTG", qte: "1" };
}

const subCol = (localId: string, col: string) => collection(db, "locals", localId, col);
const subDoc = (localId: string, col: string, id: string) => doc(db, "locals", localId, col, id);
async function saveClientDb(c: Client, localId: string) { await setDoc(subDoc(localId, "clients", c.id), c); }
async function deleteClientDb(id: string, localId: string) { await deleteDoc(subDoc(localId, "clients", id)); }

const K_CACHE = "clients_";

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function ClientsPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [localId, setLocalId] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [showDetail, setShowDetail] = useState<Client | null>(null);
  const [showForm, setShowForm] = useState<{ mode: "add" } | { mode: "edit"; client: Client } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Client | null>(null);
  const [snackMsg, setSnackMsg] = useState("");
  const [snackColor, setSnackColor] = useState("#00C853");

  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function snack(msg: string, color: string) {
    setSnackMsg(msg); setSnackColor(color);
    setTimeout(() => setSnackMsg(""), 2500);
  }

  const canAdd = user?.isAdmin || user?.permissions?.clientAjoute === true;
  const canEdit = user?.isAdmin || user?.permissions?.clientModifye === true;
  const canDelete = user?.isAdmin || user?.permissions?.clientSiprime === true;

  // ── AUTH ──
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const session = JSON.parse(raw) as UserSession;
      setUser(session);
      if (session.isAdmin) {
        getDocs(collection(db, "locals")).then(snap => {
          const ids = snap.docs.map(d => d.id).filter(id => id !== "all");
          setLocalId(ids[0] ?? "");
        });
      } else {
        setLocalId(session.localId);
      }
    } catch { router.push("/login"); }
  }, [router]);

  // ── LOAD + REALTIME + SYNC ──
  useEffect(() => {
    if (!localId) return;
    setLoading(true);

    // Cache first
    try {
      const raw = localStorage.getItem(K_CACHE + localId);
      if (raw) {
        const cached = (JSON.parse(raw) as Client[]).sort(sortByDate);
        setClients(cached);
      }
    } catch {}

    const unsub = onSnapshot(subCol(localId, "clients"), snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Client));
      setIsOnline(true);
      const merged = mergeLocal(data, localId);
      setClients(merged.sort(sortByDate));
      localStorage.setItem(K_CACHE + localId, JSON.stringify(merged));
      setLoading(false);
    }, () => {
      setIsOnline(false);
      setLoading(false);
    });

    syncTimerRef.current = setInterval(() => syncPendingClients(localId), 10000);
    return () => { unsub(); if (syncTimerRef.current) clearInterval(syncTimerRef.current); };
  }, [localId]);

  function sortByDate(a: Client, b: Client) {
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  }

  function mergeLocal(base: Client[], lid: string): Client[] {
    try {
      const raw = localStorage.getItem(K_CACHE + lid);
      if (!raw) return base;
      const localList = JSON.parse(raw) as Client[];
      const baseIds = new Set(base.map(c => c.id));
      const merged = [...base];
      for (const local of localList) {
        if (!baseIds.has(local.id)) merged.push(local);
        else if (local.pendingSync) {
          const idx = merged.findIndex(c => c.id === local.id);
          if (idx !== -1) merged[idx] = local;
        }
      }
      return merged;
    } catch { return base; }
  }

  async function syncPendingClients(lid: string) {
    if (!navigator.onLine) return;
    try {
      const raw = localStorage.getItem(K_CACHE + lid);
      if (!raw) return;
      const list = JSON.parse(raw) as Client[];
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        if (!list[i].pendingSync) continue;
        try {
          const toSend = { ...list[i] };
          delete toSend.pendingSync;
          await saveClientDb(toSend, lid);
          list[i] = toSend;
          changed = true;
        } catch {}
      }
      if (changed) localStorage.setItem(K_CACHE + lid, JSON.stringify(list));
    } catch {}
  }

  function persistLocal(list: Client[]) {
    localStorage.setItem(K_CACHE + localId, JSON.stringify(list));
  }

  // ── SAVE (add or edit) ──
  async function saveClient(client: Client) {
    setClients(prev => {
      const idx = prev.findIndex(c => c.id === client.id);
      const next = idx !== -1 ? prev.map((c, i) => i === idx ? client : c) : [client, ...prev];
      next.sort(sortByDate);
      persistLocal(next);
      return next;
    });
    try {
      await saveClientDb(client, localId);
    } catch {
      snack("📴 Offline — sove lokal, ap sync pita.", "orange");
    }
  }

  async function deleteClient(c: Client) {
    setClients(prev => {
      const next = prev.filter(x => x.id !== c.id);
      persistLocal(next);
      return next;
    });
    try { await deleteClientDb(c.id, localId); } catch {}
    setShowDeleteConfirm(null);
    snack(`✅ ${c.nom} siprime.`, "#00C853");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      (c.nom ?? "").toLowerCase().includes(q) ||
      (c.telephone ?? "").includes(search) ||
      (c.adresse ?? "").toLowerCase().includes(q)
    );
  }, [clients, search]);

  if (loading || !user) {
    return (
      <main style={{ minHeight: "100vh", background: "#F5F6FA", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI',sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 44, height: 44, border: "4px solid #ddd", borderTop: "4px solid #00B894", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 14px" }} />
          <p style={{ color: "#888" }}>Chargement...</p>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "#F5F6FA", fontFamily: "'Segoe UI',sans-serif" }}>
      {/* ── Header gradient ── */}
      <div style={{ background: "linear-gradient(135deg,#00B894,#00CEC9)", padding: "16px 20px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button onClick={() => router.push("/dashboard")} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 10, width: 34, height: 34, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ChevronLeft size={20} />
          </button>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 17 }}>Clients</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ color: "#fff", fontSize: 36, fontWeight: 700 }}>{clients.length}</div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>Clients Total</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.2)", borderRadius: 20, padding: "6px 12px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: isOnline ? "#69f0ae" : "#ffb74d" }} />
            <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>{isOnline ? "Sync en direct" : "Hors ligne"}</span>
          </div>
        </div>
      </div>

      {/* ── Search ── */}
      <div style={{ background: "linear-gradient(135deg,#00B894,#00CEC9)", padding: "0 20px 14px" }}>
        <div style={{ position: "relative" }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.7)" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un client..."
            style={{ width: "100%", padding: "10px 36px 10px 34px", borderRadius: 12, border: "none", background: "rgba(255,255,255,0.15)", color: "#fff", fontSize: 13, boxSizing: "border-box", outline: "none" }} />
          {search && (
            <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer" }}>
              <X size={16} color="rgba(255,255,255,0.7)" />
            </button>
          )}
        </div>
      </div>

      {/* ── List ── */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 16px 90px" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", marginTop: 60 }}>
            <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(0,184,148,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <User size={36} color="#00B894" />
            </div>
            <p style={{ color: "#888", fontSize: 15 }}>
              {search ? `Aucun résultat pour "${search}"` : "Aucun client pour l'instant"}
            </p>
            {!search && canAdd && (
              <button onClick={() => setShowForm({ mode: "add" })} style={{ marginTop: 16, background: "#00B894", border: "none", borderRadius: 12, padding: "10px 20px", color: "#fff", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                <UserPlus size={16} /> Ajouter le Premier Client
              </button>
            )}
          </div>
        ) : filtered.map(c => (
          <ClientCard key={c.id} c={c} canDelete={canDelete} onOpen={() => setShowDetail(c)} onDelete={() => setShowDeleteConfirm(c)} />
        ))}
      </div>

      {/* ── FAB ── */}
      {canAdd && (
        <button onClick={() => setShowForm({ mode: "add" })} style={{
          position: "fixed", bottom: 24, right: 24, background: "#00B894", border: "none",
          borderRadius: 30, padding: "14px 20px", color: "#fff", fontWeight: 700, fontSize: 14,
          cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
          boxShadow: "0 8px 20px rgba(0,184,148,0.4)", zIndex: 50,
        }}>
          <UserPlus size={18} /> Nouveau Client
        </button>
      )}

      {/* ── Detail Sheet ── */}
      {showDetail && (
        <ClientDetailSheet
          c={showDetail} canEdit={canEdit} canDelete={canDelete}
          onClose={() => setShowDetail(null)}
          onEdit={() => { setShowForm({ mode: "edit", client: showDetail }); setShowDetail(null); }}
          onDelete={() => { setShowDeleteConfirm(showDetail); setShowDetail(null); }}
        />
      )}

      {/* ── Add/Edit Form ── */}
      {showForm && (
        <ClientFormModal
          existing={showForm.mode === "edit" ? showForm.client : undefined}
          localId={localId}
          onClose={() => setShowForm(null)}
          onSave={async (client) => { await saveClient(client); setShowForm(null); }}
        />
      )}

      {/* ── Delete confirm ── */}
      {showDeleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setShowDeleteConfirm(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: 22, width: "100%", maxWidth: 380 }}>
            <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 16 }}>Supprimer le Client ?</p>
            <p style={{ margin: "0 0 18px", color: "#888" }}>{showDeleteConfirm.nom}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowDeleteConfirm(null)} style={{ flex: 1, background: "#f5f5f5", border: "none", borderRadius: 12, padding: 11, cursor: "pointer", fontWeight: 600 }}>Non</button>
              <button onClick={() => deleteClient(showDeleteConfirm)} style={{ flex: 1, background: "#F44336", border: "none", borderRadius: 12, padding: 11, cursor: "pointer", color: "#fff", fontWeight: 700 }}>Oui</button>
            </div>
          </div>
        </div>
      )}

      {snackMsg && (
        <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: snackColor, color: "#fff", padding: "10px 20px", borderRadius: 12, fontWeight: 600, zIndex: 999, fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
          {snackMsg}
        </div>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT CARD
// ─────────────────────────────────────────────────────────────────────────────
function ClientCard({ c, canDelete, onOpen, onDelete }: {
  c: Client; canDelete: boolean; onOpen: () => void; onDelete: () => void;
}) {
  const color = colorOf(c.nom ?? "");
  const aksepte = c.clientAksepte === true;
  const articles = c.articles ?? [];
  const first = articles[0];
  const produitLabel = first ? `${first.marque ?? ""} ${first.modele ?? ""}`.trim() : "";

  return (
    <div onClick={onOpen} style={{ background: "#fff", borderRadius: 18, padding: 16, marginBottom: 12, boxShadow: `0 4px 12px ${color}14`, cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 14 }}>
      <div style={{ width: 52, height: 52, borderRadius: "50%", background: `linear-gradient(135deg, ${color}, ${color}b3)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 3px 8px ${color}4d` }}>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 20 }}>{(c.nom || "?")[0]?.toUpperCase()}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nom}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6, background: aksepte ? "#E8F8F2" : "#FFF3E0", color: aksepte ? "#00B894" : "orange", border: `0.8px solid ${aksepte ? "#00B894" : "orange"}`, flexShrink: 0 }}>
            {aksepte ? <CheckCircle size={10} /> : <Clock size={10} />} {aksepte ? "Accepté" : "En attente"}
          </span>
        </div>
        {c.telephone && <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, color: "#666", fontSize: 12 }}><Phone size={12} color="#aaa" /> {c.telephone}</div>}
        {c.adresse && <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2, color: "#999", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><MapPin size={11} color="#aaa" /> {c.adresse}</div>}
        {produitLabel && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2, color: "#999", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <Package size={11} color="#aaa" /> {produitLabel}{articles.length > 1 && `  (+${articles.length - 1} autre${articles.length > 2 ? "s" : ""})`}
          </div>
        )}
        {c.montantTotal && (
          <span style={{ display: "inline-block", marginTop: 6, background: "rgba(0,150,136,0.1)", color: "#009688", fontWeight: 700, fontSize: 12, padding: "2px 8px", borderRadius: 6 }}>
            {c.montantTotal} {c.montantDevise}
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: `${color}1a`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ArrowRight size={13} color={color} />
        </div>
        {canDelete && (
          <button onClick={e => { e.stopPropagation(); onDelete(); }} style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(244,67,54,0.08)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Trash2 size={13} color="#F44336" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DETAIL SHEET
// ─────────────────────────────────────────────────────────────────────────────
function DetailRow({ icon, label, value, color, onCopy }: { icon: React.ReactNode; label: string; value: string; color: string; onCopy?: () => void }) {
  return (
    <div onClick={onCopy} style={{ display: "flex", alignItems: "center", gap: 12, background: `${color}0d`, border: `1px solid ${color}26`, borderRadius: 12, padding: 14, marginBottom: 10, cursor: onCopy ? "pointer" : "default" }}>
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: `${color}1a`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ color: "#999", fontSize: 11 }}>{label}</div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{value}</div>
      </div>
      {onCopy && <Copy size={15} color="#bbb" />}
    </div>
  );
}

function ClientDetailSheet({ c, canEdit, canDelete, onClose, onEdit, onDelete }: {
  c: Client; canEdit: boolean; canDelete: boolean;
  onClose: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const color = colorOf(c.nom ?? "");
  const articles = c.articles ?? [];
  const aksepte = c.clientAksepte === true;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 250, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "24px 24px 0 0", width: "100%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <div style={{ width: 40, height: 4, background: "#ddd", borderRadius: 2 }} />
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: `linear-gradient(135deg, ${color}, ${color}99)`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", boxShadow: `0 6px 16px ${color}66` }}>
            <span style={{ color: "#fff", fontSize: 32, fontWeight: 700 }}>{(c.nom || "?")[0]?.toUpperCase()}</span>
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700 }}>{c.nom}</p>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: aksepte ? "#E8F8F2" : "#FFF3E0", color: aksepte ? "#00B894" : "orange", border: `1px solid ${aksepte ? "#00B894" : "orange"}`, borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 700 }}>
            {aksepte ? <CheckCircle size={14} /> : <Clock size={14} />} {aksepte ? "Client Accepté" : "En Attente"}
          </span>
        </div>

        <div style={{ marginTop: 20 }}>
          {c.telephone && <DetailRow icon={<Phone size={16} color={color} />} label="Téléphone" value={c.telephone} color={color} onCopy={() => navigator.clipboard?.writeText(c.telephone ?? "")} />}
          {c.adresse && <DetailRow icon={<MapPin size={16} color={color} />} label="Adresse" value={c.adresse} color={color} />}
          {c.nif && <DetailRow icon={<CreditCard size={16} color={color} />} label="NIF / CIN" value={c.nif} color={color} />}

          {articles.length > 0 && (
            <>
              <p style={{ margin: "10px 0 8px", fontSize: 13, fontWeight: 700, color: "#FF5722" }}>Produits ({articles.length})</p>
              {articles.map((a, i) => {
                const titre = `${a.marque ?? ""} ${a.modele ?? ""}`.trim();
                return (
                  <div key={i} style={{ background: "rgba(255,87,34,0.05)", border: "1px solid rgba(255,87,34,0.15)", borderRadius: 12, padding: 12, marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#FF5722", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
                      <span style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>{titre || a.categorie || "Article"}</span>
                      {a.prix && <span style={{ fontWeight: 700, fontSize: 13, color: "#009688" }}>{a.prix} {a.prixDevise}</span>}
                    </div>
                    {a.categorie && <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>Catégorie : {a.categorie}</div>}
                    {a.couleur && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>Couleur : {a.couleur}</div>}
                    {a.sn && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>S/N : {a.sn}</div>}
                    {a.idNum && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>ID : {a.idNum}</div>}
                    {a.description && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{a.description}</div>}
                    <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>Quantité : {a.qte || "1"}</div>
                  </div>
                );
              })}
            </>
          )}

          {c.montantTotal && <DetailRow icon={<DollarSign size={16} color="#009688" />} label="Montant Total" value={`${c.montantTotal} ${c.montantDevise ?? ""}`} color="#009688" />}
          {c.rabais && c.rabais !== "0" && <DetailRow icon={<Percent size={16} color="#FF9800" />} label="Rabais" value={`${c.rabais} ${c.rabaisDevise ?? ""}`} color="#FF9800" />}
          {c.balance && c.balance !== "0" && <DetailRow icon={<Wallet size={16} color="#F44336" />} label="Balance" value={`${c.balance} ${c.balanceDevise ?? ""}`} color="#F44336" />}
          {c.nomVendeur && <DetailRow icon={<User size={16} color="#673AB7" />} label="Vendeur" value={c.nomVendeur} color="#673AB7" />}
          {c.nomCaissier && <DetailRow icon={<User size={16} color="#673AB7" />} label="Caissier" value={c.nomCaissier} color="#673AB7" />}
          <DetailRow icon={<Calendar size={16} color={color} />} label="Date" value={fmtDateShort(c.createdAt)} color={color} />
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          {canEdit && (
            <button onClick={onEdit} style={{ flex: 1, background: "none", border: `1px solid ${color}`, color, borderRadius: 12, padding: 11, cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Edit2 size={15} /> Modifier
            </button>
          )}
          {canDelete && (
            <button onClick={onDelete} style={{ flex: 1, background: "none", border: "1px solid #F44336", color: "#F44336", borderRadius: 12, padding: 11, cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Trash2 size={15} /> Supprimer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD / EDIT FORM
// ─────────────────────────────────────────────────────────────────────────────
function DevizToggle({ current, onChange }: { current: "HTG" | "$"; onChange: (v: "HTG" | "$") => void }) {
  return (
    <div style={{ display: "flex", background: "#F0F4F8", border: "1px solid #ddd", borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
      {(["HTG", "$"] as const).map(cur => (
        <button key={cur} type="button" onClick={() => onChange(cur)} style={{ border: "none", cursor: "pointer", padding: "7px 11px", fontSize: 12, fontWeight: 700, background: current === cur ? "#009688" : "transparent", color: current === cur ? "#fff" : "#666" }}>{cur}</button>
      ))}
    </div>
  );
}
function fieldStyle(color: string): React.CSSProperties {
  return { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${color}26`, background: `${color}09`, fontSize: 13, boxSizing: "border-box", outline: "none", marginBottom: 10 };
}
function SectionLabel({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 12px" }}>
      <span style={{ fontWeight: 700, fontSize: 13, color }}>{text}</span>
      <div style={{ flex: 1, height: 1, background: `${color}30` }} />
    </div>
  );
}

function ClientFormModal({ existing, localId, onClose, onSave }: {
  existing?: Client; localId: string;
  onClose: () => void; onSave: (c: Client) => Promise<void>;
}) {
  const isEdit = !!existing;
  const [nom, setNom] = useState(existing?.nom ?? "");
  const [tel, setTel] = useState(existing?.telephone ?? "");
  const [adr, setAdr] = useState(existing?.adresse ?? "");
  const [nif, setNif] = useState(existing?.nif ?? "");
  const [aksepte, setAksepte] = useState(existing?.clientAksepte ?? false);
  const [articles, setArticles] = useState<ClientArticle[]>(
    existing?.articles && existing.articles.length > 0 ? existing.articles : [emptyArticle()]
  );
  const [rabais, setRabais] = useState(existing?.rabais ?? "0");
  const [rabaisDevise, setRabaisDevise] = useState<"HTG" | "$">(existing?.rabaisDevise ?? "HTG");
  const [balance, setBalance] = useState(existing?.balance ?? "0");
  const [balanceDevise, setBalanceDevise] = useState<"HTG" | "$">(existing?.balanceDevise ?? "HTG");
  const [montant, setMontant] = useState(existing?.montantTotal ?? "");
  const [montantDevise, setMontantDevise] = useState<"HTG" | "$">(existing?.montantDevise ?? "HTG");
  const [nomVendeur, setNomVendeur] = useState(existing?.nomVendeur ?? "");
  const [nomCaissier, setNomCaissier] = useState(existing?.nomCaissier ?? "");
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2,"0")}/${String(now.getMonth()+1).padStart(2,"0")}/${now.getFullYear()}  ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  function updateArticle(i: number, patch: Partial<ClientArticle>) {
    setArticles(prev => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  }

  async function handleSave() {
    if (!nom.trim()) return;
    setSaving(true);
    const client: Client = {
      id: existing?.id ?? Date.now().toString(),
      nom: nom.trim(), telephone: tel.trim(), adresse: adr.trim(), nif: nif.trim(),
      articles, rabais, rabaisDevise, balance, balanceDevise,
      montantTotal: montant, montantDevise, nomVendeur: nomVendeur.trim(), nomCaissier: nomCaissier.trim(),
      clientAksepte: aksepte, localId, createdAt: existing?.createdAt ?? new Date().toISOString(),
      pendingSync: true,
    };
    await onSave(client);
    setSaving(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#F8F9FF", borderRadius: "24px 24px 0 0", width: "100%", maxWidth: 640, height: "93vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 0" }}>
          <div style={{ width: 40, height: 4, background: "#ddd", borderRadius: 2 }} />
        </div>

        <div style={{ padding: "10px 16px 0" }}>
          <div style={{ background: "linear-gradient(135deg,#00B894,#00CEC9)", borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 4px 12px rgba(0,184,148,0.3)" }}>
            <Save size={22} color="#fff" />
            <div style={{ flex: 1 }}>
              <div style={{ color: "#fff", fontSize: 15, fontWeight: 700 }}>{isEdit ? "Modifier la Fiche Client" : "Nouvelle Fiche Client"}</div>
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 10 }}>Date : {dateStr}</div>
            </div>
            <span style={{ background: "rgba(255,255,255,0.2)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 10 }}>MillionStore</span>
          </div>
        </div>

        <div style={{ padding: "12px 16px", overflowY: "auto", flex: 1 }}>
          {/* Acceptation */}
          <button onClick={() => setAksepte(!aksepte)} style={{ width: "100%", background: aksepte ? "#E8F8F2" : "#fff", border: `${aksepte ? 2 : 1}px solid ${aksepte ? "#00B894" : "#ddd"}`, borderRadius: 14, padding: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
            <CheckCircle size={30} color={aksepte ? "#00B894" : "#ccc"} />
            <div style={{ textAlign: "left", flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: aksepte ? "#00B894" : "#666" }}>{aksepte ? "Client Accepté ✅" : "Client non accepté"}</div>
              <div style={{ fontSize: 11, color: "#999" }}>{aksepte ? "Le client confirme son accord avec les conditions" : "Cliquez pour confirmer l'acceptation du client"}</div>
            </div>
          </button>

          {/* Informations Client */}
          <div style={{ background: "#fff", borderRadius: 14, padding: 14, marginBottom: 12, boxShadow: "0 1px 8px rgba(0,0,0,0.04)" }}>
            <SectionLabel text="Informations Client" color="#009688" />
            <input value={nom} onChange={e => setNom(e.target.value)} placeholder="Nom du Client *" style={fieldStyle("#009688")} />
            <input value={tel} onChange={e => setTel(e.target.value)} placeholder="Téléphone" style={fieldStyle("#2196F3")} />
            <input value={adr} onChange={e => setAdr(e.target.value)} placeholder="Adresse" style={fieldStyle("#FF9800")} />
            <input value={nif} onChange={e => setNif(e.target.value)} placeholder="NIF / CIN" style={{ ...fieldStyle("#9C27B0"), marginBottom: 0 }} />
          </div>

          {/* Produits */}
          <div style={{ background: "#fff", borderRadius: 14, padding: 14, marginBottom: 12, boxShadow: "0 1px 8px rgba(0,0,0,0.04)" }}>
            <SectionLabel text="Produits" color="#FF5722" />
            {articles.map((art, i) => (
              <div key={i} style={{ background: "#FFF9F6", border: "1px solid rgba(255,87,34,0.15)", borderRadius: 14, padding: 14, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#FF5722", color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
                  <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 700, color: "#FF5722", flex: 1 }}>Article {i + 1}</span>
                  {articles.length > 1 && (
                    <button onClick={() => setArticles(prev => prev.filter((_, idx) => idx !== i))} style={{ background: "rgba(255,0,0,0.08)", border: "none", borderRadius: "50%", width: 26, height: 26, cursor: "pointer", color: "red" }}>×</button>
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
            <button onClick={() => setArticles(prev => [...prev, emptyArticle()])} style={{ width: "100%", background: "none", border: "1px solid #FF5722", color: "#FF5722", borderRadius: 10, padding: 12, cursor: "pointer", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Plus size={16} /> Nouvel Article
            </button>
          </div>

          {/* Totaux du Contrat */}
          <div style={{ background: "#fff", borderRadius: 14, padding: 14, marginBottom: 12, boxShadow: "0 1px 8px rgba(0,0,0,0.04)" }}>
            <SectionLabel text="Totaux du Contrat" color="#009688" />
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input value={rabais} onChange={e => setRabais(e.target.value)} type="number" placeholder="Rabais" style={{ ...fieldStyle("#009688"), flex: 1, marginBottom: 0 }} />
              <DevizToggle current={rabaisDevise} onChange={setRabaisDevise} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input value={balance} onChange={e => setBalance(e.target.value)} type="number" placeholder="Balance" style={{ ...fieldStyle("#009688"), flex: 1, marginBottom: 0 }} />
              <DevizToggle current={balanceDevise} onChange={setBalanceDevise} />
            </div>
            <div style={{ background: "#F0FFF8", border: "1.5px solid rgba(0,150,136,0.4)", borderRadius: 12, padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <DollarSign size={18} color="#009688" />
              <input value={montant} onChange={e => setMontant(e.target.value)} type="number" placeholder="Montant Total" style={{ flex: 1, border: "none", outline: "none", background: "none", fontWeight: 700, fontSize: 15, color: "#00B894" }} />
              <DevizToggle current={montantDevise} onChange={setMontantDevise} />
            </div>
          </div>

          {/* Responsable */}
          <div style={{ background: "#fff", borderRadius: 14, padding: 14, marginBottom: 16, boxShadow: "0 1px 8px rgba(0,0,0,0.04)" }}>
            <SectionLabel text="Responsable" color="#673AB7" />
            <div style={{ display: "flex", gap: 8 }}>
              <input value={nomVendeur} onChange={e => setNomVendeur(e.target.value)} placeholder="Nom Vendeur" style={{ ...fieldStyle("#673AB7"), flex: 1 }} />
              <input value={nomCaissier} onChange={e => setNomCaissier(e.target.value)} placeholder="Nom Caissier" style={{ ...fieldStyle("#673AB7"), flex: 1 }} />
            </div>
            <div style={{ background: "#F8F9FF", border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <Calendar size={15} color="#607D8B" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: "#999" }}>Date & Heure</div>
                <div style={{ fontWeight: 700, fontSize: 12, color: "#607D8B" }}>{dateStr}</div>
              </div>
              <span style={{ background: "rgba(0,150,136,0.1)", color: "#009688", fontSize: 9, fontWeight: 700, padding: "3px 7px", borderRadius: 7 }}>Automatique</span>
            </div>
          </div>

          <button onClick={handleSave} disabled={!nom.trim() || saving} style={{
            width: "100%", background: saving ? "#999" : "#00B894", border: "none", borderRadius: 14,
            padding: 15, color: "#fff", fontWeight: 700, fontSize: 15, cursor: saving ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <Save size={17} /> {saving ? "Enregistrement..." : (isEdit ? "Sauvegarder les modifications" : "Enregistrer le Client")}
          </button>
        </div>
      </div>
    </div>
  );
}