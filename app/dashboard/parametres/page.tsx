"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import {
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, onSnapshot,
} from "firebase/firestore";
import { createHash } from "crypto";

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface UserSession {
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  permissions: Record<string, boolean>;
}

interface StoreInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  nb: string;
}

interface AppUser {
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  isBlocked?: boolean;
}

interface Local {
  id: string;
  name: string;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function hashPassword(p: string) {
  return createHash("sha256").update(p + "_millionstore_2024_sel").digest("hex");
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function ParametresPage() {
  const router = useRouter();
  const [user, setUser]       = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack]     = useState<{ msg: string; color: string } | null>(null);

  // Store info
  const [store, setStore] = useState<StoreInfo>({
    name:"", address:"", phone:"", email:"", nb:"",
  });

  // Preferans
  const [devise, setDevise]   = useState("$");
  const [taux, setTaux]       = useState(1);
  const [taxPct, setTaxPct]   = useState(0);

  // Itilizatè
  const [users, setUsers]     = useState<AppUser[]>([]);
  const [locals, setLocals]   = useState<Local[]>([]);

  // Modals
  const [showPassModal, setShowPassModal]   = useState(false);
  const [showAddUser, setShowAddUser]       = useState(false);
  const [deleteUserTarget, setDeleteUserTarget] = useState<AppUser | null>(null);
  const [resetTarget, setResetTarget]       = useState<{ title: string; fn: () => void } | null>(null);

  // ─── AUTH ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const s = JSON.parse(raw) as UserSession;
      if (!s.isAdmin && !s.permissions?.parametreVoir) {
        router.push("/dashboard"); return;
      }
      setUser(s);
    } catch { router.push("/login"); }
  }, [router]);

  // ─── LOAD ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    // Store info
    const unsub = onSnapshot(doc(db, "parametres", "store_info"), snap => {
      if (snap.exists()) {
        try {
          const j = JSON.parse(snap.data()?.json ?? "{}");
          setStore({
            name:    j.name    ?? "",
            address: j.address ?? "",
            phone:   j.phone   ?? "",
            email:   j.email   ?? "",
            nb:      j.nb      ?? "",
          });
        } catch {}
      }
    });

    // Taux
    getDoc(doc(db, "parametres", "taux")).then(snap => {
      if (snap.exists()) {
        const t = snap.data()?.taux;
        if (t) setTaux(Number(t));
      }
    });

    // Users
    getDocs(collection(db, "users")).then(snap => {
      const list: AppUser[] = [];
      snap.forEach(d => {
        const data = d.data();
        list.push({
          username:    data.username ?? d.id,
          displayName: data.displayName ?? d.id,
          isAdmin:     data.isAdmin ?? false,
          localId:     data.localId ?? "all",
          isBlocked:   data.isBlocked ?? false,
        });
      });
      setUsers(list);
    });

    // Locals
    getDocs(collection(db, "locals")).then(snap => {
      const list: Local[] = [];
      snap.forEach(d => {
        const data = d.data();
        if (d.id !== "all") {
          list.push({ id: d.id, name: data.name ?? d.id });
        }
      });
      setLocals(list);
    });

    setLoading(false);
    return () => unsub();
  }, [user]);

  // ─── SNACK ─────────────────────────────────────────────────────────────
  const showSnack = (msg: string, color: string) => {
    setSnack({ msg, color });
    setTimeout(() => setSnack(null), 2500);
  };

  // ─── SAVE STORE ────────────────────────────────────────────────────────
  const saveStore = async () => {
    if (!user?.isAdmin) { showSnack("Sèlman admin ka modifye info magazen!", "#ff4444"); return; }
    const j = JSON.stringify(store);
    await setDoc(doc(db, "parametres", "store_info"), { json: j });
    showSnack("✅ Info magazen sove!", "#00C853");
  };

  // ─── SAVE PREFS ────────────────────────────────────────────────────────
  const savePrefs = async () => {
    if (!user?.isAdmin) { showSnack("Sèlman admin ka modifye preferans!", "#ff4444"); return; }
    await setDoc(doc(db, "parametres", "taux"), { taux, devise, taxPct });
    showSnack("✅ Preferans sove!", "#00C853");
  };

  const getLocalName = (localId: string) => {
    if (localId === "all") return "Tout Lokal";
    return locals.find(l => l.id === localId)?.name ?? localId;
  };

  if (loading || !user) return (
    <main style={{ minHeight:"100vh", background:"#0F1117", display:"flex",
      alignItems:"center", justifyContent:"center", fontFamily:"'Segoe UI',sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:48, height:48, border:"4px solid #333",
          borderTop:"4px solid orange", borderRadius:"50%",
          animation:"spin 1s linear infinite", margin:"0 auto 16px" }}/>
        <p style={{ color:"#888" }}>Chajman...</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </main>
  );

  return (
    <main style={{ minHeight:"100vh", background:"#0F1117",
      fontFamily:"'Segoe UI',sans-serif", color:"#fff" }}>

      {/* ── HEADER ── */}
      <div style={{ background:"#1A1D2E", borderBottom:"1px solid #333",
        padding:"14px 20px", display:"flex", alignItems:"center", gap:12,
        position:"sticky", top:0, zIndex:100 }}>
        <button onClick={() => router.push("/dashboard")}
          style={{ background:"#0F1117", border:"none", color:"#aaa",
            padding:"8px 14px", borderRadius:10, cursor:"pointer", fontSize:13 }}>
          ← Retounen
        </button>
        <h1 style={{ margin:0, fontSize:20, fontWeight:700 }}>Paramèt</h1>
      </div>

      <div style={{ maxWidth:700, margin:"0 auto", padding:"24px 16px" }}>

        {/* ═══ INFO MAGAZEN ═══ */}
        <SectionHeader icon="🏪" title="Info Magazen" />
        <Card>
          {(["name","address","phone","email"] as const).map(k => (
            <Field key={k}
              label={k==="name"?"Non Magazen":k==="address"?"Adrès":k==="phone"?"Telefòn":"Email"}
              value={store[k]}
              readOnly={!user.isAdmin}
              onChange={v => setStore(p => ({ ...p, [k]: v }))}
            />
          ))}
          <div style={{ marginBottom:8 }}>
            <p style={{ margin:"0 0 6px", color:"orange", fontSize:12, fontWeight:700 }}>
              🔐 Note / Garanti (parèt sou fich)
            </p>
            <textarea
              value={store.nb}
              readOnly={!user.isAdmin}
              onChange={e => setStore(p => ({ ...p, nb: e.target.value }))}
              rows={4}
              style={{ width:"100%", background: user.isAdmin ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)",
                border:"1px solid #333", borderRadius:12, color: user.isAdmin ? "#fff" : "#555",
                fontSize:14, padding:"12px 14px", resize:"vertical",
                fontFamily:"'Segoe UI',sans-serif", boxSizing:"border-box" }}
            />
          </div>
          {user.isAdmin && (
            <button onClick={saveStore} style={btnOrange}>Sove Info</button>
          )}
        </Card>

        {/* ═══ PREFERANS ═══ */}
        <SectionHeader icon="⚙️" title="Preferans" />
        <Card>
          {/* Devise */}
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
            <span style={{ color:"#888", fontSize:14 }}>💰 Devise:</span>
            {["$","HTG"].map(d => (
              <button key={d} onClick={() => user.isAdmin && setDevise(d)}
                style={{ padding:"6px 18px", borderRadius:20, border:"none",
                  background: devise===d ? "orange" : "rgba(255,255,255,0.06)",
                  color: devise===d ? "#fff" : "#888",
                  cursor: user.isAdmin ? "pointer" : "default",
                  fontWeight:700, fontSize:14 }}>
                {d}
              </button>
            ))}
          </div>

          {/* Taux */}
          {devise === "HTG" && (
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
              <span style={{ color:"#888", fontSize:14 }}>💱 1$ =</span>
              <input type="number" value={taux}
                readOnly={!user.isAdmin}
                onChange={e => setTaux(Number(e.target.value))}
                style={{ width:90, ...fieldStyle(user.isAdmin) }}
              />
              <span style={{ color:"#888", fontSize:13 }}>HTG</span>
            </div>
          )}

          {/* Tax */}
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
            <span style={{ color:"#888", fontSize:14 }}>📊 Tax %:</span>
            <input type="number" value={taxPct}
              readOnly={!user.isAdmin}
              onChange={e => setTaxPct(Number(e.target.value))}
              style={{ width:90, ...fieldStyle(user.isAdmin) }}
            />
            <span style={{ color:"#888", fontSize:13 }}>%</span>
          </div>

          {user.isAdmin && (
            <button onClick={savePrefs} style={btnOrange}>Sove Preferans</button>
          )}
        </Card>

        {/* ═══ KONT MWEN ═══ */}
        <SectionHeader icon="👤" title="Kont Mwen" />
        <Card>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:16 }}>
            <div style={{ width:48, height:48, borderRadius:"50%",
              background:"rgba(255,165,0,0.15)", display:"flex",
              alignItems:"center", justifyContent:"center",
              color:"orange", fontWeight:700, fontSize:20 }}>
              {user.displayName[0]?.toUpperCase()}
            </div>
            <div>
              <p style={{ margin:0, fontWeight:700, fontSize:15 }}>{user.displayName}</p>
              <p style={{ margin:0, color:"#888", fontSize:12 }}>
                {user.isAdmin ? "👑 Administrateur" : "👤 Itilizatè"}
              </p>
            </div>
          </div>
          <button onClick={() => setShowPassModal(true)}
            style={{ width:"100%", padding:"12px", background:"none",
              border:"1px solid orange", color:"orange", borderRadius:12,
              cursor:"pointer", fontSize:14, fontWeight:600 }}>
            🔒 Chanje Modpas
          </button>
        </Card>

        {/* ═══ ITILIZATÈ (admin sèlman) ═══ */}
        {user.isAdmin && (
          <>
            <SectionHeader icon="👥" title="Itilizatè" />
            <Card>
              {users.map(u => (
                <div key={u.username} style={{ display:"flex", alignItems:"center",
                  gap:12, padding:"10px 0", borderBottom:"1px solid #1e1e2e" }}>
                  <div style={{ width:36, height:36, borderRadius:"50%",
                    background:"rgba(255,165,0,0.15)", display:"flex",
                    alignItems:"center", justifyContent:"center",
                    color:"orange", fontWeight:700 }}>
                    {u.username[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex:1 }}>
                    <p style={{ margin:0, fontWeight:600, fontSize:13 }}>{u.username}</p>
                    <p style={{ margin:0, color:"#555", fontSize:11 }}>
                      {u.isAdmin ? "👑 Admin" : "👤 Itilizatè"} • {getLocalName(u.localId)}
                    </p>
                  </div>
                  {u.username !== user.username && (
                    <button onClick={() => setDeleteUserTarget(u)}
                      style={{ background:"rgba(255,0,0,0.1)", border:"none",
                        color:"#ff4444", width:32, height:32, borderRadius:"50%",
                        cursor:"pointer", fontSize:14 }}>
                      🗑
                    </button>
                  )}
                </div>
              ))}
              <button onClick={() => setShowAddUser(true)}
                style={{ width:"100%", marginTop:14, padding:"12px",
                  background:"none", border:"1px solid orange", color:"orange",
                  borderRadius:12, cursor:"pointer", fontSize:14, fontWeight:600 }}>
                + Ajoute Itilizatè
              </button>
            </Card>
          </>
        )}

        {/* ═══ ZÒN ADMIN ═══ */}
        {user.isAdmin && (
          <>
            <SectionHeader icon="🛡️" title="Zòn Admin" />
            <div style={{ background:"#1a0000", border:"1px solid #ff000033",
              borderRadius:16, padding:16, marginBottom:24 }}>
              <div style={{ background:"rgba(255,0,0,0.08)", border:"1px solid rgba(255,0,0,0.2)",
                borderRadius:10, padding:10, marginBottom:16,
                display:"flex", gap:8, alignItems:"flex-start" }}>
                <span>⚠️</span>
                <p style={{ margin:0, color:"#ff4444", fontSize:12 }}>
                  Aksyon yo irevezibl. Itilize avèk prekosyon!
                </p>
              </div>
              {[
                { label:"Efase Tout Pwodwi",   icon:"📦", col:"locals", sub:"products" },
                { label:"Efase Tout Kliyan",   icon:"👥", col:"locals", sub:"clients" },
                { label:"Efase Tout Facture",  icon:"🧾", col:"locals", sub:"factures" },
                { label:"Efase Tout Vendeur",  icon:"👤", col:"locals", sub:"vendeurs" },
                { label:"Efase Tout Nòt",      icon:"📝", col:"locals", sub:"notes" },
                { label:"Efase Tout Dealers",  icon:"🤝", col:"locals", sub:"fournisseurs" },
              ].map(item => (
                <button key={item.label}
                  onClick={() => setResetTarget({
                    title: item.label,
                    fn: async () => {
                      const snap = await getDocs(collection(db, item.col, user.localId === "all" ? "all" : user.localId, item.sub));
                      for (const d of snap.docs) await deleteDoc(d.ref);
                      showSnack(`✅ ${item.label} fèt!`, "#00C853");
                    }
                  })}
                  style={{ width:"100%", marginBottom:8, padding:"12px",
                    background:"none", border:"1px solid #ff000066",
                    color:"#ff4444", borderRadius:10, cursor:"pointer",
                    fontSize:13, textAlign:"left", display:"flex", gap:8 }}>
                  {item.icon} {item.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Footer */}
        <p style={{ textAlign:"center", color:"#333", fontSize:11, marginTop:8 }}>
          MillionStore V2 • {new Date().getFullYear()}
        </p>
      </div>

      {/* ═══ MODAL: CHANJE MODPAS ═══ */}
      {showPassModal && (
        <ChangePasswordModal
          username={user.username}
          onClose={() => setShowPassModal(false)}
          onSuccess={() => { setShowPassModal(false); showSnack("✅ Modpas chanje!", "#00C853"); }}
          onError={msg => showSnack(msg, "#ff4444")}
        />
      )}

      {/* ═══ MODAL: AJOUTE ITILIZATÈ ═══ */}
      {showAddUser && (
        <AddUserModal
          locals={locals}
          onClose={() => setShowAddUser(false)}
          onSuccess={async () => {
            setShowAddUser(false);
            showSnack("✅ Itilizatè kreye!", "#00C853");
            const snap = await getDocs(collection(db, "users"));
            const list: AppUser[] = [];
            snap.forEach(d => {
              const data = d.data();
              list.push({ username: data.username ?? d.id, displayName: data.displayName ?? d.id,
                isAdmin: data.isAdmin ?? false, localId: data.localId ?? "all" });
            });
            setUsers(list);
          }}
          onError={msg => showSnack(msg, "#ff4444")}
        />
      )}

      {/* ═══ MODAL: KONFIME EFASE ITILIZATÈ ═══ */}
      {deleteUserTarget && (
        <ConfirmModal
          title="Efase Itilizatè?"
          message={deleteUserTarget.username}
          onClose={() => setDeleteUserTarget(null)}
          onConfirm={async () => {
            await deleteDoc(doc(db, "users", deleteUserTarget.username));
            setUsers(p => p.filter(u => u.username !== deleteUserTarget.username));
            setDeleteUserTarget(null);
            showSnack("✅ Itilizatè efase!", "#00C853");
          }}
        />
      )}

      {/* ═══ MODAL: KONFIME RESET ═══ */}
      {resetTarget && (
        <ConfirmModal
          title={resetTarget.title}
          message="Aksyon sa irevezibl!"
          confirmLabel="Konfime"
          confirmColor="#ff4444"
          onClose={() => setResetTarget(null)}
          onConfirm={async () => {
            await resetTarget.fn();
            setResetTarget(null);
          }}
        />
      )}

      {/* ═══ SNACK ═══ */}
      {snack && (
        <div style={{ position:"fixed", bottom:24, left:"50%",
          transform:"translateX(-50%)", background:snack.color,
          color:"#fff", padding:"12px 24px", borderRadius:12,
          fontWeight:600, fontSize:14, zIndex:999,
          boxShadow:"0 4px 20px rgba(0,0,0,0.3)" }}>
          {snack.msg}
        </div>
      )}
    </main>
  );
}

// ─── CHANGE PASSWORD MODAL ───────────────────────────────────────────────────
function ChangePasswordModal({ username, onClose, onSuccess, onError }: {
  username: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [oldPass, setOldPass]   = useState("");
  const [newPass, setNewPass]   = useState("");
  const [confPass, setConfPass] = useState("");
  const [loading, setLoading]   = useState(false);
  const [showOld, setShowOld]   = useState(false);
  const [showNew, setShowNew]   = useState(false);

  const handle = async () => {
    if (!oldPass || !newPass || !confPass) { onError("Ranpli tout champ yo!"); return; }
    if (newPass !== confPass) { onError("Nouvo modpas pa matche!"); return; }
    if (newPass.length < 4) { onError("Modpas dwe gen omwen 4 karaktè!"); return; }
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, "users", username));
      if (!snap.exists()) { onError("Itilizatè pa jwenn!"); setLoading(false); return; }
      const stored = snap.data().password ?? "";
      const hash = createHash("sha256").update(oldPass + "_millionstore_2024_sel").digest("hex");
      const valid = stored.length === 64 ? hash === stored : oldPass === stored;
      if (!valid) { onError("Vye modpas la pa kòrèk!"); setLoading(false); return; }
      const newHash = createHash("sha256").update(newPass + "_millionstore_2024_sel").digest("hex");
      await setDoc(doc(db, "users", username), { password: newHash }, { merge: true });
      onSuccess();
    } catch (e) {
      onError("Erè: " + e);
    }
    setLoading(false);
  };

  return (
    <Modal title="🔒 Chanje Modpas" onClose={onClose}>
      <PassField label="Vye Modpas" value={oldPass} show={showOld}
        onChange={setOldPass} onToggle={() => setShowOld(p => !p)} />
      <PassField label="Nouvo Modpas" value={newPass} show={showNew}
        onChange={setNewPass} onToggle={() => setShowNew(p => !p)} />
      <PassField label="Konfime Nouvo Modpas" value={confPass} show={showNew}
        onChange={setConfPass} onToggle={() => {}} />
      <div style={{ display:"flex", gap:8, marginTop:16 }}>
        <button onClick={onClose} style={btnSecondary}>Anile</button>
        <button onClick={handle} disabled={loading} style={btnOrange}>
          {loading ? "⏳..." : "Chanje"}
        </button>
      </div>
    </Modal>
  );
}

// ─── ADD USER MODAL ──────────────────────────────────────────────────────────
function AddUserModal({ locals, onClose, onSuccess, onError }: {
  locals: Local[];
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin]   = useState(false);
  const [localId, setLocalId]   = useState(locals[0]?.id ?? "all");
  const [loading, setLoading]   = useState(false);

  const DEFAULT_PERMISSIONS = {
    produitVoir: true, produitAjoute: false, produitModifye: false,
    produitSiprime: false, produitChangePrix: false,
    factureVoir: false, factureCreye: false, factureVoirIstwa: false,
    factureAnile: false, factureSiprime: false, factureModifye: false,
    clientVoir: false, clientAjoute: false, clientModifye: false, clientSiprime: false,
    rapportVoir: false, vendeurVoir: true, parametreVoir: true,
    noteVoir: true, noteAjoute: true,
  };

  const handle = async () => {
    if (!username.trim() || !password.trim()) { onError("Ranpli tout champ yo!"); return; }
    setLoading(true);
    try {
      const existing = await getDoc(doc(db, "users", username.trim()));
      if (existing.exists()) { onError("Non itilizatè sa deja pran!"); setLoading(false); return; }
      const hash = createHash("sha256").update(password + "_millionstore_2024_sel").digest("hex");
      await setDoc(doc(db, "users", username.trim()), {
        username: username.trim(),
        displayName: username.trim(),
        password: hash,
        isAdmin,
        isBlocked: false,
        loginAttempts: 0,
        localId: isAdmin ? "all" : localId,
        createdAt: new Date().toISOString(),
        createdFrom: "web",
        ...DEFAULT_PERMISSIONS,
      });
      onSuccess();
    } catch (e) { onError("Erè: " + e); }
    setLoading(false);
  };

  return (
    <Modal title="👤 Ajoute Itilizatè" onClose={onClose}>
      <Field label="Non itilizatè" value={username} onChange={setUsername} />
      <Field label="Modpas" value={password} onChange={setPassword} type="password" />
      {locals.length > 0 && (
        <div style={{ marginBottom:12 }}>
          <label style={{ color:"#888", fontSize:12, display:"block", marginBottom:6 }}>Lokal</label>
          <select value={localId} onChange={e => setLocalId(e.target.value)}
            style={{ width:"100%", padding:"12px", background:"rgba(255,255,255,0.06)",
              border:"1px solid #333", borderRadius:12, color:"#fff", fontSize:14 }}>
            <option value="all">Tout Lokal (Admin)</option>
            {locals.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
        <span style={{ color:"#888", fontSize:14 }}>Administrateur</span>
        <div onClick={() => setIsAdmin(p => !p)}
          style={{ width:44, height:24, borderRadius:12, cursor:"pointer",
            background: isAdmin ? "orange" : "#333", position:"relative",
            transition:"background 0.2s" }}>
          <div style={{ position:"absolute", top:2,
            left: isAdmin ? 22 : 2, width:20, height:20,
            borderRadius:"50%", background:"#fff", transition:"left 0.2s" }}/>
        </div>
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={onClose} style={btnSecondary}>Anile</button>
        <button onClick={handle} disabled={loading} style={btnOrange}>
          {loading ? "⏳..." : "Kreye"}
        </button>
      </div>
    </Modal>
  );
}

// ─── CONFIRM MODAL ───────────────────────────────────────────────────────────
function ConfirmModal({ title, message, confirmLabel="Wi, Efase", confirmColor="#ff4444", onClose, onConfirm }: {
  title: string; message: string;
  confirmLabel?: string; confirmColor?: string;
  onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ color:"#888", margin:"0 0 16px" }}>{message}</p>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={onClose} style={btnSecondary}>Anile</button>
        <button onClick={onConfirm}
          style={{ ...btnOrange, background:confirmColor }}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8,
      margin:"24px 0 10px", color:"orange" }}>
      <span>{icon}</span>
      <span style={{ fontWeight:700, fontSize:14 }}>{title}</span>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background:"#1A1D2E", borderRadius:16, padding:16, marginBottom:8 }}>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, readOnly=false, type="text" }: {
  label: string; value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean; type?: string;
}) {
  return (
    <div style={{ marginBottom:12 }}>
      <input type={type} value={value} readOnly={readOnly}
        onChange={e => onChange?.(e.target.value)}
        placeholder={label}
        style={{ width:"100%", ...fieldStyle(!readOnly), boxSizing:"border-box" as const }}
      />
    </div>
  );
}

