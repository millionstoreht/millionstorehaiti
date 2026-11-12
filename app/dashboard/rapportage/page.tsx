"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { db, auth } from "../../../lib/firebase";
import {
  collection, deleteDoc, doc, getDocs, limit, orderBy, query, serverTimestamp, setDoc,
  Timestamp, updateDoc, where, type QueryConstraint,
} from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";

// =============================================================================
// RAPPORTAGE — onglet CONTRÔLE (ventes, dealers, vendeurs, relevé)
//              onglet RAPPORT (rapport quotidien, modifiable pendant 2 h)
// Même logique que rapportage_screen.dart + FirestoreService (Flutter).
//  • Collections : rapportage_ventes, rapportage_rapports
//  • Permissions : controlVoir, rapportageVoir, rapportageModifye, rapportageSiprime
// =============================================================================

// ─── 1. TYPES & CONSTANTES ───────────────────────────────────────────────────
interface UserSession {
  uid?: string; username: string; displayName: string; isAdmin: boolean;
  localId: string; permissions: Record<string, boolean>;
}
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Periode = "jour" | "7j" | "30j" | "tout";
type Toast = (msg: string, color: string) => void;
interface Agg { nom: string; pieces: number; total: number; factures: Set<string>; }

const BG = "#0B0E1A", CARD = "#141A2E", ACCENT = "#7C5CFF", GOLD = "#FFC857";
const RED = "#FF5470", GREEN = "#2EE59D", BLUE = "#4D8DFF";
const SANS_DEALER = "(Sans dealer)", SANS_VENDEUR = "(Sans vendeur)", INCONNU = "(Inconnu)";
const MAX_LEN = 5000;
const FENETRE = 2 * 3600 * 1000;

