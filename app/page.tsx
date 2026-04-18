"use client";
import { useEffect, useState, useMemo } from "react";
import { auth, db } from "../lib/firebase";
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { collectionGroup, onSnapshot, query } from "firebase/firestore";

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

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const MARQUE_LOGOS: Record<string, string> = {
  hp: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/HP_logo_2012.svg/800px-HP_logo_2012.svg.png",
  dell: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Dell_Logo.svg/1280px-Dell_Logo.svg.png",
  lenovo: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Lenovo_logo_2015.svg/1280px-Lenovo_logo_2015.svg.png",
  apple: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Apple_logo_black.svg/800px-Apple_logo_black.svg.png",
  iphone: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Apple_logo_black.svg/800px-Apple_logo_black.svg.png",
  samsung: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Samsung_Logo.svg/1280px-Samsung_Logo.svg.png",
  asus: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/ASUS_Logo.svg/1280px-ASUS_Logo.svg.png",
  acer: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Acer_2011.svg/1280px-Acer_2011.svg.png",
  microsoft: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Microsoft_logo.svg/1280px-Microsoft_logo.svg.png",
  huawei: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Huawei_Logo.svg/1280px-Huawei_Logo.svg.png",
  xiaomi: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Xiaomi_logo.svg/1280px-Xiaomi_logo.svg.png",
  toshiba: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Toshiba_logo.svg/1280px-Toshiba_logo.svg.png",
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
  Phone: "#6C63FF",
  Ordinateur: "#00B894",
  Laptop: "#00B894",
  Desktop: "#0984E3",
  Accessoire: "#F79F1F",
  Tablette: "#E17055",
  "Lòt": "#636E72",
};

const WHATSAPP_NUMBER = "50938332483";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}`;
const WHATSAPP_NUMBER_ALT = "50947733471";
const WHATSAPP_LINK_ALT = `https://wa.me/${WHATSAPP_NUMBER_ALT}`;

/** Nimewo pou voye lajan nan modal peman (MonCash / NatCash) */
const PAYMENT_MONCASH_NUMBER = "+509 38 33 24 83";
const PAYMENT_NATCASH_NUMBER = "+509 35 01 28 13";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getImages(p: Product): string[] {
  if (p.imagePaths && p.imagePaths.length > 0) {
    return p.imagePaths.filter((u) => u && u.startsWith("http"));
  }
  if (p.imagePath && p.imagePath.startsWith("http")) return [p.imagePath];
  return [];
}

function getMarqueLogo(marque: string): string | null {
  const key = marque.toLowerCase().trim();
  for (const [k, v] of Object.entries(MARQUE_LOGOS)) {
    if (key.includes(k)) return v;
  }
  return null;
}

function getFallbackImage(p: Product): string {
  return CAT_IMAGES[p.category] ?? CAT_IMAGES["Lòt"];
}

function getCatColor(cat: string): string {
  return CAT_COLORS[cat] ?? "#636E72";
}

