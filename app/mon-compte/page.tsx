"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db, auth } from "../../lib/firebase";
import { signOut } from "firebase/auth";
import { doc, getDoc, setDoc, collection, query, where, orderBy, getDocs } from "firebase/firestore";

interface ClientSession {
  uid: string;
  nom: string;
  email: string;
  photo: string;
  type: string;
}

interface ClientProfile {
  nom: string;
  email: string;
  photo: string;
  telephone: string;
  adres: string;
}

export default function MonComptePage() {
  const router = useRouter();
  const [client, setClient]   = useState<ClientSession | null>(null);
  const [profile, setProfile] = useState<ClientProfile>({ nom: "", email: "", photo: "", telephone: "", adres: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [achats, setAchats] = useState<any[]>([]);
const [loadingAchats, setLoadingAchats] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setMounted(true);
      const raw = localStorage.getItem("ms_client_user");
      if (!raw) { router.push("/login"); return; }
      const session = JSON.parse(raw) as ClientSession;
      if (session.type !== "client") { router.push("/dashboard"); return; }
      setClient(session);
  
      // Chaje profil depi Firestore
      try {
        const snap = await getDoc(doc(db, "clients", session.uid));
        if (snap.exists()) {
          const data = snap.data();
          setProfile({
            nom: data.nom ?? session.nom,
            email: data.email ?? session.email,
            photo: data.photo ?? session.photo,
            telephone: data.telephone ?? "",
            adres: data.adres ?? "",
          });
        }
      } catch (_) {}
      setLoading(false);
  
      // Chaje istwa achte
      try {
        const q = query(
          collection(db, "achats"),
          where("clientUid", "==", session.uid),
          orderBy("createdAt", "desc")
        );
        const aSnap = await getDocs(q);
        setAchats(aSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (_) {}
      setLoadingAchats(false);
    };
    loadData();
  }, [router]);
  const handleSave = async () => {
    if (!client) return;
    setSaving(true);
    try {
      await setDoc(doc(db, "clients", client.uid), {
        nom: profile.nom,
        telephone: profile.telephone,
        adres: profile.adres,
      }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { alert("Erè: " + e); }
    setSaving(false);
  };

  const handleLogout = async () => {
    localStorage.removeItem("ms_client_user");
    try { await signOut(auth); } catch (_) {}
    router.push("/");
  };

  if (!mounted || loading) return (
    <main style={{ minHeight: "100vh", background: "#f4f4f4", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: "48px", height: "48px", border: "4px solid #eee", borderTop: "4px solid #1a1a2e", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
        <p style={{ color: "#888" }}>Chargement...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </main>
  );

  return (
    <main style={{ minHeight: "100vh", background: "#f4f4f4", fontFamily: "'Segoe UI', sans-serif", paddingBottom: "40px" }}>

      {/* Header */}
      <div style={{ background: "#1a1a2e", padding: "20px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <a href="/" style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "8px 14px", borderRadius: "10px", fontSize: "13px", textDecoration: "none" }}>
            {"← Boutique"}
          </a>
          <h1 style={{ margin: 0, color: "#fff", fontSize: "17px", fontWeight: 700 }}>Mon Compte</h1>
        </div>
        <button onClick={handleLogout} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "8px 14px", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
          🚪 Déconnexion
        </button>
      </div>

      <div style={{ maxWidth: "500px", margin: "0 auto", padding: "24px 16px" }}>

        {/* Foto + Non */}
        <div style={{ background: "#fff", borderRadius: "20px", padding: "24px", marginBottom: "16px", textAlign: "center", border: "1px solid #eee" }}>
          {profile.photo ? (
            <img src={profile.photo} alt={profile.nom} style={{ width: "80px", height: "80px", borderRadius: "50%", objectFit: "cover", marginBottom: "12px", border: "3px solid #f0f0f0" }} />
          ) : (
            <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", fontSize: "32px" }}>
              👤
            </div>
          )}
          <h2 style={{ margin: "0 0 4px", fontSize: "20px", fontWeight: 700, color: "#1a1a2e" }}>{profile.nom}</h2>
          <p style={{ margin: 0, color: "#888", fontSize: "14px" }}>{profile.email}</p>
          <div style={{ marginTop: "10px", display: "inline-flex", alignItems: "center", gap: "6px", background: "#e8f5e9", color: "#2e7d32", padding: "4px 12px", borderRadius: "999px", fontSize: "12px", fontWeight: 700 }}>
            ✅ Client vérifié via Google
          </div>
        </div>

        {/* Profil */}
        <div style={{ background: "#fff", borderRadius: "20px", padding: "24px", marginBottom: "16px", border: "1px solid #eee" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 700, color: "#1a1a2e" }}>📋 Mon Profil</h3>

          {[
            { label: "Nom complet", key: "nom", icon: "👤", placeholder: "Votre nom" },
            { label: "Téléphone", key: "telephone", icon: "📞", placeholder: "+509 XXXX XXXX" },
            { label: "Adresse de livraison", key: "adres", icon: "📍", placeholder: "Votre adresse" },
          ].map(({ label, key, icon, placeholder }) => (
            <div key={key} style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#666", marginBottom: "5px", textTransform: "uppercase" }}>
                {icon} {label}
              </label>
              <input
                type="text"
                value={profile[key as keyof ClientProfile]}
                onChange={(e) => setProfile(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "14px", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
                onFocus={(e) => e.target.style.borderColor = "#1a1a2e"}
                onBlur={(e) => e.target.style.borderColor = "#eee"}
              />
            </div>
          ))}

          <button onClick={handleSave} disabled={saving} style={{ width: "100%", padding: "14px", background: saved ? "#4CAF50" : "#1a1a2e", color: "#fff", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            {saving ? "⏳ Sauvegarde..." : saved ? "✅ Sauvegardé!" : "💾 Sauvegarder"}
          </button>
        </div>

        {/* Istwa Achte */}
<div style={{ background: "#fff", borderRadius: "20px", padding: "24px", marginBottom: "16px", border: "1px solid #eee" }}>
  <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 700, color: "#1a1a2e" }}>🛍️ Mes Commandes</h3>

  {loadingAchats ? (
    <p style={{ color: "#888", textAlign: "center", padding: "20px 0" }}>Chargement...</p>
  ) : achats.length === 0 ? (
    <div style={{ textAlign: "center", padding: "30px 0" }}>
      <p style={{ fontSize: "36px", margin: "0 0 8px" }}>🛒</p>
      <p style={{ color: "#888", fontSize: "14px", margin: 0 }}>Aucune commande pour le moment.</p>
      <a href="/" style={{ display: "inline-block", marginTop: "12px", background: "#1a1a2e", color: "#fff", padding: "10px 20px", borderRadius: "10px", textDecoration: "none", fontWeight: 700, fontSize: "14px" }}>
        Voir les produits
      </a>
    </div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {achats.map((achat) => (
        <div key={achat.id} style={{ background: "#f8f9fa", borderRadius: "14px", padding: "14px 16px", border: "1px solid #eee" }}>
          {/* Statut */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{
              background:
                achat.statut === "Confirmé" ? "#e8f5e9" :
                achat.statut === "En livraison" ? "#e3f2fd" :
                achat.statut === "Livré" ? "#f3e5f5" :
                achat.statut === "Annulé" ? "#fdecea" : "#fff8e1",
              color:
                achat.statut === "Confirmé" ? "#2e7d32" :
                achat.statut === "En livraison" ? "#1565c0" :
                achat.statut === "Livré" ? "#6a1b9a" :
                achat.statut === "Annulé" ? "#c0392b" : "#f57c00",
              padding: "4px 12px", borderRadius: "999px",
              fontSize: "12px", fontWeight: 700,
            }}>
              {achat.statut === "Confirmé" ? "✅" :
               achat.statut === "En livraison" ? "🚚" :
               achat.statut === "Livré" ? "📦" :
               achat.statut === "Annulé" ? "❌" : "⏳"} {achat.statut}
            </span>
            <span style={{ fontSize: "11px", color: "#aaa" }}>
              {new Date(achat.createdAt).toLocaleDateString("fr-FR")}
            </span>
          </div>

          {/* Pwodwi yo */}
          {achat.produits?.map((p: any, i: number) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#333", marginBottom: "4px" }}>
              <span>• {p.marque} {p.modele}</span>
              <span style={{ fontWeight: 700 }}>${Number(p.prix).toLocaleString()}</span>
            </div>
          ))}

          {/* Total + Metòd */}
          <div style={{ borderTop: "1px solid #eee", marginTop: "10px", paddingTop: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: "#888" }}>Via {achat.methode}</span>
            <span style={{ fontWeight: 800, fontSize: "16px", color: "#1a1a2e" }}>
              Total: ${Number(achat.total).toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  )}
</div>

        {/* Aksyon rapid */}
        <div style={{ background: "#fff", borderRadius: "20px", padding: "20px", border: "1px solid #eee" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 700, color: "#1a1a2e" }}>⚡ Actions rapides</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <a href="/" style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", background: "#f8f9fa", borderRadius: "12px", textDecoration: "none", color: "#1a1a2e", fontWeight: 600, fontSize: "15px" }}>
              🛒 <span>Retourner à la boutique</span>
            </a>
            <button
              onClick={() => window.open(`https://wa.me/50938332483`, "_blank", "noopener,noreferrer")}
              style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", background: "#f0fff4", borderRadius: "12px", border: "none", cursor: "pointer", color: "#25D366", fontWeight: 600, fontSize: "15px", fontFamily: "inherit" }}
            >
              💬 <span>Contacter MillionStore</span>
            </button>
            <button
              onClick={handleLogout}
              style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", background: "#fff5f5", borderRadius: "12px", border: "none", cursor: "pointer", color: "#e63946", fontWeight: 600, fontSize: "15px", fontFamily: "inherit" }}
            >
              🚪 <span>Se déconnecter</span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}