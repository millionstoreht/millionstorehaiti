"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { Settings, Type, MousePointer, CreditCard, Phone, Palette, DollarSign, Plus, Trash2, Edit2, Save, X, Check } from "lucide-react";

const DEFAULT_QUICK_BUTTONS_FOR_SETTINGS = [
  { id: "1", label: "Local",      icon: "📍", action: "scroll",     value: "hero",        color: "#1a1a2e", active: true },
  { id: "2", label: "Catégories", icon: "📂", action: "categories", value: "",            color: "#1a1a2e", active: true },
  { id: "3", label: "Bon Prix",   icon: "💰", action: "filter",     value: "priceAsc",   color: "#1a1a2e", active: true },
  { id: "4", label: "Spécial",    icon: "⭐", action: "special",    value: "",            color: "#1a1a2e", active: true },
  { id: "7", label: "Favoris",    icon: "🤍", action: "favorites",  value: "",            color: "#1a1a2e", active: true },
  { id: "8", label: "Livraison",  icon: "🚚", action: "livraison",  value: "",            color: "#1a1a2e", active: true },
  { id: "9", label: "Garantie",   icon: "🛡️", action: "garantie",   value: "",            color: "#1a1a2e", active: true },
];

interface UserSession {
  username: string;
  isAdmin: boolean;
  permissions: Record<string, boolean>;
}

interface CustomButton {
  id: string;
  label: string;
  action: "url" | "whatsapp" | "phone" | "email" | "modal" | string;
  value: string;
  color: string;
  icon: string;
  active: boolean;
}

interface CustomText {
  id: string;
  key: string;
  label: string;
  value: string;
  location: string;
}

interface SiteConfig {
  // Info Magazen
  nomMagazen: string;
  adres: string;
  telephone1: string;
  telephone2: string;
  email: string;
  logoUrl: string;
  horaire: string;
  // Banner
  bannerTexte: string;
  bannerAktif: boolean;
  // Hero
  heroTitle: string;
  heroSubtitle: string;
  heroBoutonTexte: string;
  // Peman
  moncashNumero: string;
  moncashNom: string;
  natcashNumero: string;
  natcashNom: string;
  bankHolder: string;
  bncGourde: string;
  bncDollar: string;
  sogebankGourde: string;
  sogebankDollar: string;
  buhGourde: string;
  buhDollar: string;
  unibankGourde: string;
  unibankDollar: string;
  // Kontak
  whatsapp1: string;
  whatsapp2: string;
  facebook: string;
  instagram: string;
  tiktok: string;
  // Taux
  taux: number;
  // Aparans
  couleurPrimaire: string;
  couleurSecondaire: string;
  // Bouton ak Tèks pèsonalize
  customButtons: CustomButton[];
  customTexts: CustomText[];
  livraisonTexte: string;
  garantieTexte: string;
}

