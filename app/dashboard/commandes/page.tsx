"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import { collection, query, orderBy, getDocs, doc, updateDoc } from "firebase/firestore";

interface UserSession {
  username: string;
  isAdmin: boolean;
  permissions: Record<string, boolean>;
}

interface Commande {
  id: string;
  clientNom: string;
  clientEmail: string;
  clientUid: string;
  produits: { marque: string; modele: string; prix: number }[];
  total: number;
  methode: string;
  banque?: string;
  statut: string;
  createdAt: string;
}

const STATUTS = ["En attente", "Confirmé", "En livraison", "Livré", "Annulé"];

const STATUT_COLORS: Record<string, { bg: string; color: string; icon: string }> = {
  "En attente":   { bg: "#fff8e1", color: "#f57c00", icon: "⏳" },
  "Confirmé":     { bg: "#e8f5e9", color: "#2e7d32", icon: "✅" },
  "En livraison": { bg: "#e3f2fd", color: "#1565c0", icon: "🚚" },
  "Livré":        { bg: "#f3e5f5", color: "#6a1b9a", icon: "📦" },
  "Annulé":       { bg: "#fdecea", color: "#c0392b", icon: "❌" },
};

export default function CommandesPage() {
  const router = useRouter();
  const [user, setUser]           = useState<UserSession | null>(null);
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [loading, setLoading]     = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatut, setFilterStatut] = useState("Tout");
  const [updating, setUpdating]   = useState<string | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    const session = JSON.parse(raw) as UserSession;
    if (!session.isAdmin) { router.push("/dashboard"); return; }
    setUser(session);
    loadCommandes();
  }, [router]);

  const loadCommandes = async () => {
    try {
      const q = query(collection(db, "achats"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      setCommandes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Commande)));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const updateStatut = async (commandeId: string, newStatut: string) => {
    setUpdating(commandeId);
    try {
      await updateDoc(doc(db, "achats", commandeId), { statut: newStatut });
      setCommandes(prev => prev.map(c => c.id === commandeId ? { ...c, statut: newStatut } : c));
    } catch (e) { alert("Erè: " + e); }
    setUpdating(null);
  };

  const filtered = commandes.filter(c => {
    const matchSearch = searchTerm === "" ||
      c.clientNom?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.clientEmail?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatut = filterStatut === "Tout" || c.statut === filterStatut;
    return matchSearch && matchStatut;
  });

  // Statistik
  const stats = {
    total: commandes.length,
    attente: commandes.filter(c => c.statut === "En attente").length,
    confirme: commandes.filter(c => c.statut === "Confirmé").length,
    livre: commandes.filter(c => c.statut === "Livré").length,
    totalRevenu: commandes.filter(c => c.statut !== "Annulé").reduce((s, c) => s + Number(c.total), 0),
  };

  if (loading) return (
    <main style={{ minHeight: "100vh", background: "#F5F0EB", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif" }}>
      <p style={{ color: "#888" }}>⏳ Chargement...</p>
    </main>
  );

  return (
    <main style={{ minHeight: "100vh", background: "#F5F0EB", fontFamily: "'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#1a1a2e", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button onClick={() => router.push("/dashboard")} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "8px 14px", borderRadius: "10px", cursor: "pointer", fontSize: "13px" }}>
            {"← Retour"}
          </button>
          <h1 style={{ margin: 0, color: "#fff", fontSize: "18px", fontWeight: 700 }}>🛍️ Commandes</h1>
        </div>
        <button onClick={loadCommandes} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "8px 14px", borderRadius: "10px", cursor: "pointer", fontSize: "13px" }}>
          🔄 Actualiser
        </button>
      </div>

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px 16px" }}>

        {/* Statistik */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "12px", marginBottom: "24px" }}>
          {[
            { label: "Total", value: stats.total, icon: "📋", color: "#1a1a2e" },
            { label: "En attente", value: stats.attente, icon: "⏳", color: "#f57c00" },
            { label: "Confirmé", value: stats.confirme, icon: "✅", color: "#2e7d32" },
            { label: "Livré", value: stats.livre, icon: "📦", color: "#6a1b9a" },
            { label: "Revenu", value: `$${stats.totalRevenu.toLocaleString()}`, icon: "💰", color: "#e63946" },
          ].map(({ label, value, icon, color }) => (
            <div key={label} style={{ background: "#fff", borderRadius: "14px", padding: "16px", border: "1px solid #eee", textAlign: "center" }}>
              <p style={{ margin: "0 0 4px", fontSize: "24px" }}>{icon}</p>
              <p style={{ margin: "0 0 2px", fontSize: "20px", fontWeight: 800, color }}>{value}</p>
              <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Filtè */}
        <div style={{ background: "#fff", borderRadius: "14px", padding: "16px", marginBottom: "16px", border: "1px solid #eee", display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          {/* Rechèch */}
          <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
            <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }}>🔍</span>
            <input
              type="text" placeholder="Chercher par nom ou email..."
              value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: "100%", padding: "10px 14px 10px 36px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "14px", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
              onFocus={(e) => e.target.style.borderColor = "#1a1a2e"}
              onBlur={(e) => e.target.style.borderColor = "#eee"}
            />
          </div>

          {/* Filtre statut */}
          <select value={filterStatut} onChange={(e) => setFilterStatut(e.target.value)} style={{ padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "14px", outline: "none", fontFamily: "inherit", background: "#fff" }}>
            <option value="Tout">Tous les statuts</option>
            {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Lis kòmand */}
        {filtered.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: "16px", padding: "60px", textAlign: "center", border: "1px solid #eee" }}>
            <p style={{ fontSize: "48px", margin: "0 0 12px" }}>📭</p>
            <p style={{ color: "#666", fontSize: "16px", margin: 0 }}>Aucune commande trouvée.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {filtered.map((commande) => {
              const statutInfo = STATUT_COLORS[commande.statut] ?? STATUT_COLORS["En attente"];
              return (
                <div key={commande.id} style={{ background: "#fff", borderRadius: "16px", border: "1px solid #eee", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
                  {/* Header kòmand */}
                  <div style={{ padding: "14px 16px", borderBottom: "1px solid #f5f5f5", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                    <div>
                      <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: "15px", color: "#1a1a2e" }}>
                        👤 {commande.clientNom || "Client inconnu"}
                      </p>
                      <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>
                        {commande.clientEmail} • {new Date(commande.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <span style={{ background: statutInfo.bg, color: statutInfo.color, padding: "4px 12px", borderRadius: "999px", fontSize: "12px", fontWeight: 700 }}>
                      {statutInfo.icon} {commande.statut}
                    </span>
                  </div>

                  {/* Pwodwi yo */}
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #f5f5f5" }}>
                    {commande.produits?.map((p, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", color: "#333", marginBottom: "4px" }}>
                        <span>• {p.marque} {p.modele}</span>
                        <span style={{ fontWeight: 700 }}>${Number(p.prix).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>

                  {/* Footer — Total + Aksyon */}
                  <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                    <div>
                      <p style={{ margin: "0 0 2px", fontWeight: 800, fontSize: "16px", color: "#1a1a2e" }}>
                        Total: ${Number(commande.total).toLocaleString()}
                      </p>
                      <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>
                        Via {commande.methode}{commande.banque ? ` (${commande.banque})` : ""}
                      </p>
                    </div>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                      {/* Chanje statut */}
                      <select
                        value={commande.statut}
                        onChange={(e) => updateStatut(commande.id, e.target.value)}
                        disabled={updating === commande.id}
                        style={{ padding: "8px 12px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "13px", outline: "none", fontFamily: "inherit", background: "#fff", cursor: "pointer" }}
                      >
                        {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>

                      {/* WhatsApp */}
                      {commande.clientEmail && (
                        <button
                          onClick={() => window.open(`https://wa.me/?text=Bonjou ${commande.clientNom}, votre commande est ${commande.statut}.`, "_blank")}
                          style={{ background: "#25D366", color: "#fff", border: "none", borderRadius: "10px", padding: "8px 12px", cursor: "pointer", fontSize: "13px", fontWeight: 700 }}
                        >
                          💬 WhatsApp
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}