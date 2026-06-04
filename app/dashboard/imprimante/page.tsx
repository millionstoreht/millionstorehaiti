"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import { collection, onSnapshot, query, where, orderBy } from "firebase/firestore";
import { ChevronLeft, Printer, Download, Search, CheckCircle, XCircle, User, Phone, Package, DollarSign, Calendar } from "lucide-react";

interface UserSession {
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  permissions: Record<string, boolean>;
}

interface Facture {
  id: string;
  billNo: string;
  date: string;
  localId: string;
  vendeur: string;
  modePeman: string;
  mone: string;
  taux: number;
  total: number;
  totalHTG: number;
  annule: boolean;
  kliyan: { nom: string; phone: string; adres: string; device: string };
  produits: { id: string; mak: string; description: string; prix: number; qty: number }[];
}

interface StoreInfo {
  nomBiznis: string;
  adres: string;
  email: string;
  telefon: string;
  messageNB: string;
  messageFinal: string;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(raw: string) {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  } catch { return ""; }
}

function fmtTime(raw: string) {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  } catch { return ""; }
}

// ── JENERE HTML REÇU ──
function buildReceiptHTML(f: Facture, store: StoreInfo): string {
  const produits  = f.produits ?? [];
  const total$    = produits.reduce((s, p) => s + (p.prix ?? 0), 0);
  const totalHTG  = total$ * (f.taux ?? 135);
  const cols      = 32;
  const sep       = "-".repeat(cols);
  const stars     = "*".repeat(cols);

  const items = produits.map(p => `
    <tr>
      <td style="padding:3px 0;font-size:12px;">${p.qty ?? 1}x ${p.mak}</td>
      <td style="padding:3px 0;font-size:12px;text-align:right;font-weight:700;">$${(p.prix ?? 0).toFixed(2)}</td>
    </tr>
    ${p.description ? `<tr><td colspan="2" style="font-size:10px;color:#666;padding:0 0 2px 12px;">${p.description}</td></tr>` : ""}
    ${p.id ? `<tr><td colspan="2" style="font-size:10px;color:#888;padding:0 0 4px 12px;">ID: ${p.id}</td></tr>` : ""}
  `).join("");

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; width: 300px; padding: 16px; background: #fff; color: #000; font-size: 12px; }
  .center { text-align: center; }
  .right  { text-align: right; }
  .bold   { font-weight: bold; }
  .sep    { border-top: 1px dashed #000; margin: 6px 0; }
  .logo-placeholder { width: 80px; height: 80px; border-radius: 50%; background: #1a1a2e; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 10px; font-weight: bold; margin: 0 auto 8px; }
  table { width: 100%; border-collapse: collapse; }
  .nb { font-size: 9px; color: #333; margin-top: 4px; }
  .barcode-area { background: #f5f5f5; border: 1px solid #ddd; padding: 6px; text-align: center; border-radius: 4px; margin: 6px 0; }
  .barcode-lines { display: flex; justify-content: center; gap: 1px; height: 40px; align-items: stretch; margin-bottom: 4px; }
  .barcode-line { width: 2px; background: #000; }
  .barcode-line.thin { width: 1px; }
</style>
</head>
<body>
  <div class="center" style="margin-bottom:8px;">
    <div class="logo-placeholder">LOGO</div>
    <div class="bold" style="font-size:14px;">${store.nomBiznis}</div>
    <div style="font-size:10px;">${store.adres}</div>
    <div style="font-size:10px;">${store.email}</div>
    <div style="font-size:10px;">${store.telefon}</div>
  </div>

  <div class="sep"></div>

  <div class="center bold" style="font-size:13px;">Bill No : ${f.billNo}</div>
  <div style="display:flex;justify-content:space-between;margin-top:4px;">
    <span>${fmtDate(f.date)}</span>
    <span>${fmtTime(f.date)}</span>
  </div>
  <div class="right" style="font-size:11px;">Vendeur: ${f.vendeur ?? ""}</div>

  <div class="sep"></div>

  <div>Customer: <b>${f.kliyan?.nom ?? ""}</b></div>
  ${f.kliyan?.phone ? `<div>Phone: ${f.kliyan.phone}</div>` : ""}
  ${f.kliyan?.adres ? `<div>${f.kliyan.adres}</div>` : ""}
  ${f.kliyan?.device ? `<div>Device: ${f.kliyan.device}</div>` : ""}

  <div style="text-align:center;margin:6px 0;font-size:10px;">${stars}</div>

  <table>
    <tr>
      <th style="text-align:left;font-size:11px;border-bottom:1px solid #000;padding-bottom:3px;">Item</th>
      <th style="text-align:right;font-size:11px;border-bottom:1px solid #000;padding-bottom:3px;">Prix</th>
    </tr>
    ${items}
  </table>

  <div class="sep"></div>

  <div class="right">${f.modePeman} = $${fmt(total$)}</div>
  <div class="right bold" style="font-size:13px;">Grand Total = $${fmt(total$)}</div>
  <div class="right" style="font-size:11px;color:#555;">≈ HTG ${fmt(totalHTG)}</div>

  <div class="sep"></div>

  ${store.messageNB ? `<div class="nb">${store.messageNB.split("\\n").join("<br/>")}</div>` : ""}

  <div class="sep"></div>

  <div class="center bold" style="margin:6px 0;">${store.messageFinal}</div>

  <div class="barcode-area">
    <div class="barcode-lines">
      ${Array.from({length: 30}, (_, i) => `<div class="barcode-line ${i%3===0||i%7===0?'':'thin'}"></div>`).join("")}
    </div>
    <div style="font-size:9px;">MILL-${f.billNo}</div>
  </div>

  <div class="sep"></div>
</body>
</html>`;
}

export default function PrinterPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [factures, setFactures] = useState<Facture[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [printing, setPrinting] = useState<string | null>(null);
  const [store] = useState<StoreInfo>({
    nomBiznis:    "MILLIONSTORE",
    adres:        "Delmas 83, Port-au-Prince, Haiti",
    email:        "Millionstore509@gmail.com",
    telefon:      "+509 38083793 / 35484094",
    messageNB:    "N.B. : Garantie de 15 jours, remplacement uniquement.\nAucun remboursement sauf si pas d'autre ordinateur disponible.",
    messageFinal: "MERCI POUR VOTRE ACHAT",
  });

  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const session = JSON.parse(raw) as UserSession;
      if (!session.isAdmin && !session.permissions?.imprimanteVoir) {
        router.push("/dashboard"); return;
      }
      setUser(session);
      loadFactures(session);
    } catch { router.push("/login"); }
  }, []);

  function loadFactures(session: UserSession) {
    setLoading(true);
    const localId = session.localId === "all" ? "" : session.localId;
    const q = collection(db, "fiches_factures");
    onSnapshot(q, snap => {
      let list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Facture));
      if (localId) list = list.filter(f => f.localId === localId);
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setFactures(list);
      setLoading(false);
    }, () => setLoading(false));
  }

  function printFacture(f: Facture) {
    setPrinting(f.id);
    const html = buildReceiptHTML(f, store);
    const win  = window.open("", "_blank", "width=400,height=700");
    if (!win) { alert("Aktive popups pou ka enprime!"); setPrinting(null); return; }
    win.document.write(html);
    win.document.close();
    win.onload = () => { win.print(); setPrinting(null); };
  }

  function downloadFacture(f: Facture) {
    setPrinting(f.id);
    const html  = buildReceiptHTML(f, store);
    const blob  = new Blob([html], { type: "text/html" });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement("a");
    a.href      = url;
    a.download  = `Bill-${f.billNo}-${f.kliyan?.nom ?? "client"}.html`;
    a.click();
    URL.revokeObjectURL(url);
    setTimeout(() => setPrinting(null), 800);
  }

  const filtered = factures.filter(f => {
    const q = search.toLowerCase();
    return !q || f.billNo.includes(q) || (f.kliyan?.nom ?? "").toLowerCase().includes(q) || (f.vendeur ?? "").toLowerCase().includes(q);
  });

  const nonAnnule = filtered.filter(f => !f.annule);
  const annule    = filtered.filter(f => f.annule);
  const total$    = nonAnnule.reduce((s, f) => s + (f.produits ?? []).reduce((ps, p) => ps + (p.prix ?? 0), 0), 0);

  if (loading) return (
    <main style={{ minHeight: "100vh", background: "#1A1D2E", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: "48px", height: "48px", border: "4px solid #333", borderTop: "4px solid #fff", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ color: "#888" }}>Chajman...</p>
      </div>
    </main>
  );

  return (
    <main style={{ minHeight: "100vh", background: "#1A1D2E", fontFamily: "'Segoe UI', sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{ background: "#0d0f1a", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 10px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button onClick={() => router.push("/dashboard")} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "8px", borderRadius: "8px", cursor: "pointer" }}>
            <ChevronLeft size={18} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ background: "#9C27B020", padding: "8px", borderRadius: "10px" }}>
              <Printer size={22} color="#9C27B0" />
            </div>
            <div>
              <p style={{ margin: 0, color: "#fff", fontWeight: 700, fontSize: "16px" }}>Imprimante</p>
              <p style={{ margin: 0, color: "#aaa", fontSize: "11px" }}>{factures.length} factures • ${fmt(total$)} total</p>
            </div>
          </div>
        </div>
        {/* Info */}
        <div style={{ background: "rgba(0,200,83,0.1)", border: "1px solid rgba(0,200,83,0.3)", borderRadius: "10px", padding: "8px 14px", display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#00C853", animation: "pulse 2s infinite" }} />
          <span style={{ color: "#00C853", fontSize: "12px", fontWeight: 700 }}>PDF / Print</span>
          <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
        </div>
      </div>

      {/* ── STATS ── */}
      <div style={{ display: "flex", gap: "12px", padding: "16px 20px 0", maxWidth: "900px", margin: "0 auto" }}>
        {[
          { label: "Factures Aktif", value: nonAnnule.length, color: "#00C853" },
          { label: "Anile", value: annule.length, color: "#f44336" },
          { label: "Grand Total", value: `$${fmt(total$)}`, color: "#FFD700" },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, background: "#0d0f1a", borderRadius: "14px", padding: "14px", border: `1px solid ${s.color}20` }}>
            <p style={{ margin: 0, color: "#aaa", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</p>
            <p style={{ margin: "4px 0 0", color: s.color, fontWeight: 900, fontSize: "20px" }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── SEARCH ── */}
      <div style={{ maxWidth: "900px", margin: "16px auto 0", padding: "0 20px" }}>
        <div style={{ position: "relative" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#555" }} />
          <input placeholder="Chèche #Bill, kliyan, vendeur..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", padding: "11px 14px 11px 38px", borderRadius: "12px", border: "1px solid #333", fontSize: "14px", outline: "none", background: "#0d0f1a", color: "#fff", boxSizing: "border-box" }}
          />
        </div>
      </div>

      {/* ── LISTE ── */}
      <div style={{ maxWidth: "900px", margin: "16px auto", padding: "0 20px 32px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {filtered.length === 0 ? (
          <div style={{ background: "#0d0f1a", borderRadius: "16px", padding: "48px", textAlign: "center" }}>
            <Printer size={48} color="#333" style={{ marginBottom: "12px" }} />
            <p style={{ color: "#555" }}>Pa gen factures toujou</p>
          </div>
        ) : filtered.map(f => {
          const produits = f.produits ?? [];
          const total$   = produits.reduce((s, p) => s + (p.prix ?? 0), 0);
          const totalHTG = total$ * (f.taux ?? 135);
          const isPrinting = printing === f.id;

          return (
            <div key={f.id} style={{ background: "#0d0f1a", borderRadius: "16px", padding: "16px 18px", border: f.annule ? "1px solid #f4433630" : "1px solid #ffffff10", opacity: f.annule ? 0.7 : 1 }}>

              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ background: f.annule ? "#f4433620" : "#00C85320", padding: "8px", borderRadius: "10px" }}>
                    {f.annule ? <XCircle size={18} color="#f44336" /> : <CheckCircle size={18} color="#00C853" />}
                  </div>
                  <div>
                    <span style={{ color: "#FFD700", fontWeight: 900, fontSize: "16px" }}>Bill #{f.billNo}</span>
                    {f.annule && <span style={{ marginLeft: "8px", background: "#f4433620", color: "#f44336", padding: "2px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 700 }}>ANILE</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: 0, color: "#aaa", fontSize: "11px" }}>{fmtDate(f.date)}</p>
                  <p style={{ margin: 0, color: "#777", fontSize: "10px" }}>{fmtTime(f.date)}</p>
                </div>
              </div>

              {/* Info */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <User size={13} color="#aaa" />
                  <span style={{ color: "#ddd", fontSize: "13px", fontWeight: 600 }}>{f.kliyan?.nom}</span>
                </div>
                {f.kliyan?.phone && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <Phone size={13} color="#aaa" />
                    <span style={{ color: "#aaa", fontSize: "12px" }}>{f.kliyan.phone}</span>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <DollarSign size={13} color="#00C853" />
                  <span style={{ color: "#00C853", fontWeight: 900, fontSize: "14px" }}>${fmt(total$)}</span>
                  <span style={{ color: "#555", fontSize: "11px" }}>≈ HTG {fmt(totalHTG)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Package size={13} color="#aaa" />
                  <span style={{ color: "#aaa", fontSize: "12px" }}>{produits.length} pwodwi • {f.modePeman}</span>
                </div>
              </div>

              {/* Pwodwi */}
              {produits.length > 0 && (
                <div style={{ background: "#151720", borderRadius: "10px", padding: "10px 12px", marginBottom: "12px" }}>
                  {produits.map((p, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: i < produits.length - 1 ? "1px solid #222" : "none" }}>
                      <div>
                        <span style={{ color: "#ddd", fontSize: "12px", fontWeight: 600 }}>{p.qty ?? 1}x {p.mak}</span>
                        {p.description && <span style={{ color: "#666", fontSize: "11px" }}> — {p.description}</span>}
                      </div>
                      <span style={{ color: "#00C853", fontWeight: 700, fontSize: "12px" }}>${(p.prix ?? 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Bouton yo */}
              <div style={{ display: "flex", gap: "10px" }}>
                <button onClick={() => printFacture(f)} disabled={isPrinting}
                  style={{ flex: 1, padding: "11px", background: isPrinting ? "#333" : "#9C27B0", color: "#fff", border: "none", borderRadius: "10px", cursor: isPrinting ? "not-allowed" : "pointer", fontWeight: 700, fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", opacity: isPrinting ? 0.7 : 1 }}>
                  {isPrinting ? <><div style={{ width: "14px", height: "14px", border: "2px solid #fff", borderTop: "2px solid transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} /> Ap prepare...</> : <><Printer size={15} /> Enprime</>}
                </button>
                <button onClick={() => downloadFacture(f)} disabled={isPrinting}
                  style={{ flex: 1, padding: "11px", background: isPrinting ? "#333" : "#1a1a2e", color: "#FFD700", border: "1px solid #FFD70040", borderRadius: "10px", cursor: isPrinting ? "not-allowed" : "pointer", fontWeight: 700, fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", opacity: isPrinting ? 0.7 : 1 }}>
                  <Download size={15} /> Telechaje HTML
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}