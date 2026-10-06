"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import {
  collection, query, orderBy, onSnapshot, addDoc, doc,
  setDoc, deleteDoc, getDocs,
} from "firebase/firestore";
import {
  ArrowLeft, Plus, Pencil, Trash2, X, Save, Image as ImageIcon, Video as VideoIcon,
} from "lucide-react";

// ══════════════════════════════════════════════════════════════════════
// TYPES (menm modèl ak InfoTab / InfoSeksyon / InfoMedia nan app Flutter la)
// ══════════════════════════════════════════════════════════════════════
interface InfoMedia {
  url: string;
  fileId: string; // nesesè pou siprime fichye a sou ImageKit
}

interface InfoSeksyon {
  tit: string;
  kontni: string;
  imaj: InfoMedia[];
  videyo: InfoMedia[];
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
const UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";

// Ajiste selon plan ImageKit ou a
const MAX_IMAGE_MB = 20;
const MAX_VIDEO_MB = 100;

// ══════════════════════════════════════════════════════════════════════
// KOULÈ
// ══════════════════════════════════════════════════════════════════════
const kBleu = "#1565C0";
const kDark = "#1A1A2E";
const kGris = "#F5F5F5";

// ══════════════════════════════════════════════════════════════════════
// ITIL: PARSE / ID / IMAGEKIT
// ══════════════════════════════════════════════════════════════════════

// Aksepte nouvo fòma ({url, fileId}) ak ansyen fòma (sèlman yon String)
const parseMedia = (e: any): InfoMedia =>
  typeof e === "string"
    ? { url: e, fileId: "" }
    : { url: String(e?.url ?? ""), fileId: String(e?.fileId ?? "") };

const parseMediaList = (l: any): InfoMedia[] =>
  Array.isArray(l) ? l.map(parseMedia).filter((m) => m.url) : [];

const collectFileIds = (seksyon: InfoSeksyon[]): Set<string> => {
  const ids = new Set<string>();
  seksyon.forEach((s) =>
    [...s.imaj, ...s.videyo].forEach((m) => { if (m.fileId) ids.add(m.fileId); })
  );
  return ids;
};

// Siprime fichye sou ImageKit (via route sèvè a)
const deleteFromImageKit = async (ids: Iterable<string>) => {
  for (const fileId of ids) {
    try {
      await fetch("/api/imagekit/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
    } catch { /* ignore */ }
  }
};

// Upload dirèk sou ImageKit ak siyati ki soti sou sèvè a
async function uploadToImageKit(
  file: File,
  folder: string,
  onProgress: (pct: number) => void
): Promise<InfoMedia> {
  const authRes = await fetch("/api/imagekit/auth", { cache: "no-store" });
  if (!authRes.ok) throw new Error("Pa ka jwenn otorizasyon upload la");
  const { token, expire, signature, publicKey } = await authRes.json();

  const fd = new FormData();
  fd.append("file", file);
  fd.append("fileName", file.name);
  fd.append("publicKey", publicKey);
  fd.append("signature", signature);
  fd.append("expire", String(expire));
  fd.append("token", token);
  fd.append("folder", folder);
  fd.append("useUniqueFileName", "true");
  fd.append("tags", "information");

  return new Promise<InfoMedia>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", UPLOAD_URL);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve({ url: data.url, fileId: data.fileId });
        } catch {
          reject(new Error("Repons ImageKit envalid"));
        }
      } else {
        let msg = `Kòd ${xhr.status}`;
        try { msg = JSON.parse(xhr.responseText).message ?? msg; } catch { /* ignore */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Pwoblèm koneksyon"));
    xhr.send(fd);
  });
}

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
  const [lightbox, setLightbox] = useState<string | null>(null);

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
            ? m.seksyon.map((s: any) => ({
                tit: s.tit ?? "",
                kontni: s.kontni ?? "",
                imaj: parseMediaList(s.imaj),
                videyo: parseMediaList(s.videyo),
              }))
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
        const ansyen = tabs.find((t) => t.id === tab.id);
        await setDoc(doc(db, COLLECTION, tab.id), {
          titre: tab.titre, ikon: tab.ikon, lod: tab.lod, seksyon: tab.seksyon,
        });

        // Siprime sou ImageKit sa ki te retire yo
        if (ansyen) {
          const nouvoIds = collectFileIds(tab.seksyon);
          const retire = [...collectFileIds(ansyen.seksyon)].filter((id) => !nouvoIds.has(id));
          await deleteFromImageKit(retire);
        }
        showToast("✅ Tab mizajou !", "#4CAF50");
      }
    } catch (e: any) {
      showToast(`❌ Ere: ${e.message}`, "#F44336");
    }
  };

  // ── Siprime (ak tout medya li yo) ────────────────────────────────────
  const deleteTab = async (tab: InfoTab) => {
    try {
      await deleteDoc(doc(db, COLLECTION, tab.id));
      await deleteFromImageKit(collectFileIds(tab.seksyon));
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

                  {/* Imaj yo */}
                  {s.imaj.map((m, j) => (
                    <img
                      key={`img-${j}`}
                      src={m.url}
                      alt=""
                      loading="lazy"
                      onClick={() => setLightbox(m.url)}
                      style={{ display: "block", width: "100%", marginTop: 12, borderRadius: 12, cursor: "zoom-in", background: "#eee" }}
                    />
                  ))}

                  {/* Videyo yo */}
                  {s.videyo.map((m, j) => (
                    <video
                      key={`vid-${j}`}
                      src={m.url}
                      controls
                      playsInline
                      preload="metadata"
                      style={{ display: "block", width: "100%", marginTop: 12, borderRadius: 12, background: "#000" }}
                    />
                  ))}
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

      {/* ── Imaj an gran ── */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ ...overlayStyle, background: "rgba(0,0,0,0.9)", zIndex: 400, cursor: "zoom-out" }}
        >
          <button
            onClick={() => setLightbox(null)}
            style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 10, width: 38, height: 38, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <X size={20} />
          </button>
          <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </div>
      )}

      {/* ── Modal konfimasyon siprime ── */}
      {confirmDelete && (
        <div style={overlayStyle}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 380, width: "90%" }}>
            <p style={{ margin: "0 0 8px", fontWeight: 800, fontSize: 16, color: kDark }}>Siprime Tab la ?</p>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: "#666", lineHeight: 1.5 }}>
              "{confirmDelete.titre}" ap siprime definitivman ansanm ak tout kontni ki anndan l (tèks, imaj, videyo). Aksyon sa a pa ka anile.
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
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: toast.color, color: "#fff", padding: "12px 20px", borderRadius: 12, fontWeight: 700, fontSize: 13, boxShadow: "0 6px 20px rgba(0,0,0,0.2)", zIndex: 500 }}>
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
type SeksyonForm = InfoSeksyon & { _k: string; pct: number | null };

