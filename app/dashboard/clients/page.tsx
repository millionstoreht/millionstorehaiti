"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from "firebase/firestore";
import { Users, Plus, Search, X, ChevronLeft, Trash2, Edit, CheckCircle, Clock, Phone, MapPin, DollarSign, Package, User, Badge, Calendar, Hash, Palette, QrCode, ShoppingCart, CreditCard, Tag, ArrowRight } from "lucide-react";

interface UserSession {
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  permissions: Record<string, boolean>;
}

interface Client {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
  nif: string;
  marque: string;
  modele: string;
  description: string;
  idNum: string;
  couleur: string;
  snImei: string;
  qte: string;
  rabais: string;
  clocheRabais: string;
  balance: string;
  clocheBalance: string;
  prixUnit: string;
  clochePrixUnit: string;
  montantTotal: string;
  clocheMontant: string;
  nomVendeur: string;
  nomCaissier: string;
  clientAksepte: boolean;
  localId: string;
  createdAt: string;
}

const EMPTY: Omit<Client, "id"> = {
  nom: "", telephone: "", adresse: "", nif: "",
  marque: "", modele: "", description: "", idNum: "",
  couleur: "", snImei: "", qte: "1", rabais: "0",
  clocheRabais: "HTG", balance: "0", clocheBalance: "HTG",
  prixUnit: "", clochePrixUnit: "HTG", montantTotal: "",
  clocheMontant: "HTG", nomVendeur: "", nomCaissier: "",
  clientAksepte: false, localId: "", createdAt: "",
};

const COLORS = ["#6C63FF","#00B894","#E17055","#0984E3","#D63031","#6D214F","#1289A7","#F79F1F","#5F27CD","#00CEC9"];
const colorOf = (nom: string) => COLORS[nom.length === 0 ? 0 : nom.charCodeAt(0) % COLORS.length];

function fmtDate(raw: string) {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  } catch { return ""; }
}

function nowStr() {
  const n = new Date();
  return `${String(n.getDate()).padStart(2,"0")}/${String(n.getMonth()+1).padStart(2,"0")}/${n.getFullYear()}  ${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`;
}

// ── DEVIZ TOGGLE ──
const DevizToggle = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div style={{ display: "flex", border: "1.5px solid #ddd", borderRadius: "8px", overflow: "hidden", flexShrink: 0 }}>
    {["HTG", "$"].map(cur => (
      <button key={cur} onClick={() => onChange(cur)}
        style={{ padding: "8px 12px", border: "none", cursor: "pointer", fontWeight: 700, fontSize: "12px",
          background: value === cur ? "#00B894" : "#fff", color: value === cur ? "#fff" : "#666" }}>
        {cur}
      </button>
    ))}
  </div>
);