const DEFAULT_CONFIG: SiteConfig = {
  nomMagazen: "MillionStore",
  adres: "#25,Delmas 83, Port-au-Prince, Haïti.",
  telephone1: "+509 38332483",
  telephone2: "+509 35012813",
  email: "millionstorehaiti@gmail.com",
  logoUrl: "https://i.ibb.co/gLmkySCv/ab785ed1481b.jpg",
  horaire: "Lendi - Samdi: 8h - 18h",
  bannerTexte: "🚀 Livrezon disponib!",
  bannerAktif: true,
  heroTitle: "MillionStore",
  heroSubtitle: "Meye pwodwi teknoloji nan Ayiti",
  heroBoutonTexte: "Achte Kounye a",
  moncashNumero: "+509 38 33 24 83",
  moncashNom: "Christian Hotes",
  natcashNumero: "+509 35 01 28 13",
  natcashNom: "Christian Hotes",
  bankHolder: "Christian Hotes",
  bncGourde: "27100 22696",
  bncDollar: "27110 08200",
  sogebankGourde: "140130 0650",
  sogebankDollar: "141113 6144",
  buhGourde: "310000 17984",
  buhDollar: "310000 17992",
  unibankGourde: "1802015 289989 36",
  unibankDollar: "1802016 289990 39",
  whatsapp1: "50938332483",
  whatsapp2: "50947733471",
  facebook: "",
  instagram: "",
  tiktok: "",
  taux: 1,
  couleurPrimaire: "#1a1a2e",
  couleurSecondaire: "#e63946",
  customButtons: [],
  customTexts: [],
  livraisonTexte: `🚚 Livraison Partout en Haïti – Achetez en toute confiance !\n\nPeu importe où vous vous trouvez en Haïti, MillionStore peut vous livrer votre commande en toute sécurité.\n\n✅ Livraison disponible dans tous les départements du pays\n✅ Expédition rapide via les compagnies de transport et autobus disponibles\n✅ Produits soigneusement emballés et vérifiés avant l'envoi\n✅ Suivi et confirmation de votre expédition\n\nComment ça fonctionne ?\n\n1️⃣ Vous choisissez votre produit.\n2️⃣ Vous effectuez le paiement du produit.\n3️⃣ Nous expédions votre commande le plus rapidement possible.\n4️⃣ Vous récupérez votre colis à votre destination et payez uniquement les frais de transport à l'arrivée.\n\n🔒 Votre paiement est sécurisé et votre commande est traitée avec sérieux et professionnalisme.\n\n📦 MillionStore — Votre commande, notre responsabilité. 🇭🇹✨`,

garantieTexte: `🛡️ Garantie MillionStore – Achetez en toute sérénité !\n\nChez MillionStore, nous nous engageons à vous offrir des produits de qualité, soigneusement testés et vérifiés avant chaque vente.\n\n✅ Produits testés avant la livraison\n✅ Assistance et accompagnement après l'achat\n✅ Service professionnel et transparent\n✅ Satisfaction client au cœur de nos priorités\n\nEn cas de problème lié au produit, nous nous engageons à le remplacer. Si aucun produit équivalent n'est disponible, nous vous remboursons intégralement votre argent.\n\n🔄 De plus, vous pouvez revenir à tout moment pour effectuer un échange et passer à un modèle plus récent ou plus performant.\n\n✨ MillionStore – La confiance, la qualité et le service avant tout. ✨`,
  
};

