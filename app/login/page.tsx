"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { db, auth } from "../../lib/firebase";
import { doc, getDoc, setDoc, writeBatch } from "firebase/firestore";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  deleteUser,
  signOut,
} from "firebase/auth";
import { touchPresence, DEFAULT_PERMISSIONS, DEFAULT_LOCAL_ID } from "../../lib/auth-utils";

// ══════════════════════════════════════════════════════════════════════════
// RESET PASSWORD MODAL — ✅ Firebase envoie directement un lien sécurisé
// à la vraie adresse email. Plus de questions de sécurité, plus de code
// personnalisé.
// ══════════════════════════════════════════════════════════════════════════
function ResetPasswordModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");

  const isValidEmail = (e: string) => /^[\w.\-+]+@[\w-]+\.[\w.-]+$/.test(e.trim());

  const sendResetLink = async () => {
    setError(""); setSuccess("");
    const trimmed = email.trim();
    if (!trimmed) { setError("Entrez votre adresse email."); return; }
    if (!isValidEmail(trimmed)) { setError("Adresse email invalide."); return; }

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, trimmed);
      setSuccess(`✅ Un lien de réinitialisation a été envoyé à ${trimmed}. Vérifiez votre boîte de réception (et vos spams).`);
    } catch (e: any) {
      setError(e?.code === "auth/user-not-found" ? "Aucun compte associé à cet email." : "Erreur. Veuillez réessayer.");
    }
    setLoading(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "24px 24px 0 0", width: "100%", maxWidth: "480px", maxHeight: "92vh", overflowY: "auto", paddingBottom: "40px" }}>
        <div style={{ width: "40px", height: "4px", background: "#e0e0e0", borderRadius: "2px", margin: "12px auto 0" }} />
        <div style={{ padding: "16px 18px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "17px", fontWeight: 900, color: "#1a1a2e" }}>🔐 Mot de passe oublié</p>
              <p style={{ margin: "3px 0 0", fontSize: "11px", color: "#888" }}>
                Entrez votre email, nous vous enverrons un lien
              </p>
            </div>
            <button onClick={onClose} style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#f1f1f1", border: "none", fontSize: "16px", cursor: "pointer" }}>×</button>
          </div>

          {error   && <div style={{ background: "#fff0f0", color: "#e63946", padding: "10px 12px", borderRadius: "10px", fontSize: "12px", marginBottom: "14px", textAlign: "center" }}>{error}</div>}
          {success && <div style={{ background: "#e8fdf0", color: "#1a9e6e", padding: "10px 12px", borderRadius: "10px", fontSize: "13px", marginBottom: "14px", textAlign: "center", fontWeight: 700 }}>{success}</div>}

          <p style={{ margin: "0 0 5px", fontSize: "11px", fontWeight: 700, color: "#888", letterSpacing: "0.06em" }}>EMAIL</p>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="jean.pierre@gmail.com"
            onKeyDown={(e) => e.key === "Enter" && sendResetLink()}
            style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e8e8e8", borderRadius: "12px", fontSize: "14px", outline: "none", fontFamily: "inherit", color: "#333", boxSizing: "border-box", marginBottom: "18px" }} />

          <button onClick={sendResetLink} disabled={loading} style={{ width: "100%", padding: "15px", background: loading ? "#888" : "#1a1a2e", color: "#fff", border: "none", borderRadius: "14px", fontSize: "14px", fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
            {loading ? "⏳ Envoi..." : "📩 Envoyer le lien de réinitialisation"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// REGISTER MODAL — ✅ Une seule étape, vrai email, aucune question de
// sécurité. Firebase Auth gère le mot de passe réel directement.
// ══════════════════════════════════════════════════════════════════════════
function RegisterModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [nomComplet, setNomComplet]           = useState("");
  const [username, setUsername]               = useState("");
  const [email, setEmail]                     = useState("");
  const [telephone, setTelephone]             = useState("");
  const [password, setPassword]               = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass]               = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState("");

  const isValidEmail = (e: string) => /^[\w.\-+]+@[\w-]+\.[\w.-]+$/.test(e.trim());

  const submit = async () => {
    setError("");
    if (!nomComplet.trim() || !username.trim() || !email.trim() || !telephone.trim() || !password.trim()) {
      setError("Tous les champs sont obligatoires."); return;
    }
    if (!isValidEmail(email)) { setError("Adresse email invalide."); return; }
    if (password.length < 6) { setError("Le mot de passe doit contenir au moins 6 caractères."); return; }
    if (password !== confirmPassword) { setError("Les mots de passe ne correspondent pas."); return; }
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username.trim())) {
      setError("Nom d'utilisateur : 3 à 30 caractères (lettres, chiffres, . _ -), sans espace."); return;
    }

    setLoading(true);
    try {
      const usernameTrim = username.trim();
      const emailTrim    = email.trim();

      // ✅ Verifye si non itilizatè a pran deja (yon sèl fich, pa tout lis la)
      const usernameKey = usernameTrim.toLowerCase();
      const takenSnap = await getDoc(doc(db, "usernames", usernameKey));
      if (takenSnap.exists()) {
        setError("Ce nom d'utilisateur est déjà pris. Choisissez-en un autre.");
        setLoading(false);
        return;
      }

      // ✅ Kreye kont Firebase Auth
      let uid: string;
      try {
        const cred = await createUserWithEmailAndPassword(auth, emailTrim, password);
        uid = cred.user.uid;
      } catch (e: any) {
        const msg =
          e?.code === "auth/email-already-in-use" ? "Cette adresse email est déjà utilisée." :
          e?.code === "auth/invalid-email"         ? "Adresse email invalide." :
          e?.code === "auth/weak-password"         ? "Le mot de passe est trop faible." :
          "Erreur lors de la création du compte.";
        setError(msg);
        setLoading(false);
        return;
      }

      const newUser = {
        uid,
        username:    usernameTrim,
        email:       emailTrim,
        displayName: nomComplet.trim(),
        telephone:   telephone.trim(),
        isAdmin:     false,
        isBlocked:   false,
        localId:     DEFAULT_LOCAL_ID,
        ...DEFAULT_PERMISSIONS,
        createdAt:   new Date().toISOString(),
      };

      try {
        const batch = writeBatch(db);
        batch.set(doc(db, "users", uid), newUser);
        batch.set(doc(db, "usernames", usernameKey), { uid });
        await batch.commit();
      } catch (e) {
        // Si Firestore echwe, efase kont Auth la pou pa kite l trennen
        try { if (auth.currentUser) await deleteUser(auth.currentUser); } catch {}
        throw e;
      }

      onSuccess();
      onClose();
    } catch (e: any) {
      setError("Erreur : " + (e?.message ?? e));
    }
    setLoading(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "24px 24px 0 0", width: "100%", maxWidth: "480px", maxHeight: "93vh", overflowY: "auto", paddingBottom: "40px" }}>
        <div style={{ width: "40px", height: "4px", background: "#e0e0e0", borderRadius: "2px", margin: "12px auto 0" }} />

        <div style={{ padding: "14px 18px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 900, color: "#1a1a2e" }}>🆕 Créer un compte</h3>
              <p style={{ margin: "3px 0 0", fontSize: "11px", color: "#888" }}>Vos informations</p>
            </div>
            <button onClick={onClose} style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#f1f1f1", border: "none", fontSize: "16px", cursor: "pointer" }}>×</button>
          </div>

          {error && <div style={{ background: "#fff0f0", color: "#e63946", padding: "10px 12px", borderRadius: "10px", fontSize: "12px", marginBottom: "12px", textAlign: "center" }}>{error}</div>}

          {[
            { label: "NOM COMPLET *", val: nomComplet, set: setNomComplet, ph: "Jean Pierre", type: "text" },
            { label: "NOM D'UTILISATEUR *", val: username, set: setUsername, ph: "Username", type: "text" },
            { label: "EMAIL *", val: email, set: setEmail, ph: "jean.pierre@gmail.com", type: "email" },
            { label: "TÉLÉPHONE (WHATSAPP) *", val: telephone, set: setTelephone, ph: "+509 1234 5678", type: "tel" },
          ].map(({ label, val, set, ph, type }) => (
            <div key={label} style={{ marginBottom: "12px" }}>
              <p style={{ margin: "0 0 5px", fontSize: "11px", fontWeight: 700, color: "#888", letterSpacing: "0.06em" }}>{label}</p>
              <input type={type} value={val} onChange={(e) => set(e.target.value)} placeholder={ph}
                style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e8e8e8", borderRadius: "12px", fontSize: "14px", outline: "none", fontFamily: "inherit", color: "#333", boxSizing: "border-box", background: "#f8f8f8" }} />
            </div>
          ))}

          <p style={{ margin: "0 0 5px", fontSize: "11px", fontWeight: 700, color: "#888", letterSpacing: "0.06em" }}>MOT DE PASSE * (min. 6)</p>
          <div style={{ display: "flex", alignItems: "center", border: "1.5px solid #e8e8e8", borderRadius: "12px", padding: "11px 14px", gap: "10px", marginBottom: "6px", background: "#f8f8f8" }}>
            <input type={showPass ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
              style={{ flex: 1, border: "none", outline: "none", fontSize: "14px", fontFamily: "inherit", color: "#333", background: "transparent" }} />
            <button type="button" onClick={() => setShowPass(!showPass)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "15px", padding: 0 }}>
              {showPass ? "🙈" : "👁️"}
            </button>
          </div>

          <p style={{ margin: "12px 0 5px", fontSize: "11px", fontWeight: 700, color: "#888", letterSpacing: "0.06em" }}>CONFIRMER LE MOT DE PASSE *</p>
          <div style={{ display: "flex", alignItems: "center", border: `1.5px solid ${confirmPassword && confirmPassword !== password ? "#e63946" : "#e8e8e8"}`, borderRadius: "12px", padding: "11px 14px", gap: "10px", marginBottom: "6px", background: "#f8f8f8" }}>
            <input type={showConfirmPass ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••"
              style={{ flex: 1, border: "none", outline: "none", fontSize: "14px", fontFamily: "inherit", color: "#333", background: "transparent" }} />
            <button type="button" onClick={() => setShowConfirmPass(!showConfirmPass)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "15px", padding: 0 }}>
              {showConfirmPass ? "🙈" : "👁️"}
            </button>
          </div>
          {confirmPassword && confirmPassword !== password && <p style={{ margin: "0 0 14px", fontSize: "11px", color: "#e63946" }}>❌ Les mots de passe ne correspondent pas</p>}
          {confirmPassword && confirmPassword === password && <p style={{ margin: "0 0 14px", fontSize: "11px", color: "#1a9e6e" }}>✅ Les mots de passe correspondent</p>}

          <button
            onClick={submit}
            disabled={loading}
            style={{
              width: "100%", padding: "14px",
              background: loading ? "#888" : "#1a9e6e",
              color: "#fff", border: "none", borderRadius: "14px",
              fontSize: "14px", fontWeight: 800,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "inherit", marginTop: "12px"
            }}
          >
            {loading ? "⏳ Création..." : "✅ Créer mon compte"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// LOGIN PAGE — ✅ Email + mot de passe réel, directement via Firebase Auth
// ══════════════════════════════════════════════════════════════════════════
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [showPass, setShowPass]         = useState(false);
  const [loading, setLoading]           = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError]               = useState("");
  const [showReset, setShowReset]       = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [successMsg, setSuccessMsg]     = useState("");

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) { setError("Veuillez saisir votre email et votre mot de passe."); return; }
    setLoading(true); setError("");
    try {
      const emailTrim = email.trim();

      let uid: string;
      try {
        const cred = await signInWithEmailAndPassword(auth, emailTrim, password);
        uid = cred.user.uid;
      } catch (e: any) {
        const msg =
          e?.code === "auth/user-not-found" || e?.code === "auth/invalid-credential" || e?.code === "auth/wrong-password"
            ? "Email ou mot de passe incorrect."
          : e?.code === "auth/too-many-requests" ? "Trop de tentatives. Réessayez dans quelques minutes."
          : e?.code === "auth/invalid-email" ? "Adresse email invalide."
          : "Erreur de connexion.";
        setError(msg);
        setLoading(false);
        return;
      }

      const userDoc = await getDoc(doc(db, "users", uid));
      if (!userDoc.exists()) {
        await signOut(auth);
        setError("Compte introuvable. Contactez MillionStore.");
        setLoading(false);
        return;
      }
      const userData = userDoc.data();
      if (userData.isBlocked === true) {
        await signOut(auth);
        setError("Votre compte est bloqué. Contactez MillionStore.");
        setLoading(false);
        return;
      }

      void touchPresence(uid);

      const sessionUser = {
        uid,
        username:    userData.username ?? emailTrim,
        displayName: userData.displayName ?? emailTrim,
        isAdmin:     userData.isAdmin ?? false,
        localId:     userData.localId ?? "all",
        permissions: userData,
        type:        "staff",
      };
      localStorage.setItem("ms_web_user", JSON.stringify(sessionUser));
      router.push("/dashboard");
    } catch (e) { setError("Erreur : " + e); setLoading(false); }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true); setError("");
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      const clientRef = doc(db, "clients", user.uid);
      const clientSnap = await getDoc(clientRef);
      if (!clientSnap.exists()) {
        await setDoc(clientRef, {
          uid: user.uid, nom: user.displayName ?? "", email: user.email ?? "",
          photo: user.photoURL ?? "", telephone: "", adres: "",
          createdAt: new Date().toISOString(), type: "client",
        });
      }
      const clientSession = { uid: user.uid, nom: user.displayName ?? "", email: user.email ?? "", photo: user.photoURL ?? "", type: "client" };
      localStorage.setItem("ms_client_user", JSON.stringify(clientSession));
      const redirect = localStorage.getItem("ms_redirect_after_login");
      if (redirect) { localStorage.removeItem("ms_redirect_after_login"); window.location.href = redirect; }
      else router.push("/mon-compte");
    } catch (e: any) { setError("Erreur Google : " + (e.message ?? e)); setGoogleLoading(false); }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif", padding: "24px" }}>

      {showReset    && <ResetPasswordModal onClose={() => setShowReset(false)} />}
      {showRegister && (
        <RegisterModal
          onClose={() => setShowRegister(false)}
          onSuccess={() => {
            setSuccessMsg("✅ Votre compte a été créé ! Connectez-vous maintenant.");
            setTimeout(() => setSuccessMsg(""), 5000);
          }}
        />
      )}

      <div style={{ background: "#fff", borderRadius: "24px", maxWidth: "420px", width: "100%", padding: "40px 32px", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <img src="https://i.ibb.co/gLmkySCv/ab785ed1481b.jpg" alt="MillionStore" style={{ height: "70px", objectFit: "contain", marginBottom: "10px", display: "block", marginLeft: "auto", marginRight: "auto" }} />
          <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 900, color: "#1a1a2e" }}>
            Million<span style={{ color: "#e63946" }}>Store</span>
          </h1>
          <p style={{ margin: "4px 0 0", color: "#888", fontSize: "13px" }}>Connectez-vous ou créez un compte</p>
        </div>

        {/* Success msg */}
        {successMsg && (
          <div style={{ background: "#e8fdf0", color: "#1a9e6e", padding: "10px 12px", borderRadius: "10px", fontSize: "12px", marginBottom: "16px", textAlign: "center", fontWeight: 700 }}>
            {successMsg}
          </div>
        )}

        {/* Staff Login */}

        <div style={{ position: "relative", marginBottom: "12px" }}>
          <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", fontSize: "16px" }}>📧</span>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", padding: "13px 14px 13px 44px", borderRadius: "12px", border: "1.5px solid #eee", fontSize: "15px", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
            onFocus={(e) => e.target.style.borderColor = "#1a1a2e"} onBlur={(e) => e.target.style.borderColor = "#eee"} />
        </div>

        <div style={{ position: "relative", marginBottom: "8px" }}>
          <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", fontSize: "16px" }}>🔒</span>
          <input type={showPass ? "text" : "password"} placeholder="Mot de passe" value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            style={{ width: "100%", padding: "13px 44px 13px 44px", borderRadius: "12px", border: "1.5px solid #eee", fontSize: "15px", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
            onFocus={(e) => e.target.style.borderColor = "#1a1a2e"} onBlur={(e) => e.target.style.borderColor = "#eee"} />
          <button onClick={() => setShowPass(!showPass)} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: "18px" }}>
            {showPass ? "🙈" : "👁️"}
          </button>
        </div>

        <div style={{ textAlign: "right", marginBottom: "14px" }}>
          <button onClick={() => setShowReset(true)} style={{ background: "none", border: "none", color: "#e63946", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Mot de passe oublié ?
          </button>
        </div>

        {error && (
          <div style={{ background: "#fff5f5", border: "1px solid #ffd0d0", borderRadius: "10px", padding: "10px 14px", color: "#c0392b", fontSize: "13px", marginBottom: "12px" }}>
            ❌ {error}
          </div>
        )}

        <button onClick={handleLogin} disabled={loading} style={{ width: "100%", padding: "14px", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: "12px", fontSize: "16px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, fontFamily: "inherit" }}>
          {loading ? "⏳ Connexion..." : "SE CONNECTER"}
        </button>

       {/* Bouton Inscription — couleur différente du bouton "SE CONNECTER" */}
       <button onClick={() => setShowRegister(true)} style={{ width: "100%", padding: "13px", background: "#e63946", color: "#fff", border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginTop: "10px" }}>
          S'inscrire
        </button>

        <a href="/" style={{ display: "block", textAlign: "center", color: "#888", fontSize: "13px", textDecoration: "none", marginTop: "20px" }}>
          ← Retour à la boutique
        </a>
      </div>
    </main>
  );
}