// ─── MODAL PEMAN ─────────────────────────────────────────────────────────────
function PaymentModal({
  product,
  products,
  onClose,
  onPaymentConfirmed,
}: {
  product?: Product;
  products?: Product[];
  onClose: () => void;
  onPaymentConfirmed?: () => void;
}) {
  const [step, setStep] = useState<"choose" | "moncash" | "natcash" | "bank" | "confirm">("choose");
  const [showPaymentInfo, setShowPaymentInfo] = useState(false);
  const [phone, setPhone] = useState("");
  const [ref, setRef] = useState("");
  const checkoutItems = products && products.length > 0 ? products : product ? [product] : [];
  const totalAmount = checkoutItems.reduce((sum, item) => sum + Number(item.prixVente || 0), 0);
  const isMultiCheckout = checkoutItems.length > 1;
  const orderLabel = isMultiCheckout
    ? `${checkoutItems.length} pwodwi`
    : `${checkoutItems[0]?.marque ?? ""} ${checkoutItems[0]?.modele ?? ""}`.trim();

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const METHOD_COLORS: Record<string, string> = {
    moncash: "#E8011A",
    natcash: "#004B87",
    bank: "#1D5F2B",
  };

  const METHOD_LABELS: Record<string, string> = {
    moncash: "MonCash",
    natcash: "NatCash",
    bank: "Virement Bancaire",
  };

  const activeColor = step !== "choose" && step !== "confirm" ? METHOD_COLORS[step] : "#1a1a2e";

  const handleConfirmPayment = (method: "moncash" | "natcash" | "bank") => {
    setStep("confirm");
    onPaymentConfirmed?.();

    const paymentRef = ref.trim() || "Pa bay referans";
    const buyerPhone = phone.trim() || "Pa bay nimewo";
    const itemLines = checkoutItems
      .map(
        (item, index) =>
          `${index + 1}. ${item.marque} ${item.modele} - $${Number(item.prixVente).toLocaleString()}`
      )
      .join("%0A");
    const message =
      `Bonjou MillionStore,%0A%0AMwen fek konfime yon peman.%0A%0A` +
      `Metod: ${METHOD_LABELS[method]}%0A` +
      `Telefon kliyan: ${buyerPhone}%0A` +
      `Referans tranzaksyon: ${paymentRef}%0A%0A` +
      `Pwodwi yo:%0A${itemLines}%0A%0ATotal: $${Number(totalAmount).toLocaleString()}`;

    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
        zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: "20px", maxWidth: "460px",
          width: "100%", padding: "28px", position: "relative",
          maxHeight: "90vh", overflow: "auto",
        }}
      >
        {/* Bouton fèmen */}
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: "16px", right: "16px",
            background: "#f1f1f1", border: "none", borderRadius: "50%",
            width: "36px", height: "36px", fontSize: "18px", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >×</button>

        {/* ── ETAP 1: Chwazi metòd ── */}
        {step === "choose" && (
          <>
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <p style={{ margin: "0 0 4px", fontSize: "13px", color: "#888" }}>Total pou peye</p>
              <p style={{ margin: 0, fontSize: "32px", fontWeight: 800, color: "#111" }}>
                ${Number(totalAmount).toLocaleString()}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#888" }}>
                {orderLabel}
              </p>
            </div>

            {isMultiCheckout && (
              <div style={{ background: "#f8f9ff", borderRadius: "10px", padding: "10px 12px", marginBottom: "12px" }}>
                {checkoutItems.map((item, index) => (
                  <p key={`${item.id}-${index}`} style={{ margin: "0 0 4px", fontSize: "12px", color: "#555" }}>
                    • {item.marque} {item.modele} - ${Number(item.prixVente).toLocaleString()}
                  </p>
                ))}
              </div>
            )}

            <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "0 0 16px" }} />

            <p style={{ fontSize: "12px", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 12px" }}>
              Chwazi metòd peman
            </p>

            {[
              { key: "moncash", label: "MonCash", sub: "Peye ak nimewo MonCash ou", color: "#E8011A", icon: "M" },
              { key: "natcash", label: "NatCash", sub: "Peye ak nimewo NatCash ou", color: "#004B87", icon: "N" },
              { key: "bank", label: "Virement Bancaire", sub: "BNC, Sogebank, BUH, UNIBANK...", color: "#1D5F2B", icon: "🏦" },
            ].map(({ key, label, sub, color, icon }) => (
              <button
                key={key}
                onClick={() => setStep(key as "moncash" | "natcash" | "bank")}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: "14px",
                  padding: "14px 16px", borderRadius: "12px",
                  border: "1px solid #eee", background: "#fff",
                  cursor: "pointer", marginBottom: "10px", textAlign: "left",
                }}
              >
                <div style={{
                  width: "42px", height: "42px", borderRadius: "50%",
                  background: color, display: "flex", alignItems: "center",
                  justifyContent: "center", flexShrink: 0,
                  color: "#fff", fontWeight: 700, fontSize: "18px",
                }}>
                  {icon}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#111" }}>{label}</p>
                  <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>{sub}</p>
                </div>
                <span style={{ fontSize: "20px", color: "#ccc" }}>›</span>
              </button>
            ))}

            <button
              onClick={() => setShowPaymentInfo((prev) => !prev)}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: "12px",
                border: "1px dashed #cfd8dc",
                background: "#f8fbff",
                color: "#1a1a2e",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                marginTop: "4px",
              }}
            >
              ℹ️ Information de peyman {showPaymentInfo ? "▲" : "▼"}
            </button>

            {showPaymentInfo && (
              <div style={{ marginTop: "10px", background: "#f8f9ff", border: "1px solid #e5e9ff", borderRadius: "12px", padding: "12px 14px" }}>
                <p style={{ margin: "0 0 8px", fontSize: "12px", fontWeight: 700, color: "#4c5a7d", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Kijan pou peye
                </p>
                <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#555" }}>1) Chwazi metòd ou vle a (MonCash, NatCash, oswa Bank).</p>
                <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#555" }}>2) Fè transfè a sou nimewo/kont ki parèt la.</p>
                <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#555" }}>3) Retounen mete nimewo telefòn ou ak referans tranzaksyon an.</p>
                <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#555" }}>4) Klike <strong>Konfime peman an</strong>, nou verifye epi nou kontakte ou.</p>
                <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#555" }}>5) Se ou k ap fè tranzaksyon manyèl apre w ap ekri nimewo phone nan ak nimewo tranzaksyon an, oubyen ou voye foto kote ou fè transfè a pou nou.</p>
                <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#555" }}>6) Ou ka ekri nou sou WhatsApp oubyen pase nan lokal nou pou plis infos.</p>
                <p style={{ margin: 0, fontSize: "13px", color: "#555" }}>7) Full garanti: si pwodwi a ba w pwoblèm, n ap vin chanje li pou ou oubyen ranbouse w lajan ou.</p>
              </div>
            )}
          </>
        )}

        {/* ── ETAP 2: MonCash oswa NatCash ── */}
        {(step === "moncash" || step === "natcash") && (
          <>
            <button onClick={() => setStep("choose")} style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "13px", color: "#888", padding: 0, marginBottom: "16px",
            }}>← Retounen</button>

            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              <div style={{
                width: "42px", height: "42px", borderRadius: "50%",
                background: activeColor, display: "flex", alignItems: "center",
                justifyContent: "center", color: "#fff", fontWeight: 700,
                fontSize: "18px", flexShrink: 0,
              }}>
                {step === "moncash" ? "M" : "N"}
              </div>
              <div>
                <p style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#111" }}>{METHOD_LABELS[step]}</p>
                <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>Total: ${Number(totalAmount).toLocaleString()}</p>
              </div>
            </div>

            <div style={{ background: "#fafafa", borderRadius: "12px", padding: "14px", marginBottom: "16px" }}>
              <p style={{ fontSize: "13px", color: "#888", margin: "0 0 4px" }}>Voye lajan nan nimewo sa a:</p>
              <p style={{ fontSize: "20px", fontWeight: 800, color: "#111", margin: 0, letterSpacing: "1px" }}>
                {step === "moncash" ? PAYMENT_MONCASH_NUMBER : PAYMENT_NATCASH_NUMBER}
              </p>
              <p style={{ fontSize: "12px", color: "#888", margin: "6px 0 0" }}>Non: Christian Hotes</p>
            </div>

            <label style={{ fontSize: "13px", color: "#888", display: "block", marginBottom: "6px" }}>
              Nimewo telefòn ou ({METHOD_LABELS[step]})
            </label>
            <input
              type="tel"
              placeholder="Ex: 509 XX XX XXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "10px",
                border: "1px solid #ddd", fontSize: "14px",
                boxSizing: "border-box", marginBottom: "12px", outline: "none",
              }}
            />

            <label style={{ fontSize: "13px", color: "#888", display: "block", marginBottom: "6px" }}>
              Referans / kòd tranzaksyon
            </label>
            <input
              type="text"
              placeholder="Nimewo referans ou jwenn nan aplikasyon an"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "10px",
                border: "1px solid #ddd", fontSize: "14px",
                boxSizing: "border-box", marginBottom: "16px", outline: "none",
              }}
            />

            <button
              onClick={() => handleConfirmPayment(step)}
              style={{
                width: "100%", padding: "13px", background: activeColor,
                color: "#fff", border: "none", borderRadius: "12px",
                fontSize: "15px", fontWeight: 700, cursor: "pointer",
              }}
            >
              Konfime peman an
            </button>
          </>
        )}

        {/* ── ETAP 2: Bank ── */}
        {step === "bank" && (
          <>
            <button onClick={() => setStep("choose")} style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "13px", color: "#888", padding: 0, marginBottom: "16px",
            }}>← Retounen</button>

            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              <div style={{
                width: "42px", height: "42px", borderRadius: "50%",
                background: "#1D5F2B", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: "18px", flexShrink: 0,
              }}>🏦</div>
              <div>
                <p style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#111" }}>Virement Bancaire</p>
                <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>Total: ${Number(totalAmount).toLocaleString()}</p>
              </div>
            </div>

            <div style={{ background: "#fafafa", borderRadius: "12px", padding: "14px", marginBottom: "16px" }}>
              <p style={{ fontSize: "12px", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 10px" }}>
                Enfòmasyon kont bank
              </p>
              {[
                ["Non titilè", "MillionStore Haiti"],
                ["Bank", "BNC / Sogebank"],
                ["Nimewo kont", "XXX-XXXX-XX"],
              ].map(([label, val]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "13px" }}>
                  <span style={{ color: "#888" }}>{label}</span>
                  <span style={{ fontWeight: 700, color: "#111" }}>{val}</span>
                </div>
              ))}
            </div>

            <label style={{ fontSize: "13px", color: "#888", display: "block", marginBottom: "6px" }}>
              Nimewo referans virement ou
            </label>
            <input
              type="text"
              placeholder="Referans bank ou"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "10px",
                border: "1px solid #ddd", fontSize: "14px",
                boxSizing: "border-box", marginBottom: "16px", outline: "none",
              }}
            />

            <button
              onClick={() => handleConfirmPayment("bank")}
              style={{
                width: "100%", padding: "13px", background: "#1D5F2B",
                color: "#fff", border: "none", borderRadius: "12px",
                fontSize: "15px", fontWeight: 700, cursor: "pointer",
              }}
            >
              Konfime peman an
            </button>
          </>
        )}

        {/* ── ETAP 3: Konfirmasyon ── */}
        {step === "confirm" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{
              width: "64px", height: "64px", borderRadius: "50%",
              background: "#e8f5e9", display: "flex", alignItems: "center",
              justifyContent: "center", margin: "0 auto 16px", fontSize: "28px",
            }}>✓</div>
            <p style={{ fontSize: "18px", fontWeight: 700, color: "#111", margin: "0 0 8px" }}>
              Mèsi pou kòmand ou!
            </p>
            <p style={{ fontSize: "14px", color: "#666", margin: "0 0 20px", lineHeight: 1.6 }}>
              Nou resevwa enfòmasyon peman ou. Ekip nou an ap kontakte ou trè vit pou konfime livrezon.
            </p>
            <p style={{ fontSize: "13px", color: "#888" }}>📞 +509 38 33 2483</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MODAL DETAY PWODWI ──────────────────────────────────────────────────────
