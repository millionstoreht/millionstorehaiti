"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { db, auth } from "../../lib/firebase";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";

// ══════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════
async function verifyPassword(plain: string, stored: string, salt?: string): Promise<boolean> {
  if (stored.length === 64) {
    const sel = salt ?? "_millionstore_2024_sel";
    const encoder = new TextEncoder();
    const data = encoder.encode(plain + sel);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashed = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    return hashed === stored;
  }
  return plain === stored;
}

async function hashPassword(plain: string, salt?: string): Promise<string> {
  const sel = salt ?? "_millionstore_2024_sel";
  const encoder = new TextEncoder();
  const data = encoder.encode(plain + sel);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ══════════════════════════════════════════════════════════════════════════
// RESET PASSWORD MODAL
// ══════════════════════════════════════════════════════════════════════════
function ResetPasswordModal({ onClose }: { onClose: () => void }) {
  const [step, setStep]               = useState<"questions" | "newpass">("questions");
  const [username, setUsername]       = useState("");
  const [rep1, setRep1]               = useState("");
  const [rep2, setRep2]               = useState("");
  const [rep3, setRep3]               = useState("");
  const [newPass, setNewPass]         = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showNew, setShowNew]         = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [success, setSuccess]         = useState("");

  const verifyAnswers = async () => {
    if (!username || !rep1 || !rep2 || !rep3) { setError("Veuillez remplir tous les champs."); return; }
    setLoading(true); setError("");
    try {
      const snap = await getDoc(doc(db, "users", username.trim()));
      if (!snap.exists()) { setError("Utilisateur introuvable."); setLoading(false); return; }
      const data = snap.data();
      const q = data.securityQuestions;
      if (!q) { setError("Aucune question de sécurité pour ce compte."); setLoading(false); return; }
      const ok =
        q.rep1?.toLowerCase().trim() === rep1.toLowerCase().trim() &&
        q.rep2?.toLowerCase().trim() === rep2.toLowerCase().trim() &&
        q.rep3?.toLowerCase().trim() === rep3.toLowerCase().trim();
      if (!ok) { setError("Une ou plusieurs réponses sont incorrectes."); setLoading(false); return; }
      setStep("newpass");
    } catch { setError("Erreur. Veuillez réessayer."); }
    setLoading(false);
  };

  const saveNewPassword = async () => {
    if (newPass.length < 6) { setError("Le mot de passe doit contenir au moins 6 caractères."); return; }
    if (newPass !== confirmPass) { setError("Les mots de passe ne correspondent pas."); return; }
    setLoading(true); setError("");
    try {
      const hashed = await hashPassword(newPass);
      await updateDoc(doc(db, "users", username.trim()), {
        password: hashed,
        loginAttempts: 0,
        isBlocked: false,
      });
      setSuccess("✅ Mot de passe changé avec succès !");
      setTimeout(() => onClose(), 2000);
    } catch { setError("Erreur. Veuillez réessayer."); }
    setLoading(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "24px 24px 0 0", width: "100%", maxWidth: "480px", maxHeight: "92vh", overflowY: "auto", paddingBottom: "40px" }}>
        <div style={{ width: "40px", height: "4px", background: "#e0e0e0", borderRadius: "2px", margin: "12px auto 0" }} />
        <div style={{ padding: "16px 18px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "17px", fontWeight: 900, color: "#1a1a2e" }}>
                {step === "questions" ? "🔐 Mot de passe oublié" : "🔒 Nouveau mot de passe"}
              </p>
              <p style={{ margin: "3px 0 0", fontSize: "11px", color: "#888" }}>
                {step === "questions" ? "Répondez aux 3 questions de sécurité" : "Choisissez un nouveau mot de passe"}
              </p>
            </div>
            <button onClick={onClose} style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#f1f1f1", border: "none", fontSize: "16px", cursor: "pointer" }}>×</button>
          </div>

          {error   && <div style={{ background: "#fff0f0", color: "#e63946", padding: "10px 12px", borderRadius: "10px", fontSize: "12px", marginBottom: "14px", textAlign: "center" }}>{error}</div>}
          {success && <div style={{ background: "#e8fdf0", color: "#1a9e6e", padding: "10px 12px", borderRadius: "10px", fontSize: "13px", marginBottom: "14px", textAlign: "center", fontWeight: 700 }}>{success}</div>}

          {step === "questions" && (
            <>
              <p style={{ margin: "0 0 5px", fontSize: "11px", fontWeight: 700, color: "#888", letterSpacing: "0.06em" }}>NOM D'UTILISATEUR</p>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="votre nom d'utilisateur..."
                style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e8e8e8", borderRadius: "12px", fontSize: "14px", outline: "none", fontFamily: "inherit", color: "#333", boxSizing: "border-box", marginBottom: "14px" }} />

              {[
                { label: "1️⃣ Nom de jeune fille de votre mère ?", val: rep1, set: setRep1 },
                { label: "2️⃣ Dans quelle ville êtes-vous né(e) ?", val: rep2, set: setRep2 },
                { label: "3️⃣ Quel est le nom de votre meilleur(e) ami(e) ?", val: rep3, set: setRep3 },
              ].map(({ label, val, set }) => (
                <div key={label} style={{ background: "#f8f9fa", borderRadius: "14px", padding: "14px", marginBottom: "10px" }}>
                  <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 700, color: "#1a1a2e" }}>{label}</p>
                  <input value={val} onChange={(e) => set(e.target.value)} placeholder="Votre réponse..."
                    style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e0e0e0", borderRadius: "10px", fontSize: "13px", outline: "none", fontFamily: "inherit", color: "#333", boxSizing: "border-box" }} />
                </div>
              ))}
              <button onClick={verifyAnswers} disabled={loading} style={{ width: "100%", padding: "15px", background: loading ? "#888" : "#1a1a2e", color: "#fff", border: "none", borderRadius: "14px", fontSize: "14px", fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", marginTop: "6px" }}>
                {loading ? "⏳ Vérification..." : "✅ Vérifier mes réponses"}
              </button>
            </>
          )}

          {step === "newpass" && (
            <>
              <div style={{ background: "#e8fdf0", borderRadius: "12px", padding: "12px", marginBottom: "16px", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: "13px", color: "#1a9e6e", fontWeight: 700 }}>✅ Réponses correctes ! Entrez votre nouveau mot de passe.</p>
              </div>
              <p style={{ margin: "0 0 5px", fontSize: "11px", fontWeight: 700, color: "#888", letterSpacing: "0.06em" }}>NOUVEAU MOT DE PASSE</p>
              <div style={{ display: "flex", alignItems: "center", border: "1.5px solid #e8e8e8", borderRadius: "12px", padding: "11px 14px", gap: "10px", marginBottom: "10px" }}>
                <input type={showNew ? "text" : "password"} value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="Min. 6 caractères"
                  style={{ flex: 1, border: "none", outline: "none", fontSize: "14px", fontFamily: "inherit", color: "#333", background: "transparent" }} />
                <button type="button" onClick={() => setShowNew(!showNew)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "15px", padding: 0 }}>{showNew ? "🙈" : "👁️"}</button>
              </div>
              {newPass && (
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ height: "4px", borderRadius: "999px", background: "#f0f0f0", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: "999px", width: newPass.length >= 10 ? "100%" : newPass.length >= 6 ? "60%" : "25%", background: newPass.length >= 10 ? "#1a9e6e" : newPass.length >= 6 ? "#f79f1f" : "#e63946", transition: "width 0.3s" }} />
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: "10px", color: newPass.length >= 10 ? "#1a9e6e" : newPass.length >= 6 ? "#f79f1f" : "#e63946" }}>
                    {newPass.length >= 10 ? "Fort 💪" : newPass.length >= 6 ? "Moyen" : "Trop court"}
                  </p>
                </div>
              )}
              <p style={{ margin: "0 0 5px", fontSize: "11px", fontWeight: 700, color: "#888", letterSpacing: "0.06em" }}>CONFIRMER LE MOT DE PASSE</p>
              <div style={{ display: "flex", alignItems: "center", border: `1.5px solid ${confirmPass && confirmPass !== newPass ? "#e63946" : "#e8e8e8"}`, borderRadius: "12px", padding: "11px 14px", gap: "10px", marginBottom: "6px" }}>
                <input type={showConfirm ? "text" : "password"} value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} placeholder="Répétez le mot de passe"
                  style={{ flex: 1, border: "none", outline: "none", fontSize: "14px", fontFamily: "inherit", color: "#333", background: "transparent" }} />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "15px", padding: 0 }}>{showConfirm ? "🙈" : "👁️"}</button>
              </div>
              {confirmPass && confirmPass !== newPass && <p style={{ margin: "0 0 12px", fontSize: "11px", color: "#e63946" }}>❌ Les mots de passe ne correspondent pas</p>}
              {confirmPass && confirmPass === newPass && <p style={{ margin: "0 0 12px", fontSize: "11px", color: "#1a9e6e" }}>✅ Les mots de passe correspondent</p>}
              <button onClick={saveNewPassword} disabled={loading} style={{ width: "100%", padding: "15px", background: loading ? "#888" : "#1a9e6e", color: "#fff", border: "none", borderRadius: "14px", fontSize: "14px", fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", marginTop: "8px" }}>
                {loading ? "⏳ Enregistrement..." : "💾 Changer le mot de passe"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// REGISTER MODAL
// ══════════════════════════════════════════════════════════════════════════
function RegisterModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep]         = useState<"info" | "security">("info");
  const [nom, setNom]                 = useState("");
const [prenom, setPrenom]           = useState("");
const [username, setUsername]       = useState("");
const [password, setPassword]       = useState("");
const [confirmPassword, setConfirmPassword] = useState("");
const [showPass, setShowPass]       = useState(false);
const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [rep1, setRep1]         = useState("");
  const [rep2, setRep2]         = useState("");
  const [rep3, setRep3]         = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const goToSecurity = async () => {
    if (!nom.trim() || !prenom.trim() || !username.trim() || !password.trim() || !confirmPassword.trim()) {
      setError("Tous les champs sont obligatoires."); return;
    }
    if (password.length < 6) { setError("Le mot de passe doit contenir au moins 6 caractères."); return; }
    if (password !== confirmPassword) { setError("Les mots de passe ne correspondent pas."); return; }
    // Vérifie si le username existe déjà
    const snap = await getDoc(doc(db, "users", username.trim()));
    if (snap.exists()) { setError("Ce nom d'utilisateur est déjà pris. Choisissez-en un autre."); return; }
    setError(""); setStep("security");
  };

  const submit = async () => {
    if (!rep1.trim() || !rep2.trim() || !rep3.trim()) {
      setError("Répondez aux 3 questions de sécurité."); return;
    }
    setLoading(true);
    try {
      const hashed = await hashPassword(password.trim());
      const newUser = {
        username:    username.trim(),
        displayName: `${prenom.trim()} ${nom.trim()}`,
        password:    hashed,
        isAdmin:     false,
        isBlocked:   false,
        loginAttempts: 0,
        localId:     "all",
        securityQuestions: {
          rep1: rep1.trim().toLowerCase(),
          rep2: rep2.trim().toLowerCase(),
          rep3: rep3.trim().toLowerCase(),
        },
        // Permissions par défaut — toutes à false
        factureVoir: false, factureCreye: false, factureModifye: false, factureSiprime: false, factureAnile: false, factureVoirIstwa: false,
        produitVoir: false, produitAjoute: false, produitModifye: false, produitSiprime: false, produitChangePrix: false,
        clientVoir: false, clientAjoute: false, clientModifye: false, clientSiprime: false,
        rapportVoir: false, rapportEksporte: false, rapportSiprime: false, rapportAnile: false,
        imprimanteVoir: false, imprimanteAjoute: false, imprimanteModifye: false, imprimanteSiprime: false,
        parametreVoir: false, parametreAcces: false, parametreModifye: false, parametreSiprime: false, parametreChanje: false,
        vendeurVoir: false, vendeurAjoute: false, vendeurModifye: false, vendeurSiprime: false,
        fournisseurVoir: false, fournisseurAjoute: false, fournisseurModifye: false, fournisseurSiprime: false,
        ficheVoir: false, ficheAcces: false, ficheAjouteKliyan: false, ficheModifyeKliyan: false, ficheSiprimeKliyan: false,
        ficheAjoutePwodwi: false, ficheModifyePwodwi: false, ficheSiprimePwodwi: false, ficheRapo: false, ficheIstwa: false,
        workersVoir: false, workersAjoute: false, workersModifye: false, workersSiprime: false,
        callingVoir: false, callingAjouteText: false, callingModifyeText: false, callingSiprimeText: false, callingFeApel: false, callingFeVideo: false,
        cameraVoir: false, cameraAcces: false, cameraAjoute: false, cameraModifye: false, cameraSiprime: false,
        utilisateurVoir: false, utilisateurAjoute: false, utilisateurModifye: false, utilisateurSiprime: false, utilisateurBloke: false, utilisateurDebloke: false,
        noteVoir: false, noteAjoute: false, noteModifye: false, noteSiprime: false,
        notepapVoir: false, notepapAjoute: false, notepapSiprime: false,
        printerAcces: false,
        createdAt: new Date().toISOString(),
      };

      // Sauvegarde dans users/{username}
      await setDoc(doc(db, "users", username.trim()), newUser);
      onSuccess();
      onClose();
    } catch (e: any) {
      setError("Erreur. Veuillez réessayer.");
    }
    setLoading(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "24px 24px 0 0", width: "100%", maxWidth: "480px", maxHeight: "93vh", overflowY: "auto", paddingBottom: "40px" }}>
        <div style={{ width: "40px", height: "4px", background: "#e0e0e0", borderRadius: "2px", margin: "12px auto 0" }} />

        {/* Progress */}
        <div style={{ display: "flex", gap: "6px", padding: "12px 18px 0" }}>
          {["info", "security"].map((s, i) => (
            <div key={s} style={{ flex: 1, height: "4px", borderRadius: "2px", background: i === 0 || step === "security" ? "#1a1a2e" : "#e0e0e0" }} />
          ))}
        </div>

        <div style={{ padding: "14px 18px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 900, color: "#1a1a2e" }}>
                {step === "info" ? "🆕 Créer un compte" : "🔐 Questions de sécurité"}
              </h3>
              <p style={{ margin: "3px 0 0", fontSize: "11px", color: "#888" }}>
                {step === "info" ? "Étape 1/2 — Vos informations" : "Étape 2/2 — Pour votre sécurité"}
              </p>
            </div>
            <button onClick={onClose} style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#f1f1f1", border: "none", fontSize: "16px", cursor: "pointer" }}>×</button>
          </div>

          {error && <div style={{ background: "#fff0f0", color: "#e63946", padding: "10px 12px", borderRadius: "10px", fontSize: "12px", marginBottom: "12px", textAlign: "center" }}>{error}</div>}

          {step === "info" && (
            <>
              {[
                { label: "NOM *", val: nom, set: setNom, ph: "Nom", type: "text" },
                { label: "PRÉNOM *", val: prenom, set: setPrenom, ph: "Prénom", type: "text" },
                { label: "NOM D'UTILISATEUR *", val: username, set: setUsername, ph: "Username", type: "text" },
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
              {password && (
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ height: "4px", borderRadius: "999px", background: "#f0f0f0", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: "999px", width: password.length >= 10 ? "100%" : password.length >= 6 ? "60%" : "25%", background: password.length >= 10 ? "#1a9e6e" : password.length >= 6 ? "#f79f1f" : "#e63946", transition: "width 0.3s" }} />
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: "10px", color: password.length >= 10 ? "#1a9e6e" : password.length >= 6 ? "#f79f1f" : "#e63946" }}>
                    {password.length >= 10 ? "Fort 💪" : password.length >= 6 ? "Moyen" : "Trop court"}
                  </p>
                </div>
              )}

              <p style={{ margin: "0 0 5px", fontSize: "11px", fontWeight: 700, color: "#888", letterSpacing: "0.06em" }}>CONFIRMER LE MOT DE PASSE *</p>
              <div style={{ display: "flex", alignItems: "center", border: `1.5px solid ${confirmPassword && confirmPassword !== password ? "#e63946" : "#e8e8e8"}`, borderRadius: "12px", padding: "11px 14px", gap: "10px", marginBottom: "6px", background: "#f8f8f8" }}>
                <input type={showConfirmPass ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••"
                  style={{ flex: 1, border: "none", outline: "none", fontSize: "14px", fontFamily: "inherit", color: "#333", background: "transparent" }} />
                <button type="button" onClick={() => setShowConfirmPass(!showConfirmPass)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "15px", padding: 0 }}>
                  {showConfirmPass ? "🙈" : "👁️"}
                </button>
              </div>
              {confirmPassword && confirmPassword !== password && <p style={{ margin: "0 0 14px", fontSize: "11px", color: "#e63946" }}>❌ Les mots de passe ne correspondent pas</p>}
              {confirmPassword && confirmPassword === password && <p style={{ margin: "0 0 14px", fontSize: "11px", color: "#1a9e6e" }}>✅ Les mots de passe correspondent</p>}

              <button onClick={goToSecurity} style={{ width: "100%", padding: "14px", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: "14px", fontSize: "14px", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                Suivant → Questions de sécurité
              </button>
            </>
          )}

          {step === "security" && (
            <>
              <div style={{ background: "#f0f4ff", borderRadius: "12px", padding: "10px 12px", marginBottom: "14px" }}>
                <p style={{ margin: 0, fontSize: "12px", color: "#3b4dd4" }}>
                  ℹ️ Ces réponses serviront à récupérer votre mot de passe si vous l'oubliez. Mémorisez-les bien !
                </p>
              </div>

              {[
                { label: "1️⃣ Nom de jeune fille de votre mère ?", val: rep1, set: setRep1 },
                { label: "2️⃣ Dans quelle ville êtes-vous né(e) ?", val: rep2, set: setRep2 },
                { label: "3️⃣ Quel est le nom de votre meilleur(e) ami(e) ?", val: rep3, set: setRep3 },
              ].map(({ label, val, set }) => (
                <div key={label} style={{ background: "#f8f9fa", borderRadius: "14px", padding: "12px 14px", marginBottom: "10px" }}>
                  <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 700, color: "#1a1a2e" }}>{label}</p>
                  <input value={val} onChange={(e) => set(e.target.value)} placeholder="Votre réponse..."
                    style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e0e0e0", borderRadius: "10px", fontSize: "13px", outline: "none", fontFamily: "inherit", color: "#333", boxSizing: "border-box" }} />
                </div>
              ))}

              <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
                <button onClick={() => { setStep("info"); setError(""); }} style={{ flex: 1, padding: "14px", background: "#f0f0f0", color: "#333", border: "none", borderRadius: "14px", fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  ← Retour
                </button>
                <button onClick={submit} disabled={loading} style={{ flex: 2, padding: "14px", background: loading ? "#888" : "#1a9e6e", color: "#fff", border: "none", borderRadius: "14px", fontSize: "14px", fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                  {loading ? "⏳ Création..." : "✅ Créer mon compte"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// LOGIN PAGE
// ══════════════════════════════════════════════════════════════════════════
export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername]         = useState("");
  const [password, setPassword]         = useState("");
  const [showPass, setShowPass]         = useState(false);
  const [loading, setLoading]           = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError]               = useState("");
  const [showReset, setShowReset]       = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [successMsg, setSuccessMsg]     = useState("");

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) { setError("Veuillez saisir votre nom d'utilisateur et votre mot de passe."); return; }
    setLoading(true); setError("");
    try {
      const userDoc = await getDoc(doc(db, "users", username.trim()));
      if (!userDoc.exists()) { setError("Utilisateur introuvable."); setLoading(false); return; }
      const userData = userDoc.data();
      if (userData.isBlocked === true) { setError("Votre compte est bloqué. Contactez MillionStore."); setLoading(false); return; }
      if (!await verifyPassword(password.trim(), userData.password ?? "", userData.salt)) {
        const attempts = (userData.loginAttempts ?? 0) + 1;
        const shouldBlock = attempts >= 5;
        await setDoc(doc(db, "users", username.trim()), { loginAttempts: attempts, isBlocked: shouldBlock }, { merge: true });
        setError(shouldBlock ? "Votre compte est bloqué après 5 tentatives. Contactez MillionStore." : `Mot de passe incorrect. ${5 - attempts} tentative(s) restante(s).`);
        setLoading(false); return;
      }
      await setDoc(doc(db, "users", username.trim()), { loginAttempts: 0, isBlocked: false }, { merge: true });
      const sessionUser = {
        username:    userData.username ?? username.trim(),
        displayName: userData.displayName ?? username.trim(),
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
          <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", fontSize: "16px" }}>👤</span>
          <input type="text" placeholder="Nom d'utilisateur" value={username} onChange={(e) => setUsername(e.target.value)}
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