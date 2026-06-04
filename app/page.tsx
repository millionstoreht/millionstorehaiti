"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import { db } from "../lib/firebase";
import { collectionGroup, onSnapshot, query, doc, getDoc, updateDoc, increment, collection, addDoc } from "firebase/firestore";

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface Product {
  id: string;
  marque: string;
  modele: string;
  category: string;
  prixVente: number;
  stock: number;
  imagePath?: string;
  imagePaths?: string[];
  description?: string;
  isDeleted?: boolean;
  serialImei?: string;
}

interface QuickButton {
  id: string;
  label: string;
  icon: string;
  action: "filter" | "url" | "whatsapp" | "phone" | "scroll" | string;
  value: string;
  active: boolean;
}

const DEFAULT_QUICK_BUTTONS: QuickButton[] = [
  { id: "1", label: "Local",     icon: "📍", action: "scroll",   value: "hero",      active: true },
  { id: "2", label: "Catégories", icon: "📂", action: "categories", value: "", active: true },
  { id: "3", label: "Bon Prix",  icon: "💰", action: "filter",   value: "priceAsc",  active: true },
  { id: "4", label: "Spécial", icon: "⭐", action: "special", value: "", active: true },
  { id: "5", label: "Phone",     icon: "📱", action: "filter",   value: "Phone",     active: true },
  { id: "6", label: "Adresse",   icon: "🗺️", action: "scroll",   value: "hero",      active: true },
  { id: "7", label: "Favoris", icon: "🤍", action: "favorites", value: "", active: true },
  { id: "8", label: "Livraison", icon: "🚚", action: "livraison", value: "", active: true },
  { id: "9", label: "Garantie", icon: "🛡️", action: "garantie", value: "", active: true },
];

const MARQUE_LOGOS: Record<string, string> = {
  hp: "https://cdn.worldvectorlogo.com/logos/hp-2.svg",
  dell: "https://cdn.worldvectorlogo.com/logos/dell-2.svg",
  lenovo: "https://cdn.worldvectorlogo.com/logos/lenovo-2.svg",
  apple: "https://cdn.worldvectorlogo.com/logos/apple-1.svg",
  iphone: "https://cdn.worldvectorlogo.com/logos/apple-1.svg",
  samsung: "https://cdn.worldvectorlogo.com/logos/samsung-4.svg",
  asus: "https://cdn.worldvectorlogo.com/logos/asus-1.svg",
  acer: "https://cdn.worldvectorlogo.com/logos/acer-2.svg",
  microsoft: "https://cdn.worldvectorlogo.com/logos/microsoft-1.svg",
  huawei: "https://cdn.worldvectorlogo.com/logos/huawei-1.svg",
  xiaomi: "https://cdn.worldvectorlogo.com/logos/xiaomi-3.svg",
  toshiba: "https://cdn.worldvectorlogo.com/logos/toshiba.svg",
};

const CAT_IMAGES: Record<string, string> = {
  Phone: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400",
  Ordinateur: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400",
  Laptop: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400",
  Desktop: "https://images.unsplash.com/photo-1593640495253-23196b27a87f?w=400",
  Tablette: "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=400",
  Accessoire: "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=400",
  "Lòt": "https://images.unsplash.com/photo-1518770660439-4636190af475?w=400",
};