// ─── 2. UTILITAIRES ──────────────────────────────────────────────────────────
const two = (n: number) => String(n).padStart(2, "0");
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const money = (v: number) => `$${v.toFixed(2)}`;
const parseD = (raw: unknown): Date | null => {
  if (!raw) return null;
  const d = new Date(String(raw));
  return isNaN(d.getTime()) ? null : d;
};
const fmtDate = (d: Date) => `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtHeure = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}`;
/** ISO local sans « Z » — même format que Dart (les dates des ventes sont stockées ainsi). */
const localIso = (d: Date) =>
  `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

function currentAuthUser(): Promise<User | null> {
  return new Promise(resolve => {
    if (auth.currentUser) { resolve(auth.currentUser); return; }
    const off = onAuthStateChanged(auth, u => { off(); resolve(u); });
  });
}

function rapErr(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (code === "permission-denied") return "Action refusée : délai de 2 h dépassé ou permission manquante.";
  if (e instanceof Error && e.message === "TIMEOUT") return "Réseau trop lent. Vérifiez avant de réessayer.";
  return `Erreur : ${e instanceof Error ? e.message : String(e)}`;
}

function fromOf(p: Periode): Date | null {
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  if (p === "jour") return today;
  if (p === "7j") return new Date(today.getTime() - 6 * 86400000);
  if (p === "30j") return new Date(today.getTime() - 29 * 86400000);
  return null;
}

// ─── 3. PETITS COMPOSANTS ────────────────────────────────────────────────────
const inputSt: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)",
  color: "#fff", fontSize: 14, outline: "none", fontFamily: "inherit",
};

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ background: `${color}26`, color, fontSize: 10, fontWeight: 700, padding: "2px 7px",
      borderRadius: 8, display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
      whiteSpace: "nowrap" }}>{text}</span>
  );
}

function Chip({ label, sel, onClick }: { label: string; sel: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{ padding: "8px 14px", borderRadius: 20, cursor: "pointer", whiteSpace: "nowrap", fontWeight: 700,
        fontSize: 12, fontFamily: "inherit", background: sel ? ACCENT : CARD, color: sel ? "#fff" : "rgba(255,255,255,0.6)",
        border: `1px solid ${sel ? ACCENT : "rgba(255,255,255,0.1)"}` }}>{label}</button>
  );
}

function Select({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  const opts = Array.from(new Set(options)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const val = value === "" || opts.includes(value) ? value : "";
  return (
    <label style={{ display: "block", flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>{label}</div>
      <select value={val} onChange={e => onChange(e.target.value)} style={{ ...inputSt, background: CARD }}>
        <option value="">Tous</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.38)" }}>
      <div style={{ fontSize: 52, opacity: 0.4 }}>{icon}</div>{text}
    </div>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <div style={{ background: `${GOLD}1f`, border: `1px solid ${GOLD}66`, color: GOLD, borderRadius: 12,
      padding: "8px 12px", fontSize: 11, marginBottom: 12 }}>☁️ {text}</div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 300,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: CARD, color: "#fff", borderRadius: 20, padding: 20, width: "100%", maxWidth: 480,
        maxHeight: "92vh", overflowY: "auto", border: "1px solid rgba(255,255,255,0.08)" }}>{children}</div>
    </div>
  );
}

function Btn({ children, onClick, color = ACCENT, disabled, outline, full }: {
  children: React.ReactNode; onClick?: () => void; color?: string; disabled?: boolean; outline?: boolean; full?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: "11px 16px", borderRadius: 12, fontWeight: 700, fontSize: 13, fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, width: full ? "100%" : undefined,
        border: outline ? `1px solid ${color}88` : "none", background: outline ? "transparent" : color,
        color: outline ? color : "#fff" }}>{children}</button>
  );
}

// ─── 4. ONGLET CONTRÔLE ──────────────────────────────────────────────────────
function ControlTab({ isAdmin, uid }: { isAdmin: boolean; uid: string }) {
  const [ventes, setVentes] = useState<Raw[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [periode, setPeriode] = useState<Periode>("7j");
  const [dealer, setDealer] = useState("");
  const [vendeur, setVendeur] = useState("");
  const [cashier, setCashier] = useState("");
  const [q, setQ] = useState("");
  const [vue, setVue] = useState(0); // 0 ventes, 1 dealers, 2 vendeurs, 3 relevé
  const [releveDealer, setReleveDealer] = useState(true);
  const [releveCle, setReleveCle] = useState("");
  const [limite, setLimite] = useState(50);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setFailed(false);
    setLoading(true);
    try {
      await currentAuthUser();
      const col = collection(db, "rapportage_ventes");
      const from = fromOf(periode);
      const fromIso = from ? localIso(from) : null;
      let list: Raw[];
      if (isAdmin) {
        const cons: QueryConstraint[] = [];
        if (fromIso) cons.push(where("date", ">=", fromIso));
        cons.push(orderBy("date", "desc"), limit(1000));
        const snap = await withTimeout(getDocs(query(col, ...cons)), 25000);
        list = snap.docs.map(d => ({ ...d.data(), docId: d.id }) as Raw);
      } else {
        const snap = await withTimeout(getDocs(query(col, where("cashierUid", "==", uid))), 25000);
        list = snap.docs.map(d => ({ ...d.data(), docId: d.id }) as Raw);
        if (fromIso) list = list.filter(m => str(m.date) >= fromIso);
      }
      list = list.map(m => { const { createdAt, ...rest } = m; void createdAt; return rest; });
      list.sort((a, b) => str(b.date).localeCompare(str(a.date)));
      if (id !== reqId.current) return;
      setVentes(list.slice(0, 1000));
    } catch {
      if (id === reqId.current) setFailed(true);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [periode, isAdmin, uid]);

  useEffect(() => { load(); }, [load]);

  // ── Helpers de données ──
  const nomDealer = (v: Raw) => str(v.nomDealer) || SANS_DEALER;
  const nomVendeur = (v: Raw) => str(v.vendeur) || SANS_VENDEUR;
  const nomCashier = (v: Raw) => str(v.cashier) || INCONNU;
  const tot = (v: Raw) => num(v.total);
  const qty = (v: Raw) => (v.qty == null ? 1 : Math.trunc(num(v.qty)));
  const annule = (v: Raw) => v.annule === true;

  const needle = q.trim().toLowerCase();
  const filtered = ventes.filter(v => {
    if (dealer && nomDealer(v).toLowerCase() !== dealer.toLowerCase()) return false;
    if (vendeur && nomVendeur(v).toLowerCase() !== vendeur.toLowerCase()) return false;
    if (cashier && nomCashier(v).toLowerCase() !== cashier.toLowerCase()) return false;
    if (needle) {
      const blob = `${v.marque} ${v.modele} ${v.description} ${v.productId} ${v.factureId} ${v.billNo} ${v.clientNom} ${v.serialImei}`.toLowerCase();
      if (!blob.includes(needle)) return false;
    }
    return true;
  });
  const actives = filtered.filter(v => !annule(v));
  const nbAnnule = filtered.length - actives.length;

  const aggregate = (list: Raw[], nomOf: (v: Raw) => string): Agg[] => {
    const m = new Map<string, Agg>();
    for (const v of list) {
      const nom = nomOf(v);
      const k = nom.toLowerCase();
      if (!m.has(k)) m.set(k, { nom, pieces: 0, total: 0, factures: new Set() });
      const a = m.get(k)!;
      a.pieces += qty(v); a.total += tot(v); a.factures.add(str(v.factureId));
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  };
  const dealers = aggregate(actives, nomDealer);
  const vendeurs = aggregate(actives, nomVendeur);

  const resetLim = () => setLimite(50);

  // ── Résumé ──
  const pieces = actives.reduce((s, v) => s + qty(v), 0);
  const total = actives.reduce((s, v) => s + tot(v), 0);
  const nbFactures = new Set(actives.map(v => str(v.factureId))).size;
  const stat = (v: string, l: string, icon: string) => (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{ fontSize: 15 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 16 }}>{v}</div>
      <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 10 }}>{l}</div>
    </div>
  );

  // ── Graphique par jour ──
  const parJour = new Map<string, number>();
  for (const v of actives) {
    const d = parseD(v.date);
    const k = str(v.dateKey) || (d ? `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` : "");
    if (!k) continue;
    parJour.set(k, (parJour.get(k) ?? 0) + tot(v));
  }
  const keys = Array.from(parJour.keys()).sort();
  const shown = keys.length > 14 ? keys.slice(keys.length - 14) : keys;
  const maxV = shown.reduce((m, k) => Math.max(m, parJour.get(k) ?? 0), 0);

  // ── Vues ──
  const voirPlus = (n: number) => limite >= n ? null : (
    <div style={{ marginBottom: 8 }}>
      <Btn outline full onClick={() => setLimite(l => l + 50)}>Voir plus ({n - limite} restants)</Btn>
    </div>
  );

  const carteVente = (v: Raw, i: number) => {
    const an = annule(v);
    const d = parseD(v.date);
    const heure = str(v.heure);
    return (
      <div key={`${str(v.docId)}${i}`} style={{ background: CARD, borderRadius: 14, padding: 12, marginBottom: 10,
        border: `1px solid ${(an ? RED : ACCENT)}2e` }}>
        <div style={{ display: "flex", gap: 8 }}>
          <b style={{ flex: 1, fontSize: 14, color: an ? "rgba(255,255,255,0.38)" : "#fff" }}>
            {`${str(v.marque)} ${str(v.modele)}`.trim()}
          </b>
          <b style={{ fontSize: 14, color: an ? "rgba(255,255,255,0.3)" : GREEN,
            textDecoration: an ? "line-through" : "none" }}>{money(tot(v))}</b>
        </div>
        {str(v.description) && (
          <div style={{ color: "rgba(255,255,255,0.54)", fontSize: 11, marginTop: 3 }}>{str(v.description)}</div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {an && <Pill text="ANNULÉE" color={RED} />}
          <Pill text={`ID : ${str(v.productId)}`} color="#FFA726" />
          <Pill text={`Facture : ${str(v.factureId)}`} color={BLUE} />
          <Pill text={`N° ${str(v.billNo)}`} color="#9aa0b4" />
          <Pill text={`Qté : ${qty(v)} × ${money(num(v.prixVente))}`} color="#9aa0b4" />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          <Pill text={`Dealer : ${nomDealer(v)}`} color="#BCAAA4" />
          <Pill text={`Vendeur : ${nomVendeur(v)}`} color={GOLD} />
          <Pill text={`Caissier : ${nomCashier(v)}`} color={ACCENT} />
        </div>
        <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 11, marginTop: 6 }}>
          🕐 {d ? `${fmtDate(d)}  ${heure || fmtHeure(d)}` : ""}
          {str(v.clientNom) && `   👤 ${str(v.clientNom)}`}
        </div>
      </div>
    );
  };

  const vueVentes = () => {
    if (filtered.length === 0) return <Empty icon="🧾" text="Aucune vente" />;
    return <>{filtered.slice(0, limite).map(carteVente)}{voirPlus(filtered.length)}</>;
  };

  const vueAgg = (aggs: Agg[], isDealer: boolean) => {
    if (aggs.length === 0) return <Empty icon="📊" text="Aucune donnée" />;
    const maxT = aggs[0].total <= 0 ? 1 : aggs[0].total;
    return <>{aggs.map(a => {
      const ratio = Math.min(Math.max(a.total / maxT, 0), 1);
      return (
        <div key={a.nom} onClick={() => { setVue(3); setReleveDealer(isDealer); setReleveCle(a.nom.toLowerCase()); resetLim(); }}
          style={{ background: CARD, borderRadius: 16, padding: 14, marginBottom: 10, cursor: "pointer",
            border: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: "50%", background: `${ACCENT}33`, color: ACCENT,
              fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {a.nom ? a.nom[0].toUpperCase() : "?"}
            </span>
            <b style={{ flex: 1, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.nom}</b>
            <b style={{ color: GREEN, fontSize: 15 }}>{money(a.total)}</b>
            <span style={{ color: "rgba(255,255,255,0.25)" }}>›</span>
          </div>
          <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 6, margin: "10px 0 8px", overflow: "hidden" }}>
            <div style={{ width: `${ratio * 100}%`, height: "100%", background: ACCENT }} />
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Pill text={`${a.pieces} produit${a.pieces > 1 ? "s" : ""}`} color={BLUE} />
            <Pill text={`${a.factures.size} facture${a.factures.size > 1 ? "s" : ""}`} color={GOLD} />
            <span style={{ flex: 1 }} />
            <span style={{ color: "rgba(255,255,255,0.38)", fontSize: 10 }}>Voir le relevé</span>
          </div>
        </div>
      );
    })}</>;
  };

  const vueReleve = () => {
    const aggs = releveDealer ? dealers : vendeurs;
    const noms = aggs.map(a => a.nom);
    const selNom = noms.find(n => n.toLowerCase() === releveCle) ?? "";
    const header = (
      <>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <Chip label="Par dealer" sel={releveDealer} onClick={() => { setReleveDealer(true); setReleveCle(""); resetLim(); }} />
          <Chip label="Par vendeur" sel={!releveDealer} onClick={() => { setReleveDealer(false); setReleveCle(""); resetLim(); }} />
        </div>
        <div style={{ display: "flex", marginBottom: 12 }}>
          <Select label={releveDealer ? "Choisir un dealer" : "Choisir un vendeur"} value={selNom} options={noms}
            onChange={v => { setReleveCle(v.toLowerCase()); resetLim(); }} />
        </div>
      </>
    );
    if (!selNom) return <>{header}<Empty icon="🧾" text="Choisissez un nom pour voir son relevé." /></>;

    const lignes = filtered
      .filter(v => (releveDealer ? nomDealer(v) : nomVendeur(v)).toLowerCase() === releveCle)
      .sort((a, b) => str(a.date).localeCompare(str(b.date)));
    let run = 0;
    const rows = lignes.map(v => { if (!annule(v)) run += tot(v); return { v, run }; });
    const recent = rows.reverse();

    return (
      <>
        {header}
        <div style={{ background: `${GREEN}14`, border: `1px solid ${GREEN}4d`, borderRadius: 14, padding: 14,
          marginBottom: 12, display: "flex", alignItems: "center" }}>
          <span style={{ flex: 1, color: "rgba(255,255,255,0.7)", fontSize: 12 }}>Total des ventes de {selNom}</span>
          <b style={{ color: GREEN, fontSize: 18 }}>{money(run)}</b>
        </div>
        {recent.length === 0 && <Empty icon="🧾" text="Aucune ligne" />}
        {recent.slice(0, limite).map(({ v, run: r }, i) => {
          const an = annule(v);
          const d = parseD(v.date);
          return (
            <div key={`${str(v.docId)}${i}`} style={{ background: CARD, borderRadius: 12, padding: 12, marginBottom: 8,
              border: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 13, color: an ? "rgba(255,255,255,0.38)" : "#fff" }}>
                  {`${str(v.marque)} ${str(v.modele)}`.trim()}
                </b>
                <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, marginTop: 2 }}>
                  {d ? `${fmtDate(d)} ${fmtHeure(d)}` : ""}  •  ID {str(v.productId)}  •  Fact. {str(v.factureId)}
                </div>
                {an && <div style={{ color: RED, fontSize: 10, fontWeight: 700, marginTop: 3 }}>ANNULÉE (non comptée)</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                <b style={{ fontSize: 13, color: an ? "rgba(255,255,255,0.3)" : GREEN }}>{an ? "—" : `+${money(tot(v))}`}</b>
                <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10 }}>Total : {money(r)}</div>
              </div>
            </div>
          );
        })}
        {voirPlus(recent.length)}
      </>
    );
  };

  return (
    <div>
      {failed && <Banner text="Connexion impossible. Les données affichées sont les dernières chargées. Cliquez sur « Actualiser » pour réessayer." />}

      {/* Filtres */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 10 }}>
        <Chip label="Aujourd'hui" sel={periode === "jour"} onClick={() => { setPeriode("jour"); resetLim(); }} />
        <Chip label="7 jours" sel={periode === "7j"} onClick={() => { setPeriode("7j"); resetLim(); }} />
        <Chip label="30 jours" sel={periode === "30j"} onClick={() => { setPeriode("30j"); resetLim(); }} />
        <Chip label="Tout" sel={periode === "tout"} onClick={() => { setPeriode("tout"); resetLim(); }} />
        <Chip label="🔄 Actualiser" sel={false} onClick={load} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Select label="Dealer" value={dealer} options={ventes.map(nomDealer)} onChange={v => { setDealer(v); resetLim(); }} />
        <Select label="Vendeur" value={vendeur} options={ventes.map(nomVendeur)} onChange={v => { setVendeur(v); resetLim(); }} />
      </div>
      {isAdmin && (
        <div style={{ display: "flex", marginTop: 8 }}>
          <Select label="Caissier" value={cashier} options={ventes.map(nomCashier)} onChange={v => { setCashier(v); resetLim(); }} />
        </div>
      )}
      <input value={q} onChange={e => { setQ(e.target.value); resetLim(); }}
        placeholder="Rechercher (modèle, ID, facture, client, N° de série)..."
        style={{ ...inputSt, background: CARD, marginTop: 8 }} />

      {loading ? (
        <p style={{ textAlign: "center", color: "rgba(255,255,255,0.4)", padding: 50 }}>Chargement...</p>
      ) : (
        <>
          {/* Résumé */}
          <div style={{ background: `linear-gradient(135deg, ${ACCENT}, #3D7BFF)`, borderRadius: 22, padding: 18,
            margin: "14px 0", boxShadow: `0 8px 18px ${ACCENT}4d` }}>
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 10, letterSpacing: 1.2 }}>
              ARGENT ENTRÉ (VENTES)
            </div>
            <div style={{ textAlign: "center", fontWeight: 700, fontSize: 32, marginTop: 4 }}>{money(total)}</div>
            <div style={{ display: "flex", marginTop: 14 }}>
              {stat(String(pieces), "Produits vendus", "📦")}
              <div style={{ width: 1, background: "rgba(255,255,255,0.25)" }} />
              {stat(String(nbFactures), "Factures", "🧾")}
              <div style={{ width: 1, background: "rgba(255,255,255,0.25)" }} />
              {stat(String(nbAnnule), "Annulées", "❌")}
            </div>
          </div>

          {/* Graphique */}
          {shown.length > 0 && (
            <div style={{ background: CARD, borderRadius: 18, padding: 14, marginBottom: 14,
              border: "1px solid rgba(255,255,255,0.06)" }}>
              <b style={{ fontSize: 13 }}>📊 Ventes par jour</b>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120, marginTop: 12 }}>
                {shown.map(k => {
                  const val = parJour.get(k) ?? 0;
                  const h = maxV <= 0 ? 2 : Math.min(Math.max((val / maxV) * 80, 2), 80);
                  const p = k.split("-");
                  const lab = p.length === 3 ? `${p[2]}/${p[1]}` : k;
                  return (
                    <div key={k} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                      justifyContent: "flex-end", minWidth: 0 }}>
                      <span style={{ color: "rgba(255,255,255,0.54)", fontSize: 9 }}>{val.toFixed(0)}</span>
                      <div style={{ width: "100%", height: h, marginTop: 2, borderRadius: "5px 5px 0 0",
                        background: `linear-gradient(0deg, ${ACCENT}, ${BLUE})` }} />
                      <span style={{ color: "rgba(255,255,255,0.38)", fontSize: 9, marginTop: 4 }}>{lab}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Vues */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 12 }}>
            <Chip label={`Ventes (${filtered.length})`} sel={vue === 0} onClick={() => { setVue(0); resetLim(); }} />
            <Chip label={`Dealers (${dealers.length})`} sel={vue === 1} onClick={() => { setVue(1); resetLim(); }} />
            <Chip label={`Vendeurs (${vendeurs.length})`} sel={vue === 2} onClick={() => { setVue(2); resetLim(); }} />
            <Chip label="Relevé" sel={vue === 3} onClick={() => { setVue(3); resetLim(); }} />
          </div>
          {vue === 1 ? vueAgg(dealers, true) : vue === 2 ? vueAgg(vendeurs, false)
            : vue === 3 ? vueReleve() : vueVentes()}
        </>
      )}
    </div>
  );
}

