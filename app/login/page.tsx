"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { db, auth } from "../../lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";

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

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass]       = useState(false);
  const [loading, setLoading]         = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError]             = useState("");

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError("Tape nom utilisateur ak modpas ou"); return;
    }
    setLoading(true); setError("");
    try {
      const userDoc = await getDoc(doc(db, "users", username.trim()));
      if (!userDoc.exists()) {
        setError("Utilisateur pa jwenn"); setLoading(false); return;
      }
      const userData = userDoc.data();
      if (userData.isBlocked === true) {
        setError("Kont ou bloke. Kontakte MillionStore."); setLoading(false); return;
      }
      if (!await verifyPassword(password.trim(), userData.password ?? "", userData.salt)) {
        const attempts = (userData.loginAttempts ?? 0) + 1;
        const shouldBlock = attempts >= 5;
        await setDoc(doc(db, "users", username.trim()), { loginAttempts: attempts, isBlocked: shouldBlock }, { merge: true });
        if (shouldBlock) {
          setError("Kont ou bloke apre 5 eseye. Kontakte MillionStore.");
        } else {
          setError(`Modpas mal. Eseye ankò ${5 - attempts} fwa.`);
        }
        setLoading(false); return;
      }
      await setDoc(doc(db, "users", username.trim()), { loginAttempts: 0, isBlocked: false }, { merge: true });
      const sessionUser = {
        username: userData.username ?? username.trim(),
        displayName: userData.displayName ?? username.trim(),
        isAdmin: userData.isAdmin ?? false,
        localId: userData.localId ?? "all",
        permissions: userData,
        type: "staff",
      };
      localStorage.setItem("ms_web_user", JSON.stringify(sessionUser));
      router.push("/dashboard");
    } catch (e) {
      setError("Erè: " + e); setLoading(false);
    }
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
          uid: user.uid,
          nom: user.displayName ?? "",
          email: user.email ?? "",
          photo: user.photoURL ?? "",
          telephone: "",
          adres: "",
          createdAt: new Date().toISOString(),
          type: "client",
        });
      }
      const clientSession = {
        uid: user.uid,
        nom: user.displayName ?? "",
        email: user.email ?? "",
        photo: user.photoURL ?? "",
        type: "client",
      };
      localStorage.setItem("ms_client_user", JSON.stringify(clientSession));
      const redirect = localStorage.getItem("ms_redirect_after_login");
      if (redirect) {
        localStorage.removeItem("ms_redirect_after_login");
        window.location.href = redirect;
      } else {
        router.push("/mon-compte");
      }
    } catch (e: any) {
      setError("Erè Google: " + (e.message ?? e));
      setGoogleLoading(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif", padding: "24px" }}>
      <div style={{ background: "#fff", borderRadius: "24px", maxWidth: "420px", width: "100%", padding: "40px 32px", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <img src="https://i.ibb.co/gLmkySCv/ab785ed1481b.jpg" alt="MillionStore" style={{ height: "70px", objectFit: "contain", marginBottom: "10px" }} />
          <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 900, color: "#1a1a2e" }}>
            Million<span style={{ color: "#e63946" }}>Store</span>
          </h1>
          <p style={{ margin: "4px 0 0", color: "#888", fontSize: "13px" }}>Connectez-vous à votre compte</p>
        </div>

        {/* Staff Login */}
        <div style={{ marginBottom: "8px" }}>
          <p style={{ margin: "0 0 14px", fontSize: "13px", fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            👤 Espace Staff / Admin
          </p>
          <div style={{ position: "relative", marginBottom: "12px" }}>
            <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", fontSize: "16px" }}>👤</span>
            <input type="text" placeholder="Nom utilisateur" value={username} onChange={(e) => setUsername(e.target.value)}
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
            <a href="/forgot-password" style={{ color: "#e63946", fontSize: "13px", fontWeight: 600, textDecoration: "none" }}>Mot de passe oublié?</a>
          </div>
          {error && (
            <div style={{ background: "#fff5f5", border: "1px solid #ffd0d0", borderRadius: "10px", padding: "10px 14px", color: "#c0392b", fontSize: "13px", marginBottom: "12px" }}>
              ❌ {error}
            </div>
          )}
          <button onClick={handleLogin} disabled={loading} style={{ width: "100%", padding: "14px", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: "12px", fontSize: "16px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, fontFamily: "inherit" }}>
            {loading ? "⏳ Connexion..." : "SE CONNECTER"}
          </button>
        </div>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "20px 0" }}>
          <div style={{ flex: 1, height: "1px", background: "#eee" }} />
          <span style={{ color: "#aaa", fontSize: "13px", fontWeight: 600 }}>ou</span>
          <div style={{ flex: 1, height: "1px", background: "#eee" }} />
        </div>

        {/* Client Google */}
        <div>
          <p style={{ margin: "0 0 14px", fontSize: "13px", fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            🛒 Espace Client
          </p>
          <button onClick={handleGoogle} disabled={googleLoading} style={{ width: "100%", padding: "14px", background: "#fff", color: "#333", border: "2px solid #eee", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: googleLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", fontFamily: "inherit" }}>
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={{ width: "22px", height: "22px" }} />
            {googleLoading ? "Connexion..." : "Se connecter avec Google"}
          </button>
        </div>

        <a href="/" style={{ display: "block", textAlign: "center", color: "#888", fontSize: "13px", textDecoration: "none", marginTop: "20px" }}>
          {"← Retourner à la boutique"}
        </a>
      </div>
    </main>
  );
}