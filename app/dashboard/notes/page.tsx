"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, getDocs,
} from "firebase/firestore";

// ══════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════
interface UserSession {
  username:    string;
  displayName: string;
  isAdmin:     boolean;
  localId:     string;
  permissions: Record<string, boolean>;
}

interface StoreOption {
  id: string;
  name: string;
}

interface Note {
  id: string;
  contenu: string;
  auteur: string;
  localId: string;
  createdAt: string;
  deleted: boolean;
  deletedAt?: string;
  deletedBy?: string;
  editedAt?: string;
  editedBy?: string;
  replyToId?: string;
  replyToAuteur?: string;
  replyToContenu?: string;
  pending?: boolean;
}

// ══════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════
function fmtTime(raw?: string) {
  if (!raw) return "";
  const dt = new Date(raw);
  return dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(raw?: string) {
  if (!raw) return "";
  const dt = new Date(raw);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(dt, now)) return "Aujourd'hui";
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay(dt, yesterday)) return "Hier";
  return dt.toLocaleDateString("fr-FR");
}

const AUTEUR_COLORS = ["#e63946", "#8e44ad", "#3949ab", "#00897b", "#43a047", "#fb8c00", "#d81b60", "#00acc1"];
function auteurColor(auteur: string) {
  if (!auteur) return AUTEUR_COLORS[0];
  return AUTEUR_COLORS[auteur.charCodeAt(0) % AUTEUR_COLORS.length];
}

const PENDING_KEY = (localId: string) => `pending_notes_${localId}`;