const CAT_COLORS: Record<string, string> = {
  Phone: "#6C63FF", Ordinateur: "#00B894", Laptop: "#00B894",
  Desktop: "#0984E3", Accessoire: "#F79F1F", Tablette: "#E17055", "Lòt": "#636E72",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getImages(p: Product): string[] {
  if (p.imagePaths && p.imagePaths.length > 0) return p.imagePaths.filter((u) => u?.startsWith("http"));
  if (p.imagePath?.startsWith("http")) return [p.imagePath];
  return [];
}
function getMarqueLogo(marque: string): string | null {
  const key = marque.toLowerCase().trim();
  for (const [k, v] of Object.entries(MARQUE_LOGOS)) { if (key.includes(k)) return v; }
  return null;
}
function getFallbackImage(p: Product): string { return CAT_IMAGES[p.category] ?? CAT_IMAGES["Lòt"]; }
function getCatColor(cat: string): string { return CAT_COLORS[cat] ?? "#636E72"; }

// ─── PAYMENT MODAL ────────────────────────────────────────────────────────────
function PaymentModal({ product, products, onClose, onPaymentConfirmed, siteConfig = {} }: {
  product?: Product; products?: Product[];
  onClose: () => void; onPaymentConfirmed?: () => void;
  siteConfig?: Record<string, any>;
}) {
  const [step, setStep] = useState<"choose" | "moncash" | "natcash" | "bank" | "confirm">("choose");
  const [selectedBank, setSelectedBank] = useState("BNC");
  const [showInfo, setShowInfo] = useState(false);

  const checkoutItems = products?.length ? products : product ? [product] : [];
  const total = checkoutItems.reduce((s, i) => s + Number(i.prixVente || 0), 0);
  const isMulti = checkoutItems.length > 1;
  const orderLabel = isMulti ? `${checkoutItems.length} produits` : `${checkoutItems[0]?.marque ?? ""} ${checkoutItems[0]?.modele ?? ""}`.trim();

  const whatsappNum = siteConfig.whatsapp1 ?? "50938332483";
  const moncashNum  = siteConfig.moncashNumero ?? "+509 38 33 24 83";
  const moncashNom  = siteConfig.moncashNom ?? "Christian Hotes";
  const natcashNum  = siteConfig.natcashNumero ?? "+509 35 01 28 13";
  const natcashNom  = siteConfig.natcashNom ?? "Christian Hotes";
  const bankHolder  = siteConfig.bankHolder ?? "Christian Hotes";

  const BANK_DETAILS: Record<string, { gourde: string; dollar: string }> = {
    BNC:      { gourde: siteConfig.bncGourde ?? "27100 22696",        dollar: siteConfig.bncDollar ?? "27110 08200" },
    SOGEBANK: { gourde: siteConfig.sogebankGourde ?? "140130 0650",   dollar: siteConfig.sogebankDollar ?? "141113 6144" },
    BUH:      { gourde: siteConfig.buhGourde ?? "310000 17984",       dollar: siteConfig.buhDollar ?? "310000 17992" },
    UNIBANK:  { gourde: siteConfig.unibankGourde ?? "1802015 289989 36", dollar: siteConfig.unibankDollar ?? "1802016 289990 39" },
  };

  const METHOD_COLORS: Record<string, string> = { moncash: "#E8011A", natcash: "#004B87", bank: "#1D5F2B" };
  const METHOD_LABELS: Record<string, string> = { moncash: "MonCash", natcash: "NatCash", bank: "Virement Bancaire" };
  const activeColor = step !== "choose" && step !== "confirm" ? METHOD_COLORS[step] : "#1a1a2e";

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const handleConfirm = async (method: "moncash" | "natcash" | "bank") => {
    setStep("confirm");
    onPaymentConfirmed?.();

    // Sove achte nan Firestore
    try {
      const clientRaw = localStorage.getItem("ms_client_user");
      if (clientRaw) {
        const client = JSON.parse(clientRaw);
        const { collection, addDoc } = await import("firebase/firestore");
        
        await addDoc(collection(db, "achats"), {
          clientUid: client.uid,
          clientNom: client.nom,
          clientEmail: client.email,
          produits: checkoutItems.map(i => ({
            id: i.id,
            marque: i.marque,
            modele: i.modele,
            prix: Number(i.prixVente),
          })),
          total: Number(total),
          methode: METHOD_LABELS[method],
          banque: method === "bank" ? selectedBank : null,
          statut: "En attente",
          createdAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error("Erè sove achte:", e);
    }

    // Voye WhatsApp
    const lines = checkoutItems.map((i, idx) => `${idx + 1}. ${i.marque} ${i.modele} - $${Number(i.prixVente).toLocaleString()}`).join("%0A");
    const bankLine = method === "bank" ? `%0ABanque: ${selectedBank}` : "";
    const msg = `Bonjou MillionStore,%0A%0AUn client a payé.%0A%0AMéthode: ${METHOD_LABELS[method]}${bankLine}%0A%0AProduits:%0A${lines}%0A%0ATotal: $${Number(total).toLocaleString()}`;
    window.open(`https://wa.me/${whatsappNum}?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 3000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: "500px", padding: "24px", maxHeight: "92vh", overflow: "auto" }}>
        <div style={{ width: "40px", height: "4px", background: "#e0e0e0", borderRadius: "2px", margin: "0 auto 20px" }} />
        <button onClick={onClose} style={{ position: "absolute", top: "16px", right: "16px", background: "#f1f1f1", border: "none", borderRadius: "50%", width: "32px", height: "32px", fontSize: "16px", cursor: "pointer" }}>×</button>

        {step === "choose" && (
          <>
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <p style={{ margin: "0 0 4px", fontSize: "13px", color: "#888" }}>Total à payer</p>
              <p style={{ margin: 0, fontSize: "32px", fontWeight: 800, color: "#111" }}>${Number(total).toLocaleString()}</p>
              <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#888" }}>{orderLabel}</p>
            </div>
            {isMulti && (
              <div style={{ background: "#f8f9ff", borderRadius: "10px", padding: "10px 12px", marginBottom: "12px" }}>
                {checkoutItems.map((item, i) => (
                  <p key={`${item.id}-${i}`} style={{ margin: "0 0 4px", fontSize: "12px", color: "#555" }}>• {item.marque} {item.modele} - ${Number(item.prixVente).toLocaleString()}</p>
                ))}
              </div>
            )}
            <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "0 0 16px" }} />
            <p style={{ fontSize: "12px", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 12px" }}>Choisir méthode de paiement</p>
            {[
              { key: "moncash", label: "MonCash", sub: "Payer avec MonCash", color: "#E8011A", icon: "M" },
              { key: "natcash", label: "NatCash", sub: "Payer avec NatCash", color: "#004B87", icon: "N" },
              { key: "bank",    label: "Virement Bancaire", sub: "BNC, Sogebank, BUH, UNIBANK", color: "#1D5F2B", icon: "🏦" },
            ].map(({ key, label, sub, color, icon }) => (
              <button key={key} onClick={() => setStep(key as any)} style={{ width: "100%", display: "flex", alignItems: "center", gap: "14px", padding: "14px 16px", borderRadius: "12px", border: "1px solid #eee", background: "#fff", cursor: "pointer", marginBottom: "10px", textAlign: "left" }}>
                <div style={{ width: "42px", height: "42px", borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "18px", flexShrink: 0 }}>{icon}</div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#111" }}>{label}</p>
                  <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>{sub}</p>
                </div>
                <span style={{ fontSize: "20px", color: "#ccc" }}>›</span>
              </button>
            ))}
            <button onClick={() => setShowInfo(!showInfo)} style={{ width: "100%", padding: "12px", borderRadius: "12px", border: "1px dashed #cfd8dc", background: "#f8fbff", color: "#1a1a2e", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>
              ℹ️ Comment payer {showInfo ? "▲" : "▼"}
            </button>
            {showInfo && (
              <div style={{ marginTop: "10px", background: "#f8f9ff", border: "1px solid #e5e9ff", borderRadius: "12px", padding: "12px 14px" }}>
                {["Choisissez la méthode (MonCash, NatCash, Banque).", "Effectuez le transfert au numéro/compte indiqué.", "Revenez cliquer sur Confirmer le paiement.", "Nous vérifions et vous contactons.", "Garantie complète — échange ou remboursement si problème."].map((t, i) => (
                  <p key={i} style={{ margin: "0 0 6px", fontSize: "13px", color: "#555" }}>{i + 1}) {t}</p>
                ))}
              </div>
            )}
          </>
        )}

        {(step === "moncash" || step === "natcash") && (
          <>
            <button onClick={() => setStep("choose")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: "#888", padding: 0, marginBottom: "16px" }}>{"← Retour"}</button>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              <div style={{ width: "42px", height: "42px", borderRadius: "50%", background: activeColor, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "18px" }}>{step === "moncash" ? "M" : "N"}</div>
              <div>
                <p style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#111" }}>{METHOD_LABELS[step]}</p>
                <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>Total: ${Number(total).toLocaleString()}</p>
              </div>
            </div>
            <div style={{ background: "#fafafa", borderRadius: "12px", padding: "14px", marginBottom: "16px" }}>
              <p style={{ fontSize: "13px", color: "#888", margin: "0 0 4px" }}>Envoyer au numéro:</p>
              <p style={{ fontSize: "20px", fontWeight: 800, color: "#111", margin: 0, letterSpacing: "1px" }}>{step === "moncash" ? moncashNum : natcashNum}</p>
              <p style={{ fontSize: "12px", color: "#888", margin: "6px 0 0" }}>Nom: {step === "moncash" ? moncashNom : natcashNom}</p>
            </div>
            <button onClick={() => handleConfirm(step)} style={{ width: "100%", padding: "14px", background: activeColor, color: "#fff", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}>Confirmer le paiement</button>
          </>
        )}

        {step === "bank" && (
          <>
            <button onClick={() => setStep("choose")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: "#888", padding: 0, marginBottom: "16px" }}>{"← Retour"}</button>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              <div style={{ width: "42px", height: "42px", borderRadius: "50%", background: "#1D5F2B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>🏦</div>
              <div>
                <p style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#111" }}>Virement Bancaire</p>
                <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>Total: ${Number(total).toLocaleString()}</p>
              </div>
            </div>
            <div style={{ background: "#fafafa", borderRadius: "12px", padding: "14px", marginBottom: "16px" }}>
              <p style={{ fontSize: "12px", fontWeight: 700, color: "#888", textTransform: "uppercase", margin: "0 0 10px" }}>Informations bancaires</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
                {Object.keys(BANK_DETAILS).map((b) => (
                  <button key={b} onClick={() => setSelectedBank(b)} style={{ border: selectedBank === b ? "1px solid #1D5F2B" : "1px solid #ddd", background: selectedBank === b ? "#eaf6ed" : "#fff", color: selectedBank === b ? "#1D5F2B" : "#333", borderRadius: "999px", padding: "6px 12px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>{b}</button>
                ))}
              </div>
              {[["Banque", selectedBank], ["Titulaire", bankHolder], ["Compte gourde", BANK_DETAILS[selectedBank]?.gourde], ["Compte dollar", BANK_DETAILS[selectedBank]?.dollar]].map(([label, val]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "13px" }}>
                  <span style={{ color: "#888" }}>{label}</span>
                  <span style={{ fontWeight: 700, color: "#111" }}>{val}</span>
                </div>
              ))}
            </div>
            <button onClick={() => handleConfirm("bank")} style={{ width: "100%", padding: "14px", background: "#1D5F2B", color: "#fff", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}>Confirmer le paiement</button>
          </>
        )}

{step === "confirm" && (
  <div style={{ textAlign: "center", padding: "20px 0" }}>
    <div style={{ width: "72px", height: "72px", borderRadius: "50%", background: "#fff3e0", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: "32px" }}>
      ⏳
    </div>
    <p style={{ fontSize: "20px", fontWeight: 800, color: "#111", margin: "0 0 8px" }}>
      Dépôt en attente!
    </p>
    <p style={{ fontSize: "14px", color: "#666", margin: "0 0 16px", lineHeight: 1.7 }}>
      Merci pour votre commande! Veuillez effectuer votre dépôt au numéro/compte indiqué, puis attendez la confirmation de notre équipe.
    </p>
    <div style={{ background: "#fff8e1", border: "1px solid #ffe082", borderRadius: "12px", padding: "14px", marginBottom: "16px", textAlign: "left" }}>
      <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "13px", color: "#f57c00" }}>⚠️ Important:</p>
      <p style={{ margin: "0 0 4px", fontSize: "13px", color: "#555" }}>• Effectuez le dépôt après avoir fermé cette fenêtre</p>
      <p style={{ margin: "0 0 4px", fontSize: "13px", color: "#555" }}>• Notre équipe vérifiera votre paiement</p>
      <p style={{ margin: 0, fontSize: "13px", color: "#555" }}>• Vous serez contacté très bientôt</p>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <button
        onClick={() => window.open(`https://wa.me/${whatsappNum}`, "_blank", "noopener,noreferrer")}
        style={{ width: "100%", padding: "12px", background: "#25D366", color: "#fff", border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}
      >
        💬 Contacter sur WhatsApp
      </button>
      <a href="/mon-compte" style={{ display: "block", width: "100%", padding: "12px", background: "#f0f4ff", color: "#1a1a2e", border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 700, cursor: "pointer", textDecoration: "none", boxSizing: "border-box" }}>
        👤 Voir mes commandes
      </a>
    </div>
    <p style={{ fontSize: "12px", color: "#aaa", marginTop: "12px" }}>
      📞 {siteConfig.telephone1 ?? "+509 38332483"}
    </p>
  </div>
)}
      </div>
    </div>
  );
}

// ─── PRODUCT MODAL ────────────────────────────────────────────────────────────
function ProductModal({ product, onClose, onAddToCart, siteConfig = {} }: {
  product: Product; onClose: () => void;
  onAddToCart: (p: Product) => void;
  siteConfig?: Record<string, any>;
}) {
  const [imgIdx, setImgIdx] = useState(0);
  const [showPayment, setShowPayment] = useState(false);
  const imgs  = getImages(product);
  const logo  = getMarqueLogo(product.marque);
  const color = getCatColor(product.category);
  const whatsapp = siteConfig.whatsapp1 ?? "50938332483";

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 2000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      {showPayment && <PaymentModal product={product} siteConfig={siteConfig} onClose={() => setShowPayment(false)} />}
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: "600px", maxHeight: "92vh", overflow: "auto", padding: "24px" }}>
        <div style={{ width: "40px", height: "4px", background: "#e0e0e0", borderRadius: "2px", margin: "0 auto 16px" }} />
        <button onClick={onClose} style={{ position: "absolute", top: "16px", right: "16px", background: "#f1f1f1", border: "none", borderRadius: "50%", width: "32px", height: "32px", fontSize: "16px", cursor: "pointer" }}>×</button>

        {/* Image */}
        <div style={{ background: "#fafafa", borderRadius: "14px", height: "240px", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "12px", overflow: "hidden" }}>
          <img src={imgs[imgIdx] ?? getFallbackImage(product)} alt={`${product.marque} ${product.modele}`} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </div>
        {imgs.length > 1 && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px", overflowX: "auto" }}>
            {imgs.map((img, i) => (
              <div key={i} onClick={() => setImgIdx(i)} style={{ width: "56px", height: "56px", borderRadius: "8px", border: i === imgIdx ? `2px solid ${color}` : "2px solid #eee", overflow: "hidden", cursor: "pointer", flexShrink: 0 }}>
                <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            ))}
          </div>
        )}

        {/* Info */}
        <span style={{ background: `${color}18`, color, padding: "4px 12px", borderRadius: "999px", fontSize: "12px", fontWeight: 700 }}>{product.category}</span>
        <p style={{ margin: "6px 0 2px", color: "#aaa", fontSize: "11px" }}>🔖 ID: {product.id || "—"}</p>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "8px 0 4px" }}>
          {logo && <img src={logo} alt={product.marque} style={{ height: "20px", objectFit: "contain" }} />}
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#111" }}>{product.marque} {product.modele}</h2>
        </div>
        {product.description && <p style={{ color: "#555", fontSize: "14px", lineHeight: 1.6, margin: "8px 0" }}>{product.description}</p>}
        <p style={{ fontSize: "32px", fontWeight: 800, color: "#111", margin: "8px 0 4px" }}>${Number(product.prixVente).toLocaleString()}</p>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: product.stock <= 2 ? "#fff3e0" : "#e8f5e9", color: product.stock <= 2 ? "#e65100" : "#2e7d32", padding: "4px 12px", borderRadius: "999px", fontSize: "13px", fontWeight: 600, marginBottom: "20px" }}>
          {product.stock <= 2 ? `⚠️ Seulement ${product.stock} restant!` : `✅ ${product.stock} en stock`}
        </div>

        {/* Bouton */}
        <button
  onClick={(e) => {
    e.stopPropagation();
    // Verifye si kliyan konekte
    const clientRaw = localStorage.getItem("ms_client_user");
    if (!clientRaw) {
      // Pa konekte — ale login
      localStorage.setItem("ms_redirect_after_login", window.location.href);
      window.location.href = "/login";
      return;
    }
    setShowPayment(true);
  }}
  style={{
    width: "100%", background: "#1a1a2e", color: "#fff",
    border: "none", borderRadius: "12px", padding: "14px",
    fontSize: "16px", fontWeight: 700, cursor: "pointer", marginBottom: "10px",
  }}