const newKey = () => Math.random().toString(36).slice(2);
const blankSeksyon = (): SeksyonForm => ({
  _k: newKey(), tit: "", kontni: "", imaj: [], videyo: [], pct: null,
});

function InfoTabForm({
  existing, onClose, onSave,
}: {
  existing: InfoTab | null;
  onClose: () => void;
  onSave: (tab: InfoTab) => Promise<void>;
}) {
  const [titre, setTitre] = useState(existing?.titre ?? "");
  const [ikon, setIkon] = useState(existing?.ikon ?? "📄");
  const [seksyon, setSeksyon] = useState<SeksyonForm[]>(
    existing?.seksyon.length
      ? existing.seksyon.map((s) => ({
          ...s, imaj: [...s.imaj], videyo: [...s.videyo], _k: newKey(), pct: null,
        }))
      : [blankSeksyon()]
  );
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const anUpload = seksyon.some((s) => s.pct !== null);

  const patch = (k: string, p: Partial<SeksyonForm>) =>
    setSeksyon((prev) => prev.map((s) => (s._k === k ? { ...s, ...p } : s)));

  const addSeksyon = () => setSeksyon((prev) => [...prev, blankSeksyon()]);
  const removeSeksyon = (k: string) => {
    if (seksyon.length <= 1) return;
    setSeksyon((prev) => prev.filter((s) => s._k !== k));
  };

  const addMedia = (k: string, video: boolean, media: InfoMedia) =>
    setSeksyon((prev) =>
      prev.map((s) =>
        s._k === k
          ? video
            ? { ...s, videyo: [...s.videyo, media], pct: null }
            : { ...s, imaj: [...s.imaj, media], pct: null }
          : s
      )
    );

  const removeMedia = (k: string, video: boolean, idx: number) =>
    setSeksyon((prev) =>
      prev.map((s) =>
        s._k === k
          ? video
            ? { ...s, videyo: s.videyo.filter((_, i) => i !== idx) }
            : { ...s, imaj: s.imaj.filter((_, i) => i !== idx) }
          : s
      )
    );

  const handlePick = async (k: string, video: boolean, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // pou ka chwazi menm fichye a ankò
    if (!file) return;

    const maxMb = video ? MAX_VIDEO_MB : MAX_IMAGE_MB;
    if (file.size > maxMb * 1024 * 1024) {
      setErrMsg(`Fichye a twò gwo (maksimòm ${maxMb} MB)`);
      return;
    }

    setErrMsg(null);
    patch(k, { pct: 0 });
    try {
      const media = await uploadToImageKit(
        file,
        video ? "/information/videos" : "/information/images",
        (pct) => patch(k, { pct })
      );
      addMedia(k, video, media);
    } catch (err: any) {
      patch(k, { pct: null });
      setErrMsg(`Upload echwe: ${err.message}`);
    }
  };

  const handleSave = async () => {
    if (!titre.trim()) { setErrMsg("Antre non tab la (ex: Facebook, Google...)"); return; }
    for (let i = 0; i < seksyon.length; i++) {
      if (!seksyon[i].tit.trim()) { setErrMsg(`Antre yon tit pou Seksyon #${i + 1}`); return; }
      if (!seksyon[i].kontni.trim()) { setErrMsg(`Antre kontni pou Seksyon #${i + 1}`); return; }
    }
    setErrMsg(null);
    setSaving(true);
    await onSave({
      id: existing?.id ?? "",
      titre: titre.trim(),
      ikon: ikon.trim() || "📄",
      lod: existing?.lod ?? 0,
      seksyon: seksyon.map((s) => ({
        tit: s.tit.trim(),
        kontni: s.kontni.trim(),
        imaj: s.imaj,
        videyo: s.videyo,
      })),
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

          {seksyon.map((s, i) => {
            const uploading = s.pct !== null;
            return (
              <div key={s._k} style={{ background: "#FAFAFC", border: "1px solid #EDEDF0", borderRadius: 14, padding: 14, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>Seksyon #{i + 1}</p>
                  {seksyon.length > 1 && (
                    <button onClick={() => removeSeksyon(s._k)} style={{ background: "transparent", border: "none", color: "#F44336", cursor: "pointer", display: "flex" }}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                <input
                  value={s.tit}
                  onChange={(e) => patch(s._k, { tit: e.target.value })}
                  placeholder="Tit Seksyon (ex: Kijan pou pibliye)"
                  style={{ ...inputStyle, marginBottom: 10 }}
                />
                <textarea
                  value={s.kontni}
                  onChange={(e) => patch(s._k, { kontni: e.target.value })}
                  placeholder="Kontni / Eksplikasyon"
                  rows={5}
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                />

                {/* Bouton Imaj / Videyo */}
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <label
                    htmlFor={`img-${s._k}`}
                    style={{ ...mediaBtnStyle, opacity: uploading ? 0.5 : 1, cursor: uploading ? "default" : "pointer", pointerEvents: uploading ? "none" : "auto" }}
                  >
                    <ImageIcon size={16} /> Imaj
                  </label>
                  <input
                    id={`img-${s._k}`}
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={uploading}
                    onChange={(e) => handlePick(s._k, false, e)}
                  />

                  <label
                    htmlFor={`vid-${s._k}`}
                    style={{ ...mediaBtnStyle, opacity: uploading ? 0.5 : 1, cursor: uploading ? "default" : "pointer", pointerEvents: uploading ? "none" : "auto" }}
                  >
                    <VideoIcon size={16} /> Videyo
                  </label>
                  <input
                    id={`vid-${s._k}`}
                    type="file"
                    accept="video/*"
                    hidden
                    disabled={uploading}
                    onChange={(e) => handlePick(s._k, true, e)}
                  />
                </div>

                {/* Pwogrè upload */}
                {uploading && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ height: 6, background: "#E0E0E0", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${s.pct}%`, height: "100%", background: kBleu, transition: "width 0.2s" }} />
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: 11, color: "#888" }}>
                      Ap upload... {s.pct}% — pa fèmen paj la
                    </p>
                  </div>
                )}

                {/* Preview medya yo */}
                {(s.imaj.length > 0 || s.videyo.length > 0) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                    {s.imaj.map((m, j) => (
                      <PreviewBox key={`i-${j}`} onRemove={() => removeMedia(s._k, false, j)}>
                        <img
                          src={`${m.url}?tr=w-200,h-200`}
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      </PreviewBox>
                    ))}
                    {s.videyo.map((m, j) => (
                      <PreviewBox key={`v-${j}`} dark onRemove={() => removeMedia(s._k, true, j)}>
                        <video
                          src={m.url}
                          preload="metadata"
                          muted
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      </PreviewBox>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

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
            disabled={saving || anUpload}
            style={{ width: "100%", background: kBleu, color: "#fff", border: "none", borderRadius: 14, padding: "14px 0", fontWeight: 700, fontSize: 15, cursor: saving || anUpload ? "default" : "pointer", opacity: saving || anUpload ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "inherit" }}
          >
            <Save size={18} /> {saving ? "..." : anUpload ? "Ap upload..." : existing ? "Mizajou Tab" : "Kreye Tab"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// PREVIEW BOX (ti kare ak bouton ✕)
// ══════════════════════════════════════════════════════════════════════
function PreviewBox({ children, onRemove, dark }: { children: React.ReactNode; onRemove: () => void; dark?: boolean }) {
  return (
    <div style={{ position: "relative", width: 80, height: 80 }}>
      <div style={{ width: "100%", height: "100%", borderRadius: 10, overflow: "hidden", background: dark ? "#111" : "#eee" }}>
        {children}
      </div>
      <button
        onClick={onRemove}
        title="Retire"
        style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%", border: "none", background: "#F44336", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

const mediaBtnStyle: React.CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  padding: "10px 0", borderRadius: 12, border: `1.5px solid ${kBleu}66`,
  color: kBleu, fontWeight: 700, fontSize: 13, background: "#fff", fontFamily: "inherit",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", borderRadius: 12,
  border: "1px solid #ddd", fontSize: 14, outline: "none", fontFamily: "inherit",
};