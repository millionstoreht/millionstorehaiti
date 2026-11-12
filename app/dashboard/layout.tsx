"use client";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { Menu as MenuIcon, Search, X, LogOut, TrendingUp } from "lucide-react";
import { db, auth } from "../../lib/firebase";
import { touchPresence } from "../../lib/auth-utils";
import { C, MENU_ITEMS, MenuItem, UserSession, readCol, DashboardContext } from "./dashboard-shared";

// ══════════════════════════════════════════════════════════════════════════
// PAJ KI GEN SHELL LA (header + meni + ba anba) NAN LAYOUT SA A.
// Lòt paj yo (rapports, vendeurs, ...) kontinye ak pwòp header yo jiskaske
// nou migre yo youn pa youn. Lè yon paj migre, ajoute chemen li la a.
// ══════════════════════════════════════════════════════════════════════════
const SHELL_ROUTES = ["/dashboard"];

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const rawPath = usePathname() || "";
  const path = rawPath.replace(/\/$/, "") || "/";
  const useShell = SHELL_ROUTES.includes(path);

  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [locals, setLocals] = useState<{ id: string; name: string }[]>([]);
  const [localId, setLocalIdState] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [q, setQ] = useState("");
  const [online, setOnline] = useState(true);

  // Redireksyon vè /login: yon sèl fwa, epi apre premye rann lan
  // (evite erè "Router action dispatched before initialization")
  const redirected = useRef(false);
  const [loadError, setLoadError] = useState("");
  const goLogin = useCallback(() => {
    if (redirected.current) return;
    redirected.current = true;
    setTimeout(() => router.replace("/login"), 0);
  }, [router]);

  // ── Session (chaje yon sèl fwa, rete nan memwa pandan navigasyon) ──
  useEffect(() => {
    if (!useShell || user) return;
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { goLogin(); return; }
    try {
      const session = JSON.parse(raw) as UserSession;
      if (!session.uid) { localStorage.removeItem("ms_web_user"); goLogin(); return; }
      getDoc(doc(db, "users", session.uid)).then((s) => {
        if (!s.exists()) { localStorage.removeItem("ms_web_user"); goLogin(); return; }
        const data: any = s.data();
        if (data.isBlocked) { localStorage.removeItem("ms_web_user"); goLogin(); return; }
        const updated: UserSession = {
          uid: session.uid,
          username: data.username ?? session.username,
          displayName: data.displayName ?? session.username,
          isAdmin: data.isAdmin ?? false,
          localId: data.localId ?? "all",
          permissions: data,
        };
        localStorage.setItem("ms_web_user", JSON.stringify(updated));
        setUser(updated);
        setLoading(false);
      }).catch((e: any) => {
        console.error("Erè chaje sesyon:", e);
        setLoadError(String(e?.message || e));
      });
    } catch { goLogin(); }
  }, [useShell, user, goLogin]);

  // ── Présence (erè yo pa kraze paj la) ──
  useEffect(() => {
    if (!user) return;
    const ping = () => {
      try { Promise.resolve(touchPresence(user.uid)).catch(() => {}); } catch { /* */ }
    };
    ping();
    const interval = setInterval(ping, 45000);
    return () => clearInterval(interval);
  }, [user]);

  // ── En ligne / hors ligne ──
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ── Liste des locals + local sélectionné ──
  useEffect(() => {
    if (!user) return;
    if (user.localId && user.localId !== "all") { setLocalIdState(user.localId); return; }
    (async () => {
      const list = await readCol(["locals"], 8000);
      const ls = list.map((l: any) => ({ id: String(l.id), name: String(l.name || l.id) }));
      setLocals(ls);
      const saved = typeof window !== "undefined" ? localStorage.getItem("ms_dash_local") : null;
      setLocalIdState(ls.find((l) => l.id === saved)?.id || ls[0]?.id || "");
    })();
  }, [user]);

  const setLocalId = useCallback((id: string) => {
    setLocalIdState(id);
    try { localStorage.setItem("ms_dash_local", id); } catch { /* */ }
  }, []);

  // Fèmen drawer la chak fwa paj la chanje
  useEffect(() => { setDrawer(false); }, [path]);

  const handleLogout = () => {
    localStorage.removeItem("ms_web_user");
    signOut(auth).catch(() => {});
    router.push("/login");
  };

  const canSee = (item: MenuItem): boolean => {
    if (!user) return false;
    if (user.isAdmin) return true;
    if (item.adminOnly) return false;
    if (item.permKeys) return item.permKeys.some((k) => user.permissions[k] === true);
    if (item.permKey) return (user.permissions[item.permKey] ?? item.permDefault ?? false) === true;
    return true;
  };

  const visibleItems = useMemo(() => MENU_ITEMS.filter(canSee), [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const searchResults = useMemo(() => {
    const n = norm(q.trim());
    return n ? visibleItems.filter((i) => norm(i.label).includes(n) || norm(i.key).includes(n)) : [];
  }, [q, visibleItems]);

  const ctx = useMemo(
    () => ({ user, visibleItems, locals, localId, setLocalId, online }),
    [user, visibleItems, locals, localId, setLocalId, online],
  );

  const isActive = (href: string) => (href === "/dashboard" ? path === "/dashboard" : path.startsWith(href));
  const admin = !!user?.isAdmin;

  // Paj ki poko migre: pa gen shell, se pwòp header yo ki aktif
  if (!useShell) return <>{children}</>;

  if (loading && loadError) return (
    <main style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: "28px 24px", maxWidth: 380, textAlign: "center", boxShadow: "0 12px 40px rgba(0,60,160,0.15)" }}>
        <p style={{ fontSize: 40, margin: "0 0 8px" }}>⚠️</p>
        <p style={{ margin: "0 0 6px", fontWeight: 800, color: C.text, fontSize: 17 }}>Impossible de charger votre session</p>
        <p style={{ margin: "0 0 18px", color: C.grey, fontSize: 13, lineHeight: 1.5 }}>{loadError}</p>
        <button onClick={() => window.location.reload()} style={{ width: "100%", padding: 12, background: "#0a2a7a", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, cursor: "pointer", marginBottom: 8, fontFamily: "inherit" }}>Réessayer</button>
        <button onClick={() => { localStorage.removeItem("ms_web_user"); window.location.href = "/login"; }} style={{ width: "100%", padding: 12, background: "#fff", color: "#0a2a7a", border: "2px solid #0a2a7a", borderRadius: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Se reconnecter</button>
      </div>
    </main>
  );

  if (loading) return (
    <main style={{ minHeight: "100vh", background: `radial-gradient(circle at 50% 35%, #ffffff 0%, ${C.bg} 70%)`, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ textAlign: "center", animation: "ms-splash-in .5s ease-out both" }}>
        <div style={{ background: "#fff", borderRadius: 28, padding: "22px 26px", boxShadow: "0 12px 40px rgba(0,60,160,0.15)", display: "inline-block", maxWidth: "100%" }}>
          <img src="/logo-full.png" alt="MillionStore" style={{ width: "min(260px, 62vw)", height: "auto", display: "block", animation: "ms-pulse 1.8s ease-in-out infinite" }} />
        </div>
        <div style={{ width: 160, height: 4, background: "#e6eefc", borderRadius: 4, overflow: "hidden", margin: "26px auto 10px" }}>
          <div style={{ width: "40%", height: "100%", background: "linear-gradient(90deg,#0a6cf0,#2ed12e)", borderRadius: 4, animation: "ms-load 1.2s ease-in-out infinite" }} />
        </div>
        <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Chargement...</p>
      </div>
      <style>{`
        @keyframes ms-splash-in { from { opacity: 0; transform: translateY(12px) scale(.97); } to { opacity: 1; transform: none; } }
        @keyframes ms-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.03); } }
        @keyframes ms-load { 0% { transform: translateX(-100%); } 100% { transform: translateX(260%); } }
      `}</style>
    </main>
  );

  return (
    <DashboardContext.Provider value={ctx}>
      <main style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Segoe UI', sans-serif" }}>
        {/* ── Header ── */}
        <div style={{ background: C.dark, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.3)", position: "sticky", top: 0, zIndex: 60 }}>
          <button className="ms-burger" onClick={() => setDrawer(true)} aria-label="Menu" style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer", display: "none", padding: 4 }}>
            <MenuIcon size={24} />
          </button>
          <Link href="/dashboard" aria-label="MillionStore" style={{ display: "flex", flexShrink: 0, background: "#fff", borderRadius: 12, padding: 3, boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}>
            <img src="/logo-icon.png" alt="MillionStore" width={38} height={38} style={{ width: 38, height: 38, borderRadius: 9, objectFit: "contain", display: "block" }} />
          </Link>
          <div className="ms-brand">
            <p style={{ margin: 0, color: "#fff", fontWeight: 700, fontSize: 16 }}>Million<span style={{ color: "#e63946" }}>Store</span></p>
            <p style={{ margin: 0, color: "#aaa", fontSize: 11 }}>Tableau de bord</p>
          </div>

          {/* Recherche de page */}
          <div style={{ flex: 1, maxWidth: 460, margin: "0 auto", position: "relative" }}>
            <Search size={16} style={{ position: "absolute", left: 12, top: 11, color: "#aaa" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une page..."
              style={{ width: "100%", padding: "9px 34px 9px 34px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
            {q && <button onClick={() => setQ("")} style={{ position: "absolute", right: 8, top: 7, background: "none", border: "none", color: "#aaa", cursor: "pointer" }}><X size={16} /></button>}
            {q.trim() && (
              <div style={{ position: "absolute", top: 44, left: 0, right: 0, background: "#fff", borderRadius: 14, boxShadow: "0 10px 30px rgba(0,0,0,0.25)", overflow: "hidden", zIndex: 80 }}>
                {searchResults.length === 0 ? (
                  <div style={{ padding: 14, fontSize: 13, color: C.grey }}>Aucune page trouvée</div>
                ) : searchResults.map((r) => (
                  <Link key={r.key} href={r.href} onClick={() => setQ("")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", textDecoration: "none", color: C.text, fontSize: 14, fontWeight: 600 }}>
                    <span style={{ color: r.color, display: "flex" }}>{r.icon(18)}</span>{r.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="ms-user" style={{ textAlign: "right" }}>
            <p style={{ margin: 0, color: "#fff", fontWeight: 600, fontSize: 14 }}>{user?.displayName}</p>
            <span style={{ background: admin ? "#e63946" : "#4CAF50", color: "#fff", padding: "1px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700 }}>
              {admin ? "👑 ADMIN" : "👤 UTILISATEUR"}
            </span>
          </div>
          <button onClick={handleLogout} title="Déconnexion" style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "8px 12px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit" }}>
            <LogOut size={15} /> <span className="ms-logout-txt">Déconnexion</span>
          </button>
        </div>

        <div style={{ display: "flex" }}>
          {/* ── Menu latéral (Drawer) ── */}
          {drawer && <div className="ms-overlay" onClick={() => setDrawer(false)} />}
          <aside className={`ms-side ${drawer ? "open" : ""}`}>
            <div className="ms-side-head">
              <span style={{ fontWeight: 800, color: C.text }}>Menu</span>
              <button className="ms-close" onClick={() => setDrawer(false)} style={{ background: "none", border: "none", cursor: "pointer", display: "none" }}><X size={20} /></button>
            </div>
            <Link href="/dashboard" className={`ms-link ${isActive("/dashboard") ? "active" : ""}`}>
              <span style={{ color: C.primary, display: "flex" }}><TrendingUp size={18} /></span>Tableau de bord
            </Link>
            {visibleItems.map((m) => (
              <Link key={m.key} href={m.href} className={`ms-link ${isActive(m.href) ? "active" : ""}`}>
                <span style={{ color: m.color, display: "flex" }}>{m.icon(18)}</span>{m.label}
              </Link>
            ))}
            <button onClick={handleLogout} className="ms-link" style={{ border: "none", background: "none", width: "100%", cursor: "pointer", fontFamily: "inherit" }}>
              <span style={{ color: C.red, display: "flex" }}><LogOut size={18} /></span>Déconnexion
            </button>
          </aside>

          {/* ── Corps (kontni paj la chanje isit la sèlman) ── */}
          <div style={{ flex: 1, minWidth: 0, maxWidth: 1100, margin: "0 auto", padding: "24px 18px 90px" }}>
            {children}
          </div>
        </div>

        {/* ── Barre du bas ── */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: "1px solid #eee", display: "flex", justifyContent: "space-around", alignItems: "center", padding: "8px 0 12px", boxShadow: "0 -2px 10px rgba(0,0,0,0.06)", zIndex: 50 }}>
          {[
            { icon: "🏠", label: "Boutique", href: "/" },
            { icon: "⚡", label: "Tableau de bord", href: "/dashboard" },
            { icon: "⚙️", label: "Paramètres", href: "/dashboard/parametres" },
          ].map(({ icon, label, href }) => (
            <Link key={label} href={href} style={{ textDecoration: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 22 }}>{icon}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#888" }}>{label}</span>
            </Link>
          ))}
        </div>

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
          .ms-side { width: 240px; flex-shrink: 0; background: #fff; border-right: 1px solid #eee; min-height: calc(100vh - 62px); padding: 12px 8px; position: sticky; top: 62px; align-self: flex-start; max-height: calc(100vh - 62px); overflow-y: auto; }
          .ms-side-head { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px 10px; }
          .ms-link { display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-radius: 12px; text-decoration: none; color: ${C.text}; font-size: 14px; font-weight: 600; }
          .ms-link:hover { background: #fff4e5; }
          .ms-link.active { background: ${C.primary}1A; }
          .ms-overlay { display: none; }
          @media (max-width: 860px) {
            .ms-burger, .ms-close { display: block !important; }
            .ms-side { position: fixed; top: 0; left: 0; bottom: 0; z-index: 100; transform: translateX(-100%); transition: transform .25s; max-height: none; min-height: 100vh; box-shadow: 4px 0 24px rgba(0,0,0,0.2); }
            .ms-side.open { transform: translateX(0); }
            .ms-overlay { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 90; }
            .ms-user, .ms-brand, .ms-logout-txt { display: none; }
          }
        `}</style>
      </main>
    </DashboardContext.Provider>
  );
}