// ─── COMPONENTS ──────────────────────────────────────────────────────────────
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #eee", marginBottom: "20px", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #f5f5f5", display: "flex", alignItems: "center", gap: "10px", background: "#fafafa" }}>
        <span style={{ color: "#1a1a2e" }}>{icon}</span>
        <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#1a1a2e" }}>{title}</h2>
      </div>
      <div style={{ padding: "20px" }}>{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "" }: {
  label: string; value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#666", marginBottom: "5px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "14px", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
        onFocus={(e) => e.target.style.borderColor = "#1a1a2e"}
        onBlur={(e) => e.target.style.borderColor = "#eee"}
      />
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
      <span style={{ fontSize: "14px", fontWeight: 600, color: "#333" }}>{label}</span>
      <div onClick={() => onChange(!value)} style={{ width: "46px", height: "24px", borderRadius: "999px", background: value ? "#4CAF50" : "#ccc", position: "relative", cursor: "pointer", transition: "background 0.2s" }}>
        <div style={{ position: "absolute", top: "3px", left: value ? "23px" : "3px", width: "18px", height: "18px", borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
      </div>
    </div>
  );
}

export default function SiteSettingsPage() {
  const router = useRouter();
  const [user, setUser]       = useState<UserSession | null>(null);
  const [config, setConfig]   = useState<SiteConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [activeTab, setActiveTab] = useState("magasen");

  // Bouton editor state
  const [showBtnForm, setShowBtnForm]   = useState(false);
  const [editingBtn, setEditingBtn]     = useState<CustomButton | null>(null);
  const [btnLabel, setBtnLabel]         = useState("");
  const [btnAction, setBtnAction]       = useState<CustomButton["action"]>("url");
  const [btnValue, setBtnValue]         = useState("");
  const [btnColor, setBtnColor]         = useState("#1a1a2e");
  const [btnIcon, setBtnIcon]           = useState("🔗");

  // Tèks editor state
  const [showTxtForm, setShowTxtForm]   = useState(false);
  const [editingTxt, setEditingTxt]     = useState<CustomText | null>(null);
  const [txtKey, setTxtKey]             = useState("");
  const [txtLabel, setTxtLabel]         = useState("");
  const [txtValue, setTxtValue]         = useState("");
  const [txtLocation, setTxtLocation]   = useState("hero");

  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    const session = JSON.parse(raw) as UserSession;
    if (!session.isAdmin) { router.push("/dashboard"); return; }
    setUser(session);
    getDoc(doc(db, "parametres", "site_config")).then((snap) => {
      if (snap.exists()) {
        const data = snap.data() as SiteConfig;
        // Si pa gen customButtons nan Firestore, itilize defo yo
        if (!data.customButtons?.length) {
          data.customButtons = DEFAULT_QUICK_BUTTONS_FOR_SETTINGS;
        }
        setConfig({ ...DEFAULT_CONFIG, ...data });
      }
      setLoading(false);
    });
  }, [router]);

  const update = (key: keyof SiteConfig, value: unknown) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, "parametres", "site_config"), config, { merge: true });
      await setDoc(doc(db, "parametres", "taux"), { taux: config.taux }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { alert("Erè: " + e); }
    setSaving(false);
  };

  // ── Bouton CRUD ──
  const openAddBtn = () => {
    setEditingBtn(null); setBtnLabel(""); setBtnAction("url");
    setBtnValue(""); setBtnColor("#1a1a2e"); setBtnIcon("🔗");
    setShowBtnForm(true);
  };

  const openEditBtn = (btn: CustomButton) => {
    setEditingBtn(btn); setBtnLabel(btn.label); setBtnAction(btn.action);
    setBtnValue(btn.value); setBtnColor(btn.color); setBtnIcon(btn.icon);
    setShowBtnForm(true);
  };

  const saveBtn = () => {
    if (!btnLabel.trim() || !btnValue.trim()) return;
    const newBtn: CustomButton = {
      id: editingBtn?.id ?? Date.now().toString(),
      label: btnLabel.trim(), action: btnAction,
      value: btnValue.trim(), color: btnColor,
      icon: btnIcon, active: true,
    };
    const updated = editingBtn
      ? config.customButtons.map((b) => b.id === editingBtn.id ? newBtn : b)
      : [...config.customButtons, newBtn];
    update("customButtons", updated);
    setShowBtnForm(false);
  };

  const deleteBtn = (id: string) => {
    update("customButtons", config.customButtons.filter((b) => b.id !== id));
  };

  const toggleBtn = (id: string) => {
    update("customButtons", config.customButtons.map((b) => b.id === id ? { ...b, active: !b.active } : b));
  };

  // ── Tèks CRUD ──
  const openAddTxt = () => {
    setEditingTxt(null); setTxtKey(""); setTxtLabel(""); setTxtValue(""); setTxtLocation("hero");
    setShowTxtForm(true);
  };

  const openEditTxt = (txt: CustomText) => {
    setEditingTxt(txt); setTxtKey(txt.key); setTxtLabel(txt.label);
    setTxtValue(txt.value); setTxtLocation(txt.location);
    setShowTxtForm(true);
  };

  const saveTxt = () => {
    if (!txtLabel.trim() || !txtValue.trim()) return;
    const newTxt: CustomText = {
      id: editingTxt?.id ?? Date.now().toString(),
      key: txtKey.trim() || Date.now().toString(),
      label: txtLabel.trim(), value: txtValue.trim(), location: txtLocation,
    };
    const updated = editingTxt
      ? config.customTexts.map((t) => t.id === editingTxt.id ? newTxt : t)
      : [...config.customTexts, newTxt];
    update("customTexts", updated);
    setShowTxtForm(false);
  };

  const deleteTxt = (id: string) => {
    update("customTexts", config.customTexts.filter((t) => t.id !== id));
  };

  const TABS = [
    { key: "magasen",  label: "🏪 Magazen",  icon: <Settings size={14} /> },
    { key: "textes",   label: "📝 Tèks",     icon: <Type size={14} /> },
    { key: "boutons",  label: "🔘 Bouton",   icon: <MousePointer size={14} /> },
    { key: "peman",    label: "💳 Peman",    icon: <CreditCard size={14} /> },
    { key: "kontak",   label: "📞 Kontak",   icon: <Phone size={14} /> },
    { key: "aparans",  label: "🎨 Aparans",  icon: <Palette size={14} /> },
    { key: "taux",     label: "💱 Taux",     icon: <DollarSign size={14} /> },
  ];

  if (loading) return (
    <main style={{ minHeight: "100vh", background: "#F5F0EB", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#888" }}>⏳ Chajman...</p>
    </main>
  );

  return (
    <main style={{ minHeight: "100vh", background: "#F5F0EB", fontFamily: "'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#1a1a2e", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button onClick={() => router.push("/dashboard")} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "8px 14px", borderRadius: "10px", cursor: "pointer", fontSize: "13px" }}>
            {"← Retounen"}
          </button>
          <h1 style={{ margin: 0, color: "#fff", fontSize: "17px", fontWeight: 700 }}>🌐 Setting Site Web</h1>
        </div>
        <button onClick={handleSave} disabled={saving} style={{ background: saved ? "#4CAF50" : "#e63946", border: "none", color: "#fff", padding: "10px 22px", borderRadius: "12px", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>
          {saving ? "⏳..." : saved ? "✅ Sove!" : "💾 Sove"}
        </button>
      </div>

      <div style={{ maxWidth: "960px", margin: "0 auto", padding: "24px 20px" }}>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "20px", background: "#fff", borderRadius: "14px", padding: "6px", border: "1px solid #eee", flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{ flex: 1, minWidth: "100px", padding: "9px 12px", border: "none", borderRadius: "10px", cursor: "pointer", fontWeight: 700, fontSize: "13px", background: activeTab === t.key ? "#1a1a2e" : "transparent", color: activeTab === t.key ? "#fff" : "#888", fontFamily: "inherit" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── TAB MAGAZEN ── */}
        {activeTab === "magasen" && (
          <Section title="Info Magazen" icon={<Settings size={18} />}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              <Field label="Non Magazen" value={config.nomMagazen} onChange={(v) => update("nomMagazen", v)} />
              <Field label="Email" value={config.email} onChange={(v) => update("email", v)} type="email" />
              <Field label="Telefòn 1" value={config.telephone1} onChange={(v) => update("telephone1", v)} />
              <Field label="Telefòn 2" value={config.telephone2} onChange={(v) => update("telephone2", v)} />
            </div>
            <Field label="Adres" value={config.adres} onChange={(v) => update("adres", v)} />
            <Field label="Orè" value={config.horaire} onChange={(v) => update("horaire", v)} placeholder="Lendi-Samdi 8h-18h" />
            <Field label="URL Logo" value={config.logoUrl} onChange={(v) => update("logoUrl", v)} placeholder="https://..." />
            {config.logoUrl && <img src={config.logoUrl} alt="Logo" style={{ height: "60px", objectFit: "contain", marginTop: "8px", borderRadius: "8px" }} />}

            <div style={{ marginTop: "16px", borderTop: "1px solid #f0f0f0", paddingTop: "16px" }}>
              <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: "13px", color: "#666", textTransform: "uppercase" }}>Banner</p>
              <Field label="Tèks Banner" value={config.bannerTexte} onChange={(v) => update("bannerTexte", v)} placeholder="🚀 Livrezon disponib!" />
              <Toggle label="Banner aktif" value={config.bannerAktif} onChange={(v) => update("bannerAktif", v)} />
              {config.bannerAktif && (
                <div style={{ marginTop: "10px", background: "#1a1a2e", color: "#fff", padding: "10px", borderRadius: "8px", textAlign: "center", fontSize: "14px" }}>
                  {config.bannerTexte}
                </div>
              )}
            </div>
            <div style={{ marginTop: "16px", borderTop: "1px solid #f0f0f0", paddingTop: "16px" }}>
  <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: "13px", color: "#666", textTransform: "uppercase" }}>Livraison & Garantie</p>
  <div style={{ marginBottom: "14px" }}>
    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#666", marginBottom: "5px", textTransform: "uppercase" }}>
      Texte Livraison
    </label>
    <textarea
      value={config.livraisonTexte}
      onChange={(e) => update("livraisonTexte", e.target.value)}
      rows={4}
      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "14px", outline: "none", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }}
      onFocus={(e) => e.target.style.borderColor = "#1a1a2e"}
      onBlur={(e) => e.target.style.borderColor = "#eee"}
    />
  </div>
  <div style={{ marginBottom: "14px" }}>
    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#666", marginBottom: "5px", textTransform: "uppercase" }}>
      Texte Garantie
    </label>
    <textarea
      value={config.garantieTexte}
      onChange={(e) => update("garantieTexte", e.target.value)}
      rows={4}
      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "14px", outline: "none", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }}
      onFocus={(e) => e.target.style.borderColor = "#1a1a2e"}
      onBlur={(e) => e.target.style.borderColor = "#eee"}
    />
  </div>
