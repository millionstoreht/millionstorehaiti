"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { HardHat, Plus, Search, X, ChevronLeft, Trash2, Edit, Eye, CheckCircle, XCircle } from "lucide-react";

interface UserSession {
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  permissions: Record<string, boolean>;
}

interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  email: string;
  address: string;
  gender: string;
  maritalStatus: string;
  birthDate: string;
  position: string;
  department: string;
  contractType: string;
  startDate: string;
  schedule: string;
  localId: string;
  isActive: boolean;
  salary: number;
  salaryType: string;
  bankAccount: string;
  nif: string;
  cin: string;
  socialSecurity: string;
}

const EMPTY_WORKER: Omit<Worker, "id"> = {
  firstName: "", lastName: "", fullName: "", phone: "", email: "",
  address: "", gender: "Gason", maritalStatus: "Selibatè", birthDate: "",
  position: "", department: "", contractType: "Fiks", startDate: "",
  schedule: "", localId: "", isActive: true, salary: 0, salaryType: "Mwa",
  bankAccount: "", nif: "", cin: "", socialSecurity: "",
};

function formatDate(dateStr: string) {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  } catch { return dateStr; }
}

export default function WorkersPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState<Worker | null>(null);
  const [editing, setEditing] = useState<Worker | null>(null);
  const [form, setForm] = useState<Omit<Worker, "id">>(EMPTY_WORKER);
  const [saving, setSaving] = useState(false);

  // Verifye sesyon
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const session = JSON.parse(raw) as UserSession;
      if (!session.isAdmin && !session.permissions?.workersVoir) {
        router.push("/dashboard"); return;
      }
      setUser(session);
      loadWorkers();
    } catch { router.push("/login"); }
  }, []);

  const canAdd    = user?.isAdmin || user?.permissions?.workersAjoute;
  const canEdit   = user?.isAdmin || user?.permissions?.workersModifye;
  const canDelete = user?.isAdmin || user?.permissions?.workersSiprime;

  async function loadWorkers() {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "workers"));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Worker));
      setWorkers(list);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_WORKER);
    setShowForm(true);
  }

  function openEdit(w: Worker) {
    setEditing(w);
    setForm({ ...w });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      alert("Non ak Prenon obligatwa!"); return;
    }
    setSaving(true);
    const data = {
      ...form,
      fullName: `${form.firstName.trim()} ${form.lastName.trim()}`,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editing) {
        await updateDoc(doc(db, "workers", editing.id), data);
      } else {
        await addDoc(collection(db, "workers"), { ...data, createdAt: new Date().toISOString() });
      }
      await loadWorkers();
      setShowForm(false);
    } catch (e) { alert("Erè: " + e); }
    setSaving(false);
  }

  async function handleDelete(w: Worker) {
    if (!confirm(`Siprime ${w.firstName} ${w.lastName}?`)) return;
    await deleteDoc(doc(db, "workers", w.id));
    await loadWorkers();
  }

  const filtered = workers.filter(w =>
    `${w.firstName} ${w.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
    (w.position ?? "").toLowerCase().includes(search.toLowerCase())
  );

  // ── INPUT HELPER ──
  const inp = (label: string, key: keyof Omit<Worker,"id">, type = "text") => (
    <div style={{ marginBottom: "12px" }}>
      <label style={{ display: "block", fontSize: "12px", color: "#888", marginBottom: "4px", fontWeight: 600 }}>{label}</label>
      <input
        type={type}
        value={form[key] as string}
        onChange={e => setForm(f => ({ ...f, [key]: type === "number" ? Number(e.target.value) : e.target.value }))}
        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "14px", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
        onFocus={e => e.target.style.borderColor = "#795548"}
        onBlur={e => e.target.style.borderColor = "#eee"}
      />
    </div>
  );

  const sel = (label: string, key: keyof Omit<Worker,"id">, options: string[]) => (
    <div style={{ marginBottom: "12px" }}>
      <label style={{ display: "block", fontSize: "12px", color: "#888", marginBottom: "4px", fontWeight: 600 }}>{label}</label>
      <select
        value={form[key] as string}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "14px", outline: "none", background: "#fff", boxSizing: "border-box", fontFamily: "inherit" }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  if (loading) return (
    <main style={{ minHeight: "100vh", background: "#F5F0EB", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: "48px", height: "48px", border: "4px solid #eee", borderTop: "4px solid #795548", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
        <p style={{ color: "#888" }}>Chajman...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </main>
  );

  return (
    <main style={{ minHeight: "100vh", background: "#F5F0EB", fontFamily: "'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#1a1a2e", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 10px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button onClick={() => router.push("/dashboard")} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "8px", borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center" }}>
            <ChevronLeft size={18} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ background: "#79554820", padding: "8px", borderRadius: "10px" }}>
              <HardHat size={22} color="#795548" />
            </div>
            <div>
              <p style={{ margin: 0, color: "#fff", fontWeight: 700, fontSize: "16px" }}>Workers</p>
              <p style={{ margin: 0, color: "#aaa", fontSize: "11px" }}>{workers.length} anplwaye</p>
            </div>
          </div>
        </div>
        {canAdd && (
          <button onClick={openAdd} style={{ background: "#795548", border: "none", color: "#fff", padding: "10px 18px", borderRadius: "10px", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "14px" }}>
            <Plus size={16} /> Ajoute
          </button>
        )}
      </div>

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px 20px" }}>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: "20px" }}>
          <Search size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "#aaa" }} />
          <input
            placeholder="Chèche anplwaye..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", padding: "12px 14px 12px 42px", borderRadius: "12px", border: "none", fontSize: "14px", outline: "none", background: "#fff", boxSizing: "border-box", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}
          />
        </div>

        {/* Liste */}
        {filtered.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: "20px", padding: "60px", textAlign: "center" }}>
            <HardHat size={48} color="#ccc" style={{ marginBottom: "12px" }} />
            <p style={{ color: "#aaa" }}>Pa gen anplwaye</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {filtered.map(w => (
              <div key={w.id} style={{ background: "#fff", borderRadius: "16px", padding: "16px 20px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: "16px" }}>

                {/* Avatar */}
                <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: w.isActive ? "#4CAF5018" : "#9E9E9E18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", fontWeight: 700, color: w.isActive ? "#4CAF50" : "#9E9E9E", flexShrink: 0 }}>
                  {(w.firstName || "?")[0].toUpperCase()}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <span style={{ fontWeight: 700, fontSize: "15px", color: "#1a1a2e" }}>{w.firstName} {w.lastName}</span>
                    <span style={{ background: w.isActive ? "#4CAF5018" : "#9E9E9E18", color: w.isActive ? "#4CAF50" : "#9E9E9E", padding: "2px 8px", borderRadius: "8px", fontSize: "10px", fontWeight: 700 }}>
                      {w.isActive ? "Aktif" : "Inaktif"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                    {w.position && <span style={{ color: "#795548", fontSize: "12px", fontWeight: 600 }}>💼 {w.position}</span>}
                    {w.salary > 0 && <span style={{ color: "#888", fontSize: "12px" }}>💰 {w.salary} HTG/{w.salaryType}</span>}
                    {w.phone && <span style={{ color: "#888", fontSize: "12px" }}>📞 {w.phone}</span>}
                  </div>
                </div>

                {/* Bouton yo */}
                <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                  <button onClick={() => setShowDetail(w)} style={{ background: "#9C27B018", border: "none", color: "#9C27B0", padding: "8px", borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center" }} title="Wè detay">
                    <Eye size={16} />
                  </button>
                  {canEdit && (
                    <button onClick={() => openEdit(w)} style={{ background: "#2196F318", border: "none", color: "#2196F3", padding: "8px", borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center" }} title="Modifye">
                      <Edit size={16} />
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={() => handleDelete(w)} style={{ background: "#F4433618", border: "none", color: "#F44336", padding: "8px", borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center" }} title="Siprime">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── MODAL FORM ── */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#F5F0EB", borderRadius: "24px 24px 0 0", width: "100%", maxWidth: "600px", maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>

            {/* Header modal */}
            <div style={{ padding: "20px 24px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #eee" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>{editing ? "Modifye Anplwaye" : "Ajoute Anplwaye"}</h2>
              <button onClick={() => setShowForm(false)} style={{ background: "#eee", border: "none", padding: "8px", borderRadius: "8px", cursor: "pointer" }}>
                <X size={18} />
              </button>
            </div>

            {/* Kò modal */}
            <div style={{ overflowY: "auto", padding: "20px 24px 32px" }}>

              {/* Pèsonèl */}
              <p style={{ fontWeight: 700, color: "#795548", marginBottom: "12px" }}>👤 Enfòmasyon Pèsonèl</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                {inp("Non *", "firstName")}
                {inp("Prenon *", "lastName")}
              </div>
              {sel("Sèks", "gender", ["Gason", "Fi"])}
              {sel("Eta Sivil", "maritalStatus", ["Selibatè", "Marye", "Divòse", "Vèf/Vèv"])}
              {inp("Dat Nesans", "birthDate", "date")}
              {inp("Telefòn", "phone", "tel")}
              {inp("Email", "email", "email")}
              {inp("Adrès", "address")}

              {/* Travay */}
              <p style={{ fontWeight: 700, color: "#795548", margin: "16px 0 12px" }}>💼 Enfòmasyon Travay</p>
              {inp("Pozisyon/Tit", "position")}
              {inp("Depatman", "department")}
              {sel("Tip Kontra", "contractType", ["Fiks", "Paryè", "Sezonye", "Estajyè"])}
              {inp("Dat Antre", "startDate", "date")}
              {inp("Orè (ex: Lendi-Vandredi 8h-17h)", "schedule")}

              {/* Estati */}
              <div style={{ background: form.isActive ? "#4CAF5010" : "#9E9E9E10", borderRadius: "12px", padding: "4px 12px", marginBottom: "12px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", padding: "8px 0" }}>
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
                  <span style={{ fontWeight: 600, color: form.isActive ? "#4CAF50" : "#9E9E9E" }}>
                    {form.isActive ? "✅ Anplwaye Aktif" : "❌ Anplwaye Inaktif"}
                  </span>
                </label>
              </div>

              {/* Salè */}
              <p style={{ fontWeight: 700, color: "#795548", margin: "16px 0 12px" }}>💰 Salè</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                {inp("Montan Salè", "salary", "number")}
                {sel("Tip Salè", "salaryType", ["Jounen", "Semèn", "Mwa"])}
              </div>
              {inp("Nimewo Kont Bank (opsyonèl)", "bankAccount")}

              {/* Dokiman */}
              <p style={{ fontWeight: 700, color: "#795548", margin: "16px 0 12px" }}>📄 Dokiman</p>
              {inp("NIF", "nif")}
              {inp("CIN (Kat Nasyonal)", "cin")}
              {inp("Nimewo Sekirite Sosyal", "socialSecurity")}

              {/* Bouton sove */}
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ width: "100%", padding: "14px", background: "#795548", color: "#fff", border: "none", borderRadius: "12px", fontSize: "16px", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, marginTop: "8px" }}
              >
                {saving ? "⏳ Ap sove..." : editing ? "✅ Sove Chanjman" : "✅ Ajoute Anplwaye"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL DETAY ── */}
      {showDetail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", width: "100%", maxWidth: "500px", maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #eee" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>{showDetail.firstName} {showDetail.lastName}</h2>
              <button onClick={() => setShowDetail(null)} style={{ background: "#eee", border: "none", padding: "8px", borderRadius: "8px", cursor: "pointer" }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ overflowY: "auto", padding: "20px 24px 24px" }}>
              {[
                { title: "👤 Pèsonèl", rows: [
                  ["Sèks", showDetail.gender], ["Eta Sivil", showDetail.maritalStatus],
                  ["Dat Nesans", formatDate(showDetail.birthDate)], ["Telefòn", showDetail.phone],
                  ["Email", showDetail.email], ["Adrès", showDetail.address],
                ]},
                { title: "💼 Travay", rows: [
                  ["Pozisyon", showDetail.position], ["Depatman", showDetail.department],
                  ["Kontra", showDetail.contractType], ["Dat Antre", formatDate(showDetail.startDate)],
                  ["Orè", showDetail.schedule], ["Estati", showDetail.isActive ? "Aktif ✅" : "Inaktif ❌"],
                ]},
                { title: "💰 Salè", rows: [
                  ["Salè", `${showDetail.salary} HTG/${showDetail.salaryType}`],
                  ["Kont Bank", showDetail.bankAccount || "-"],
                ]},
                { title: "📄 Dokiman", rows: [
                  ["NIF", showDetail.nif || "-"], ["CIN", showDetail.cin || "-"],
                  ["Sekirite Sosyal", showDetail.socialSecurity || "-"],
                ]},
              ].map(section => (
                <div key={section.title} style={{ marginBottom: "16px" }}>
                  <p style={{ fontWeight: 700, color: "#795548", margin: "0 0 8px" }}>{section.title}</p>
                  {section.rows.map(([label, value]) => (
                    <div key={label} style={{ display: "flex", gap: "8px", padding: "4px 0", borderBottom: "1px solid #f5f5f5" }}>
                      <span style={{ fontWeight: 600, fontSize: "13px", minWidth: "120px", color: "#555" }}>{label}:</span>
                      <span style={{ fontSize: "13px", color: "#333" }}>{value || "-"}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}