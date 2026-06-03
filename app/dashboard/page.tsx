"use client";
import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { useRouter } from "next/navigation";
import { db } from "../../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import {
  ShoppingCart, Package, Users, BarChart2, Printer, Settings,
  UserPlus, Badge, Truck, FileText, Video, Phone, HardHat,
  Building2, LogOut, Store,
} from "lucide-react";

interface UserSession {
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  permissions: Record<string, boolean>;
}

interface MenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  href: string;
  permKey?: string;
  adminOnly?: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  { key: "factures",     label: "Fakturation",  icon: <ShoppingCart size={36} />, color: "#2196F3", href: "/dashboard/factures",     permKey: "factureVoir" },
  { key: "produits",     label: "Pwodwi",       icon: <Package size={36} />,      color: "#FF9800", href: "/dashboard/produits",     permKey: "produitVoir" },
  { key: "clients",      label: "Kliyan",       icon: <Users size={36} />,        color: "#4CAF50", href: "/dashboard/clients",      permKey: "clientVoir" },
  { key: "rapports",     label: "Rapò",         icon: <BarChart2 size={36} />,    color: "#F44336", href: "/dashboard/rapports",     permKey: "rapportVoir" },
  { key: "imprimante",   label: "Imprimante",   icon: <Printer size={36} />,      color: "#9C27B0", href: "/dashboard/imprimante",   permKey: "imprimanteVoir" },
  { key: "parametres",   label: "Paramètre",    icon: <Settings size={36} />,     color: "#9E9E9E", href: "/dashboard/parametres",   permKey: "parametreVoir" },
  { key: "utilisateurs", label: "Itilizatè",    icon: <UserPlus size={36} />,     color: "#009688", href: "/dashboard/utilisateurs", permKey: "utilisateurVoir" },
  { key: "vendeurs",     label: "Vendeurs",     icon: <Badge size={36} />,        color: "#3F51B5", href: "/dashboard/vendeurs",     permKey: "vendeurVoir" },
  { key: "fournisseurs", label: "Fournisseur",  icon: <Truck size={36} />,        color: "#795548", href: "/dashboard/fournisseurs", permKey: "fournisseurVoir" },
  { key: "fiche",        label: "Fiche",        icon: <FileText size={36} />,     color: "#E91E63", href: "/dashboard/fiche",        permKey: "ficheVoir" },
  { key: "camera",       label: "Camera",       icon: <Video size={36} />,        color: "#00BCD4", href: "/dashboard/camera",       permKey: "cameraVoir" },
  { key: "calling",      label: "Calling",      icon: <Phone size={36} />,        color: "#00BCD4", href: "/dashboard/calling",      permKey: "callingVoir" },
  { key: "workers",      label: "Workers",      icon: <HardHat size={36} />,      color: "#795548", href: "/dashboard/workers",      permKey: "workersVoir" },
  { key: "local",        label: "Local",        icon: <Building2 size={36} />,    color: "#4CAF50", href: "/dashboard/local",        permKey: "localVoir" },
  { key: "site-settings", label: "Setting Site Web", icon: <Globe size={36} />, color: "#e63946", href: "/dashboard/site-settings", adminOnly: true },
  { key: "commandes", label: "Commandes", icon: <ShoppingCart size={36} />, color: "#FF5722", href: "/dashboard/commandes", adminOnly: true },
];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser]       = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const session = JSON.parse(raw) as UserSession;
      getDoc(doc(db, "users", session.username)).then((snap) => {
        if (!snap.exists()) { localStorage.removeItem("ms_web_user"); router.push("/login"); return; }
        const data = snap.data();
        if (data.isBlocked) { localStorage.removeItem("ms_web_user"); router.push("/login"); return; }
        const updated: UserSession = {
          username:    data.username ?? session.username,
          displayName: data.displayName ?? session.username,
          isAdmin:     data.isAdmin ?? false,
          localId:     data.localId ?? "all",
          permissions: data,
        };
        localStorage.setItem("ms_web_user", JSON.stringify(updated));
        setUser(updated);
        setLoading(false);
      });
    } catch { router.push("/login"); }
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("ms_web_user");
    router.push("/login");
  };

  const canSee = (item: MenuItem): boolean => {
    if (!user) return false;
    if (user.isAdmin) return true;
    if (item.adminOnly) return false;
    if (item.permKey) return user.permissions[item.permKey] === true;
    return false;
  };

  const visibleItems = MENU_ITEMS.filter(canSee);

  if (loading) return (
    <main style={{ minHeight: "100vh", background: "#F5F0EB", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: "48px", height: "48px", border: "4px solid #eee", borderTop: "4px solid #1a1a2e", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
        <p style={{ color: "#888" }}>Chajman...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </main>
  );

  return (
    <main style={{ minHeight: "100vh", background: "#F5F0EB", fontFamily: "'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#1a1a2e", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 10px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img src="https://i.ibb.co/gLmkySCv/ab785ed1481b.jpg" alt="Logo" style={{ height: "38px", borderRadius: "8px", objectFit: "contain" }} />
          <div>
            <p style={{ margin: 0, color: "#fff", fontWeight: 700, fontSize: "16px" }}>
              Million<span style={{ color: "#e63946" }}>Store</span>
            </p>
            <p style={{ margin: 0, color: "#aaa", fontSize: "11px" }}>Dashboard</p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ textAlign: "right", marginRight: "8px" }}>
            <p style={{ margin: 0, color: "#fff", fontWeight: 600, fontSize: "14px" }}>{user?.displayName}</p>
            <span style={{ background: user?.isAdmin ? "#e63946" : "#4CAF50", color: "#fff", padding: "1px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 700 }}>
              {user?.isAdmin ? "ADMIN" : "ITILIZATÈ"}
            </span>
          </div>

          <a href="/" style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "8px 14px", borderRadius: "10px", fontSize: "13px", fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", gap: "6px" }}>
            <Store size={15} /> {"Sit la"}
          </a>

          <button onClick={handleLogout} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "8px 14px", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
            <LogOut size={15} /> Dekonekte
          </button>
        </div>
      </div>

      {/* Kò */}
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 20px" }}>

        {/* Bonjou */}
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ margin: "0 0 4px", fontSize: "26px", color: "#1a1a2e", fontWeight: 900 }}>
            👋 Bonjou, {user?.displayName}!
          </h1>
          <p style={{ margin: 0, color: "#888", fontSize: "14px" }}>
            {user?.isAdmin ? "Ou gen aksè konplè ak tout sistèm nan." : "Ou gen aksè ak seksyon yo admin otorize pou ou."}
          </p>
        </div>

        {/* Grid menu */}
        {visibleItems.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: "20px", padding: "60px", textAlign: "center", border: "1px solid #eee" }}>
            <p style={{ fontSize: "48px", margin: "0 0 12px" }}>🔒</p>
            <p style={{ color: "#666", fontSize: "16px", margin: 0 }}>Ou pa gen permisyon. Kontakte Admin.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "16px" }}>
            {visibleItems.map((item) => (
              <a key={item.key} href={item.href} style={{ textDecoration: "none" }}>
                <div style={{
                  background: "#fff", borderRadius: "20px",
                  padding: "28px 16px", border: "1px solid #eee",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                  cursor: "pointer", display: "flex", flexDirection: "column",
                  alignItems: "center", gap: "14px", textAlign: "center",
                  transition: "all 0.2s",
                }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLDivElement;
                    el.style.transform = "translateY(-4px)";
                    el.style.boxShadow = `0 12px 28px ${item.color}30`;
                    el.style.borderColor = `${item.color}50`;
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLDivElement;
                    el.style.transform = "";
                    el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.05)";
                    el.style.borderColor = "#eee";
                  }}
                >
                  {/* Ikòn */}
                  <div style={{
                    width: "70px", height: "70px", borderRadius: "18px",
                    background: `${item.color}18`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: item.color,
                  }}>
                    {item.icon}
                  </div>

                  {/* Label */}
                  <p style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#1a1a2e" }}>
                    {item.label}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}