</div>

            <div style={{ marginTop: "16px", borderTop: "1px solid #f0f0f0", paddingTop: "16px" }}>
              <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: "13px", color: "#666", textTransform: "uppercase" }}>Seksyon Hero</p>
              <Field label="Tit prensipal" value={config.heroTitle} onChange={(v) => update("heroTitle", v)} />
              <Field label="Sous-tit" value={config.heroSubtitle} onChange={(v) => update("heroSubtitle", v)} />
              <Field label="Tèks bouton prensipal" value={config.heroBoutonTexte} onChange={(v) => update("heroBoutonTexte", v)} />
            </div>
          </Section>
        )}

        {/* ── TAB TÈKS ── */}
        {activeTab === "textes" && (
          <Section title="Jere Tèks Sit la" icon={<Type size={18} />}>
            <button onClick={openAddTxt} style={{ background: "#1a1a2e", color: "#fff", border: "none", borderRadius: "12px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: "14px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "8px", fontFamily: "inherit" }}>
              <Plus size={16} /> Ajoute Nouvo Tèks
            </button>

            {/* Form tèks */}
            {showTxtForm && (
              <div style={{ background: "#f8f9fa", borderRadius: "14px", padding: "20px", marginBottom: "20px", border: "1px solid #e0e0e0" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: "15px", fontWeight: 700 }}>
                  {editingTxt ? "✏️ Modifye Tèks" : "➕ Nouvo Tèks"}
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                  <Field label="Label (non pou admin)" value={txtLabel} onChange={setTxtLabel} placeholder="Ex: Mesaj byenveni" />
                  <div style={{ marginBottom: "14px" }}>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#666", marginBottom: "5px", textTransform: "uppercase" }}>Kote nan sit la</label>
                    <select value={txtLocation} onChange={(e) => setTxtLocation(e.target.value)} style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "14px", outline: "none", fontFamily: "inherit" }}>
                      <option value="hero">Hero (anwo paj la)</option>
                      <option value="banner">Banner</option>
                      <option value="footer">Footer</option>
                      <option value="about">Seksyon À propos</option>
                      <option value="autre">Lòt</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: "14px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#666", marginBottom: "5px", textTransform: "uppercase" }}>Kontni tèks la</label>
                  <textarea
                    value={txtValue} onChange={(e) => setTxtValue(e.target.value)}
                    placeholder="Ekri tèks ou vle a..."
                    rows={3}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #eee", fontSize: "14px", outline: "none", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }}
                    onFocus={(e) => e.target.style.borderColor = "#1a1a2e"}
                    onBlur={(e) => e.target.style.borderColor = "#eee"}
                  />
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button onClick={saveTxt} style={{ background: "#1a1a2e", color: "#fff", border: "none", borderRadius: "10px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontFamily: "inherit" }}>
                    <Save size={15} /> Sove
                  </button>
                  <button onClick={() => setShowTxtForm(false)} style={{ background: "#f0f0f0", color: "#333", border: "none", borderRadius: "10px", padding: "10px 16px", cursor: "pointer", fontFamily: "inherit" }}>
                    <X size={15} />
                  </button>
                </div>
              </div>
            )}

            {/* Lis tèks */}
            {config.customTexts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#aaa" }}>
                <Type size={40} style={{ marginBottom: "12px", opacity: 0.3 }} />
                <p style={{ margin: 0 }}>Pa gen tèks pèsonalize toujou. Ajoute youn!</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {config.customTexts.map((txt) => (
                  <div key={txt.id} style={{ background: "#f8f9fa", borderRadius: "12px", padding: "14px 16px", border: "1px solid #eee", display: "flex", alignItems: "flex-start", gap: "12px" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: "14px", color: "#1a1a2e" }}>{txt.label}</p>
                        <span style={{ background: "#e8f4fd", color: "#1a6fc4", padding: "1px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 600 }}>{txt.location}</span>
                      </div>
                      <p style={{ margin: 0, color: "#555", fontSize: "13px", lineHeight: 1.5 }}>{txt.value}</p>
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => openEditTxt(txt)} style={{ background: "#e8f4fd", border: "none", borderRadius: "8px", padding: "6px 10px", cursor: "pointer", color: "#1a6fc4" }}>
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => deleteTxt(txt.id)} style={{ background: "#fdecea", border: "none", borderRadius: "8px", padding: "6px 10px", cursor: "pointer", color: "#c0392b" }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── TAB BOUTON ── */}
        {activeTab === "boutons" && (
          <Section title="Jere Bouton Sit la" icon={<MousePointer size={18} />}>
            <button onClick={openAddBtn} style={{ background: "#1a1a2e", color: "#fff", border: "none", borderRadius: "12px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: "14px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "8px", fontFamily: "inherit" }}>
              <Plus size={16} /> Ajoute Nouvo Bouton
            </button>

            {/* Form bouton */}
            {showBtnForm && (
              <div style={{ background: "#f8f9fa", borderRadius: "14px", padding: "20px", marginBottom: "20px", border: "1px solid #e0e0e0" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: "15px", fontWeight: 700 }}>
                  {editingBtn ? "✏️ Modifye Bouton" : "➕ Nouvo Bouton"}
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                  <Field label="Non Bouton" value={btnLabel} onChange={setBtnLabel} placeholder="Ex: Kontakte nou" />
                  <Field label="Ikòn (emoji)" value={btnIcon} onChange={setBtnIcon} placeholder="💬" />
                </div>

                <div style={{ marginBottom: "14px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#666", marginBottom: "5px", textTransform: "uppercase" }}>Aksyon bouton an</label>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {[
                      { key: "url", label: "🔗 Lyen URL" },
                      { key: "whatsapp", label: "💬 WhatsApp" },
                      { key: "phone", label: "📞 Telefòn" },
                      { key: "email", label: "✉️ Email" },
                      { key: "modal", label: "🪟 Modal" },
                    ].map((a) => (
                      <button key={a.key} onClick={() => setBtnAction(a.key as CustomButton["action"])} style={{ padding: "8px 14px", border: "none", borderRadius: "10px", cursor: "pointer", fontWeight: 600, fontSize: "13px", background: btnAction === a.key ? "#1a1a2e" : "#eee", color: btnAction === a.key ? "#fff" : "#333", fontFamily: "inherit" }}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>

                <Field
                  label={btnAction === "whatsapp" ? "Nimewo WhatsApp (san +)" : btnAction === "phone" ? "Nimewo Telefòn" : btnAction === "email" ? "Adrès Email" : btnAction === "modal" ? "Kontni modal la" : "URL"}
                  value={btnValue} onChange={setBtnValue}
                  placeholder={btnAction === "whatsapp" ? "50938332483" : btnAction === "url" ? "https://..." : ""}
                />

                <div style={{ marginBottom: "14px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#666", marginBottom: "5px", textTransform: "uppercase" }}>Koulè bouton</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <input type="color" value={btnColor} onChange={(e) => setBtnColor(e.target.value)} style={{ width: "44px", height: "44px", borderRadius: "10px", border: "none", cursor: "pointer" }} />
                    <div style={{ background: btnColor, color: "#fff", padding: "10px 20px", borderRadius: "10px", fontWeight: 700, fontSize: "14px" }}>
                      {btnIcon} {btnLabel || "Preview"}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px" }}>
                  <button onClick={saveBtn} style={{ background: "#1a1a2e", color: "#fff", border: "none", borderRadius: "10px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontFamily: "inherit" }}>
                    <Save size={15} /> Sove
                  </button>
                  <button onClick={() => setShowBtnForm(false)} style={{ background: "#f0f0f0", color: "#333", border: "none", borderRadius: "10px", padding: "10px 16px", cursor: "pointer", fontFamily: "inherit" }}>
                    <X size={15} />
                  </button>
                </div>
              </div>
            )}

            {/* Lis bouton */}
            {config.customButtons.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#aaa" }}>
                <MousePointer size={40} style={{ marginBottom: "12px", opacity: 0.3 }} />
                <p style={{ margin: 0 }}>Pa gen bouton pèsonalize toujou. Ajoute youn!</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {config.customButtons.map((btn) => (
                  <div key={btn.id} style={{ background: "#f8f9fa", borderRadius: "12px", padding: "14px 16px", border: "1px solid #eee", display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: `${btn.color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", color: btn.color }}>
                      {btn.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: "14px", color: "#1a1a2e" }}>{btn.label}</p>
                      <p style={{ margin: 0, color: "#888", fontSize: "12px" }}>{btn.action} → {btn.value}</p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {/* Toggle aktif */}
                      <div onClick={() => toggleBtn(btn.id)} style={{ width: "38px", height: "20px", borderRadius: "999px", background: btn.active ? "#4CAF50" : "#ccc", position: "relative", cursor: "pointer" }}>
                        <div style={{ position: "absolute", top: "2px", left: btn.active ? "19px" : "2px", width: "16px", height: "16px", borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
                      </div>
                      <button
  onClick={() => {
    const idx = config.customButtons.findIndex(b => b.id === btn.id);
    if (idx <= 0) return;
    const newBtns = [...config.customButtons];
    [newBtns[idx - 1], newBtns[idx]] = [newBtns[idx], newBtns[idx - 1]];
    update("customButtons", newBtns);
  }}
  style={{ background: "#f0f0f0", border: "none", borderRadius: "8px", padding: "6px 10px", cursor: "pointer", color: "#333" }}
>
  ↑
</button>
<button
  onClick={() => {
    const idx = config.customButtons.findIndex(b => b.id === btn.id);
    if (idx >= config.customButtons.length - 1) return;
    const newBtns = [...config.customButtons];
    [newBtns[idx + 1], newBtns[idx]] = [newBtns[idx], newBtns[idx + 1]];
    update("customButtons", newBtns);
  }}
  style={{ background: "#f0f0f0", border: "none", borderRadius: "8px", padding: "6px 10px", cursor: "pointer", color: "#333" }}
>
  ↓
</button>
                      <button onClick={() => openEditBtn(btn)} style={{ background: "#e8f4fd", border: "none", borderRadius: "8px", padding: "6px 10px", cursor: "pointer", color: "#1a6fc4" }}>
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => deleteBtn(btn.id)} style={{ background: "#fdecea", border: "none", borderRadius: "8px", padding: "6px 10px", cursor: "pointer", color: "#c0392b" }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── TAB PEMAN ── */}
        {activeTab === "peman" && (
          <>
            <Section title="MonCash" icon={<CreditCard size={18} />}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
                <Field label="Nimewo MonCash" value={config.moncashNumero} onChange={(v) => update("moncashNumero", v)} />
                <Field label="Non Titulè" value={config.moncashNom} onChange={(v) => update("moncashNom", v)} />
              </div>
            </Section>
            <Section title="NatCash" icon={<CreditCard size={18} />}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
                <Field label="Nimewo NatCash" value={config.natcashNumero} onChange={(v) => update("natcashNumero", v)} />
                <Field label="Non Titulè" value={config.natcashNom} onChange={(v) => update("natcashNom", v)} />
              </div>
            </Section>
            <Section title="Virement Bancaire" icon={<CreditCard size={18} />}>
              <Field label="Non Titulè Kont" value={config.bankHolder} onChange={(v) => update("bankHolder", v)} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
                <div>
                  <p style={{ fontWeight: 700, color: "#555", fontSize: "13px", margin: "0 0 8px" }}>BNC</p>
                  <Field label="Kont Goud" value={config.bncGourde} onChange={(v) => update("bncGourde", v)} />
                  <Field label="Kont Dola" value={config.bncDollar} onChange={(v) => update("bncDollar", v)} />
                </div>
                <div>
                  <p style={{ fontWeight: 700, color: "#555", fontSize: "13px", margin: "0 0 8px" }}>Sogebank</p>
                  <Field label="Kont Goud" value={config.sogebankGourde} onChange={(v) => update("sogebankGourde", v)} />
                  <Field label="Kont Dola" value={config.sogebankDollar} onChange={(v) => update("sogebankDollar", v)} />
                </div>
                <div>
                  <p style={{ fontWeight: 700, color: "#555", fontSize: "13px", margin: "0 0 8px" }}>BUH</p>
                  <Field label="Kont Goud" value={config.buhGourde} onChange={(v) => update("buhGourde", v)} />
                  <Field label="Kont Dola" value={config.buhDollar} onChange={(v) => update("buhDollar", v)} />
                </div>
                <div>
                  <p style={{ fontWeight: 700, color: "#555", fontSize: "13px", margin: "0 0 8px" }}>Unibank</p>
                  <Field label="Kont Goud" value={config.unibankGourde} onChange={(v) => update("unibankGourde", v)} />
                  <Field label="Kont Dola" value={config.unibankDollar} onChange={(v) => update("unibankDollar", v)} />
                </div>
              </div>
            </Section>
          </>
        )}

        {/* ── TAB KONTAK ── */}
        {activeTab === "kontak" && (
          <Section title="Kontak & Rezo Sosyal" icon={<Phone size={18} />}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              <Field label="WhatsApp 1 (san +)" value={config.whatsapp1} onChange={(v) => update("whatsapp1", v)} placeholder="50938332483" />
              <Field label="WhatsApp 2 (san +)" value={config.whatsapp2} onChange={(v) => update("whatsapp2", v)} />
              <Field label="Facebook URL" value={config.facebook} onChange={(v) => update("facebook", v)} placeholder="https://facebook.com/..." />
              <Field label="Instagram URL" value={config.instagram} onChange={(v) => update("instagram", v)} placeholder="https://instagram.com/..." />
              <Field label="TikTok URL" value={config.tiktok} onChange={(v) => update("tiktok", v)} placeholder="https://tiktok.com/..." />
            </div>
            <div style={{ marginTop: "8px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {config.whatsapp1 && <a href={`https://wa.me/${config.whatsapp1}`} target="_blank" rel="noopener noreferrer" style={{ background: "#25D366", color: "#fff", padding: "8px 16px", borderRadius: "10px", fontSize: "13px", textDecoration: "none", fontWeight: 700 }}>{"💬 WhatsApp 1"}</a>}
              {config.facebook && <a href={config.facebook} target="_blank" rel="noopener noreferrer" style={{ background: "#1877F2", color: "#fff", padding: "8px 16px", borderRadius: "10px", fontSize: "13px", textDecoration: "none", fontWeight: 700 }}>{"👍 Facebook"}</a>}
              {config.instagram && <a href={config.instagram} target="_blank" rel="noopener noreferrer" style={{ background: "#E1306C", color: "#fff", padding: "8px 16px", borderRadius: "10px", fontSize: "13px", textDecoration: "none", fontWeight: 700 }}>{"📸 Instagram"}</a>}
            </div>
          </Section>
        )}

        {/* ── TAB APARANS ── */}
        {activeTab === "aparans" && (
          <Section title="Koulè & Aparans" icon={<Palette size={18} />}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#666", marginBottom: "6px", textTransform: "uppercase" }}>Koulè Prensipal</label>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <input type="color" value={config.couleurPrimaire} onChange={(e) => update("couleurPrimaire", e.target.value)} style={{ width: "46px", height: "46px", borderRadius: "10px", border: "none", cursor: "pointer" }} />
                  <span style={{ fontWeight: 700 }}>{config.couleurPrimaire}</span>
                </div>
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#666", marginBottom: "6px", textTransform: "uppercase" }}>Koulè Segondè</label>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <input type="color" value={config.couleurSecondaire} onChange={(e) => update("couleurSecondaire", e.target.value)} style={{ width: "46px", height: "46px", borderRadius: "10px", border: "none", cursor: "pointer" }} />
                  <span style={{ fontWeight: 700 }}>{config.couleurSecondaire}</span>
                </div>
              </div>
            </div>
            <div style={{ borderRadius: "12px", overflow: "hidden", border: "1px solid #eee", marginTop: "8px" }}>
              <div style={{ background: config.couleurPrimaire, padding: "16px 20px" }}>
                <p style={{ margin: 0, color: "#fff", fontWeight: 700, fontSize: "16px" }}>
                  Million<span style={{ color: config.couleurSecondaire }}>Store</span>
                </p>
              </div>
              <div style={{ padding: "16px", background: "#f8f9fa", display: "flex", gap: "10px" }}>
                <button style={{ background: config.couleurPrimaire, color: "#fff", border: "none", borderRadius: "10px", padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Bouton Prensipal</button>
                <button style={{ background: config.couleurSecondaire, color: "#fff", border: "none", borderRadius: "10px", padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Bouton Segondè</button>
              </div>
            </div>
          </Section>
        )}

        {/* ── TAB TAUX ── */}
        {activeTab === "taux" && (
          <Section title="Taux Dola / Goud" icon={<DollarSign size={18} />}>
            <Field label="1$ = ? HTG" value={config.taux} onChange={(v) => update("taux", Number(v))} type="number" placeholder="134" />
            {config.taux > 1 && (
              <div style={{ background: "#f0fff4", border: "1px solid #b7ebc8", borderRadius: "12px", padding: "14px 16px", marginTop: "8px" }}>
                <p style={{ margin: 0, color: "#1e8449", fontWeight: 700, fontSize: "16px" }}>
                  💱 Taux kounye a: 1$ = {config.taux} HTG
                </p>
              </div>
            )}
          </Section>
        )}

        {/* Bouton sove anba */}
        <button onClick={handleSave} disabled={saving} style={{ width: "100%", padding: "16px", background: saved ? "#4CAF50" : "#1a1a2e", border: "none", color: "#fff", borderRadius: "14px", fontSize: "16px", fontWeight: 700, cursor: "pointer", marginTop: "8px", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          {saving ? "⏳ Saving..." : saved ? <><Check size={18} /> Chanjman Sove!</> : <><Save size={18} /> Sove Tout Chanjman</>}
        </button>
      </div>
    </main>
  );
}