>
  🛒 Acheter maintenant
</button>
        <button onClick={(e) => { e.stopPropagation(); window.open(`https://wa.me/${whatsapp}`, "_blank", "noopener,noreferrer"); }} style={{ width: "100%", background: "#fff", color: "#1a1a2e", border: "2px solid #1a1a2e", borderRadius: "12px", padding: "12px", fontSize: "15px", fontWeight: 600, cursor: "pointer", marginBottom: "10px" }}>💬 Nous contacter</button>
        <button onClick={(e) => { e.stopPropagation(); onAddToCart(product); onClose(); }} style={{ width: "100%", background: "#0b8457", color: "#fff", border: "none", borderRadius: "12px", padding: "12px", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}>➕ Ajouter au panier</button>
      </div>
    </div>
  );
}

// ─── CART MODAL ───────────────────────────────────────────────────────────────
function CartModal({ cart, onClose, onRemoveItem, onCheckout, onCheckoutAll, siteConfig = {} }: {
  cart: Product[]; onClose: () => void; onRemoveItem: (i: number) => void;
  onCheckout: (p: Product) => void; onCheckoutAll: () => void;
  siteConfig?: Record<string, any>;
}) {
  const total = cart.reduce((s, i) => s + Number(i.prixVente || 0), 0);
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 2600, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: "500px", maxHeight: "92vh", overflow: "auto", padding: "24px" }}>
        <div style={{ width: "40px", height: "4px", background: "#e0e0e0", borderRadius: "2px", margin: "0 auto 16px" }} />
        <button onClick={onClose} style={{ position: "absolute", top: "16px", right: "16px", background: "#f1f1f1", border: "none", borderRadius: "50%", width: "32px", height: "32px", fontSize: "16px", cursor: "pointer" }}>×</button>
        <h2 style={{ margin: "0 0 4px", color: "#111", fontSize: "20px" }}>🛒 Mon Panier ({cart.length})</h2>
        <p style={{ margin: "0 0 16px", color: "#0b8457", fontWeight: 800, fontSize: "18px" }}>Total: ${total.toLocaleString()}</p>
        {cart.length === 0 ? (
          <p style={{ color: "#666", textAlign: "center", padding: "40px 0" }}>Panier vide. Ajoutez des produits!</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {cart.map((item, index) => {
              const imgs = getImages(item);
              const thumb = imgs[0] ?? getFallbackImage(item);
              return (
                <div key={`${item.id}-${index}`} style={{ border: "1px solid #ececec", borderRadius: "12px", padding: "12px", display: "grid", gridTemplateColumns: "70px 1fr", gap: "12px", alignItems: "center" }}>
                  <img src={thumb} alt={`${item.marque} ${item.modele}`} style={{ width: "70px", height: "70px", objectFit: "contain", background: "#fafafa", borderRadius: "10px", padding: "6px" }} />
                  <div>
                    <p style={{ margin: "0 0 2px", fontWeight: 700, color: "#111", fontSize: "14px" }}>{item.marque} {item.modele}</p>
                    <p style={{ margin: "0 0 8px", color: "#0b8457", fontWeight: 700 }}>${Number(item.prixVente).toLocaleString()}</p>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => onCheckout(item)} style={{ background: "#1a1a2e", color: "#fff", border: "none", borderRadius: "8px", padding: "6px 12px", fontWeight: 700, cursor: "pointer", fontSize: "12px" }}>Acheter</button>
                      <button onClick={() => onRemoveItem(index)} style={{ background: "#fff", color: "#b42318", border: "1px solid #f5c2c2", borderRadius: "8px", padding: "6px 12px", fontWeight: 600, cursor: "pointer", fontSize: "12px" }}>Retirer</button>
                    </div>
                  </div>
                </div>
              );
            })}
            <button onClick={onCheckoutAll} style={{ width: "100%", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: "12px", padding: "14px", fontSize: "15px", fontWeight: 800, cursor: "pointer", marginTop: "8px" }}>Tout acheter maintenant</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DRAWER MENU ──────────────────────────────────────────────────────────────
function DrawerMenu({ onClose, siteConfig, categories, onFilterCategory }: {
  onClose: () => void;
  siteConfig: Record<string, any>;
  categories: string[];
  onFilterCategory: (cat: string) => void;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 4000, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(320px, 85vw)", background: "#fff", height: "100%", overflow: "auto", display: "flex", flexDirection: "column" }}>
        {/* Header drawer */}
        <div style={{ background: "#1a1a2e", padding: "20px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <img src={siteConfig.logoUrl ?? "https://i.ibb.co/gLmkySCv/ab785ed1481b.jpg"} alt="Logo" style={{ width: "36px", height: "36px", borderRadius: "8px", objectFit: "contain" }} />
            <div>
              <p style={{ margin: 0, color: "#fff", fontWeight: 700, fontSize: "15px" }}>MillionStore</p>
              <p style={{ margin: 0, color: "#aaa", fontSize: "11px" }}>{siteConfig.horaire ?? "Lun - Sam: 8h - 18h"}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", width: "32px", height: "32px", borderRadius: "50%", cursor: "pointer", fontSize: "18px" }}>×</button>
        </div>

        {/* Info magazen */}
        <div style={{ padding: "16px", borderBottom: "1px solid #f0f0f0" }}>
          <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: "13px", color: "#888", textTransform: "uppercase" }}>Informations</p>
          {[
            { icon: "📍", text: siteConfig.adres ?? "#25, Delmas 83, Port-au-Prince" },
            { icon: "📞", text: siteConfig.telephone1 ?? "+509 38332483" },
            { icon: "📞", text: siteConfig.telephone2 ?? "+509 35012813" },
            { icon: "✉️", text: siteConfig.email ?? "millionstorehaiti@gmail.com" },
          ].map(({ icon, text }) => (
            <div key={text} style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "10px" }}>
              <span style={{ fontSize: "16px", flexShrink: 0 }}>{icon}</span>
              <p style={{ margin: 0, fontSize: "13px", color: "#333", lineHeight: 1.4 }}>{text}</p>
            </div>
          ))}
        </div>

        {/* Rezo sosyal */}
        <div style={{ padding: "16px", borderBottom: "1px solid #f0f0f0", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {siteConfig.whatsapp1 && (
            <a href={`https://wa.me/${siteConfig.whatsapp1}`} target="_blank" rel="noopener noreferrer" style={{ background: "#25D366", color: "#fff", padding: "8px 14px", borderRadius: "10px", fontSize: "13px", textDecoration: "none", fontWeight: 700 }}>💬 WhatsApp</a>
          )}
          {siteConfig.facebook && (
            <a href={siteConfig.facebook} target="_blank" rel="noopener noreferrer" style={{ background: "#1877F2", color: "#fff", padding: "8px 14px", borderRadius: "10px", fontSize: "13px", textDecoration: "none", fontWeight: 700 }}>👍 Facebook</a>
          )}
          {siteConfig.instagram && (
            <a href={siteConfig.instagram} target="_blank" rel="noopener noreferrer" style={{ background: "#E1306C", color: "#fff", padding: "8px 14px", borderRadius: "10px", fontSize: "13px", textDecoration: "none", fontWeight: 700 }}>📸 Instagram</a>
          )}
        </div>

        {/* Kategori */}
        <div style={{ padding: "16px", flex: 1 }}>
          <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: "13px", color: "#888", textTransform: "uppercase" }}>Catégories</p>
          {["Tout", ...categories.filter(c => c !== "Tout")].map((cat) => (
            <button key={cat} onClick={() => { onFilterCategory(cat); onClose(); }} style={{ width: "100%", textAlign: "left", padding: "12px 14px", border: "none", background: "transparent", borderBottom: "1px solid #f5f5f5", cursor: "pointer", fontSize: "15px", color: "#1a1a2e", fontWeight: 500, display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "18px" }}>{cat === "Tout" ? "🛍️" : cat === "Phone" ? "📱" : cat === "Laptop" ? "💻" : cat === "Ordinateur" ? "🖥️" : cat === "Tablette" ? "📟" : cat === "Accessoire" ? "🎧" : "📦"}</span>
              {cat === "Tout" ? "Tous les produits" : cat}
            </button>
          ))}
        </div>

        {/* Footer drawer */}
        <div style={{ padding: "16px", background: "#f8f9fa", borderTop: "1px solid #eee" }}>
          <a href="/dashboard" style={{ display: "block", textAlign: "center", background: "#1a1a2e", color: "#fff", padding: "12px", borderRadius: "12px", textDecoration: "none", fontWeight: 700, fontSize: "14px" }}>
            🔐 Espace Admin
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function Home() {
  const [products, setProducts]   = useState<Product[]>([]);
  const [loading, setLoading]     = useState(true);
  const [isOnline, setIsOnline]   = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Tout");
  const [sortBy, setSortBy] = useState<"relevance" | "priceAsc" | "priceDesc" | "popular" | "special">("relevance");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart]           = useState<Product[]>([]);
  const [showCart, setShowCart]   = useState(false);
  const [checkoutProduct, setCheckoutProduct]   = useState<Product | null>(null);
  const [checkoutProducts, setCheckoutProducts] = useState<Product[] | null>(null);
  const [taux, setTaux]           = useState<number>(1);
  const [siteConfig, setSiteConfig] = useState<Record<string, any>>({});
  const [quickButtons, setQuickButtons] = useState<QuickButton[]>(DEFAULT_QUICK_BUTTONS);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [showLivraison, setShowLivraison] = useState(false);
const [showGarantie, setShowGarantie] = useState(false);
  const [mounted, setMounted]     = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const productsRef = useRef<HTMLDivElement>(null);
  const trackClick = async (productId: string) => {
    try {
      const snap = await getDoc(doc(db, "products", productId));
      if (snap.exists()) {
        await updateDoc(doc(db, "products", productId), {
          clicks: increment(1)
        });
      }
    } catch (_) {}
  };

  // Load data
  useEffect(() => {
    const q = query(collectionGroup(db, "products"));
    const unsub = onSnapshot(q, (snapshot) => {
      const data: Product[] = [];
      snapshot.forEach((doc) => {
        const p = { ...doc.data(), id: doc.id } as Product;
        if (p.isDeleted === true) return;
        if (p.stock != null && Number(p.stock) <= 0) return;
        data.push(p);
      });
      data.sort((a, b) => (a.category ?? "").localeCompare(b.category ?? ""));
      setProducts(data);
      setLoading(false);
      setIsOnline(true);
    }, () => { setIsOnline(false); setLoading(false); });
    return () => unsub();
  }, []);

  // Load config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const snap = await getDoc(doc(db, "parametres", "site_config"));
        if (snap.exists()) {
          const cfg = snap.data();
          setSiteConfig(cfg);
          if (cfg.taux && Number(cfg.taux) > 0) setTaux(Number(cfg.taux));
          if (cfg.customButtons?.length) {
            setQuickButtons(cfg.customButtons);
          } else {
            // Si pa gen bouton nan Firestore, sove defo yo
            setQuickButtons(DEFAULT_QUICK_BUTTONS);
          }
        } else {
          const tSnap = await getDoc(doc(db, "parametres", "taux"));
          const val = tSnap.data()?.taux;
          if (val && Number(val) > 0) setTaux(Number(val));
        }
      } catch (_) {}
    };
    fetchConfig();
  }, []);

  // Cart persistence
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("ms_cart");
      if (raw) { const p = JSON.parse(raw); if (Array.isArray(p)) setCart(p); }
    } catch (_) {}
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem("ms_cart", JSON.stringify(cart)); } catch (_) {}
  }, [cart]);

  // Auth check
  useEffect(() => {
    setMounted(true);
    setIsLoggedIn(!!localStorage.getItem("ms_web_user"));
  }, []);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map((p) => p.category ?? "Lòt")));
    return cats.sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCategory !== "Tout" && p.category !== selectedCategory) return false;
      // Filtre spécial
      if (sortBy === "special") {
        const hay = `${p.marque} ${p.modele} ${p.description ?? ""}`.toLowerCase();
        if (!hay.includes("special")) return false;
      }
      if (!q) return true;
      const hay = `${p.id} ${p.marque} ${p.modele} ${p.description ?? ""} ${p.category} ${p.serialImei ?? ""}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => {
      if (sortBy === "priceAsc") return Number(a.prixVente) - Number(b.prixVente);
      if (sortBy === "priceDesc") return Number(b.prixVente) - Number(a.prixVente);
      if (sortBy === "popular") return Number((b as any).clicks ?? 0) - Number((a as any).clicks ?? 0);
      return 0;
    });
  }, [products, selectedCategory, searchTerm, sortBy]);

  const handleQuickBtn = (btn: QuickButton) => {
    if (btn.action === "filter") {
      if (btn.value === "priceAsc") setSortBy("priceAsc");
      else if (btn.value === "priceDesc") setSortBy("priceDesc");
      else if (btn.value) setSelectedCategory(btn.value);
      productsRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (btn.action === "whatsapp") {
      window.open(`https://wa.me/${btn.value}`, "_blank", "noopener,noreferrer");
    } else if (btn.action === "phone") {
      window.open(`tel:${btn.value}`, "_blank");
    } else if (btn.action === "url") {
      window.open(btn.value, "_blank", "noopener,noreferrer");
    } else if (btn.action === "scroll") {
      productsRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (btn.action === "favorites") {
      setSortBy("popular");
      productsRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (btn.action === "special") {
      setSortBy("special");
      productsRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (btn.action === "categories") {
      setShowCategories(true);
    } else if (btn.action === "livraison") {
      setShowLivraison(true);
    } else if (btn.action === "garantie") {
      setShowGarantie(true);
    }
  };

  const activeQuickBtns = quickButtons.filter(b => b.active);

  return (
    <main style={{ fontFamily: "'Segoe UI', sans-serif", background: "#f4f4f4", minHeight: "100vh", paddingBottom: "70px" }}>

      {/* Modals */}
      {selectedProduct && <ProductModal product={selectedProduct} siteConfig={siteConfig} onClose={() => setSelectedProduct(null)} onAddToCart={(p) => setCart(prev => [...prev, p])} />}
      {showCart && <CartModal cart={cart} siteConfig={siteConfig} onClose={() => setShowCart(false)} onRemoveItem={(i) => setCart(prev => prev.filter((_, idx) => idx !== i))} onCheckout={(p) => { setShowCart(false); setCheckoutProducts(null); setCheckoutProduct(p); }} onCheckoutAll={() => { if (!cart.length) return; setShowCart(false); setCheckoutProduct(null); setCheckoutProducts(cart); }} />}
      {checkoutProduct && <PaymentModal product={checkoutProduct} siteConfig={siteConfig} onClose={() => setCheckoutProduct(null)} onPaymentConfirmed={() => setCart([])} />}
      {checkoutProducts && <PaymentModal products={checkoutProducts} siteConfig={siteConfig} onClose={() => setCheckoutProducts(null)} onPaymentConfirmed={() => setCart([])} />}
      {showDrawer && <DrawerMenu onClose={() => setShowDrawer(false)} siteConfig={siteConfig} categories={categories} onFilterCategory={setSelectedCategory} />}
      {showCategories && (
  <div onClick={() => setShowCategories(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 3500, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
    <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: "500px", maxHeight: "70vh", overflow: "auto", padding: "20px" }}>
      <div style={{ width: "40px", height: "4px", background: "#e0e0e0", borderRadius: "2px", margin: "0 auto 16px" }} />
      <h3 style={{ margin: "0 0 16px", fontSize: "18px", fontWeight: 700, color: "#1a1a2e" }}>📂 Catégories</h3>
      <button
        onClick={() => { setSelectedCategory("Tout"); setSortBy("relevance"); setShowCategories(false); productsRef.current?.scrollIntoView({ behavior: "smooth" }); }}
        style={{ width: "100%", textAlign: "left", padding: "14px 16px", border: "none", borderBottom: "1px solid #f5f5f5", background: selectedCategory === "Tout" ? "#f0f4ff" : "transparent", cursor: "pointer", fontSize: "15px", color: "#1a1a2e", fontWeight: selectedCategory === "Tout" ? 700 : 500, borderRadius: "10px", marginBottom: "4px", display: "flex", alignItems: "center", gap: "10px" }}
      >
        <span style={{ fontSize: "20px" }}>🛍️</span> Tous les produits
        {selectedCategory === "Tout" && <span style={{ marginLeft: "auto", color: "#e63946", fontWeight: 700 }}>✓</span>}
      </button>
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => { setSelectedCategory(cat); setShowCategories(false); productsRef.current?.scrollIntoView({ behavior: "smooth" }); }}
          style={{ width: "100%", textAlign: "left", padding: "14px 16px", border: "none", borderBottom: "1px solid #f5f5f5", background: selectedCategory === cat ? "#f0f4ff" : "transparent", cursor: "pointer", fontSize: "15px", color: "#1a1a2e", fontWeight: selectedCategory === cat ? 700 : 500, borderRadius: "10px", marginBottom: "4px", display: "flex", alignItems: "center", gap: "10px" }}
        >
          <span style={{ fontSize: "20px" }}>
            {cat === "Phone" ? "📱" : cat === "Laptop" ? "💻" : cat === "Ordinateur" ? "🖥️" : cat === "Tablette" ? "📟" : cat === "Accessoire" ? "🎧" : "📦"}
          </span>
          {cat}
          {selectedCategory === cat && <span style={{ marginLeft: "auto", color: "#e63946", fontWeight: 700 }}>✓</span>}
        </button>
      ))}
    </div>
  </div>
)}
{showLivraison && (
  <div onClick={() => setShowLivraison(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 3500, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
    <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: "500px", padding: "24px", maxHeight: "80vh", overflow: "auto" }}>
      <div style={{ width: "40px", height: "4px", background: "#e0e0e0", borderRadius: "2px", margin: "0 auto 16px" }} />
      <h3 style={{ margin: "0 0 16px", fontSize: "18px", fontWeight: 700, color: "#1a1a2e" }}>🚚 Livraison</h3>
      <p style={{ margin: 0, color: "#555", fontSize: "14px", lineHeight: 1.8, whiteSpace: "pre-line" }}>
        {siteConfig.livraisonTexte ?? "Livraison disponib nan tout Ayiti."}
      </p>
      <button onClick={() => setShowLivraison(false)} style={{ width: "100%", marginTop: "20px", padding: "14px", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}>
        Fermer
      </button>
    </div>
  </div>
)}

{showGarantie && (
  <div onClick={() => setShowGarantie(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 3500, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
    <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: "500px", padding: "24px", maxHeight: "80vh", overflow: "auto" }}>
      <div style={{ width: "40px", height: "4px", background: "#e0e0e0", borderRadius: "2px", margin: "0 auto 16px" }} />
      <h3 style={{ margin: "0 0 16px", fontSize: "18px", fontWeight: 700, color: "#1a1a2e" }}>🛡️ Garantie</h3>
      <p style={{ margin: 0, color: "#555", fontSize: "14px", lineHeight: 1.8, whiteSpace: "pre-line" }}>
        {siteConfig.garantieTexte ?? "Garanti 30 jou sou tout pwodwi."}
      </p>
      <button onClick={() => setShowGarantie(false)} style={{ width: "100%", marginTop: "20px", padding: "14px", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}>
        Fermer
      </button>
    </div>
  </div>
)}

      {/* ── NAVBAR ── */}
      <nav style={{ background: "#fff", borderBottom: "1px solid #eee", position: "sticky", top: 0, zIndex: 1000, boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px" }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <img src={siteConfig.logoUrl ?? "https://i.ibb.co/gLmkySCv/ab785ed1481b.jpg"} alt="Logo" style={{ width: "36px", height: "36px", borderRadius: "8px", objectFit: "contain" }} />
            <div>
              <p style={{ margin: 0, fontSize: "13px", fontWeight: 800, color: "#1a1a2e", lineHeight: 1 }}>
                Million<span style={{ color: "#e63946" }}>Store</span>
              </p>
              <p style={{ margin: 0, fontSize: "9px", color: "#aaa", lineHeight: 1.2 }}>
                {isOnline ? "🟢 En ligne" : "🔴 Hors ligne"}
              </p>
            </div>
          </div>

          {/* Ikòn dwat */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {/* Kont */}
            <button onClick={() => { const raw = localStorage.getItem("ms_web_user"); window.location.href = raw ? "/dashboard" : "/login"; }} style={{ background: "none", border: "none", cursor: "pointer", padding: "8px", borderRadius: "10px", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
              <span style={{ fontSize: "20px" }}>{mounted && isLoggedIn ? "✅" : "👤"}</span>
              <span style={{ fontSize: "9px", color: "#666" }}>Compte</span>
            </button>

            {/* Panye */}
            <button onClick={() => setShowCart(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: "8px", borderRadius: "10px", position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
              <span style={{ fontSize: "20px" }}>🛒</span>
              <span style={{ fontSize: "9px", color: "#666" }}>Panier</span>
              {cart.length > 0 && (
                <span style={{ position: "absolute", top: "4px", right: "4px", background: "#e63946", color: "#fff", borderRadius: "999px", fontSize: "10px", minWidth: "16px", height: "16px", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px", fontWeight: 700 }}>{cart.length}</span>
              )}
            </button>

            {/* 3 bar */}
            <button onClick={() => setShowDrawer(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: "8px", borderRadius: "10px", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
              <span style={{ fontSize: "20px" }}>☰</span>
              <span style={{ fontSize: "9px", color: "#666" }}>Menu</span>
            </button>
          </div>
        </div>

        {/* Baw rechèch */}
        <div style={{ padding: "0 16px 10px" }}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", fontSize: "16px", color: "#888" }}>🔍</span>
            <input
              type="search"
              placeholder="Rechercher un produit, ID, IMEI..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: "100%", padding: "11px 14px 11px 42px", borderRadius: "25px", border: "1.5px solid #e0e0e0", fontSize: "14px", outline: "none", background: "#f8f8f8", boxSizing: "border-box", fontFamily: "inherit" }}
              onFocus={(e) => { e.target.style.borderColor = "#1a1a2e"; e.target.style.background = "#fff"; }}
              onBlur={(e) => { e.target.style.borderColor = "#e0e0e0"; e.target.style.background = "#f8f8f8"; }}
            />
          </div>
        </div>

        {/* Bouton rapid scroll horizontal */}
        <div style={{ overflowX: "auto", display: "flex", gap: "8px", padding: "0 16px 12px", scrollbarWidth: "none" }}>
          {/* Bouton "Tout" */}
          <button onClick={() => { setSelectedCategory("Tout"); setSortBy("relevance"); }} style={{ flexShrink: 0, padding: "7px 14px", borderRadius: "999px", border: selectedCategory === "Tout" && sortBy === "relevance" ? "1.5px solid #1a1a2e" : "1.5px solid #e0e0e0", background: selectedCategory === "Tout" && sortBy === "relevance" ? "#1a1a2e" : "#fff", color: selectedCategory === "Tout" && sortBy === "relevance" ? "#fff" : "#333", fontSize: "13px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}>
            🛍️ Tout
          </button>
          {activeQuickBtns.map((btn) => {
            const isActive = (btn.action === "filter" && btn.value === selectedCategory) || (btn.action === "filter" && btn.value === sortBy);
            return (
              <button key={btn.id} onClick={() => handleQuickBtn(btn)} style={{ flexShrink: 0, padding: "7px 14px", borderRadius: "999px", border: isActive ? "1.5px solid #e63946" : "1.5px solid #e0e0e0", background: isActive ? "#e63946" : "#fff", color: isActive ? "#fff" : "#333", fontSize: "13px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}>
                {btn.icon} {btn.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── TAUX ── */}
      {taux > 1 && (
        <div style={{ background: "#1a1a2e", color: "#fff", textAlign: "center", padding: "6px 16px", fontSize: "13px", fontWeight: 600 }}>
          💱 Taux du jour: 1$ = {taux} HTG
        </div>
      )}

      {/* ── PRODUITS ── */}
      <div ref={productsRef} style={{ padding: "16px" }}>
        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
        <p style={{ margin: 0, fontSize: "14px", color: "#555" }}>
  {selectedCategory !== "Tout" && <span style={{ color: "#e63946", fontWeight: 700 }}>{selectedCategory}</span>}
</p>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "6px 10px", fontSize: "13px", background: "#fff", outline: "none", fontFamily: "inherit" }}>
            <option value="relevance">Pertinence</option>
            <option value="priceAsc">Prix: bas → haut</option>
            <option value="priceDesc">Prix: haut → bas</option>
          </select>
        </div>

        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{ background: "#fff", borderRadius: "14px", height: "260px", border: "1px solid #eee", animation: "pulse 1.5s infinite" }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 24px", background: "#fff", borderRadius: "16px", border: "1px solid #eee" }}>
            <p style={{ fontSize: "48px", margin: "0 0 12px" }}>🔍</p>
            <p style={{ color: "#666", fontSize: "16px", margin: 0 }}>Aucun produit trouvé.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            {filtered.map((p) => {
              const imgs  = getImages(p);
              const thumb = imgs[0] ?? getFallbackImage(p);
              const logo  = getMarqueLogo(p.marque);
              const color = getCatColor(p.category);
              const lowStock = (p.stock ?? 99) <= 2 && (p.stock ?? 99) > 0;

              return (
                <div key={p.id} onClick={() => { setSelectedProduct(p); trackClick(p.id); }} style={{ background: "#fff", borderRadius: "14px", border: "1px solid #eee", overflow: "hidden", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
                  {/* Image */}
                  <div style={{ position: "relative", background: "#fafafa", height: "150px", display: "flex", alignItems: "center", justifyContent: "center", padding: "8px" }}>
                    <img src={thumb} alt={`${p.marque} ${p.modele}`} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} onError={(e) => { (e.target as HTMLImageElement).src = getFallbackImage(p); }} />
                    {imgs.length > 1 && <span style={{ position: "absolute", bottom: "6px", right: "6px", background: "rgba(0,0,0,0.5)", color: "#fff", borderRadius: "6px", padding: "2px 6px", fontSize: "10px" }}>📷 {imgs.length}</span>}
                    {lowStock && <span style={{ position: "absolute", top: "6px", left: "6px", background: "#ff6b35", color: "#fff", borderRadius: "6px", padding: "2px 7px", fontSize: "10px", fontWeight: 700 }}>Dèrnier {p.stock}!</span>}
                  </div>

                  {/* Info */}
                  <div style={{ padding: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ background: `${color}18`, color, padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 700 }}>{p.category}</span>
                      {logo && <img src={logo} alt={p.marque} style={{ height: "14px", objectFit: "contain" }} />}
                    </div>
                    <p style={{ margin: "0 0 4px", color: "#555", fontSize: "12px", fontWeight: 700 }}>🔖 ID: {p.id}</p>
                    <h3 style={{ margin: "0 0 4px", fontSize: "13px", color: "#111820", lineHeight: 1.3, fontWeight: 700 }}>{p.marque} {p.modele}</h3>
                    {p.description && <p style={{ margin: "0 0 6px", color: "#888", fontSize: "11px", lineHeight: 1.3 }}>{p.description.length > 50 ? p.description.slice(0, 50) + "…" : p.description}</p>}
                    <p style={{ margin: "0 0 8px", color: "#111", fontWeight: 800, fontSize: "17px" }}>${Number(p.prixVente).toLocaleString()}</p>
                    <button onClick={(e) => { e.stopPropagation(); setSelectedProduct(p); }} style={{ width: "100%", borderRadius: "8px", border: "none", background: "#1a1a2e", color: "#fff", padding: "8px", fontWeight: 600, cursor: "pointer", fontSize: "12px" }}>
                      Voir détails
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── BOTTOM BAR ── */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: "1px solid #eee", display: "flex", zIndex: 999, boxShadow: "0 -2px 10px rgba(0,0,0,0.08)" }}>
        {/* Accueil */}
        <button onClick={() => { setSelectedCategory("Tout"); setSortBy("relevance"); setSearchTerm(""); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ flex: 1, padding: "10px 8px", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
          <span style={{ fontSize: "20px" }}>🏠</span>
          <span style={{ fontSize: "10px", color: "#1a1a2e", fontWeight: 700 }}>Accueil</span>
        </button>

        {/* WhatsApp */}
        <button onClick={() => window.open(`https://wa.me/${siteConfig.whatsapp1 ?? "50938332483"}`, "_blank", "noopener,noreferrer")} style={{ flex: 1, padding: "10px 8px", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
          <span style={{ fontSize: "20px" }}>💬</span>
          <span style={{ fontSize: "10px", color: "#25D366", fontWeight: 700 }}>WhatsApp</span>
        </button>

        {/* Mon Compte */}
        <button onClick={() => { const raw = localStorage.getItem("ms_web_user"); window.location.href = raw ? "/dashboard" : "/login"; }} style={{ flex: 1, padding: "10px 8px", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
          <span style={{ fontSize: "20px" }}>{mounted && isLoggedIn ? "✅" : "👤"}</span>
          <span style={{ fontSize: "10px", color: "#666", fontWeight: 600 }}>Mon Compte</span>
        </button>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        ::-webkit-scrollbar { display: none; }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>
    </main>
  );
}