"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { changeOwnPassword } from "../../../lib/auth-utils";

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface UserSession {
  uid: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  permissions: Record<string, boolean>;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function ParametresPage() {
  const router = useRouter();
  const [user, setUser]       = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack]     = useState<{ msg: string; color: string } | null>(null);
  const [showPassModal, setShowPassModal] = useState(false);

  // ─── AUTH ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const s = JSON.parse(raw) as UserSession;
      if (!s.uid) {
        // ✅ Ancienne session (avant la restructuration par UID) — forcer
        // une reconnexion.
        localStorage.removeItem("ms_web_user"); router.push("/login"); return;
      }
      setUser(s);
      setLoading(false);
    } catch { router.push("/login"); }
  }, [router]);

  const showSnack = (msg: string, color: string) => {
    setSnack({ msg, color });
    setTimeout(() => setSnack(null), 2500);
  };

  if (loading || !user) return (
    <main style={{ minHeight:"100vh", background:"#0F1117", display:"flex",
      alignItems:"center", justifyContent:"center", fontFamily:"'Segoe UI',sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:48, height:48, border:"4px solid #333",
          borderTop:"4px solid orange", borderRadius:"50%",
          animation:"spin 1s linear infinite", margin:"0 auto 16px" }}/>
        <p style={{ color:"#888" }}>Chargement...</p>
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
          ← Retour
        </button>
        <h1 style={{ margin:0, fontSize:20, fontWeight:700 }}>Paramètres</h1>
      </div>

      <div style={{ maxWidth:700, margin:"0 auto", padding:"24px 16px" }}>

        {/* ═══ MON COMPTE ═══ */}
        <Card>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:16 }}>
            <div style={{ width:48, height:48, borderRadius:"50%",
              background:"rgba(255,165,0,0.15)", display:"flex",
              alignItems:"center", justifyContent:"center",
              color:"orange", fontWeight:700, fontSize:20 }}>
              {user.displayName?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div>
              <p style={{ margin:0, fontWeight:700, fontSize:15 }}>{user.displayName}</p>
              <p style={{ margin:0, color:"#888", fontSize:12 }}>
                {user.isAdmin ? "👑 Administrateur" : "👤 Utilisateur"}
              </p>
            </div>
          </div>
          <button onClick={() => setShowPassModal(true)}
            style={{ width:"100%", padding:"12px", background:"none",
              border:"1px solid orange", color:"orange", borderRadius:12,
              cursor:"pointer", fontSize:14, fontWeight:600 }}>
            🔒 Changer le mot de passe
          </button>
        </Card>

        {/* Footer */}
        <p style={{ textAlign:"center", color:"#333", fontSize:11, marginTop:24 }}>
          MillionStore V2 • {new Date().getFullYear()}
        </p>
      </div>

      {/* ═══ MODAL: CHANGER MOT DE PASSE ═══ */}
      {showPassModal && (
        <ChangePasswordModal
          onClose={() => setShowPassModal(false)}
          onSuccess={() => { setShowPassModal(false); showSnack("✅ Mot de passe changé !", "#00C853"); }}
          onError={msg => showSnack(msg, "#ff4444")}
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

// ─── CHANGE PASSWORD MODAL — ✅ Firebase gère le changement directement
// (avec ré-authentification) — plus de hachage personnalisé. ─────────────
function ChangePasswordModal({ onClose, onSuccess, onError }: {
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
    if (!oldPass || !newPass || !confPass) { onError("Remplissez tous les champs !"); return; }
    if (newPass !== confPass) { onError("Les nouveaux mots de passe ne correspondent pas !"); return; }
    if (newPass.length < 6) { onError("Le mot de passe doit contenir au moins 6 caractères !"); return; }
    setLoading(true);
    const result = await changeOwnPassword(oldPass, newPass);
    setLoading(false);
    if (result.success) {
      onSuccess();
    } else {
      onError(result.message ?? "Erreur. Veuillez réessayer.");
    }
  };

  return (
    <Modal title="🔒 Changer le mot de passe" onClose={onClose}>
      <PassField label="Ancien mot de passe" value={oldPass} show={showOld}
        onChange={setOldPass} onToggle={() => setShowOld(p => !p)} />
      <PassField label="Nouveau mot de passe" value={newPass} show={showNew}
        onChange={setNewPass} onToggle={() => setShowNew(p => !p)} />
      <PassField label="Confirmer le nouveau mot de passe" value={confPass} show={showNew}
        onChange={setConfPass} onToggle={() => {}} />
      <div style={{ display:"flex", gap:8, marginTop:16 }}>
        <button onClick={onClose} style={btnSecondary}>Annuler</button>
        <button onClick={handle} disabled={loading} style={btnOrange}>
          {loading ? "⏳..." : "Changer"}
        </button>
      </div>
    </Modal>
  );
}

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background:"#1A1D2E", borderRadius:16, padding:16, marginBottom:8 }}>
      {children}
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