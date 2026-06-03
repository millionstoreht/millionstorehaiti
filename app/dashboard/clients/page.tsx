"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import { collection, doc, setDoc, deleteDoc, onSnapshot } from "firebase/firestore";

// ─── TYPES ───────────────────────────────────────────────────────────────────
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

// ─── COLORS ──────────────────────────────────────────────────────────────────
const COLORS = [
  "#6C63FF","#00B894","#E17055","#0984E3",
  "#D63031","#6D214F","#1289A7","#F79F1F","#5F27CD",
];
const colorOf = (nom: string) =>
  nom ? COLORS[nom.charCodeAt(0) % COLORS.length] : COLORS[0];

const fmtDate = (raw?: string) => {
  if (!raw) return "";
  try {
    const dt = new Date(raw);
    return `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()}`;
  } catch { return ""; }
};

const nowStr = () => {
  const n = new Date();
  return `${String(n.getDate()).padStart(2,"0")}/${String(n.getMonth()+1).padStart(2,"0")}/${n.getFullYear()}  ${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`;
};

// ─── EMPTY CLIENT ─────────────────────────────────────────────────────────────
const emptyClient = (): Omit<Client,"id"|"localId"|"createdAt"> => ({
  nom:"", telephone:"", adresse:"", nif:"",
  marque:"", modele:"", description:"", idNum:"", couleur:"", snImei:"",
  qte:"1", rabais:"0", clocheRabais:"HTG", balance:"0", clocheBalance:"HTG",
  prixUnit:"", clochePrixUnit:"HTG", montantTotal:"", clocheMontant:"HTG",
  nomVendeur:"", nomCaissier:"", clientAksepte:false,
});

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function ClientsPage() {
  const router = useRouter();
  const [user, setUser]       = useState<UserSession | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [localId, setLocalId] = useState("all");
  const [snack, setSnack]     = useState<{msg:string;color:string}|null>(null);

  // Modals
  const [formClient, setFormClient]     = useState<Client | "new" | null>(null);
  const [detailClient, setDetailClient] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);

  // ─── AUTH ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const s = JSON.parse(raw) as UserSession;
      if (!s.isAdmin && !s.permissions?.clientVoir) {
        router.push("/dashboard"); return;
      }
      setUser(s);
      setLocalId(s.localId === "all" ? "all" : s.localId);
    } catch { router.push("/login"); }
  }, [router]);

  // ─── LOAD ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      collection(db, "clients"),
      snap => {
        const list: Client[] = [];
        snap.forEach(d => list.push({ ...d.data(), id: d.id } as Client));
        list.sort((a,b) => (b.createdAt??"").localeCompare(a.createdAt??""));
        setClients(list);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [user, localId]);

  // ─── SNACK ───────────────────────────────────────────────────────────────
  const showSnack = (msg: string, color: string) => {
    setSnack({ msg, color });
    setTimeout(() => setSnack(null), 2500);
  };

  // ─── FILTER ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return clients;
    return clients.filter(c =>
      (c.nom        ?? "").toLowerCase().includes(q) ||
      (c.telephone  ?? "").includes(q) ||
      (c.adresse    ?? "").toLowerCase().includes(q)
    );
  }, [clients, search]);

  // ─── SAVE ────────────────────────────────────────────────────────────────
  const saveClient = async (c: Client) => {
    await setDoc(doc(db, "clients", c.id), c);
  };

  // ─── DELETE ──────────────────────────────────────────────────────────────
  const deleteClient = async (c: Client) => {
    await deleteDoc(doc(db, "clients", c.id));
    setDeleteTarget(null);
    showSnack("✅ Kliyan efase!", "#00B894");
  };

  const canEdit   = user?.isAdmin || user?.permissions?.clientModifye;
  const canDelete = user?.isAdmin || user?.permissions?.clientSiprime;
  const canAdd    = user?.isAdmin || user?.permissions?.clientAjoute;

  if (loading || !user) return (
    <main style={{ minHeight:"100vh", background:"#f5f6fa", display:"flex",
      alignItems:"center", justifyContent:"center", fontFamily:"'Segoe UI',sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:48, height:48, border:"4px solid #eee",
          borderTop:"4px solid #00B894", borderRadius:"50%",
          animation:"spin 1s linear infinite", margin:"0 auto 16px" }}/>
        <p style={{ color:"#888" }}>Chajman...</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </main>
  );

  return (
    <main style={{ minHeight:"100vh", background:"#f5f6fa",
      fontFamily:"'Segoe UI',sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{ background:"linear-gradient(135deg,#00B894,#00CEC9)",
        padding:"16px 20px", position:"sticky", top:0, zIndex:100,
        boxShadow:"0 2px 12px rgba(0,184,148,0.3)" }}>
        <div style={{ display:"flex", alignItems:"center",
          justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <button onClick={() => router.push("/dashboard")}
              style={{ background:"rgba(255,255,255,0.2)", border:"none",
                color:"#fff", padding:"8px 14px", borderRadius:10,
                cursor:"pointer", fontSize:13 }}>
              ← Retounen
            </button>
            <div>
              <p style={{ margin:0, color:"rgba(255,255,255,0.8)", fontSize:12 }}>
                Kliyan
              </p>
              <p style={{ margin:0, color:"#fff", fontSize:22, fontWeight:700 }}>
                {clients.length} total
              </p>
            </div>
          </div>
          {canAdd && (
            <button onClick={() => setFormClient("new")}
              style={{ background:"rgba(255,255,255,0.95)", border:"none",
                color:"#00B894", padding:"10px 18px", borderRadius:12,
                cursor:"pointer", fontSize:13, fontWeight:700,
                display:"flex", alignItems:"center", gap:6 }}>
              + Nouvo Kliyan
            </button>
          )}
        </div>
        <input
          type="search" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Chèche kliyan (non, telefòn, adrès)..."
          style={{ width:"100%", padding:"10px 16px",
            background:"rgba(255,255,255,0.2)", border:"none",
            borderRadius:12, color:"#fff", fontSize:14,
            outline:"none", boxSizing:"border-box" as const,
            fontFamily:"inherit" }}
        />
      </div>

      {/* ── LIST ── */}
      <div style={{ maxWidth:800, margin:"0 auto", padding:"16px" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign:"center", marginTop:80 }}>
            <div style={{ width:80, height:80, borderRadius:"50%",
              background:"rgba(0,184,148,0.1)", display:"flex",
              alignItems:"center", justifyContent:"center",
              margin:"0 auto 16px", fontSize:36 }}>👥</div>
            <p style={{ color:"#888", fontSize:15 }}>
              {search ? `Pa gen rezilta pou "${search}"` : "Pa gen kliyan toujou"}
            </p>
            {!search && canAdd && (
              <button onClick={() => setFormClient("new")}
                style={{ marginTop:16, background:"#00B894", border:"none",
                  color:"#fff", padding:"12px 24px", borderRadius:12,
                  cursor:"pointer", fontSize:14, fontWeight:700 }}>
                + Ajoute Premye Kliyan
              </button>
            )}
          </div>
        ) : (
          filtered.map(c => (
            <ClientCard
              key={c.id}
              client={c}
              canDelete={!!canDelete}
              onTap={() => setDetailClient(c)}
              onDelete={() => setDeleteTarget(c)}
            />
          ))
        )}
      </div>

      {/* ── FAB ── */}
      {canAdd && (
        <button onClick={() => setFormClient("new")}
          style={{ position:"fixed", bottom:24, right:24,
            background:"#00B894", border:"none", color:"#fff",
            padding:"14px 20px", borderRadius:50, cursor:"pointer",
            fontSize:14, fontWeight:700,
            boxShadow:"0 4px 20px rgba(0,184,148,0.4)",
            display:"flex", alignItems:"center", gap:8, zIndex:50 }}>
          👤 Nouvo Kliyan
        </button>
      )}

      {/* ── MODALS ── */}
      {formClient !== null && (
        <ClientForm
          client={formClient === "new" ? null : formClient}
          onClose={() => setFormClient(null)}
          onSave={async c => {
            await saveClient(c);
            setFormClient(null);
            showSnack(formClient === "new" ? "✅ Kliyan ajoute!" : "✅ Chanjman sove!", "#00B894");
          }}
        />
      )}

      {detailClient && (
        <ClientDetail
          client={detailClient}
          canEdit={!!canEdit}
          canDelete={!!canDelete}
          onClose={() => setDetailClient(null)}
          onEdit={() => { setDetailClient(null); setFormClient(detailClient); }}
          onDelete={() => { setDetailClient(null); setDeleteTarget(detailClient); }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Siprime Kliyan?"
          message={deleteTarget.nom}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteClient(deleteTarget)}
        />
      )}

      {snack && (
        <div style={{ position:"fixed", bottom:24, left:"50%",
          transform:"translateX(-50%)", background:snack.color,
          color:"#fff", padding:"12px 24px", borderRadius:12,
          fontWeight:600, fontSize:14, zIndex:999,
          boxShadow:"0 4px 20px rgba(0,0,0,0.2)", whiteSpace:"nowrap" }}>
          {snack.msg}
        </div>
      )}
    </main>
  );
}