// ══════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════
export default function NotesPage() {
  const router = useRouter();
  const [user, setUser]           = useState<UserSession | null>(null);
  const canAjoute  = user?.isAdmin || user?.permissions?.noteAjoute === true;
  const canModifye = user?.isAdmin || user?.permissions?.noteModifye === true;
  const canSiprime = user?.isAdmin || user?.permissions?.noteSiprime === true;

  const needsStorePicker = user?.localId === "all";
  const [stores, setStores]           = useState<StoreOption[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [loadingStores, setLoadingStores] = useState(false);
  const effectiveLocalId = needsStorePicker ? selectedStore : (user?.localId ?? "");

  const [notes, setNotes]         = useState<Note[]>([]);
  const [trash, setTrash]         = useState<Note[]>([]);
  const [text, setText]           = useState("");
  const [search, setSearch]       = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [replyTo, setReplyTo]     = useState<Note | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [sending, setSending]     = useState(false);
  const [isOnline, setIsOnline]   = useState(true);
  const [loading, setLoading]     = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const session = JSON.parse(raw) as UserSession;
      if (!session.isAdmin && session.permissions?.noteVoir !== true) {
        router.push("/dashboard");
        return;
      }
      setUser(session);
    } catch { router.push("/login"); }
  }, [router]);

  useEffect(() => {
    if (!user || !needsStorePicker) return;
    setLoadingStores(true);
    getDocs(collection(db, "locals")).then((snap) => {
      const list = snap.docs
        .filter((d) => d.id !== "all")
        .map((d) => ({ id: d.id, name: (d.data().name as string) || d.id }));
      setStores(list);
      setLoadingStores(false);
    }).catch(() => setLoadingStores(false));
  }, [user, needsStorePicker]);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const on = () => { setIsOnline(true); flushPending(); };
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, effectiveLocalId]);

  useEffect(() => {
    if (!user) return;
    if (needsStorePicker && !selectedStore) { setLoading(false); return; }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "locals", effectiveLocalId, "notes"),
      (snap) => {
        const all = snap.docs.map((d) => d.data() as Note);
        setNotes(all.filter((n) => !n.deleted));
        setTrash(all.filter((n) => n.deleted));
        setLoading(false);
        setIsOnline(true);
        flushPending();
      },
      () => { setIsOnline(false); setLoading(false); }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, effectiveLocalId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [notes]);

  const getPending = (): Note[] => {
    if (!effectiveLocalId) return [];
    try { return JSON.parse(localStorage.getItem(PENDING_KEY(effectiveLocalId)) || "[]"); } catch { return []; }
  };
  const setPending = (list: Note[]) => {
    if (!effectiveLocalId) return;
    localStorage.setItem(PENDING_KEY(effectiveLocalId), JSON.stringify(list));
  };

  const flushPending = async () => {
    if (!effectiveLocalId) return;
    const pending = getPending();
    if (pending.length === 0) return;
    const remaining: Note[] = [];
    for (const n of pending) {
      try {
        const clean = { ...n }; delete clean.pending;
        await setDoc(doc(db, "locals", effectiveLocalId, "notes", n.id), clean);
      } catch { remaining.push(n); }
    }
    setPending(remaining);
  };

  const handleSend = async () => {
    if (!user || !text.trim() || !canAjoute || !effectiveLocalId) return;
    setSending(true);

    if (editingNote) {
      if (!canModifye) { setSending(false); return; }
      const updated: Note = { ...editingNote, contenu: text.trim(), editedAt: new Date().toISOString(), editedBy: user.displayName };
      try {
        await setDoc(doc(db, "locals", effectiveLocalId, "notes", updated.id), updated);
      } catch {}
      setEditingNote(null);
    } else {
      const note: Note = {
        id: Date.now().toString(),
        contenu: text.trim(),
        auteur: user.displayName,
        localId: effectiveLocalId,
        createdAt: new Date().toISOString(),
        deleted: false,
        pending: true,
        ...(replyTo ? { replyToId: replyTo.id, replyToAuteur: replyTo.auteur, replyToContenu: replyTo.contenu } : {}),
      };
      setNotes((prev) => [...prev, note]);
      setReplyTo(null);
      try {
        const clean = { ...note }; delete clean.pending;
        await setDoc(doc(db, "locals", effectiveLocalId, "notes", note.id), clean);
      } catch {
        const pending = getPending();
        setPending([...pending, note]);
      }
    }

    setText("");
    setSending(false);
  };

  const moveToTrash = async (n: Note) => {
    if (!user || !canSiprime || !effectiveLocalId) return;
    if (!confirm("Déplacer cette note vers la corbeille ?")) return;
    const updated: Note = { ...n, deleted: true, deletedAt: new Date().toISOString(), deletedBy: user.displayName };
    try { await setDoc(doc(db, "locals", effectiveLocalId, "notes", n.id), updated); } catch {}
  };

  const restoreNote = async (n: Note) => {
    if (!user || !canSiprime || !effectiveLocalId) return;
    const updated: Note = { ...n, deleted: false };
    delete updated.deletedAt; delete updated.deletedBy;
    try { await setDoc(doc(db, "locals", effectiveLocalId, "notes", n.id), updated); } catch {}
  };

  const deleteForever = async (n: Note) => {
    if (!user || !canSiprime || !effectiveLocalId) return;
    if (!confirm("Supprimer définitivement ? Cette action est irréversible !")) return;
    try { await deleteDoc(doc(db, "locals", effectiveLocalId, "notes", n.id)); } catch {}
  };

  const emptyTrash = async () => {
    if (!user || !canSiprime || !effectiveLocalId) return;
    if (!confirm("Vider toute la corbeille ? Cette action est irréversible !")) return;
    for (const n of trash) {
      try { await deleteDoc(doc(db, "locals", effectiveLocalId, "notes", n.id)); } catch {}
    }
  };

  const filtered = search.trim()
    ? notes.filter((n) => n.contenu.toLowerCase().includes(search.toLowerCase()) || n.auteur.toLowerCase().includes(search.toLowerCase()))
    : notes;

  const groups: { date: string; items: Note[] }[] = [];
  for (const n of filtered) {
    const dateKey = fmtDate(n.createdAt);
    let g = groups.find((x) => x.date === dateKey);
    if (!g) { g = { date: dateKey, items: [] }; groups.push(g); }
    g.items.push(n);
  }

  if (user && needsStorePicker && !selectedStore) {
    return (
      <main style={{ position: "fixed", inset: 0, background: "#ECE5DD", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif", padding: "24px" }}>
        <div style={{ background: "#fff", borderRadius: "20px", padding: "28px", maxWidth: "380px", width: "100%", boxShadow: "0 10px 30px rgba(0,0,0,0.1)" }}>
          <p style={{ margin: "0 0 4px", fontWeight: 900, fontSize: "18px", color: "#1a1a2e" }}>📝 Notes</p>
          <p style={{ margin: "0 0 18px", fontSize: "13px", color: "#888" }}>Chwazi yon magazen pou wè nòt li yo</p>
          {loadingStores ? (
            <p style={{ textAlign: "center", color: "#999", fontSize: "13px" }}>Chajman magazen yo...</p>
          ) : stores.length === 0 ? (
            <p style={{ textAlign: "center", color: "#999", fontSize: "13px" }}>Pa gen magazen disponib</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {stores.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedStore(s.id)}
                  style={{ textAlign: "left", padding: "13px 16px", borderRadius: "12px", border: "1.5px solid #eee", background: "#f8f8f8", fontSize: "14px", fontWeight: 600, color: "#1a1a2e", cursor: "pointer", fontFamily: "inherit" }}
                >
                  🏬 {s.name}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => router.push("/dashboard")} style={{ marginTop: "16px", width: "100%", background: "none", border: "none", color: "#888", fontSize: "13px", cursor: "pointer" }}>
            ← Retounen nan dashboard
          </button>
        </div>
      </main>
    );
  }

  if (!user || loading) {
    return (
      <main style={{ position: "fixed", inset: 0, background: "#ECE5DD", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: "48px", height: "48px", border: "4px solid #eee", borderTop: "4px solid #075E54", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
          <p style={{ color: "#888", fontSize: "14px" }}>Chajman...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </main>
    );
  }

  return (
    <main style={{ position: "fixed", inset: 0, background: "#ECE5DD", fontFamily: "'Segoe UI', sans-serif", display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 10 }}>

      <div style={{ background: "#075E54", color: "#fff", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 10px rgba(0,0,0,0.15)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button onClick={() => router.push("/dashboard")} style={{ background: "none", border: "none", color: "#fff", fontSize: "20px", cursor: "pointer", padding: "4px" }}>←</button>
          {needsStorePicker && (
            <button onClick={() => setSelectedStore("")} title="Chanje magazen"
              style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: "11px", cursor: "pointer", padding: "4px 8px", borderRadius: "8px" }}>
              🏬 Chanje
            </button>
          )}
          {showSearch ? (
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une note..."
              style={{ background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: "15px", fontFamily: "inherit" }} />
          ) : (
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: "16px" }}>📝 Notes</p>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: isOnline ? "#25D366" : "orange", display: "inline-block" }} />
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.75)" }}>{isOnline ? `${notes.length} notes` : "Hors ligne — cache local"}</span>
              </div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearch(""); }}
            style={{ background: "none", border: "none", color: "#fff", fontSize: "18px", cursor: "pointer", padding: "4px" }}>
            {showSearch ? "✕" : "🔍"}
          </button>
          {canSiprime && (
            <button onClick={() => setShowTrash(true)} style={{ background: "none", border: "none", color: "#fff", fontSize: "18px", cursor: "pointer", padding: "4px", position: "relative" }}>
              🗑️
              {trash.length > 0 && (
                <span style={{ position: "absolute", top: "-2px", right: "-2px", background: "#e63946", color: "#fff", borderRadius: "50%", fontSize: "9px", width: "16px", height: "16px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                  {trash.length}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {!isOnline && (
        <div style={{ background: "#e67e22", color: "#fff", textAlign: "center", fontSize: "12px", padding: "5px", flexShrink: 0 }}>
          📵 Pas de connexion — Notes en cache affichées
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "12px", minHeight: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", marginTop: "40px" }}>
            <div style={{ display: "inline-block", background: "rgba(255,255,255,0.85)", borderRadius: "12px", padding: "12px 20px" }}>
              <p style={{ margin: 0, color: "#555", fontSize: "13px" }}>
                {search ? "Aucun résultat trouvé 🔍" : "Aucune note pour le moment\nÉcris ton premier message ! 👇"}
              </p>
            </div>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.date}>
              <div style={{ textAlign: "center", margin: "12px 0" }}>
                <span style={{ background: "rgba(220,248,198,0.9)", padding: "4px 12px", borderRadius: "12px", fontSize: "12px", color: "#555", fontWeight: 500 }}>
                  {g.date}
                </span>
              </div>
              {g.items.map((n) => {
                const isMe = n.auteur === user.displayName;
                const isPending = !!n.pending;
                return (
                  <div key={n.id} style={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start", marginBottom: "8px" }}>
                    <div
                      onDoubleClick={() => {
                        if (isPending || !canAjoute) return;
                        setReplyTo(n);
                      }}
                      style={{
                        maxWidth: "70%", background: isMe ? "#DCF8C6" : "#fff", borderRadius: "12px",
                        padding: "8px 12px 6px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", position: "relative",
                        opacity: isPending ? 0.65 : 1, border: isPending ? "1px solid #f0ad4e" : "none",
                      }}
                    >
                      {!isMe && <p style={{ margin: "0 0 4px", fontSize: "12px", fontWeight: 700, color: auteurColor(n.auteur) }}>{n.auteur}</p>}
                      {n.replyToId && (
                        <div style={{ background: "rgba(0,0,0,0.05)", borderLeft: `3px solid ${auteurColor(n.replyToAuteur || "")}`, borderRadius: "8px", padding: "4px 8px", marginBottom: "6px" }}>
                          <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, color: auteurColor(n.replyToAuteur || "") }}>{n.replyToAuteur}</p>
                          <p style={{ margin: 0, fontSize: "12px", color: "#666" }}>{n.replyToContenu}</p>
                        </div>
                      )}
                      <p style={{ margin: 0, fontSize: "14px", color: "#222", whiteSpace: "pre-wrap" }}>{n.contenu}</p>
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "4px", marginTop: "3px" }}>
                        {n.editedAt && <span style={{ fontSize: "9px", color: "#999", fontStyle: "italic" }}>modifié</span>}
                        <span style={{ fontSize: "10px", color: "#999" }}>{fmtTime(n.createdAt)}</span>
                        {isMe && <span style={{ fontSize: "11px" }}>{isPending ? "🕒" : "✓✓"}</span>}
                      </div>

                      {!isPending && (canModifye || canSiprime || canAjoute) && (
                        <div style={{ display: "flex", gap: "8px", marginTop: "6px", borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: "4px" }}>
                          {canAjoute && (
                            <button onClick={() => setReplyTo(n)} style={{ background: "none", border: "none", color: "#075E54", fontSize: "11px", cursor: "pointer", padding: 0 }}>↩ Répondre</button>
                          )}
                          {canModifye && (
                            <button onClick={() => { setEditingNote(n); setText(n.contenu); }} style={{ background: "none", border: "none", color: "#e67e22", fontSize: "11px", cursor: "pointer", padding: 0 }}>✏ Modifier</button>
                          )}
                          {canSiprime && (
                            <button onClick={() => moveToTrash(n)} style={{ background: "none", border: "none", color: "#e63946", fontSize: "11px", cursor: "pointer", padding: 0 }}>🗑 Supprimer</button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {replyTo && (
        <div style={{ background: "#e8e8e8", padding: "6px 12px", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <div style={{ width: "3px", height: "34px", background: "#075E54", borderRadius: "2px" }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: "12px", fontWeight: 700, color: "#075E54" }}>{replyTo.auteur}</p>
            <p style={{ margin: 0, fontSize: "12px", color: "#666", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{replyTo.contenu}</p>
          </div>
          <button onClick={() => setReplyTo(null)} style={{ background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: "16px" }}>✕</button>
        </div>
      )}

      {editingNote && (
        <div style={{ background: "#FFF9C4", padding: "6px 12px", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <span style={{ color: "#e67e22" }}>✏</span>
          <p style={{ flex: 1, margin: 0, fontSize: "12px", fontWeight: 700, color: "#e67e22" }}>Modification de la note...</p>
          <button onClick={() => { setEditingNote(null); setText(""); }} style={{ background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: "16px" }}>✕</button>
        </div>
      )}

      {canAjoute ? (
        <div style={{ background: "#F0F0F0", padding: "8px", display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={editingNote ? "Modifier la note..." : "Écris une note..."}
            style={{ flex: 1, borderRadius: "22px", border: "none", padding: "12px 16px", fontSize: "14px", outline: "none", fontFamily: "inherit" }}
          />
          <button onClick={handleSend} disabled={sending} style={{ width: "46px", height: "46px", borderRadius: "50%", background: "#075E54", border: "none", color: "#fff", fontSize: "18px", cursor: sending ? "not-allowed" : "pointer" }}>
            {editingNote ? "✓" : "➤"}
          </button>
        </div>
      ) : (
        <div style={{ background: "#F0F0F0", padding: "12px", textAlign: "center", color: "#999", fontSize: "12px", flexShrink: 0 }}>
          🔒 Ou pa gen pèmisyon pou ekri nòt
        </div>
      )}

      {showTrash && canSiprime && (
        <div onClick={() => setShowTrash(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 999 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#1A1D2E", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: "480px", maxHeight: "80vh", overflowY: "auto", padding: "16px" }}>
            <div style={{ width: "40px", height: "4px", background: "rgba(255,255,255,0.2)", borderRadius: "2px", margin: "0 auto 14px" }} />
            <p style={{ textAlign: "center", color: "#fff", fontWeight: 700, marginBottom: "12px" }}>🗑️ Corbeille ({trash.length})</p>
            {trash.length === 0 ? (
              <p style={{ textAlign: "center", color: "rgba(255,255,255,0.4)" }}>Corbeille vide</p>
            ) : (
              trash.map((n) => (
                <div key={n.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "rgba(230,57,70,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "#e63946", fontWeight: 700, flexShrink: 0 }}>
                    {n.auteur?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, color: "rgba(255,255,255,0.85)", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.contenu}</p>
                    <p style={{ margin: 0, color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>{n.auteur} • {fmtTime(n.deletedAt)}</p>
                  </div>
                  <button onClick={() => restoreNote(n)} style={{ background: "none", border: "none", color: "#4CAF50", fontSize: "18px", cursor: "pointer" }}>↺</button>
                  <button onClick={() => deleteForever(n)} style={{ background: "none", border: "none", color: "#e63946", fontSize: "18px", cursor: "pointer" }}>✕</button>
                </div>
              ))
            )}
            {trash.length > 0 && (
              <button onClick={emptyTrash} style={{ width: "100%", marginTop: "14px", padding: "12px", background: "transparent", border: "1px solid #e63946", color: "#e63946", borderRadius: "12px", fontWeight: 700, cursor: "pointer" }}>
                Vider toute la corbeille
              </button>
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } * { box-sizing: border-box; }`}</style>
    </main>
  );
}