// ─── 5. ONGLET RAPPORT ───────────────────────────────────────────────────────
function RapportTab({ user, uid, onToast }: { user: UserSession; uid: string; onToast: Toast }) {
  const isAdmin = user.isAdmin;
  const perms = user.permissions ?? {};
  const actor = str(user.username) || str(user.displayName);
  const draftKey = `rapportage_draft_${actor.toLowerCase()}`;

  const [texte, setTexte] = useState("");
  const [rapports, setRapports] = useState<Raw[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Raw | null>(null);
  const [del, setDel] = useState<Raw | null>(null);
  const [, setTick] = useState(0);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rafraîchit le décompte des 2 h
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Brouillon restauré depuis ce navigateur
  useEffect(() => {
    try {
      const d = localStorage.getItem(draftKey) ?? "";
      if (d) setTexte(d);
    } catch { /* ignore */ }
  }, [draftKey]);

  const onChangeTexte = (v: string) => {
    setTexte(v);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      try {
        if (v.trim()) localStorage.setItem(draftKey, v); else localStorage.removeItem(draftKey);
      } catch { /* ignore */ }
    }, 600);
  };
  const clearDraft = () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
  };

  const load = useCallback(async (): Promise<Raw[] | null> => {
    setFailed(false);
    try {
      await currentAuthUser();
      const col = collection(db, "rapportage_rapports");
      const snap = isAdmin
        ? await withTimeout(getDocs(query(col, orderBy("createdAt", "desc"), limit(300))), 20000)
        : await withTimeout(getDocs(query(col, where("authorUid", "==", uid))), 20000);
      const list = snap.docs.map(d => {
        const m: Raw = { ...d.data(), id: d.id };
        for (const k of ["createdAt", "updatedAt"]) {
          if (m[k] instanceof Timestamp) m[k] = m[k].toDate().toISOString();
        }
        return m;
      }).sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)));
      setRapports(list);
      setLoading(false);
      return list;
    } catch {
      setFailed(true);
      setLoading(false);
      return null;
    }
  }, [isAdmin, uid]);

  useEffect(() => { load(); }, [load]);

  // ── Règle des 2 h (contrôlée aussi par les règles Firestore) ──
  const tempsRestant = (r: Raw): number | null => {
    const c = parseD(r.createdAt);
    if (!c) return null;
    const left = FENETRE - (Date.now() - c.getTime());
    return left < 0 ? null : left;
  };
  const estMien = (r: Raw) => str(r.authorUid) === uid;
  const canEdit = (r: Raw) => isAdmin || (perms.rapportageModifye === true && estMien(r) && tempsRestant(r) !== null);
  const canDelete = (r: Raw) => isAdmin || (perms.rapportageSiprime === true && estMien(r) && tempsRestant(r) !== null);
  const setBusy = (id: string, on: boolean) =>
    setBusyIds(p => (on ? [...p, id] : p.filter(x => x !== id)));

  // ── Envoyer un rapport ──
  const submit = async () => {
    if (saving) return;
    const t = texte.trim();
    if (!t) { onToast("Écrivez votre rapport avant de l'envoyer.", GOLD); return; }
    if (t.length > MAX_LEN) { onToast(`Rapport trop long (${MAX_LEN} caractères maximum).`, RED); return; }
    setSaving(true);
    let ok = false;
    let message = "";
    try {
      const now = new Date();
      const ref = doc(collection(db, "rapportage_rapports"));
      await withTimeout(setDoc(ref, {
        authorUid: uid, authorName: actor, texte: t,
        dateKey: `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`,
        createdAt: serverTimestamp(),
      }), 20000);
      ok = true;
      onToast("✅ Rapport enregistré !", GREEN);
    } catch (e) {
      message = rapErr(e);
      // Un délai dépassé n'est pas forcément un échec : on vérifie avant de dire « échec ».
      const list = await load();
      const now = Date.now();
      if (list && list.some(r => estMien(r) && str(r.texte) === t &&
        parseD(r.createdAt) && now - parseD(r.createdAt)!.getTime() < 10 * 60000)) {
        ok = true;
        onToast("ℹ️ Ce rapport était déjà enregistré.", BLUE);
      }
    }
    if (ok) {
      setTexte(""); clearDraft(); await load();
    } else {
      onToast(`❌ ${message || "Échec"} Votre texte est conservé, réessayez.`, RED);
    }
    setSaving(false);
  };

  const doDelete = async (r: Raw) => {
    const id = str(r.id);
    if (busyIds.includes(id)) return;
    if (!canDelete(r)) { onToast("⏱️ Le délai de 2 h est dépassé.", RED); setDel(null); return; }
    setBusy(id, true);
    try {
      await withTimeout(deleteDoc(doc(db, "rapportage_rapports", id)), 20000);
      setRapports(p => p.filter(x => str(x.id) !== id));
      onToast("✅ Rapport supprimé.", GREEN);
    } catch (e) {
      onToast(`❌ ${rapErr(e)}`, RED);
      await load();
    }
    setBusy(id, false);
    setDel(null);
  };

  // ── Affichage ──
  const today = new Date();
  const nbJour = rapports.filter(r => {
    const d = parseD(r.createdAt);
    return d && d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  }).length;

  const needle = q.trim().toLowerCase();
  const liste = rapports.filter(r => {
    if (!needle) return true;
    const d = parseD(r.createdAt);
    return `${r.texte} ${r.authorName} ${d ? fmtDate(d) : ""}`.toLowerCase().includes(needle);
  });

  const blocs: React.ReactNode[] = [];
  let dernierJour: string | null = null;
  for (const r of liste) {
    const d = parseD(r.createdAt);
    const jour = d ? fmtDate(d) : "En cours";
    if (jour !== dernierJour) {
      blocs.push(
        <div key={`j-${jour}`} style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 8px" }}>
          <span style={{ color: GOLD, fontWeight: 700, fontSize: 12 }}>📅 {jour}</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.12)" }} />
        </div>
      );
      dernierJour = jour;
    }
    const id = str(r.id);
    const busy = busyIds.includes(id);
    const nom = str(r.authorName);
    const left = tempsRestant(r);
    const ce = canEdit(r), cd = canDelete(r);
    blocs.push(
      <div key={id} style={{ background: CARD, borderRadius: 16, padding: 14, marginBottom: 10,
        border: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 32, height: 32, borderRadius: "50%", background: `${ACCENT}33`, color: ACCENT,
            fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {nom ? nom[0].toUpperCase() : "?"}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ fontSize: 13 }}>{nom || "Inconnu"}</b>
            <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 11 }}>
              {d ? `${fmtDate(d)}  ${fmtHeure(d)}` : "Enregistrement..."}
            </div>
          </div>
          {busy && <span style={{ color: ACCENT, fontSize: 11 }}>...</span>}
        </div>
        <p style={{ margin: "10px 0", color: "rgba(255,255,255,0.7)", fontSize: 13, lineHeight: 1.45,
          whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{str(r.texte)}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {str(r.updatedAt) && <Pill text="✏️ Modifié" color={BLUE} />}
          {!isAdmin && left !== null && <Pill text={`⏱ Reste ${Math.floor(left / 60000)} min`} color={GOLD} />}
          {!isAdmin && left === null && estMien(r) && <Pill text="🔒 Verrouillé (2 h)" color="#9e9e9e" />}
        </div>
        {(ce || cd) && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {ce && <Btn outline full disabled={busy} onClick={() => {
              if (!canEdit(r)) { onToast("⏱️ Le délai de 2 h est dépassé.", RED); return; }
              setEdit(r);
            }}>✏️ Modifier</Btn>}
            {cd && <Btn outline full color={RED} disabled={busy} onClick={() => setDel(r)}>🗑️ Supprimer</Btn>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {failed && <Banner text="Connexion impossible. Cliquez sur « Actualiser » pour réessayer." />}

      <div style={{ background: `linear-gradient(135deg, ${ACCENT}, #3D7BFF)`, borderRadius: 22, padding: 18,
        marginBottom: 14, display: "flex", boxShadow: `0 8px 18px ${ACCENT}4d` }}>
        {[[String(rapports.length), isAdmin ? "Rapports (tous)" : "Mes rapports", "📋"], [String(nbJour), "Aujourd'hui", "📅"]]
          .map(([v, l, ic], i) => (
            <div key={l} style={{ flex: 1, textAlign: "center", borderLeft: i ? "1px solid rgba(255,255,255,0.25)" : "none" }}>
              <div>{ic}</div><div style={{ fontWeight: 700, fontSize: 18 }}>{v}</div>
              <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 10 }}>{l}</div>
            </div>
          ))}
      </div>

      {/* Rédaction */}
      <div style={{ background: CARD, borderRadius: 18, padding: 14, marginBottom: 14,
        border: "1px solid rgba(255,255,255,0.06)" }}>
        <b style={{ fontSize: 14 }}>📝 Rapport du jour</b>
        <textarea value={texte} disabled={saving} maxLength={MAX_LEN} rows={5} onChange={e => onChangeTexte(e.target.value)}
          placeholder="Que s'est-il passé aujourd'hui ?"
          style={{ ...inputSt, marginTop: 10, resize: "vertical" }} />
        <div style={{ textAlign: "right", color: "rgba(255,255,255,0.25)", fontSize: 11 }}>{texte.length} / {MAX_LEN}</div>
        <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 11, margin: "4px 0 12px" }}>
          Modification et suppression possibles pendant 2 h seulement (sauf administrateur).
        </div>
        <Btn full onClick={submit} disabled={saving}>{saving ? "Envoi..." : "📤 Envoyer le rapport"}</Btn>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder={isAdmin ? "Rechercher (texte, employé, date)..." : "Rechercher dans mes rapports..."}
          style={{ ...inputSt, background: CARD, flex: 1 }} />
        <Chip label="🔄 Actualiser" sel={false} onClick={load} />
      </div>

      {loading ? (
        <p style={{ textAlign: "center", color: "rgba(255,255,255,0.4)", padding: 40 }}>Chargement...</p>
      ) : liste.length === 0 ? (
        <Empty icon="📋" text={q ? "Aucun résultat" : "Aucun rapport pour le moment"} />
      ) : blocs}

      {edit && (
        <EditModal rapport={edit} onClose={() => setEdit(null)} onToast={onToast}
          onSaved={async () => { setEdit(null); await load(); }}
          guard={() => canEdit(edit)} />
      )}
      {del && (
        <Overlay>
          <h2 style={{ margin: "0 0 10px", fontSize: 17, color: RED }}>🗑️ Supprimer le rapport ?</h2>
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 13.5 }}>Cette action est définitive.</p>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <Btn outline color="#aaa" full onClick={() => setDel(null)}>Non</Btn>
            <Btn color={RED} full onClick={() => doDelete(del)}>Oui, supprimer</Btn>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function EditModal({ rapport, onClose, onSaved, onToast, guard }: {
  rapport: Raw; onClose: () => void; onSaved: () => void; onToast: Toast; guard: () => boolean;
}) {
  const [texte, setTexte] = useState(str(rapport.texte));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const t = texte.trim();
    if (!t) { setErr("Le rapport est vide."); return; }
    if (t === str(rapport.texte)) { onClose(); return; }
    if (!guard()) { onToast("⏱️ Le délai de 2 h est dépassé.", RED); onClose(); return; }
    setBusy(true); setErr(null);
    try {
      await withTimeout(updateDoc(doc(db, "rapportage_rapports", str(rapport.id)), {
        texte: t, updatedAt: serverTimestamp(),
      }), 20000);
      onToast("✅ Rapport modifié !", GREEN);
      onSaved();
    } catch (e) {
      setBusy(false);
      setErr(rapErr(e));
    }
  };

  return (
    <Overlay>
      <h2 style={{ margin: "0 0 12px", fontSize: 17 }}>✏️ Modifier le rapport</h2>
      <textarea value={texte} disabled={busy} maxLength={MAX_LEN} rows={8} autoFocus
        onChange={e => { setTexte(e.target.value); setErr(null); }} style={{ ...inputSt, resize: "vertical" }} />
      {err && <p style={{ color: RED, fontSize: 12 }}>{err}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <Btn outline color="#aaa" full onClick={onClose} disabled={busy}>Annuler</Btn>
        <Btn full onClick={submit} disabled={busy}>{busy ? "..." : "Enregistrer"}</Btn>
      </div>
    </Overlay>
  );
}