// ─── CLIENT CARD ──────────────────────────────────────────────────────────────
function ClientCard({ client: c, canDelete, onTap, onDelete }: {
  client: Client; canDelete: boolean;
  onTap: () => void; onDelete: () => void;
}) {
  const color   = colorOf(c.nom);
  const aksepte = c.clientAksepte;

  return (
    <div onClick={onTap}
      style={{ background:"#fff", borderRadius:18, padding:16,
        marginBottom:12, cursor:"pointer",
        boxShadow:`0 4px 12px ${color}14`,
        border:"1px solid #f0f0f0",
        transition:"transform 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.transform="translateY(-2px)"}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.transform=""}>
      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
        {/* Avatar */}
        <div style={{ width:52, height:52, borderRadius:"50%", flexShrink:0,
          background:`linear-gradient(135deg,${color},${color}aa)`,
          display:"flex", alignItems:"center", justifyContent:"center",
          color:"#fff", fontWeight:700, fontSize:20,
          boxShadow:`0 3px 8px ${color}44` }}>
          {c.nom?.[0]?.toUpperCase() ?? "?"}
        </div>

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center",
            justifyContent:"space-between", marginBottom:3 }}>
            <span style={{ fontWeight:700, fontSize:15, color:"#1a1a2e" }}>
              {c.nom}
            </span>
            {/* Badge akseptasyon */}
            <span style={{ background: aksepte ? "#E8F8F2" : "#FFF3E0",
              color: aksepte ? "#00B894" : "orange",
              border: `1px solid ${aksepte ? "#00B894" : "orange"}`,
              padding:"2px 8px", borderRadius:6,
              fontSize:10, fontWeight:700, flexShrink:0, marginLeft:8 }}>
              {aksepte ? "✅ Aksepte" : "⏳ Annatant"}
            </span>
          </div>

          {c.telephone && (
            <p style={{ margin:"0 0 2px", color:"#888", fontSize:12,
              display:"flex", alignItems:"center", gap:4 }}>
              📞 {c.telephone}
            </p>
          )}
          {c.adresse && (
            <p style={{ margin:0, color:"#aaa", fontSize:11,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              📍 {c.adresse}
            </p>
          )}
          {c.montantTotal && (
            <span style={{ display:"inline-block", marginTop:4,
              background:"rgba(0,184,148,0.1)", color:"#00B894",
              padding:"2px 8px", borderRadius:6,
              fontSize:12, fontWeight:700 }}>
              {c.montantTotal} {c.clocheMontant}
            </span>
          )}
        </div>

        {/* Actions */}
        <div style={{ display:"flex", flexDirection:"column" as const,
          gap:6, flexShrink:0 }}>
          <div style={{ width:32, height:32, borderRadius:"50%",
            background:`${color}18`, display:"flex",
            alignItems:"center", justifyContent:"center" }}>
            <span style={{ color, fontSize:14 }}>›</span>
          </div>
          {canDelete && (
            <div onClick={e => { e.stopPropagation(); onDelete(); }}
              style={{ width:32, height:32, borderRadius:"50%",
                background:"rgba(255,0,0,0.08)", display:"flex",
                alignItems:"center", justifyContent:"center",
                cursor:"pointer" }}>
              <span style={{ color:"#ff4444", fontSize:13 }}>🗑</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CLIENT DETAIL ────────────────────────────────────────────────────────────
function ClientDetail({ client: c, canEdit, canDelete, onClose, onEdit, onDelete }: {
  client: Client; canEdit: boolean; canDelete: boolean;
  onClose: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const color   = colorOf(c.nom);
  const aksepte = c.clientAksepte;

  const rows = [
    { icon:"📞", label:"Telefòn",      val: c.telephone,   copy: true },
    { icon:"📍", label:"Adrès",        val: c.adresse },
    { icon:"🪪", label:"NIF / SIN",    val: c.nif },
    { icon:"📦", label:"Pwodwi",       val: [c.marque, c.modele].filter(Boolean).join(" ") },
    { icon:"📝", label:"Description",  val: c.description },
    { icon:"🔢", label:"S/N / IMEI",   val: c.snImei },
    { icon:"💰", label:"Montant Total",val: c.montantTotal ? `${c.montantTotal} ${c.clocheMontant}` : "" },
    { icon:"🧑‍💼", label:"Vendeur",      val: c.nomVendeur },
    { icon:"💼", label:"Caissier",     val: c.nomCaissier },
    { icon:"📅", label:"Dat",          val: fmtDate(c.createdAt) },
  ].filter(r => r.val);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
      zIndex:200, display:"flex", alignItems:"flex-end",
      justifyContent:"center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:"#fff", borderRadius:"24px 24px 0 0",
          width:"100%", maxWidth:700, maxHeight:"85vh",
          overflow:"auto", paddingBottom:32 }}>
        {/* Handle */}
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 0" }}>
          <div style={{ width:40, height:4, background:"#ddd", borderRadius:2 }}/>
        </div>

        {/* Avatar + nom */}
        <div style={{ textAlign:"center", padding:"16px 24px 12px" }}>
          <div style={{ width:80, height:80, borderRadius:"50%",
            background:`linear-gradient(135deg,${color},${color}aa)`,
            display:"flex", alignItems:"center", justifyContent:"center",
            color:"#fff", fontWeight:700, fontSize:32,
            margin:"0 auto 12px",
            boxShadow:`0 6px 16px ${color}44` }}>
            {c.nom?.[0]?.toUpperCase()}
          </div>
          <h2 style={{ margin:"0 0 8px", fontSize:22, fontWeight:700 }}>{c.nom}</h2>
          <span style={{ background: aksepte ? "#E8F8F2" : "#FFF3E0",
            color: aksepte ? "#00B894" : "orange",
            border:`1px solid ${aksepte ? "#00B894" : "orange"}`,
            padding:"4px 14px", borderRadius:20, fontSize:12, fontWeight:700 }}>
            {aksepte ? "✅ Kliyan Aksepte" : "⏳ Pa Aksepte Toujou"}
          </span>
        </div>

        {/* Detail rows */}
        <div style={{ padding:"0 24px" }}>
          {rows.map((r, i) => (
            <div key={i}
              onClick={() => r.copy && r.val && navigator.clipboard?.writeText(r.val)}
              style={{ display:"flex", alignItems:"center", gap:12,
                background:`${color}08`,
                border:`1px solid ${color}18`,
                borderRadius:12, padding:"12px 14px", marginBottom:10,
                cursor: r.copy ? "pointer" : "default" }}>
              <div style={{ width:36, height:36, borderRadius:"50%",
                background:`${color}18`, display:"flex",
                alignItems:"center", justifyContent:"center",
                fontSize:16, flexShrink:0 }}>
                {r.icon}
              </div>
              <div style={{ flex:1 }}>
                <p style={{ margin:0, color:"#888", fontSize:11 }}>{r.label}</p>
                <p style={{ margin:0, fontWeight:600, fontSize:14 }}>{r.val}</p>
              </div>
              {r.copy && <span style={{ color:"#ccc", fontSize:14 }}>📋</span>}
            </div>
          ))}
        </div>

        {/* Bouton */}
        <div style={{ display:"flex", gap:12, padding:"8px 24px 0" }}>
          {canEdit && (
            <button onClick={onEdit}
              style={{ flex:1, padding:12, background:"none",
                border:`1px solid ${color}`, color,
                borderRadius:12, cursor:"pointer",
                fontSize:14, fontWeight:600 }}>
              ✏️ Modifye
            </button>
          )}
          {canDelete && (
            <button onClick={onDelete}
              style={{ flex:1, padding:12, background:"none",
                border:"1px solid #ff4444", color:"#ff4444",
                borderRadius:12, cursor:"pointer",
                fontSize:14, fontWeight:600 }}>
              🗑 Siprime
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CLIENT FORM ──────────────────────────────────────────────────────────────
function ClientForm({ client, onClose, onSave }: {
  client: Client | null;
  onClose: () => void;
  onSave: (c: Client) => void;
}) {
  const isEdit = !!client;
  const [form, setForm] = useState<Omit<Client,"id"|"localId"|"createdAt">>(
    client ? { ...client } : emptyClient()
  );
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form, v: string | boolean) =>
    setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.nom.trim()) return;
    setSaving(true);
    const c: Client = {
      ...form,
      id:        client?.id ?? Date.now().toString(),
      localId:   client?.localId ?? "",
      createdAt: client?.createdAt ?? new Date().toISOString(),
    };
    await onSave(c);
    setSaving(false);
  };

  const DevizToggle = ({ val, onChange }: { val: string; onChange: (v: string) => void }) => (
    <div style={{ display:"flex", background:"#f0f4f8",
      borderRadius:8, border:"1px solid #ddd",
      overflow:"hidden", flexShrink:0 }}>
      {["HTG","$"].map(d => (
        <button key={d} onClick={() => onChange(d)}
          style={{ padding:"6px 10px", border:"none",
            background: val===d ? "#00B894" : "transparent",
            color: val===d ? "#fff" : "#888",
            fontWeight:700, fontSize:12, cursor:"pointer" }}>
          {d}
        </button>
      ))}
    </div>
  );

  const Field = ({ label, fkey, type="text", icon }: {
    label: string; fkey: keyof typeof form; type?: string; icon?: string;
  }) => (
    <div style={{ marginBottom:10, position:"relative" }}>
      {icon && <span style={{ position:"absolute", left:12, top:"50%",
        transform:"translateY(-50%)", fontSize:15 }}>{icon}</span>}
      <input type={type} value={String(form[fkey])}
        onChange={e => set(fkey, e.target.value)}
        placeholder={label}
        style={{ width:"100%", padding: icon ? "11px 14px 11px 36px" : "11px 14px",
          background:"#f8f9ff", border:"1.5px solid #eee",
          borderRadius:10, fontSize:14, color:"#1a1a2e",
          outline:"none", boxSizing:"border-box" as const,
          fontFamily:"'Segoe UI',sans-serif" }}
      />
    </div>
  );

  const MoneyField = ({ label, fkey, devizKey, icon }: {
    label: string; fkey: keyof typeof form;
    devizKey: keyof typeof form; icon?: string;
  }) => (
    <div style={{ display:"flex", gap:8, marginBottom:10 }}>
      <div style={{ position:"relative", flex:1 }}>
        {icon && <span style={{ position:"absolute", left:12, top:"50%",
          transform:"translateY(-50%)", fontSize:15 }}>{icon}</span>}
        <input type="number" value={String(form[fkey])}
          onChange={e => set(fkey, e.target.value)}
          placeholder={label}
          style={{ width:"100%", padding: icon ? "11px 14px 11px 36px" : "11px 14px",
            background:"#f8f9ff", border:"1.5px solid #eee",
            borderRadius:10, fontSize:14, color:"#1a1a2e",
            outline:"none", boxSizing:"border-box" as const,
            fontFamily:"'Segoe UI',sans-serif" }}
        />
      </div>
      <DevizToggle val={String(form[devizKey])}
        onChange={v => set(devizKey, v)} />
    </div>
  );

  const SectionTitle = ({ icon, title, color }: { icon: string; title: string; color: string }) => (
    <div style={{ display:"flex", alignItems:"center", gap:8,
      margin:"16px 0 12px" }}>
      <div style={{ width:28, height:28, borderRadius:"50%",
        background:`${color}18`, display:"flex",
        alignItems:"center", justifyContent:"center", fontSize:13 }}>
        {icon}
      </div>
      <span style={{ fontWeight:700, fontSize:13, color }}>
        {title}
      </span>
      <div style={{ flex:1, height:1, background:`${color}30` }}/>
    </div>
  );

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
      zIndex:200, display:"flex", alignItems:"flex-end",
      justifyContent:"center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:"#f8f9ff", borderRadius:"24px 24px 0 0",
          width:"100%", maxWidth:700, height:"93vh",
          display:"flex", flexDirection:"column" as const,
          overflow:"hidden" }}>

        {/* Handle */}
        <div style={{ display:"flex", justifyContent:"center",
          padding:"10px 0 0", flexShrink:0 }}>
          <div style={{ width:40, height:4, background:"#ddd", borderRadius:2 }}/>
        </div>

        {/* Header */}
        <div style={{ margin:"8px 16px", borderRadius:14, flexShrink:0,
          background:"linear-gradient(135deg,#00B894,#00CEC9)",
          padding:"14px 16px", display:"flex",
          alignItems:"center", gap:12 }}>
          <span style={{ fontSize:22 }}>🧾</span>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, color:"#fff", fontSize:15, fontWeight:700 }}>
              {isEdit ? "Modifye Fich Kliyan" : "Nouvo Fich Kliyan"}
            </p>
            <p style={{ margin:0, color:"rgba(255,255,255,0.7)", fontSize:10 }}>
              Dat: {nowStr()}
            </p>
          </div>
          <span style={{ background:"rgba(255,255,255,0.2)",
            color:"#fff", fontSize:10, fontWeight:700,
            padding:"3px 8px", borderRadius:8 }}>
            MillionStore
          </span>
        </div>

        {/* Akseptasyon toggle */}
        <div style={{ margin:"0 16px 0", flexShrink:0 }}>
          <div onClick={() => set("clientAksepte", !form.clientAksepte)}
            style={{ background: form.clientAksepte ? "#E8F8F2" : "#fff",
              border:`${form.clientAksepte ? 2 : 1}px solid ${form.clientAksepte ? "#00B894" : "#ddd"}`,
              borderRadius:14, padding:"12px 16px", cursor:"pointer",
              display:"flex", alignItems:"center", gap:12,
              transition:"all 0.2s" }}>
            <span style={{ fontSize:28 }}>
              {form.clientAksepte ? "✅" : "🔔"}
            </span>
            <div style={{ flex:1 }}>
              <p style={{ margin:0, fontWeight:700, fontSize:14,
                color: form.clientAksepte ? "#00B894" : "#666" }}>
                {form.clientAksepte ? "Kliyan Aksepte ✅" : "Kliyan pa Aksepte Toujou"}
              </p>
              <p style={{ margin:0, color:"#aaa", fontSize:11 }}>
                {form.clientAksepte
                  ? "Kliyan konfime li dakò ak kondisyon yo"
                  : "Klike pou kliyan konfime akseptasyon li"}
              </p>
            </div>
            {/* Toggle switch */}
            <div style={{ width:48, height:26, borderRadius:13,
              background: form.clientAksepte ? "#00B894" : "#ddd",
              position:"relative", transition:"background 0.2s" }}>
              <div style={{ position:"absolute", top:2,
                left: form.clientAksepte ? 24 : 2,
                width:22, height:22, borderRadius:"50%",
                background:"#fff", transition:"left 0.2s",
                boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }}/>
            </div>
          </div>
        </div>

        {/* Scroll content */}
        <div style={{ overflowY:"auto", flex:1, padding:"0 16px" }}>

          {/* Kliyan */}
          <div style={{ background:"#fff", borderRadius:14,
            padding:14, marginTop:12,
            boxShadow:"0 2px 8px rgba(0,0,0,0.04)" }}>
            <SectionTitle icon="👤" title="Enfòmasyon Kliyan" color="#00B894" />
            <Field label="Non Kliyan *" fkey="nom" icon="👤" />
            <Field label="Telefòn Kliyan" fkey="telephone" type="tel" icon="📞" />
            <Field label="Adrès Kliyan" fkey="adresse" icon="📍" />
            <Field label="NIF / SIN Kliyan" fkey="nif" icon="🪪" />
          </div>

          {/* Pwodwi */}
          <div style={{ background:"#fff", borderRadius:14,
            padding:14, marginTop:12,
            boxShadow:"0 2px 8px rgba(0,0,0,0.04)" }}>
            <SectionTitle icon="📦" title="Detay Pwodwi — Caissier" color="#FF7043" />
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ flex:1 }}>
                <Field label="Marque" fkey="marque" />
              </div>
              <div style={{ flex:1 }}>
                <Field label="Modèle" fkey="modele" />
              </div>
            </div>
            <div style={{ marginBottom:10 }}>
              <textarea value={form.description}
                onChange={e => set("description", e.target.value)}
                placeholder="Description" rows={2}
                style={{ width:"100%", padding:"11px 14px",
                  background:"#f8f9ff", border:"1.5px solid #eee",
                  borderRadius:10, fontSize:14, color:"#1a1a2e",
                  outline:"none", resize:"vertical" as const,
                  fontFamily:"'Segoe UI',sans-serif",
                  boxSizing:"border-box" as const }}/>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ flex:1 }}><Field label="ID / Nimewo" fkey="idNum" /></div>
              <div style={{ flex:1 }}><Field label="Couleur" fkey="couleur" /></div>
            </div>
            <Field label="S/N ou IMEI" fkey="snImei" icon="🔢" />
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ flex:1 }}><Field label="Qte" fkey="qte" type="number" /></div>
              <div style={{ flex:1 }}>
                <MoneyField label="Rabais" fkey="rabais" devizKey="clocheRabais" />
              </div>
            </div>
            <MoneyField label="Balance" fkey="balance" devizKey="clocheBalance" icon="💳" />
            <MoneyField label="Prix Unité" fkey="prixUnit" devizKey="clochePrixUnit" icon="💵" />
            {/* Montant Total */}
            <div style={{ background:"#F0FFF8", border:"1.5px solid #00B89444",
              borderRadius:12, padding:"10px 14px",
              display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:18 }}>💰</span>
              <input type="number" value={form.montantTotal}
                onChange={e => set("montantTotal", e.target.value)}
                placeholder="Montant Total"
                style={{ flex:1, border:"none", background:"transparent",
                  fontSize:16, fontWeight:700, color:"#00B894",
                  outline:"none", fontFamily:"'Segoe UI',sans-serif" }}/>
              <div style={{ display:"flex", background:"#f0f4f8",
                borderRadius:8, border:"1px solid #ddd", overflow:"hidden" }}>
                {["HTG","$"].map(d => (
                  <button key={d} onClick={() => set("clocheMontant", d)}
                    style={{ padding:"6px 10px", border:"none",
                      background: form.clocheMontant===d ? "#00B894" : "transparent",
                      color: form.clocheMontant===d ? "#fff" : "#888",
                      fontWeight:700, fontSize:12, cursor:"pointer" }}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Responsab */}
          <div style={{ background:"#fff", borderRadius:14,
            padding:14, marginTop:12,
            boxShadow:"0 2px 8px rgba(0,0,0,0.04)" }}>
            <SectionTitle icon="🏷️" title="Responsab" color="#6C63FF" />
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ flex:1 }}><Field label="Non Vendeur" fkey="nomVendeur" icon="🧑‍💼" /></div>
              <div style={{ flex:1 }}><Field label="Non Caissier" fkey="nomCaissier" icon="💼" /></div>
            </div>
            {/* Dat */}
            <div style={{ background:"#f8f9ff", border:"1px solid #eee",
              borderRadius:10, padding:"10px 14px",
              display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:14 }}>📅</span>
              <div>
                <p style={{ margin:0, color:"#aaa", fontSize:9 }}>Dat & Lè Tranzaksyon</p>
                <p style={{ margin:0, fontWeight:700, fontSize:12, color:"#555" }}>{nowStr()}</p>
              </div>
              <span style={{ marginLeft:"auto", background:"rgba(0,184,148,0.1)",
                color:"#00B894", fontSize:9, fontWeight:700,
                padding:"3px 7px", borderRadius:6 }}>Otomatik</span>
            </div>
          </div>

          {/* Bouton */}
          <button onClick={handleSave} disabled={saving || !form.nom.trim()}
            style={{ width:"100%", marginTop:16, marginBottom:8,
              padding:"14px", background: !form.nom.trim() ? "#ccc" : "#00B894",
              border:"none", borderRadius:14, cursor: !form.nom.trim() ? "not-allowed" : "pointer",
              fontSize:16, fontWeight:700, color:"#fff",
              display:"flex", alignItems:"center",
              justifyContent:"center", gap:8 }}>
            {saving ? "⏳ Ap sove..." : isEdit ? "💾 Sove Chanjman" : "✅ Anrejistre Kliyan"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CONFIRM MODAL ────────────────────────────────────────────────────────────
function ConfirmModal({ title, message, onClose, onConfirm }: {
  title: string; message: string;
  onClose: () => void; onConfirm: () => void;
}) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
      zIndex:300, display:"flex", alignItems:"center",
      justifyContent:"center", padding:20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:"#fff", borderRadius:20, padding:24,
          maxWidth:380, width:"100%" }}>
        <h3 style={{ margin:"0 0 12px", fontSize:17, fontWeight:700 }}>{title}</h3>
        <p style={{ margin:"0 0 20px", color:"#666" }}>{message}</p>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onClose}
            style={{ flex:1, padding:12, background:"#f5f5f5",
              border:"none", borderRadius:12, cursor:"pointer",
              fontSize:14 }}>
            Non
          </button>
          <button onClick={onConfirm}
            style={{ flex:1, padding:12, background:"#ff4444",
              border:"none", borderRadius:12, cursor:"pointer",
              color:"#fff", fontWeight:700, fontSize:14 }}>
            Wi, Siprime
          </button>
        </div>
      </div>
    </div>
  );
}
