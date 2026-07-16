"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import {
  collection, query, orderBy, onSnapshot, addDoc, doc,
  setDoc, deleteDoc, getDocs, writeBatch,
} from "firebase/firestore";
import { ArrowLeft, Plus, Pencil, Trash2, X, Save } from "lucide-react";

// ══════════════════════════════════════════════════════════════════════
// TYPES (menm modèl ak InfoTab / InfoSeksyon nan app Flutter la)
// ══════════════════════════════════════════════════════════════════════
interface InfoSeksyon {
  tit: string;
  kontni: string;
}

interface InfoTab {
  id: string;
  titre: string;
  ikon: string;
  lod: number;
  seksyon: InfoSeksyon[];
}

interface UserSession {
  username: string;
  displayName: string;
  isAdmin: boolean;
}

const COLLECTION = "info_tabs";

// ══════════════════════════════════════════════════════════════════════
// KOULÈ
// ══════════════════════════════════════════════════════════════════════
const kBleu = "#1565C0";
const kDark = "#1A1A2E";
const kGris = "#F5F5F5";

// ══════════════════════════════════════════════════════════════════════
// PAJ PRENSIPAL
// ══════════════════════════════════════════════════════════════════════
export default function InformationPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [tabs, setTabs] = useState<InfoTab[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editingTab, setEditingTab] = useState<InfoTab | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<InfoTab | null>(null);
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);

  // ── Sesyon itilizatè (pou konnen si se admin) ─────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (raw) {
      try { setUser(JSON.parse(raw)); } catch { /* ignore */ }
    }
  }, []);

  // ── Stream tab yo an tan reyèl ─────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, COLLECTION), orderBy("lod"));
    const unsub = onSnapshot(q, (snap) => {
      const data: InfoTab[] = snap.docs.map((d) => {
        const m = d.data();
        return {
          id: d.id,
          titre: m.titre ?? "",
          ikon: m.ikon ?? "📄",
          lod: m.lod ?? 0,
          seksyon: Array.isArray(m.seksyon)
            ? m.seksyon.map((s: any) => ({ tit: s.tit ?? "", kontni: s.kontni ?? "" }))
            : [],
        };
      });
      setTabs(data);
      setActiveIdx((prev) => Math.min(prev, Math.max(data.length - 1, 0)));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const showToast = (msg: string, color: string) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 2200);
  };

  // ── Sove (kreye oswa modifye) ────────────────────────────────────────
  const saveTab = async (tab: InfoTab) => {
    try {
      if (!tab.id) {
        const snap = await getDocs(collection(db, COLLECTION));
        const nouvoLod = snap.size;
        await addDoc(collection(db, COLLECTION), {
          titre: tab.titre, ikon: tab.ikon, lod: nouvoLod, seksyon: tab.seksyon,
        });
        showToast("✅ Tab ajoute !", "#4CAF50");
      } else {
        await setDoc(doc(db, COLLECTION, tab.id), {
          titre: tab.titre, ikon: tab.ikon, lod: tab.lod, seksyon: tab.seksyon,
        });
        showToast("✅ Tab mizajou !", "#4CAF50");
      }
    } catch (e: any) {
      showToast(`❌ Ere: ${e.message}`, "#F44336");
    }
  };

  // ── Siprime ──────────────────────────────────────────────────────────
  const deleteTab = async (tab: InfoTab) => {
    try {
      await deleteDoc(doc(db, COLLECTION, tab.id));
      showToast("🗑️ Tab siprime", "#FF9800");
    } catch (e: any) {
      showToast(`❌ Ere: ${e.message}`, "#F44336");
    }
    setConfirmDelete(null);
  };

  const activeTab = tabs[activeIdx];

  // ── Loading ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main style={{ minHeight: "100vh", background: kGris, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif" }}>
        <div style={{ width: 44, height: 44, border: "4px solid #eee", borderTop: `4px solid ${kBleu}`, borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: kGris, fontFamily: "'Segoe UI', sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ background: kDark, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 10px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            onClick={() => router.back()}
            style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 10, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff" }}
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <p style={{ margin: 0, color: "#fff", fontWeight: 800, fontSize: 17, letterSpacing: 0.3 }}>INFORMATION</p>
            <p style={{ margin: 0, color: "rgba(255,255,255,0.5)", fontSize: 11 }}>Gid pou Vin Vandè</p>
          </div>
        </div>

        {user?.isAdmin && (
          <div style={{ display: "flex", gap: 8 }}>
            {activeTab && (
              <>
                <IconBtn color="#2196F3" onClick={() => { setEditingTab(activeTab); setFormOpen(true); }} title="Modifye tab sa a">
                  <Pencil size={16} />
                </IconBtn>
                <IconBtn color="#FF5252" onClick={() => setConfirmDelete(activeTab)} title="Siprime tab sa a">
                  <Trash2 size={16} />
                </IconBtn>
              </>
            )}
            <IconBtn color="#fff" onClick={() => { setEditingTab(null); setFormOpen(true); }} title="Ajoute yon tab">
              <Plus size={18} />
            </IconBtn>
          </div>
        )}
      </div>

      {/* ── Kò paj la ── */}
      {tabs.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 20px" }}>
          <p style={{ fontSize: 48, margin: "0 0 12px" }}>ℹ️</p>
          <p style={{ color: "#999", fontSize: 15, margin: "0 0 18px" }}>Pa gen tab ankò</p>
          {user?.isAdmin && (
            <button
              onClick={() => { setEditingTab(null); setFormOpen(true); }}
              style={{ background: kBleu, color: "#fff", border: "none", borderRadius: 12, padding: "12px 22px", fontWeight: 700, fontSize: 14, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <Plus size={16} /> Ajoute Premye Tab
            </button>
          )}
        </div>
      ) : (
        <>
          {/* ── Tab bar ── */}
          <div style={{ background: kDark, display: "flex", overflowX: "auto", padding: "0 8px" }}>
            {tabs.map((t, i) => {
              const isActive = i === activeIdx;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveIdx(i)}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: "14px 16px", whiteSpace: "nowrap",
                    fontWeight: 700, fontSize: 13, fontFamily: "inherit",
                    color: isActive ? "#2196F3" : "rgba(255,255,255,0.55)",
                    borderBottom: isActive ? "3px solid #2196F3" : "3px solid transparent",
                  }}
                >
                  {t.ikon} {t.titre}
                </button>
              );
            })}
          </div>

          {/* ── Kontni tab aktif la ── */}
          <div style={{ maxWidth: 780, margin: "0 auto", padding: 20 }}>
            {activeTab?.seksyon.length === 0 ? (
              <p style={{ textAlign: "center", color: "#999", marginTop: 40 }}>
                Pa gen kontni pou "{activeTab?.titre}" ankò
              </p>
            ) : (
              activeTab?.seksyon.map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 16, border: "1px solid #EDEDF0", padding: 18, marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 4, height: 18, background: kBleu, borderRadius: 2 }} />
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: kDark }}>{s.tit}</p>
                  </div>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#444", whiteSpace: "pre-wrap" }}>
                    {s.kontni}
                  </p>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ── Modal fòm ajoute/modifye ── */}
      {formOpen && (
        <InfoTabForm
          existing={editingTab}
          onClose={() => setFormOpen(false)}
          onSave={async (tab) => { await saveTab(tab); setFormOpen(false); }}
        />
      )}

      {/* ── Modal konfimasyon siprime ── */}
      {confirmDelete && (
        <div style={overlayStyle}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 380, width: "90%" }}>
            <p style={{ margin: "0 0 8px", fontWeight: 800, fontSize: 16, color: kDark }}>Siprime Tab la ?</p>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: "#666", lineHeight: 1.5 }}>
              "{confirmDelete.titre}" ap siprime definitivman ansanm ak tout kontni ki anndan l. Aksyon sa a pa ka anile.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ background: "#f0f0f0", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Anile
              </button>
              <button onClick={() => deleteTab(confirmDelete)} style={{ background: "#F44336", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Siprime
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: toast.color, color: "#fff", padding: "12px 20px", borderRadius: 12, fontWeight: 700, fontSize: 13, boxShadow: "0 6px 20px rgba(0,0,0,0.2)", zIndex: 300 }}>
          {toast.msg}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } * { box-sizing: border-box; }`}</style>
    </main>
  );
}

// ══════════════════════════════════════════════════════════════════════
// PTIT BOUTON ICON (header)
// ══════════════════════════════════════════════════════════════════════
function IconBtn({ children, color, onClick, title }: { children: React.ReactNode; color: string; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 10, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color }}
    >
      {children}
    </button>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16,
};

// ══════════════════════════════════════════════════════════════════════
// FÒM AJOUTE / MODIFYE TAB
// ══════════════════════════════════════════════════════════════════════
function InfoTabForm({
  existing, onClose, onSave,
}: {
  existing: InfoTab | null;
  onClose: () => void;
  onSave: (tab: InfoTab) => Promise<void>;
}) {
  const [titre, setTitre] = useState(existing?.titre ?? "");
  const [ikon, setIkon] = useState(existing?.ikon ?? "📄");
  const [seksyon, setSeksyon] = useState<InfoSeksyon[]>(
    existing?.seksyon.length ? existing.seksyon.map((s) => ({ ...s })) : [{ tit: "", kontni: "" }]
  );
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const updateSeksyon = (i: number, field: keyof InfoSeksyon, value: string) => {
    setSeksyon((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  };

  const addSeksyon = () => setSeksyon((prev) => [...prev, { tit: "", kontni: "" }]);
  const removeSeksyon = (i: number) => {
    if (seksyon.length <= 1) return;
    setSeksyon((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSave = async () => {
    if (!titre.trim()) { setErrMsg("Antre non tab la (ex: Facebook, Google...)"); return; }
    for (let i = 0; i < seksyon.length; i++) {
      if (!seksyon[i].tit.trim()) { setErrMsg(`Antre yon tit pou Seksyon #${i + 1}`); return; }
      if (!seksyon[i].kontni.trim()) { setErrMsg(`Antre kontni pou Seksyon #${i + 1}`); return; }
    }
    setSaving(true);
    await onSave({
      id: existing?.id ?? "",
      titre: titre.trim(),
      ikon: ikon.trim() || "📄",
      lod: existing?.lod ?? 0,
      seksyon: seksyon.map((s) => ({ tit: s.tit.trim(), kontni: s.kontni.trim() })),
    });
    setSaving(false);
  };

  return (
    <div style={overlayStyle}>
      <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 560, maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header modal */}
        <div style={{ background: kDark, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <p style={{ margin: 0, color: "#fff", fontWeight: 700, fontSize: 16 }}>
            {existing ? "Modifye Tab" : "Nouvo Tab"}
          </p>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer" }}>
            <X size={20} />
          </button>
        </div>

        {/* Kò fòm nan */}
        <div style={{ padding: 20, overflowY: "auto" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <input
              value={ikon}
              onChange={(e) => setIkon(e.target.value)}
              placeholder="📄"
              style={{ ...inputStyle, width: 70, textAlign: "center" }}
            />
            <input
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
              placeholder="Non Tab (ex: Facebook) *"
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>

          <p style={{ fontWeight: 700, fontSize: 14, margin: "0 0 10px" }}>Seksyon Kontni</p>

          {seksyon.map((s, i) => (
            <div key={i} style={{ background: "#FAFAFC", border: "1px solid #EDEDF0", borderRadius: 14, padding: 14, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>Seksyon #{i + 1}</p>
                {seksyon.length > 1 && (
                  <button onClick={() => removeSeksyon(i)} style={{ background: "transparent", border: "none", color: "#F44336", cursor: "pointer", display: "flex" }}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <input
                value={s.tit}
                onChange={(e) => updateSeksyon(i, "tit", e.target.value)}
                placeholder="Tit Seksyon (ex: Kijan pou pibliye)"
                style={{ ...inputStyle, marginBottom: 10 }}
              />
              <textarea
                value={s.kontni}
                onChange={(e) => updateSeksyon(i, "kontni", e.target.value)}
                placeholder="Kontni / Eksplikasyon"
                rows={5}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
              />
            </div>
          ))}

          <button
            onClick={addSeksyon}
            style={{ width: "100%", background: "#fff", border: `1.5px solid ${kBleu}66`, borderRadius: 12, padding: "12px 0", color: kBleu, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 20 }}
          >
            <Plus size={16} /> Ajoute yon Seksyon
          </button>

          {errMsg && (
            <p style={{ background: "#FDECEA", color: "#D32F2F", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 16 }}>
              ⚠️ {errMsg}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            style={{ width: "100%", background: kBleu, color: "#fff", border: "none", borderRadius: 14, padding: "14px 0", fontWeight: 700, fontSize: 15, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "inherit" }}
          >
            <Save size={18} /> {saving ? "..." : existing ? "Mizajou Tab" : "Kreye Tab"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", borderRadius: 12,
  border: "1px solid #ddd", fontSize: 14, outline: "none", fontFamily: "inherit",
};