function PassField({ label, value, show, onChange, onToggle }: {
  label: string; value: string; show: boolean;
  onChange: (v: string) => void; onToggle: () => void;
}) {
  return (
    <div style={{ position:"relative", marginBottom:12 }}>
      <input type={show ? "text" : "password"} value={value}
        onChange={e => onChange(e.target.value)} placeholder={label}
        style={{ width:"100%", ...fieldStyle(true), boxSizing:"border-box" as const, paddingRight:44 }}
      />
      <button onClick={onToggle} style={{ position:"absolute", right:12,
        top:"50%", transform:"translateY(-50%)", background:"none",
        border:"none", cursor:"pointer", color:"#888", fontSize:16 }}>
        {show ? "🙈" : "👁️"}
      </button>
    </div>
  );
}

function Modal({ title, children, onClose }: {
  title: string; children: React.ReactNode; onClose: () => void;
}) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)",
      zIndex:300, display:"flex", alignItems:"center", justifyContent:"center",
      padding:20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:"#1A1D2E", borderRadius:20, padding:24,
          width:"100%", maxWidth:420, boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>
        <h2 style={{ margin:"0 0 20px", fontSize:18, fontWeight:700 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const fieldStyle = (editable: boolean): React.CSSProperties => ({
  padding:"12px 14px",
  background: editable ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)",
  border:"1px solid #333", borderRadius:12,
  color: editable ? "#fff" : "#555", fontSize:14, outline:"none",
  fontFamily:"'Segoe UI',sans-serif",
});

const btnOrange: React.CSSProperties = {
  flex:1, padding:"12px", background:"orange", border:"none",
  color:"#fff", borderRadius:12, cursor:"pointer", fontSize:14, fontWeight:700,
};

const btnSecondary: React.CSSProperties = {
  flex:1, padding:"12px", background:"rgba(255,255,255,0.06)",
  border:"1px solid #333", color:"#aaa", borderRadius:12,
  cursor:"pointer", fontSize:14,
};