function ProductModal({
  product,
  onClose,
  onAddToCart,
}: {
  product: Product;
  onClose: () => void;
  onAddToCart: (product: Product) => void;
}) {
  const [imgIdx, setImgIdx] = useState(0);
  const [showPayment, setShowPayment] = useState(false);
  const imgs = getImages(product);
  const logo = getMarqueLogo(product.marque);
  const color = getCatColor(product.category);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
      }}
    >
      {/* Modal peman */}
      {showPayment && (
        <PaymentModal product={product} onClose={() => setShowPayment(false)} />
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: "20px", maxWidth: "700px",
          width: "100%", maxHeight: "90vh", overflow: "auto",
          padding: "32px", position: "relative",
        }}
      >
        {/* Bouton fèmen */}
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: "16px", right: "16px",
            background: "#f1f1f1", border: "none", borderRadius: "50%",
            width: "36px", height: "36px", fontSize: "18px", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >×</button>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Galeri foto */}
          <div>
            <div style={{
              background: "#fafafa", borderRadius: "14px", padding: "16px",
              height: "260px", display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: "12px", overflow: "hidden",
            }}>
              <img
                src={imgs[imgIdx] ?? getFallbackImage(product)}
                alt={`${product.marque} ${product.modele}`}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            </div>
            {imgs.length > 1 && (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {imgs.map((img, i) => (
                  <div
                    key={i}
                    onClick={() => setImgIdx(i)}
                    style={{
                      width: "56px", height: "56px", borderRadius: "8px",
                      border: i === imgIdx ? `2px solid ${color}` : "2px solid #eee",
                      overflow: "hidden", cursor: "pointer",
                    }}
                  >
                    <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Enfòmasyon */}
          <div>
            {/* Badge kategori */}
            <span style={{
              background: `${color}18`, color, padding: "4px 12px",
              borderRadius: "999px", fontSize: "12px", fontWeight: 700,
            }}>
              {product.category}
            </span>

            {/* ✅ ID pwodwi */}
            <p style={{ margin: "4px 0 8px", color: "#aaa", fontSize: "12px" }}>
              🔖 ID: <span style={{ fontWeight: 700, color: "#555" }}>{product.id || "SAN-ID"}</span>
            </p>

            {/* Mak + logo */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "12px 0 4px" }}>
              {logo && (
                <img src={logo} alt={product.marque} style={{ height: "22px", objectFit: "contain" }} />
              )}
              <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#111" }}>
                {product.marque} {product.modele}
              </h2>
            </div>

            {product.description && (
              <p style={{ color: "#555", fontSize: "14px", lineHeight: 1.6, margin: "8px 0 16px" }}>
                {product.description}
              </p>
            )}

            {/* Pri */}
            <p style={{ fontSize: "32px", fontWeight: 800, color: "#111", margin: "0 0 4px" }}>
              ${Number(product.prixVente).toLocaleString()}
            </p>

            {/* Stock */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              background: product.stock <= 2 ? "#fff3e0" : "#e8f5e9",
              color: product.stock <= 2 ? "#e65100" : "#2e7d32",
              padding: "4px 12px", borderRadius: "999px", fontSize: "13px",
              fontWeight: 600, marginBottom: "20px",
            }}>
              <span>{product.stock <= 2 ? "⚠️" : "✅"}</span>
              {product.stock <= 2 ? `Sèlman ${product.stock} ki rete!` : `${product.stock} an stock`}
            </div>

            {/* ✅ Bouton Achte — ouvri PaymentModal */}
            <button
              onClick={(e) => { e.stopPropagation(); setShowPayment(true); }}
              style={{
                width: "100%", background: "#1a1a2e", color: "#fff",
                border: "none", borderRadius: "12px", padding: "14px",
                fontSize: "16px", fontWeight: 700, cursor: "pointer", marginBottom: "10px",
              }}
            >
              🛒 Achte Kounye a
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                window.open(WHATSAPP_LINK, "_blank", "noopener,noreferrer");
              }}
              style={{
              width: "100%", background: "#fff", color: "#1a1a2e",
              border: "2px solid #1a1a2e", borderRadius: "12px", padding: "12px",
              fontSize: "15px", fontWeight: 600, cursor: "pointer", marginBottom: "10px",
            }}
            >
              💬 Kontakte nou
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddToCart(product);
                onClose();
              }}
              style={{
                width: "100%", background: "#0b8457", color: "#fff",
                border: "none", borderRadius: "12px", padding: "12px",
                fontSize: "15px", fontWeight: 700, cursor: "pointer",
              }}
            >
              ➕ Ajoute nan panye
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CartModal({
  cart,
  onClose,
  onRemoveItem,
  onCheckout,
  onCheckoutAll,
}: {
  cart: Product[];
  onClose: () => void;
  onRemoveItem: (index: number) => void;
  onCheckout: (product: Product) => void;
  onCheckoutAll: () => void;
}) {
  const total = cart.reduce((sum, item) => sum + Number(item.prixVente || 0), 0);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        zIndex: 2600, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: "20px", maxWidth: "620px",
          width: "100%", maxHeight: "90vh", overflow: "auto",
          padding: "24px", position: "relative",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: "14px", right: "14px",
            background: "#f1f1f1", border: "none", borderRadius: "50%",
            width: "34px", height: "34px", fontSize: "18px", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >×</button>

        <h2 style={{ margin: "0 0 12px", color: "#111", fontSize: "24px" }}>
          🛒 Panye ou ({cart.length})
        </h2>
        <p style={{ margin: "0 0 16px", color: "#0b8457", fontWeight: 800, fontSize: "18px" }}>
          Total: ${total.toLocaleString()}
        </p>

        {cart.length === 0 ? (
          <p style={{ margin: 0, color: "#666", fontSize: "15px" }}>
            Panye a vid. Ajoute pwodwi pou kontinye.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {cart.map((item, index) => {
              const imgs = getImages(item);
              const thumb = imgs[0] ?? getFallbackImage(item);
              return (
                <div
                  key={`${item.id}-${index}`}
                  style={{
                    border: "1px solid #ececec",
                    borderRadius: "12px",
                    padding: "12px",
                    display: "grid",
                    gridTemplateColumns: "74px 1fr",
                    gap: "12px",
                    alignItems: "center",
                  }}
                >
                  <img
                    src={thumb}
                    alt={`${item.marque} ${item.modele}`}
                    style={{
                      width: "74px", height: "74px", objectFit: "contain",
                      background: "#fafafa", borderRadius: "10px", padding: "6px",
                    }}
                  />

                  <div>
                    <p style={{ margin: "0 0 2px", fontWeight: 700, color: "#111" }}>
                      {item.marque} {item.modele}
                    </p>
                    <p style={{ margin: "0 0 10px", color: "#0b8457", fontWeight: 700 }}>
                      ${Number(item.prixVente).toLocaleString()}
                    </p>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        onClick={() => onCheckout(item)}
                        style={{
                          background: "#1a1a2e", color: "#fff", border: "none",
                          borderRadius: "10px", padding: "8px 12px",
                          fontWeight: 700, cursor: "pointer", fontSize: "13px",
                        }}
                      >
                        Achte kounye a
                      </button>
                      <button
                        onClick={() => onRemoveItem(index)}
                        style={{
                          background: "#fff", color: "#b42318", border: "1px solid #f5c2c2",
                          borderRadius: "10px", padding: "8px 12px",
                          fontWeight: 600, cursor: "pointer", fontSize: "13px",
                        }}
                      >
                        Retire
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            <button
              onClick={onCheckoutAll}
              style={{
                width: "100%", background: "#1a1a2e", color: "#fff",
                border: "none", borderRadius: "12px", padding: "12px",
                fontSize: "15px", fontWeight: 800, cursor: "pointer", marginTop: "8px",
              }}
            >
              Achte tout kounye a
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function Home() {
  const [products, setProducts]         = useState<Product[]>([]);
  const [loading, setLoading]           = useState(true);
  const [isOnline, setIsOnline]         = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("Tout");
  const [selectedBrand, setSelectedBrand]       = useState("Tout");
  const [searchTerm, setSearchTerm]     = useState("");
  const [sortBy, setSortBy]             = useState<"relevance" | "priceAsc" | "priceDesc">("relevance");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<Product[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [checkoutProduct, setCheckoutProduct] = useState<Product | null>(null);
  const [checkoutProducts, setCheckoutProducts] = useState<Product[] | null>(null);

  const handleAddToCart = (product: Product) => {
    setCart((prev) => [...prev, product]);
  };

  const handleRemoveFromCart = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCheckoutFromCart = (product: Product) => {
    setShowCart(false);
    setCheckoutProducts(null);
    setCheckoutProduct(product);
  };
  const handleCheckoutAllFromCart = () => {
    if (cart.length === 0) return;
    setShowCart(false);
    setCheckoutProduct(null);
    setCheckoutProducts(cart);
  };

  const handleGoogleAuth = async () => {
    try {
      if (auth.currentUser) {
        await signOut(auth);
        return;
      }
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google auth error:", error);
      alert("Nou pa t ka konekte ak Google kounye a. Tanpri eseye ankò.");
    }
  };

  useEffect(() => {
    const q = query(collectionGroup(db, "products"));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data: Product[] = [];
        snapshot.forEach((doc) => {
          const p = { ...doc.data(), id: doc.id } as Product;
          if (p.isDeleted === true) return;
          const s = p.stock;
          if (s != null && Number(s) <= 0) return;
          data.push(p);
        });
        data.sort((a, b) => (a.category ?? "").localeCompare(b.category ?? ""));
        setProducts(data);
        setLoading(false);
        setIsOnline(true);
      },
      (error) => {
        console.error("Firestore error:", error);
        setIsOnline(false);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("millionstore_cart");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Product[];
      if (Array.isArray(parsed)) {
        setCart(parsed);
      }
    } catch (error) {
      console.error("Cart load error:", error);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("millionstore_cart", JSON.stringify(cart));
    } catch (error) {
      console.error("Cart save error:", error);
    }
  }, [cart]);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map((p) => p.category ?? "Lòt")));
    return ["Tout", ...cats.sort()];
  }, [products]);

  const brands = useMemo(() => {
    const src = selectedCategory === "Tout"
      ? products
      : products.filter((p) => p.category === selectedCategory);
    const b = Array.from(new Set(src.map((p) => p.marque ?? "Lòt")));
    return ["Tout", ...b.sort()];
  }, [products, selectedCategory]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return products
      .filter((p) => {
        if (selectedCategory !== "Tout" && p.category !== selectedCategory) return false;
        if (selectedBrand !== "Tout" && p.marque !== selectedBrand) return false;
        if (!q) return true;
        const hay = `${p.id} ${p.marque} ${p.modele} ${p.description ?? ""} ${p.category} ${p.serialImei ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        if (sortBy === "priceAsc") return Number(a.prixVente) - Number(b.prixVente);
        if (sortBy === "priceDesc") return Number(b.prixVente) - Number(a.prixVente);
        return 0;
      });
  }, [products, selectedCategory, selectedBrand, searchTerm, sortBy]);

  return (
    <main style={{ fontFamily: "'Segoe UI', sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>

      {selectedProduct && (
        <ProductModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onAddToCart={handleAddToCart}
        />
      )}
      {showCart && (
        <CartModal
          cart={cart}
          onClose={() => setShowCart(false)}
          onRemoveItem={handleRemoveFromCart}
          onCheckout={handleCheckoutFromCart}
          onCheckoutAll={handleCheckoutAllFromCart}
        />
      )}
      {checkoutProduct && (
        <PaymentModal
          product={checkoutProduct}
          onClose={() => setCheckoutProduct(null)}
          onPaymentConfirmed={() => setCart([])}
        />
      )}
      {checkoutProducts && (
        <PaymentModal
          products={checkoutProducts}
          onClose={() => setCheckoutProducts(null)}
          onPaymentConfirmed={() => setCart([])}
        />
      )}

      {/* Banner */}
      <div style={{
        background: "#1a1a2e", color: "#fff", textAlign: "center",
        padding: "10px", fontSize: "14px",
      }}>
        🚀 Livrezon disponib toupatou ann Ayiti — !
        <span style={{
          marginLeft: "16px", display: "inline-flex", alignItems: "center", gap: "6px",
          background: "rgba(255,255,255,0.1)", borderRadius: "20px", padding: "2px 10px",
          fontSize: "12px",
        }}>
          <span style={{
            width: "7px", height: "7px", borderRadius: "50%",
            background: isOnline ? "#00e676" : "#ff1744",
            display: "inline-block",
          }}/>
          {isOnline ? "Live" : "Offline"}
        </span>
      </div>

      {/* Navbar — grid: sou phone rechèch anba, plen lajè; sou desktop menm liy */}
      <nav
        className="site-nav"
        style={{
          borderBottom: "1px solid #eee",
          position: "sticky", top: 0, background: "#fff", zIndex: 1000,
          boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
        }}
      >
        <div className="site-nav-brand" style={{ fontSize: "24px", fontWeight: "bold", color: "#e63946" }}>
          Million<span style={{ color: "#1a1a2e" }}>Store</span>
        </div>
        <div className="site-nav-search">
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Rechèch (non, kategori, ID, IMEI/serial...)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="site-nav-search-input"
          />
        </div>
        <div className="site-nav-icons" style={{ display: "flex", gap: "20px", fontSize: "24px" }}>
          <span style={{ cursor: "pointer" }}>🤍</span>
          <span
            onClick={handleGoogleAuth}
            title={user ? `Dekonekte (${user.displayName ?? user.email ?? "Google"})` : "Konekte ak Google"}
            style={{ cursor: "pointer" }}
          >
            {user ? "✅👤" : "👤"}
          </span>
          <span
            onClick={() => setShowCart(true)}
            title="Panye"
            style={{ cursor: "pointer", position: "relative", display: "inline-flex" }}
          >
            🛒
            {cart.length > 0 && (
              <span style={{
                position: "absolute", top: "-8px", right: "-10px",
                background: "#e63946", color: "#fff",
                borderRadius: "999px", fontSize: "11px",
                minWidth: "18px", height: "18px",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: "0 4px", fontWeight: 700,
              }}>
                {cart.length}
              </span>
            )}
          </span>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ background: "#fff", padding: "60px 24px", textAlign: "center" }}>
        <img src="https://i.ibb.co/gLmkySCv/ab785ed1481b.jpg" alt="MillionStore Logo"
          style={{ height: "200px", objectFit: "contain", marginBottom: "12px", display: "block", marginLeft: "auto", marginRight: "auto" }} />
        <h2 style={{ fontSize: "28px", fontWeight: 900, color: "#1a1a2e", margin: "0 0 16px", letterSpacing: "2px", textTransform: "uppercase" }}>
          MillionStore
        </h2>
        <p style={{ margin: "0 0 8px", color: "#666", fontSize: "18px" }}>
          #25,Delmas 83, à proximité du BUH, à côté du CEDEC, Port-au-Prince, Haïti.
        </p>
        <a href="tel:+50938332483" style={{ display: "inline-flex", alignItems: "center", gap: "8px", margin: "0 0 8px", color: "#1a6fc4", fontSize: "18px", textDecoration: "none", fontWeight: 500 }}>
          📞 +509 38332483
        </a>
        <br/>
        <a
          href={WHATSAPP_LINK_ALT}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: "8px", margin: "0 0 8px", color: "#25D366", fontSize: "18px", textDecoration: "none", fontWeight: 700 }}
        >
          💬 WhatsApp: +509 47733471
        </a>
        <br/>
        <a href="tel:+50935012813" style={{ display: "inline-flex", alignItems: "center", gap: "8px", margin: "0 0 8px", color: "#1a6fc4", fontSize: "18px", textDecoration: "none", fontWeight: 500 }}>
          📞 Apèl dirèk: +509 35012813
        </a>
        <br/>
        <a href="tel:+50956739901" style={{ display: "inline-flex", alignItems: "center", gap: "8px", margin: "0 0 8px", color: "#1a6fc4", fontSize: "18px", textDecoration: "none", fontWeight: 500 }}>
          📞 Apèl dirèk: +509 56 73 99 01
        </a>
        <br/>
        <a href="mailto:millionstorehaiti@gmail.com" style={{ display: "inline-flex", alignItems: "center", gap: "8px", margin: "0 0 28px", color: "#1a6fc4", fontSize: "18px", textDecoration: "none", fontWeight: 500 }}>
          ✉️ millionstorehaiti@gmail.com
        </a>
        <br/>
        <button style={{ background: "#1a1a2e", color: "#fff", padding: "14px 40px", borderRadius: "30px", border: "none", fontSize: "16px", cursor: "pointer" }}>
          vini Achte Kounye a
        </button>
      </section>

      {/* Kontni prensipal */}
      <section style={{ padding: "40px 24px", maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ fontSize: "28px", color: "#111820", fontWeight: 700, margin: 0 }}>
            {loading ? "Chajman..." : `${products.length} pwodwi disponib`}
          </h2>
        </div>

        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "20px" }}>
            <div style={{ background: "#fff", borderRadius: "12px", height: "400px",
              animation: "pulse 1.5s infinite", border: "1px solid #eee" }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
              {[...Array(6)].map((_, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: "14px", height: "320px",
                  border: "1px solid #eee", animation: "pulse 1.5s infinite" }} />
              ))}
            </div>
          </div>
        ) : products.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 24px", background: "#fff",
            borderRadius: "16px", border: "1px solid #eee" }}>
            <p style={{ fontSize: "48px", margin: 0 }}>📦</p>
            <p style={{ color: "#666", fontSize: "16px" }}>Pa gen pwodwi disponib kounye a.</p>
          </div>
        ) : (
          <div
            className="catalog-layout"
            style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "20px", alignItems: "start" }}
          >

            {/* Sidebar filtè */}
            <aside className="filters-panel" style={{
              background: "#fff", border: "1px solid #e5e5e5",
              borderRadius: "12px", padding: "16px",
              position: "sticky", top: "92px",
            }}>
              <h3 style={{ fontSize: "16px", margin: "0 0 14px", color: "#1a1a2e", fontWeight: 700 }}>
                Filtè
              </h3>

              <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Kategori
              </p>
              {categories.map((cat) => {
                const count = cat === "Tout"
                  ? products.length
                  : products.filter((p) => p.category === cat).length;
                const active = selectedCategory === cat;
                const color = getCatColor(cat);
                return (
                  <button
                    className="filter-option"
                    key={cat}
                    onClick={() => { setSelectedCategory(cat); setSelectedBrand("Tout"); }}
                    style={{
                      width: "100%", textAlign: "left", borderRadius: "8px",
                      border: active ? `1.5px solid ${color}` : "1px solid #ececec",
                      background: active ? `${color}12` : "#fff",
                      color: active ? color : "#333",
                      padding: "8px 12px", marginBottom: "6px", cursor: "pointer",
                      fontWeight: active ? 700 : 400, fontSize: "14px",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}
                  >
                    <span>{cat}</span>
                    <span style={{
                      background: active ? color : "#f0f0f0",
                      color: active ? "#fff" : "#666",
                      borderRadius: "999px", padding: "1px 8px", fontSize: "12px",
                    }}>{count}</span>
                  </button>
                );
              })}

              <p style={{ margin: "16px 0 8px", fontSize: "12px", color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Mak
              </p>
              {brands.map((brand) => {
                const logo = brand !== "Tout" ? getMarqueLogo(brand) : null;
                const active = selectedBrand === brand;
                return (
                  <button
                    className="filter-option"
                    key={brand}
                    onClick={() => setSelectedBrand(brand)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: "8px",
                      textAlign: "left", borderRadius: "8px",
                      border: active ? "1.5px solid #3665f3" : "1px solid #ececec",
                      background: active ? "#eef4ff" : "#fff",
                      color: active ? "#3665f3" : "#333",
                      padding: "8px 12px", marginBottom: "6px",
                      cursor: "pointer", fontWeight: active ? 700 : 400, fontSize: "14px",
                    }}
                  >
                    {logo && (
                      <img src={logo} alt={brand} style={{ width: "28px", height: "18px", objectFit: "contain" }} />
                    )}
                    <span>{brand}</span>
                  </button>
                );
              })}
            </aside>

            {/* Lis pwodwi */}
            <div className="products-panel">
              <div className="products-toolbar" style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: "16px", background: "#fff", border: "1px solid #e5e5e5",
                borderRadius: "12px", padding: "12px 16px",
              }}>
                <p style={{ margin: 0, color: "#555", fontSize: "14px" }}>
                  <strong style={{ color: "#111" }}>{filtered.length}</strong> rezilta
                  {selectedCategory !== "Tout" && ` nan ${selectedCategory}`}
                  {selectedBrand !== "Tout" && ` · ${selectedBrand}`}
                </p>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "8px 12px", fontSize: "14px", background: "#fff" }}
                >
                  <option value="relevance">Pi enpòtan</option>
                  <option value="priceAsc">Pri: ba → wo</option>
                  <option value="priceDesc">Pri: wo → ba</option>
                </select>
              </div>

              <div className="products-list-wrap">
              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px", background: "#fff",
                  borderRadius: "14px", border: "1px solid #eee" }}>
                  <p style={{ fontSize: "36px" }}>🔍</p>
                  <p style={{ color: "#666" }}>Pa gen pwodwi ki koresponn.</p>
                </div>
              ) : (
                <div className="products-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
                  {filtered.map((p) => {
                    const imgs = getImages(p);
                    const thumb = imgs[0] ?? getFallbackImage(p);
                    const logo = getMarqueLogo(p.marque);
                    const color = getCatColor(p.category);
                    const lowStock = (p.stock ?? 99) <= 2 && (p.stock ?? 99) > 0;

                    return (
                      <div
                        className="product-card"
                        key={p.id}
                        onClick={() => setSelectedProduct(p)}
                        style={{
                          background: "#fff", borderRadius: "14px",
                          border: "1px solid #e5e5e5", padding: "12px",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                          cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s",
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)";
                          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 20px rgba(0,0,0,0.1)";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLDivElement).style.transform = "";
                          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)";
                        }}
                      >
                        <div style={{
                          background: "#fafafa", borderRadius: "12px", padding: "8px",
                          marginBottom: "10px", height: "170px",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          overflow: "hidden", position: "relative",
                        }}>
                          <img
                            src={thumb}
                            alt={`${p.marque} ${p.modele}`}
                            style={{ width: "100%", height: "100%", objectFit: "contain" }}
                            onError={(e) => { (e.target as HTMLImageElement).src = getFallbackImage(p); }}
                          />
                          {imgs.length > 1 && (
                            <span style={{
                              position: "absolute", bottom: "6px", right: "6px",
                              background: "rgba(0,0,0,0.55)", color: "#fff",
                              borderRadius: "8px", padding: "2px 7px", fontSize: "11px",
                            }}>
                              📷 {imgs.length}
                            </span>
                          )}
                          {lowStock && (
                            <span style={{
                              position: "absolute", top: "6px", left: "6px",
                              background: "#ff6b35", color: "#fff",
                              borderRadius: "6px", padding: "2px 8px", fontSize: "10px", fontWeight: 700,
                            }}>
                              Dènye {p.stock}!
                            </span>
                          )}
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                          <span style={{
                            background: `${color}18`, color,
                            padding: "2px 8px", borderRadius: "999px",
                            fontSize: "11px", fontWeight: 700,
                          }}>
                            {p.category}
                          </span>
                          {logo && (
                            <img src={logo} alt={p.marque} style={{ height: "16px", objectFit: "contain" }} />
                          )}
                        </div>

                        {/* ✅ ID pwodwi */}
                        <p style={{ margin: "0 0 8px", color: "#7a7a7a", fontSize: "14px", fontWeight: 800 }}>
                          🔖 ID: <span style={{ fontWeight: 900, color: "#333" }}>{p.id || "SAN-ID"}</span>
                        </p>

                        <h3 style={{ margin: "0 0 5px", fontSize: "14px", color: "#111820", lineHeight: 1.3 }}>
                          {p.marque} {p.modele}
                        </h3>

                        {p.description && (
                          <p style={{ margin: "0 0 8px", color: "#888", fontSize: "12px", lineHeight: 1.4 }}>
                            {p.description.length > 65 ? p.description.slice(0, 65) + "…" : p.description}
                          </p>
                        )}

                        <p style={{ margin: "0 0 4px", color: "#111820", fontWeight: 800, fontSize: "20px" }}>
                          ${Number(p.prixVente).toLocaleString()}
                        </p>

                        <p style={{ margin: "0 0 12px", color: "#188038", fontSize: "12px" }}>
                          ✅ Livrezon rapid disponib
                        </p>

                        <button
                          className="details-btn"
                          onClick={(e) => { e.stopPropagation(); setSelectedProduct(p); }}
                          style={{
                            width: "100%", borderRadius: "999px",
                            border: "none", background: "#1a1a2e",
                            color: "#fff", padding: "10px",
                            fontWeight: 600, cursor: "pointer", fontSize: "14px",
                          }}
                        >
                          Wè detay
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer style={{
        background: "#1a1a2e", color: "#aaa", textAlign: "center",
        padding: "32px 24px", marginTop: "60px", fontSize: "14px",
      }}>
        <p style={{ color: "#fff", fontWeight: 700, fontSize: "18px", margin: "0 0 8px" }}>
          Million<span style={{ color: "#e63946" }}>Store</span>
        </p>
        <p style={{ margin: 0 }}>© {new Date().getFullYear()} MillionStore. Tout dwa rezève.</p>
      </footer>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .site-nav {
          display: grid;
          gap: 10px 16px;
          align-items: center;
          padding: 16px 24px;
          grid-template-areas:
            "brand icons"
            "search search";
          grid-template-columns: minmax(0, 1fr) auto;
        }

        @media (max-width: 768px) {
          .site-nav {
            padding: 12px 12px;
            gap: 12px 12px;
          }
        }

        .site-nav-brand {
          grid-area: brand;
          min-width: 0;
        }

        .site-nav-search {
          grid-area: search;
          min-width: 0;
          width: 100%;
        }

        .site-nav-icons {
          grid-area: icons;
          justify-self: end;
        }

        .site-nav-search-input {
          box-sizing: border-box;
          width: 100%;
          padding: 10px 14px;
          border-radius: 8px;
          border: 1px solid #ddd;
          font-size: 16px;
          outline: none;
          -webkit-appearance: none;
          appearance: none;
        }

        .site-nav-search-input::-webkit-search-decoration,
        .site-nav-search-input::-webkit-search-cancel-button {
          -webkit-appearance: none;
          appearance: none;
        }

        @media (min-width: 769px) {
          .site-nav {
            grid-template-areas: "brand search icons";
            grid-template-columns: auto minmax(0, 1fr) auto;
            gap: 0 20px;
          }

          .site-nav-search {
            max-width: 720px;
            width: 100%;
            justify-self: stretch;
          }

          .site-nav-search-input {
            border-radius: 25px;
            padding: 10px 20px;
            font-size: 14px;
          }
        }

        .catalog-layout {
          grid-template-columns: clamp(240px, 24vw, 300px) minmax(0, 1fr);
          gap: clamp(14px, 2vw, 24px);
        }

        .filters-panel {
          box-shadow: 0 10px 30px rgba(17, 24, 39, 0.08);
          backdrop-filter: blur(8px);
        }

        .filter-option {
          transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
        }

        .filter-option:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 18px rgba(26, 35, 53, 0.08);
        }

        .products-toolbar {
          box-shadow: 0 8px 24px rgba(17, 24, 39, 0.06);
        }

        .products-grid {
          grid-template-columns: repeat(auto-fit, minmax(clamp(180px, 22vw, 230px), 1fr)) !important;
          gap: clamp(10px, 1.5vw, 18px) !important;
        }

        .product-card {
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .product-card:hover {
          transform: translateY(-4px);
          border-color: #d4defa !important;
          box-shadow: 0 14px 28px rgba(17, 24, 39, 0.12) !important;
        }

        .details-btn {
          transition: transform 0.2s ease, opacity 0.2s ease;
        }

        .details-btn:hover {
          transform: translateY(-1px);
          opacity: 0.94;
        }

        @media (max-width: 1024px) {
          .catalog-layout {
            grid-template-columns: clamp(220px, 30vw, 270px) minmax(0, 1fr);
          }
        }

        @media (max-width: 768px) {
          .catalog-layout {
            grid-template-columns: minmax(120px, 45%) minmax(0, 55%) !important;
            gap: 10px !important;
            grid-template-areas:
              "filters toolbar"
              "list list";
            align-items: stretch !important;
          }

          .filters-panel {
            grid-area: filters;
            position: static !important;
            top: auto !important;
            padding: 12px !important;
          }

          .products-panel {
            display: contents;
          }

          .products-toolbar {
            grid-area: toolbar;
            margin-bottom: 0 !important;
            padding: 10px 12px !important;
            flex-direction: column;
            align-items: flex-start !important;
            gap: 8px;
          }

          .products-toolbar select {
            width: 100%;
            min-height: 38px;
          }

          .products-toolbar p {
            font-size: 13px !important;
            line-height: 1.3;
          }

          .products-list-wrap {
            grid-area: list;
            margin-top: 10px;
          }

          .products-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 10px !important;
          }
        }

        @media (max-width: 560px) {
          .filters-panel {
            padding: 10px !important;
          }

          .filters-panel h3 {
            font-size: 15px !important;
          }

          .filter-option {
            padding: 7px 10px !important;
            font-size: 13px !important;
          }

          .products-toolbar {
            padding: 8px 10px !important;
          }

          .products-grid {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 380px) {
          .catalog-layout {
            grid-template-columns: minmax(112px, 46%) minmax(0, 54%) !important;
            gap: 8px !important;
          }

          .products-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}