// ── INPUT FIELD ──
function Inp({ label, val, onChange, type = "text", icon }: { label: string; val: string; onChange: (v: string) => void; type?: string; icon?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <label style={{ display: "block", fontSize: "11px", color: "#888", marginBottom: "4px", fontWeight: 600, textTransform: "uppercase" }}>{label}</label>
      <div style={{ position: "relative" }}>
        {icon && <span style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", color: "#aaa" }}>{icon}</span>}
        <input type={type} value={val} onChange={e => onChange(e.target.value)}
          style={{ width: "100%", padding: icon ? "10px 14px 10px 34px" : "10px 14px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "14px", outline: "none", boxSizing: "border-box", fontFamily: "inherit", background: "#fafafa" }}
          onFocus={e => e.target.style.borderColor = "#00B894"}
          onBlur={e => e.target.style.borderColor = "#eee"}
        />
      </div>
    </div>
  );
}

// ── DEVIZ FIELD ──
function InpDeviz({ label, val, onChange, deviz, onDeviz }: { label: string; val: string; onChange: (v: string) => void; deviz: string; onDeviz: (v: string) => void }) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <label style={{ display: "block", fontSize: "11px", color: "#888", marginBottom: "4px", fontWeight: 600, textTransform: "uppercase" }}>{label}</label>
      <div style={{ display: "flex", gap: "8px" }}>
        <input type="number" value={val} onChange={e => onChange(e.target.value)}
          style={{ flex: 1, padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "14px", outline: "none", boxSizing: "border-box", fontFamily: "inherit", background: "#fafafa" }}
          onFocus={e => e.target.style.borderColor = "#00B894"}
          onBlur={e => e.target.style.borderColor = "#eee"}
        />
        <DevizToggle value={deviz} onChange={onDeviz} />
      </div>
    </div>
  );
}

// ── SECTION TITLE ──
function SectionTitle({ title, color }: { title: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "16px 0 12px" }}>
      <div style={{ width: "4px", height: "18px", background: color, borderRadius: "2px" }} />
      <span style={{ fontWeight: 700, fontSize: "13px", color, textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</span>
      <div style={{ flex: 1, height: "1px", background: `${color}30` }} />
    </div>
  );
}

export default function ClientsPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isOnline, setIsOnline] = useState(true);

  // ── FORM STATE ──
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState<Client | null>(null);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<Omit<Client,"id">>(EMPTY);
  const [saving, setSaving] = useState(false);

  const setF = (k: keyof Omit<Client,"id">, v: string | boolean) =>
    setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const session = JSON.parse(raw) as UserSession;
      if (!session.isAdmin && !session.permissions?.clientVoir) {
        router.push("/dashboard"); return;
      }
      setUser(session);
      listenClients(session);
    } catch { router.push("/login"); }
  }, []);

  const canAdd    = user?.isAdmin || user?.permissions?.clientAjoute;
  const canEdit   = user?.isAdmin || user?.permissions?.clientModifye;
  const canDelete = user?.isAdmin || user?.permissions?.clientSiprime;

  function listenClients(session: UserSession) {
    const localId = session.localId === "all" ? "" : session.localId;
    onSnapshot(collection(db, "clients"),
      snap => {
        let list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Client));
        if (localId) list = list.filter(c => c.localId === localId || !c.localId);
        list.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
        setClients(list);
        setIsOnline(true);
        setLoading(false);
      },
      () => { setIsOnline(false); setLoading(false); }
    );
  }

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY, localId: user?.localId === "all" ? "" : (user?.localId ?? ""), createdAt: new Date().toISOString() });
    setShowForm(true);
  }

  function openEdit(c: Client) {
    setEditing(c);
    setForm({ ...c });
    setShowDetail(null);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.nom.trim()) { alert("Non kliyan obligatwa!"); return; }
    setSaving(true);
    const data = { ...form, updatedAt: new Date().toISOString() };
    try {
      if (editing) {
        await updateDoc(doc(db, "clients", editing.id), data);
      } else {
        await addDoc(collection(db, "clients"), { ...data, createdAt: new Date().toISOString() });
      }
      setShowForm(false);
    } catch (e) { alert("Erè: " + e); }
    setSaving(false);
  }

  async function handleDelete(c: Client) {
    if (!confirm(`Siprime ${c.nom}?`)) return;
    await deleteDoc(doc(db, "clients", c.id));
    setShowDetail(null);
  }

  const filtered = clients.filter(c =>
    c.nom?.toLowerCase().includes(search.toLowerCase()) ||
    (c.telephone ?? "").includes(search) ||
    (c.adresse ?? "").toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <main style={{ minHeight: "100vh", background: "#F5F6FA", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: "48px", height: "48px", border: "4px solid #eee", borderTop: "4px solid #00B894", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ color: "#888" }}>Chajman...</p>
      </div>
    </main>
  );

  return (
    <main style={{ minHeight: "100vh", background: "#F5F6FA", fontFamily: "'Segoe UI', sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{ background: "linear-gradient(135deg, #00B894, #00CEC9)", boxShadow: "0 2px 10px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button onClick={() => router.push("/dashboard")} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", padding: "8px", borderRadius: "8px", cursor: "pointer" }}>
              <ChevronLeft size={18} />
            </button>
            <div>
              <p style={{ margin: 0, color: "#fff", fontWeight: 700, fontSize: "18px" }}>Kliyan</p>
              <p style={{ margin: 0, color: "rgba(255,255,255,0.7)", fontSize: "11px" }}>
                {clients.length} total •{" "}
                <span style={{ color: isOnline ? "#b2f5e4" : "#ffd3b6" }}>{isOnline ? "● Sync" : "● Offline"}</span>
              </p>
            </div>
          </div>
          {canAdd && (
            <button onClick={openAdd} style={{ background: "rgba(255,255,255,0.2)", border: "2px solid rgba(255,255,255,0.4)", color: "#fff", padding: "10px 18px", borderRadius: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "14px" }}>
              <Plus size={16} /> Nouvo Kliyan
            </button>
          )}
        </div>
        {/* Search */}
        <div style={{ position: "relative", padding: "0 20px 16px" }}>
          <Search size={15} style={{ position: "absolute", left: "32px", top: "50%", transform: "translateY(-60%)", color: "rgba(255,255,255,0.7)" }} />
          <input placeholder="Chèche kliyan, telefòn, adrès..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", padding: "11px 14px 11px 40px", borderRadius: "12px", border: "none", fontSize: "14px", outline: "none", background: "rgba(255,255,255,0.2)", color: "#fff", boxSizing: "border-box" }}
          />
          {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: "28px", top: "50%", transform: "translateY(-60%)", background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.7)" }}><X size={15} /></button>}
        </div>
      </div>

      {/* ── LISTE ── */}
      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "20px 16px" }}>
        {filtered.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: "20px", padding: "60px", textAlign: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <Users size={48} color="#ccc" style={{ marginBottom: "12px" }} />
            <p style={{ color: "#aaa", marginBottom: "16px" }}>{search ? `Pa gen rezilta pou "${search}"` : "Pa gen kliyan toujou"}</p>
            {!search && canAdd && (
              <button onClick={openAdd} style={{ background: "#00B894", color: "#fff", border: "none", padding: "12px 24px", borderRadius: "12px", cursor: "pointer", fontWeight: 700 }}>
                + Ajoute Premye Kliyan
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {filtered.map(c => {
              const color   = colorOf(c.nom ?? "");
              const aksepte = c.clientAksepte;
              return (
                <div key={c.id} onClick={() => setShowDetail(c)}
                  style={{ background: "#fff", borderRadius: "18px", padding: "16px 20px", boxShadow: `0 4px 12px ${color}15`, cursor: "pointer", display: "flex", alignItems: "center", gap: "14px", borderLeft: `4px solid ${color}` }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-2px)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "")}>

                  {/* Avatar */}
                  <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: `linear-gradient(135deg, ${color}, ${color}aa)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", fontWeight: 700, color: "#fff", flexShrink: 0, boxShadow: `0 4px 10px ${color}40` }}>
                    {(c.nom || "?")[0].toUpperCase()}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: "15px", color: "#1a1a2e" }}>{c.nom}</span>
                      <span style={{ background: aksepte ? "#E8F8F2" : "#FFF3E0", color: aksepte ? "#00B894" : "#FF9800", padding: "2px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 700, border: `1px solid ${aksepte ? "#00B89440" : "#FF980040"}` }}>
                        {aksepte ? "✅ Aksepte" : "⏳ Annatant"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                      {c.telephone && <span style={{ color: "#888", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}><Phone size={11} />{c.telephone}</span>}
                      {c.adresse && <span style={{ color: "#888", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}><MapPin size={11} />{c.adresse}</span>}
                      {c.montantTotal && <span style={{ color: "#00B894", fontWeight: 700, fontSize: "12px" }}>{c.montantTotal} {c.clocheMontant}</span>}
                    </div>
                  </div>

                  {/* Aksyon */}
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    {canEdit && <button onClick={() => openEdit(c)} style={{ background: "#2196F318", border: "none", color: "#2196F3", padding: "8px", borderRadius: "8px", cursor: "pointer" }}><Edit size={15} /></button>}
                    {canDelete && <button onClick={() => handleDelete(c)} style={{ background: "#F4433618", border: "none", color: "#F44336", padding: "8px", borderRadius: "8px", cursor: "pointer" }}><Trash2 size={15} /></button>}
                    <div style={{ background: `${color}15`, padding: "8px", borderRadius: "8px", color }}><ArrowRight size={15} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── MODAL FORM ── */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#F8F9FF", borderRadius: "24px 24px 0 0", width: "100%", maxWidth: "640px", maxHeight: "93vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>

            {/* Header */}
            <div style={{ background: "linear-gradient(135deg, #00B894, #00CEC9)", padding: "18px 24px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <Users size={20} color="#fff" />
                  <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#fff" }}>{editing ? "Modifye Fich Kliyan" : "Nouvo Fich Kliyan"}</h2>
                </div>
                <button onClick={() => setShowForm(false)} style={{ background: "rgba(255,255,255,0.2)", border: "none", padding: "8px", borderRadius: "8px", cursor: "pointer", color: "#fff" }}><X size={18} /></button>
              </div>
              <p style={{ margin: "4px 0 0", color: "rgba(255,255,255,0.7)", fontSize: "11px" }}>Dat: {nowStr()} • MillionStore</p>
            </div>

            {/* Bouton Akseptasyon */}
            <div style={{ padding: "14px 24px 6px" }}>
              <div onClick={() => setF("clientAksepte", !form.clientAksepte)}
                style={{ background: form.clientAksepte ? "#E8F8F2" : "#fff", border: `2px solid ${form.clientAksepte ? "#00B894" : "#eee"}`, borderRadius: "14px", padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: "14px", transition: "all 0.2s" }}>
                {form.clientAksepte ? <CheckCircle size={28} color="#00B894" /> : <Clock size={28} color="#aaa" />}
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: "14px", color: form.clientAksepte ? "#00B894" : "#666" }}>
                    {form.clientAksepte ? "Kliyan Aksepte ✅" : "Kliyan pa Aksepte Toujou"}
                  </p>
                  <p style={{ margin: 0, fontSize: "11px", color: "#aaa" }}>
                    {form.clientAksepte ? "Kliyan konfime li dakò ak kondisyon yo" : "Klike pou kliyan konfime akseptasyon li"}
                  </p>
                </div>
                <div style={{ width: "48px", height: "26px", borderRadius: "13px", background: form.clientAksepte ? "#00B894" : "#ddd", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                  <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "#fff", position: "absolute", top: "2px", left: form.clientAksepte ? "24px" : "2px", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
                </div>
              </div>
            </div>

            {/* Kò form */}
            <div style={{ overflowY: "auto", padding: "8px 24px 32px" }}>

              {/* Kliyan */}
              <div style={{ background: "#fff", borderRadius: "14px", padding: "16px", marginBottom: "12px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <SectionTitle title="Enfòmasyon Kliyan" color="#00B894" />
                <Inp label="Non Kliyan *" val={form.nom} onChange={v => setF("nom", v)} icon={<User size={14} />} />
                <Inp label="Telefòn" val={form.telephone} onChange={v => setF("telephone", v)} type="tel" icon={<Phone size={14} />} />
                <Inp label="Adrès" val={form.adresse} onChange={v => setF("adresse", v)} icon={<MapPin size={14} />} />
                <Inp label="NIF / SIN" val={form.nif} onChange={v => setF("nif", v)} icon={<Badge size={14} />} />
              </div>

              {/* Pwodwi */}
              <div style={{ background: "#fff", borderRadius: "14px", padding: "16px", marginBottom: "12px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <SectionTitle title="Detay Pwodwi — Caissier" color="#FF6B35" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                  <Inp label="Marque" val={form.marque} onChange={v => setF("marque", v)} icon={<Package size={14} />} />
                  <Inp label="Modèle" val={form.modele} onChange={v => setF("modele", v)} icon={<Package size={14} />} />
                </div>
                <Inp label="Description" val={form.description} onChange={v => setF("description", v)} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                  <Inp label="ID / Nimewo" val={form.idNum} onChange={v => setF("idNum", v)} icon={<Hash size={14} />} />
                  <Inp label="Couleur" val={form.couleur} onChange={v => setF("couleur", v)} icon={<Palette size={14} />} />
                </div>
                <Inp label="S/N ou IMEI" val={form.snImei} onChange={v => setF("snImei", v)} icon={<QrCode size={14} />} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                  <Inp label="Qte" val={form.qte} onChange={v => setF("qte", v)} type="number" icon={<ShoppingCart size={14} />} />
                  <InpDeviz label="Rabais" val={form.rabais} onChange={v => setF("rabais", v)} deviz={form.clocheRabais} onDeviz={v => setF("clocheRabais", v)} />
                </div>
                <InpDeviz label="Balance" val={form.balance} onChange={v => setF("balance", v)} deviz={form.clocheBalance} onDeviz={v => setF("clocheBalance", v)} />
                <InpDeviz label="Prix Unité" val={form.prixUnit} onChange={v => setF("prixUnit", v)} deviz={form.clochePrixUnit} onDeviz={v => setF("clochePrixUnit", v)} />
                {/* Montant Total */}
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "11px", color: "#888", marginBottom: "4px", fontWeight: 600, textTransform: "uppercase" }}>Montant Total</label>
                  <div style={{ display: "flex", gap: "8px", background: "#E8F8F2", borderRadius: "12px", padding: "4px", border: "1.5px solid #00B89440" }}>
                    <input type="number" value={form.montantTotal} onChange={e => setF("montantTotal", e.target.value)}
                      style={{ flex: 1, padding: "10px 14px", borderRadius: "10px", border: "none", fontSize: "16px", fontWeight: 700, outline: "none", background: "transparent", color: "#00B894", fontFamily: "inherit" }} />
                    <DevizToggle value={form.clocheMontant} onChange={v => setF("clocheMontant", v)} />
                  </div>
                </div>
              </div>

              {/* Responsab */}
              <div style={{ background: "#fff", borderRadius: "14px", padding: "16px", marginBottom: "12px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <SectionTitle title="Responsab" color="#7C3AED" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                  <Inp label="Non Vendeur" val={form.nomVendeur} onChange={v => setF("nomVendeur", v)} icon={<Tag size={14} />} />
                  <Inp label="Non Caissier" val={form.nomCaissier} onChange={v => setF("nomCaissier", v)} icon={<CreditCard size={14} />} />
                </div>
                {/* Dat otomatik */}
                <div style={{ background: "#F8F9FF", borderRadius: "10px", padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px" }}>
                  <Calendar size={15} color="#7C3AED" />
                  <div>
                    <p style={{ margin: 0, fontSize: "9px", color: "#aaa", textTransform: "uppercase" }}>Dat & Lè Tranzaksyon</p>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: "12px", color: "#7C3AED" }}>{nowStr()}</p>
                  </div>
                  <span style={{ marginLeft: "auto", background: "#7C3AED18", color: "#7C3AED", padding: "2px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 700 }}>Otomatik</span>
                </div>
              </div>

              {/* Bouton Sove */}
              <button onClick={handleSave} disabled={saving}
                style={{ width: "100%", padding: "15px", background: saving ? "#aaa" : "#00B894", color: "#fff", border: "none", borderRadius: "14px", fontSize: "16px", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                {saving ? "⏳ Ap sove..." : editing ? "✅ Sove Chanjman" : "✅ Anrejistre Kliyan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL DETAY ── */}
      {showDetail && (() => {
        const c     = showDetail;
        const color = colorOf(c.nom ?? "");
        const aksepte = c.clientAksepte;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }}>
            <div style={{ background: "#fff", borderRadius: "24px 24px 0 0", width: "100%", maxWidth: "640px", maxHeight: "88vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>

              {/* Header */}
              <div style={{ padding: "28px 24px 20px", textAlign: "center", background: `linear-gradient(135deg, ${color}15, ${color}05)`, position: "relative" }}>
                <button onClick={() => setShowDetail(null)} style={{ position: "absolute", right: "16px", top: "16px", background: "#eee", border: "none", padding: "8px", borderRadius: "8px", cursor: "pointer" }}><X size={18} /></button>
                <div style={{ width: "72px", height: "72px", borderRadius: "50%", background: `linear-gradient(135deg, ${color}, ${color}aa)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px", fontWeight: 700, color: "#fff", margin: "0 auto 12px", boxShadow: `0 8px 20px ${color}40` }}>
                  {(c.nom || "?")[0].toUpperCase()}
                </div>
                <h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: 700 }}>{c.nom}</h2>
                <span style={{ background: aksepte ? "#E8F8F2" : "#FFF3E0", color: aksepte ? "#00B894" : "#FF9800", padding: "4px 14px", borderRadius: "20px", fontSize: "12px", fontWeight: 700, border: `1px solid ${aksepte ? "#00B89440" : "#FF980040"}` }}>
                  {aksepte ? "✅ Kliyan Aksepte" : "⏳ Pa Aksepte Toujou"}
                </span>
              </div>

              <div style={{ overflowY: "auto", padding: "16px 24px 24px" }}>
                {[
                  { title: "👤 Pèsonèl", color: "#00B894", rows: [
                    ["📞 Telefòn", c.telephone], ["📍 Adrès", c.adresse], ["🏷 NIF/SIN", c.nif],
                  ]},
                  { title: "📦 Pwodwi", color: "#FF6B35", rows: [
                    ["Pwodwi", `${c.marque} ${c.modele}`.trim()],
                    ["Description", c.description], ["ID/Nimewo", c.idNum],
                    ["Couleur", c.couleur], ["S/N / IMEI", c.snImei],
                    ["Qte", c.qte], ["Rabais", c.rabais ? `${c.rabais} ${c.clocheRabais}` : ""],
                    ["Balance", c.balance ? `${c.balance} ${c.clocheBalance}` : ""],
                    ["Prix Unité", c.prixUnit ? `${c.prixUnit} ${c.clochePrixUnit}` : ""],
                    ["Montant Total", c.montantTotal ? `${c.montantTotal} ${c.clocheMontant}` : ""],
                  ]},
                  { title: "👤 Responsab", color: "#7C3AED", rows: [
                    ["Vendeur", c.nomVendeur], ["Caissier", c.nomCaissier],
                    ["Dat", fmtDate(c.createdAt)],
                  ]},
                ].map(section => (
                  <div key={section.title} style={{ marginBottom: "16px" }}>
                    <p style={{ fontWeight: 700, color: section.color, margin: "0 0 8px", fontSize: "13px" }}>{section.title}</p>
                    {section.rows.filter(([,v]) => v).map(([label, value]) => (
                      <div key={label} style={{ display: "flex", gap: "8px", padding: "7px 0", borderBottom: "1px solid #f5f5f5" }}>
                        <span style={{ fontWeight: 600, fontSize: "13px", minWidth: "120px", color: "#666" }}>{label}</span>
                        <span style={{ fontSize: "13px", color: "#333" }}>{value || "-"}</span>
                      </div>
                    ))}
                  </div>
                ))}

                {/* Bouton aksyon */}
                <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
                  {canEdit && (
                    <button onClick={() => openEdit(c)}
                      style={{ flex: 1, padding: "12px", background: "#fff", color, border: `2px solid ${color}`, borderRadius: "12px", cursor: "pointer", fontWeight: 700, fontSize: "14px" }}>
                      ✏️ Modifye
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={() => handleDelete(c)}
                      style={{ flex: 1, padding: "12px", background: "#fff", color: "#F44336", border: "2px solid #F44336", borderRadius: "12px", cursor: "pointer", fontWeight: 700, fontSize: "14px" }}>
                      🗑️ Siprime
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </main>
  );
}