// ─── 6. PAGE ─────────────────────────────────────────────────────────────────
export default function RapportagePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [uidReady, setUidReady] = useState(false);
  const [tabSel, setTabSel] = useState<"control" | "rapport" | null>(null);
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);

  const showToast: Toast = (msg, color) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try { setUser(JSON.parse(raw) as UserSession); } catch { router.push("/login"); }
  }, [router]);

  useEffect(() => {
    if (!user) return;
    currentAuthUser().then(u => { setUid(u?.uid ?? null); setUidReady(true); });
  }, [user]);

  if (!user) return null;

  const perms = user.permissions ?? {};
  const canControl = user.isAdmin || perms.controlVoir === true;
  const canRapport = user.isAdmin || perms.rapportageVoir === true;
  const tab = tabSel ?? (canControl ? "control" : "rapport");

  const header = (
    <div style={{ borderBottom: "1px solid #1e1e2e", padding: "14px 20px", display: "flex",
      alignItems: "center", gap: 12, position: "sticky", top: 0, background: CARD, zIndex: 50 }}>
      <button onClick={() => router.push("/dashboard")} title="Retour"
        style={{ background: "#1A1D2E", border: "none", color: "#aaa", width: 36, height: 36,
          borderRadius: 10, cursor: "pointer", fontSize: 16 }}>←</button>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Rapportage</h1>
    </div>
  );

  const page = (children: React.ReactNode) => (
    <main style={{ minHeight: "100vh", background: BG, fontFamily: "'Segoe UI',sans-serif", color: "#fff" }}>
      {header}
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "16px 14px 80px" }}>{children}</div>
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: toast.color, color: toast.color === GREEN ? "#000" : "#fff", padding: "10px 20px",
          borderRadius: 12, fontWeight: 700, zIndex: 999, fontSize: 13, maxWidth: "90vw", textAlign: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}>{toast.msg}</div>
      )}
    </main>
  );

  if (!canControl && !canRapport) {
    return page(
      <p style={{ textAlign: "center", color: "rgba(255,255,255,0.55)", padding: "60px 0" }}>
        🔒 Accès refusé : vous n&apos;avez pas la permission.
      </p>
    );
  }
  if (!uidReady) {
    return page(<p style={{ textAlign: "center", color: "rgba(255,255,255,0.4)", padding: 60 }}>Chargement...</p>);
  }
  if (!uid) {
    return page(
      <p style={{ textAlign: "center", color: "rgba(255,255,255,0.55)", padding: "60px 0" }}>
        Session inactive. Reconnectez-vous pour utiliser le rapportage.
      </p>
    );
  }

  return page(
    <>
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.1)", marginBottom: 16 }}>
        {canControl && (
          <button onClick={() => setTabSel("control")}
            style={{ flex: 1, padding: "12px 0", background: "none", border: "none", cursor: "pointer",
              fontWeight: 700, fontSize: 13, letterSpacing: 1, fontFamily: "inherit",
              color: tab === "control" ? ACCENT : "rgba(255,255,255,0.38)",
              borderBottom: `3px solid ${tab === "control" ? ACCENT : "transparent"}` }}>CONTRÔLE</button>
        )}
        {canRapport && (
          <button onClick={() => setTabSel("rapport")}
            style={{ flex: 1, padding: "12px 0", background: "none", border: "none", cursor: "pointer",
              fontWeight: 700, fontSize: 13, letterSpacing: 1, fontFamily: "inherit",
              color: tab === "rapport" ? ACCENT : "rgba(255,255,255,0.38)",
              borderBottom: `3px solid ${tab === "rapport" ? ACCENT : "transparent"}` }}>RAPPORT</button>
        )}
      </div>
      {canControl && (
        <div style={{ display: tab === "control" ? "block" : "none" }}>
          <ControlTab isAdmin={user.isAdmin} uid={uid} />
        </div>
      )}
      {canRapport && (
        <div style={{ display: tab === "rapport" ? "block" : "none" }}>
          <RapportTab user={user} uid={uid} onToast={showToast} />
        </div>
      )}
    </>
  );
}