"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import { collection, doc, getDocs, onSnapshot } from "firebase/firestore";

// =============================================================================
// CALENDRIER — tout ce qui se passe dans MillionStore, jour par jour
//  • Jours avec activité : colorés + points par catégorie + nombre
//  • Jours sans activité : restent simples
//  • Clic sur un jour : historique complet (Factures, Vendeurs, Fournisseurs,
//    MILLIONSTORE) avec résumé, recherche et filtres
// =============================================================================

// ─── 1. TYPES & CONSTANTES ───────────────────────────────────────────────────
interface UserSession {
  username: string; displayName: string; isAdmin: boolean;
  localId: string; permissions: Record<string, boolean>;
}
type Cat = "facture" | "commande" | "vendeur" | "fournisseur" | "ms";
type Raw = Record<string, unknown>;

interface CalEvent {
  ts: Date; cat: Cat; type: string; title: string; subtitle: string;
  amount?: number; amountText?: string; cancelled?: boolean; lines: string[];
  color?: string; // couleur imposée (ex. statut d'une commande)
}

const NAVY = "#1A1D2E", VIOLET = "#4A3AA7", ORANGE = "#FF6B35";
const CATS: Cat[] = ["facture", "commande", "vendeur", "fournisseur", "ms"];
const CAT_COLOR: Record<Cat, string> = {
  facture: "#2979FF", commande: "#6C63FF", vendeur: "#00C853", fournisseur: "#FF9100", ms: "#FFB300",
};
const CAT_LABEL: Record<Cat, string> = {
  facture: "Factures", commande: "Commandes", vendeur: "Vendeurs", fournisseur: "Fournisseurs", ms: "MILLIONSTORE",
};
const CAT_ICON: Record<Cat, string> = { facture: "🧾", commande: "🛍️", vendeur: "🏷️", fournisseur: "🚚", ms: "🏪" };

const TYPE_LABEL: Record<string, string> = {
  facture_creee: "Facture créée", facture_annulee: "Facture annulée",
  commande_recue: "Commande reçue", commande_statut: "Statut de commande",
  facture_poubelle: "Mise à la poubelle", vente: "Vente ajoutée",
  annulation: "Vente annulée", restauration: "Vente restaurée",
  suppression_definitive: "Vente enlevée", retrait: "Retrait", depot: "Dépôt",
};
const TYPE_ICON: Record<string, string> = {
  facture_creee: "🧾", facture_annulee: "❌", commande_recue: "🛍️", commande_statut: "🔄", facture_poubelle: "🗑️", vente: "🛒",
  annulation: "🚫", restauration: "♻️", suppression_definitive: "🗑", retrait: "⬆️", depot: "⬇️",
};

const STATUT_COLOR: Record<string, string> = {
  "En attente": "#F57C00", "Confirmé": "#2E7D32", "En livraison": "#1565C0",
  "Livré": "#6A1B9A", "Annulé": "#C0392B",
};
const STATUT_ICON: Record<string, string> = {
  "En attente": "⏳", "Confirmé": "✅", "En livraison": "🚚", "Livré": "📦", "Annulé": "❌",
};

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet",
  "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const WD_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const WD_LONG = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

// ─── 2. UTILITAIRES ──────────────────────────────────────────────────────────
const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const toDate = (raw: unknown): Date | null => {
  if (!raw) return null;
  const d = new Date(String(raw));
  return isNaN(d.getTime()) ? null : d;
};
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const group = (s: string) => s.replace(/(\d)(?=(\d{3})+$)/g, "$1,");
const money = (v: number) => {
  const [ip, fp] = Math.abs(v).toFixed(2).split(".");
  return `${v < 0 ? "-" : ""}$${group(ip)}.${fp}`;
};
const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function evColor(e: CalEvent): string {
  if (e.color) return e.color;
  if (e.type === "facture_creee") return e.cancelled ? "#9e9e9e" : "#2979FF";
  if (e.type === "facture_annulee") return "#EF5350";
  if (e.type === "facture_poubelle") return "#FF9100";
  const a = e.amount ?? 0;
  return a > 0 ? "#00C853" : a < 0 ? "#EF5350" : "#9e9e9e";
}

function histEvent(cat: Cat, owner: string, h: Raw): CalEvent | null {
  const ts = toDate(h.date);
  if (!ts) return null;
  const type = str(h.type);
  const amount = "delta" in h ? num(h.delta) : num(h.montant);
  const prod = `${str(h.marque)} ${str(h.modele)}`.trim();
  const lines: string[] = [];
  if (prod) lines.push(`📱 ${prod}`);
  const id = str(h.venteId ?? h.productId);
  if (id) lines.push(`🏷 ID : ${id}`);
  if (str(h.billNo)) lines.push(`🧾 Facture #${str(h.billNo)}`);
  if (str(h.produitDescription)) lines.push(`📝 ${str(h.produitDescription)}`);
  if (str(h.clientNom)) lines.push(`👤 Client : ${str(h.clientNom)}`);
  if (str(h.vendeurNom)) lines.push(`🧑‍💼 Vendeur : ${str(h.vendeurNom)}`);
  if (str(h.cashier)) lines.push(`💳 Caissier : ${str(h.cashier)}`);
  if (h.benefis != null) lines.push(`📈 Bénéfice : ${money(num(h.benefis))}`);
  if (h.commission != null) lines.push(`💰 Commission : ${money(num(h.commission))}`);
  if (str(h.parAdmin)) lines.push(`🔐 Par : ${str(h.parAdmin)}`);
  if (h.soldeApres != null) lines.push(`🏦 Solde après : ${money(num(h.soldeApres))}`);
  return {
    ts, cat, type, title: `${TYPE_LABEL[type] ?? "Mouvement"} — ${owner}`,
    subtitle: prod || (str(h.parAdmin) ? `Par ${str(h.parAdmin)}` : ""),
    amount, lines,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// ─── 3. PAGE ─────────────────────────────────────────────────────────────────
export default function CalendrierPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [locals, setLocals] = useState<{ id: string; name: string }[]>([]);
  const [lid, setLid] = useState("");
  const now = new Date();
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [filter, setFilter] = useState<"all" | Cat>("all");
  const [loading, setLoading] = useState(true);
  const [openDay, setOpenDay] = useState<Date | null>(null);

  const [factures, setFactures] = useState<Raw[]>([]);
  const [vendeurs, setVendeurs] = useState<Raw[]>([]);
  const [comptes, setComptes] = useState<Raw[]>([]);
  const [commandes, setCommandes] = useState<Raw[]>([]);
  const [ms, setMs] = useState<Raw>({});
  const [archive, setArchive] = useState<{ nom: string; entry: Raw }[]>([]);
  const [archiveLoaded, setArchiveLoaded] = useState(false);

  // Catégories visibles selon les permissions (MILLIONSTORE = admin seulement)
  const allowed: Cat[] = useMemo(() => {
    if (!user) return [];
    const p = user.permissions ?? {};
    return CATS.filter(c =>
      user.isAdmin ? true
      : c === "facture" ? p.factureVoir === true || p.factureVoirIstwa === true
      : c === "commande" ? p.commandeVoir === true
      : c === "vendeur" ? p.vendeurVoir === true
      : c === "fournisseur" ? p.fournisseurVoir === true
      : false);
  }, [user]);
  const allowedKey = allowed.join(",");

  // ─── AUTH ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const s = JSON.parse(raw) as UserSession;
      setUser(s);
      if (s.localId && s.localId !== "all") setLid(s.localId);
      withTimeout(getDocs(collection(db, "locals")), 10000).then(snap => {
        const list = snap.docs.filter(d => d.id !== "all")
          .map(d => ({ id: d.id, name: (d.data().name as string) ?? d.id }));
        setLocals(list);
        if (!s.localId || s.localId === "all") {
          if (list.length > 0) setLid(list[0].id); else setLoading(false);
        }
      }).catch(() => setLoading(false));
    } catch { router.push("/login"); }
  }, [router]);

  // ─── DONNÉES EN DIRECT ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !lid) return;
    setLoading(true); setArchive([]); setArchiveLoaded(false);
    const base = ["locals", lid] as const;
    const withId = (d: { id: string; data: () => Raw }) => ({ ...d.data(), id: d.id });

    const noop = () => {};
    const u1 = allowed.includes("facture")
      ? onSnapshot(collection(db, ...base, "factures"), s => {
          setFactures(s.docs.map(withId)); setLoading(false);
        }, () => setLoading(false))
      : (setLoading(false), noop);
    const u2 = allowed.includes("vendeur")
      ? onSnapshot(collection(db, ...base, "vendeurs"), s => setVendeurs(s.docs.map(withId)), () => {})
      : noop;
    const u3 = allowed.includes("fournisseur")
      ? onSnapshot(collection(db, ...base, "fournisseurs_comptes"), s => setComptes(s.docs.map(withId)), () => {})
      : noop;
    const u5 = allowed.includes("commande")
      ? onSnapshot(collection(db, "achats"), s => setCommandes(s.docs.map(withId)), () => {})
      : noop;
    const u4 = allowed.includes("ms")
      ? onSnapshot(doc(db, ...base, "millionstore", "compte"), s => setMs((s.data() as Raw) ?? {}), () => {})
      : noop;
    return () => { u1(); u2(); u3(); u4(); u5(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, lid, allowedKey]);

  // Anciens mouvements des vendeurs (+90 jours) — seulement si on regarde un vieux mois
  useEffect(() => {
    if (!user || !lid || archiveLoaded || vendeurs.length === 0 || !allowed.includes("vendeur")) return;
    const limit = Date.now() - 80 * 86400000;
    if (month.getTime() >= limit) return;
    setArchiveLoaded(true);
    (async () => {
      try {
        const out: { nom: string; entry: Raw }[] = [];
        for (const v of vendeurs) {
          const snap = await withTimeout(
            getDocs(collection(db, "locals", lid, "vendeurs", str(v.id), "archive")), 10000);
          snap.forEach(d => {
            const data = d.data();
            if (data.kind !== "historique") return;
            for (const e of (data.items ?? []) as Raw[]) out.push({ nom: str(v.nom), entry: e });
          });
        }
        setArchive(out);
      } catch { setArchiveLoaded(false); }
    })();
  }, [user, lid, month, vendeurs, archiveLoaded]);

  // ─── CONSTRUCTION DES ÉVÉNEMENTS ───────────────────────────────────────
  const byDay = useMemo(() => {
    const ev: CalEvent[] = [];

    for (const f of factures) {
      const ts = toDate(f.date);
      if (!ts) continue;
      const tot = num(f.totalUSD);
      const taux = num(f.taux);
      const amountText = str(f.devise) === "HTG"
        ? `HTG ${group(String(Math.round(tot * (taux > 0 ? taux : 1))))}` : money(tot);
      const annule = f.annule === true;
      const bill = str(f.billNo);
      const lines: string[] = [
        `👤 Client : ${str(f.clientNom) || "Anonyme"}`,
        ...(str(f.vendeur) ? [`🧑‍💼 Vendeur : ${str(f.vendeur)}`] : []),
        ...(str(f.cashier) ? [`💳 Caissier : ${str(f.cashier)}`] : []),
        ...(str(f.modePeman) ? [`💵 Paiement : ${str(f.modePeman)}`] : []),
        ...((f.lignes as Raw[] | undefined) ?? []).map(l =>
          `📱 ${`${str(l.marque)} ${str(l.modele)}`.trim()} × ${l.qty ?? 1}`),
      ];
      ev.push({ ts, cat: "facture", type: "facture_creee", title: `Facture #${bill}`,
        subtitle: str(f.clientNom), amount: tot, amountText, cancelled: annule, lines });
      if (annule) {
        ev.push({ ts: toDate(f.annuleDate) ?? ts, cat: "facture", type: "facture_annulee",
          title: `Facture #${bill} annulée`, subtitle: str(f.clientNom), amount: tot, amountText, lines });
      }
      const pb = toDate(f.poubelDate);
      if (f.dansPoubel === true && pb) {
        ev.push({ ts: pb, cat: "facture", type: "facture_poubelle",
          title: `Facture #${bill} → poubelle`, subtitle: str(f.clientNom), amount: tot, amountText, lines });
      }
    }

    for (const v of vendeurs) {
      for (const h of (v.historique as Raw[] | undefined) ?? []) {
        const e = histEvent("vendeur", str(v.nom), h); if (e) ev.push(e);
      }
    }
    for (const a of archive) { const e = histEvent("vendeur", a.nom, a.entry); if (e) ev.push(e); }

    for (const c of comptes) {
      const nom = str(c.nom) || str(c.id);
      for (const h of (c.historique as Raw[] | undefined) ?? []) {
        const e = histEvent("fournisseur", nom, h); if (e) ev.push(e);
      }
    }
    for (const c of commandes) {
      const ts = toDate(c.createdAt);
      if (!ts) continue;
      const client = str(c.clientNom) || "Client inconnu";
      const statut = str(c.statut) || "En attente";
      const total = num(c.total);
      const lines: string[] = [
        `👤 Client : ${client}`,
        ...(str(c.clientTelephone) ? [`📞 ${str(c.clientTelephone)}`] : []),
        ...(str(c.clientEmail) ? [`✉️ ${str(c.clientEmail)}`] : []),
        ...((c.produits as Raw[] | undefined) ?? []).map(p =>
          `📱 ${`${str(p.marque)} ${str(p.modele)}`.trim()}${str(p.id) ? ` (ID: ${str(p.id)})` : ""} — ${money(num(p.prix))}`),
        `💳 Via ${str(c.methode)}${str(c.banque) ? ` (${str(c.banque)})` : ""}`,
        `${STATUT_ICON[statut] ?? "❓"} Statut actuel : ${statut}`,
      ];
      ev.push({ ts, cat: "commande", type: "commande_recue", title: `Commande — ${client}`,
        subtitle: statut, amount: total, amountText: money(total), cancelled: statut === "Annulé",
        color: STATUT_COLOR[statut], lines });
      for (const h of (c.statutHistory as Raw[] | undefined) ?? []) {
        const hts = toDate(h.date);
        const st = str(h.statut);
        if (!hts || !st) continue;
        ev.push({ ts: hts, cat: "commande", type: "commande_statut", title: `${client} → ${st}`,
          subtitle: `Commande ${money(total)}`, color: STATUT_COLOR[st],
          lines: [`${STATUT_ICON[st] ?? "❓"} Nouveau statut : ${st}`] });
      }
    }

    for (const h of (ms.historique as Raw[] | undefined) ?? []) {
      const e = histEvent("ms", "MILLIONSTORE", h); if (e) ev.push(e);
    }

    const map = new Map<string, CalEvent[]>();
    for (const e of ev.filter(x => allowed.includes(x.cat))) {
      const k = keyOf(e.ts);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    map.forEach(l => l.sort((a, b) => b.ts.getTime() - a.ts.getTime()));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factures, vendeurs, comptes, commandes, ms, archive, allowedKey]);

  const eventsOf = (k: string) => {
    const l = byDay.get(k) ?? [];
    return filter === "all" ? l : l.filter(e => e.cat === filter);
  };

  // ─── RÉSUMÉ DU MOIS ────────────────────────────────────────────────────
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const monthEvents = useMemo(() => {
    const out: CalEvent[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(...eventsOf(keyOf(new Date(month.getFullYear(), month.getMonth(), d))));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDay, month, filter]);
  const activeDays = new Set(monthEvents.map(e => keyOf(e.ts))).size;
  const nbFact = monthEvents.filter(e => e.type === "facture_creee").length;
  const ventes = monthEvents.filter(e => e.type === "facture_creee" && !e.cancelled)
    .reduce((s, e) => s + (e.amount ?? 0), 0);

  const goMonth = (delta: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  const goToday = () => setMonth(new Date(now.getFullYear(), now.getMonth(), 1));

  if (!user) return null;

  const lead = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7; // lundi = 0
  const todayKey = keyOf(new Date());

  return (
    <main style={{ minHeight: "100vh", background: "#0F1117", fontFamily: "'Segoe UI',sans-serif", color: "#fff" }}>

      {/* HEADER PAGE */}
      <div style={{ borderBottom: "1px solid #1e1e2e", padding: "14px 20px", display: "flex",
        alignItems: "center", gap: 12, position: "sticky", top: 0, background: "#0F1117", zIndex: 50 }}>
        <button onClick={() => router.push("/dashboard")} title="Retour"
          style={{ background: "#1A1D2E", border: "none", color: "#aaa", width: 36, height: 36,
            borderRadius: 10, cursor: "pointer", fontSize: 16 }}>←</button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Calendrier</h1>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "20px 16px 60px" }}>

        {/* Lokal */}
        {user.isAdmin && locals.length > 1 && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 14 }}>
            {locals.map(l => (
              <button key={l.id} onClick={() => setLid(l.id)}
                style={{ padding: "6px 14px", borderRadius: 20, cursor: "pointer", border: "none",
                  fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
                  background: lid === l.id ? ORANGE : `${ORANGE}22`,
                  color: lid === l.id ? "#fff" : ORANGE }}>{l.name}</button>
            ))}
          </div>
        )}

        {allowed.length === 0 && (
          <p style={{ textAlign: "center", color: "#aaa", padding: "30px 0" }}>
            🔒 Vous n&apos;avez aucune permission pour voir des activités.
          </p>
        )}

        {/* Bannière mois */}
        <div style={{ background: `linear-gradient(135deg, ${NAVY}, ${VIOLET})`, borderRadius: 24,
          padding: "14px 12px 16px", boxShadow: `0 6px 16px ${VIOLET}59` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button onClick={() => goMonth(-1)} style={navBtn}>‹</button>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{MONTHS[month.getMonth()]}</div>
              <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{month.getFullYear()}</div>
            </div>
            <button onClick={() => goMonth(1)} style={navBtn}>›</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {[
              { v: String(monthEvents.length), l: "Activités" },
              { v: String(activeDays), l: "Jours actifs" },
              { v: String(nbFact), l: "Factures" },
              { v: money(ventes), l: "Ventes" },
            ].map(s => (
              <div key={s.l} style={{ flex: 1, background: "rgba(255,255,255,0.12)", borderRadius: 14,
                padding: "8px 4px", textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{s.v}</div>
                <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 10 }}>{s.l}</div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 10 }}>
            <button onClick={goToday} style={{ background: "rgba(255,255,255,0.14)", border: "none",
              color: "#fff", borderRadius: 20, padding: "5px 16px", cursor: "pointer", fontSize: 12 }}>
              📅 Aujourd&apos;hui
            </button>
          </div>
        </div>

        {/* Filtres */}
        <div style={{ display: "flex", gap: 8, overflowX: "auto", margin: "14px 0 10px" }}>
          {(["all", ...allowed] as ("all" | Cat)[]).map(id => {
            const c = id === "all" ? VIOLET : CAT_COLOR[id];
            const sel = filter === id;
            return (
              <button key={id} onClick={() => setFilter(id)}
                style={{ padding: "8px 14px", borderRadius: 20, cursor: "pointer", whiteSpace: "nowrap",
                  fontWeight: 700, fontSize: 12, fontFamily: "inherit",
                  border: `1px solid ${c}66`, background: sel ? c : "#fff", color: sel ? "#fff" : NAVY }}>
                {id === "all" ? "Tout" : `${CAT_ICON[id]} ${CAT_LABEL[id]}`}
              </button>
            );
          })}
        </div>

        {/* Calendrier */}
        <div style={{ background: "#F4F5FA", borderRadius: 22, padding: 12, color: NAVY }}>
          {loading ? (
            <p style={{ textAlign: "center", color: "#888", padding: 40 }}>Chargement...</p>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 6 }}>
                {WD_SHORT.map(w => (
                  <div key={w} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#888", padding: "6px 0" }}>{w}</div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
                {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const d = new Date(month.getFullYear(), month.getMonth(), i + 1);
                  const k = keyOf(d);
                  const evs = eventsOf(k);
                  const n = evs.length;
                  const isToday = k === todayKey;
                  const cats = CATS.filter(c => evs.some(e => e.cat === c));
                  const heat = n === 0 ? 0 : 0.07 + Math.min(n / 15, 1) * 0.22;
                  return (
                    <button key={k} onClick={() => n > 0 && setOpenDay(d)}
                      title={n > 0 ? `${n} activité(s)` : "Aucune activité"}
                      style={{ aspectRatio: "1 / 1.05", borderRadius: 14, cursor: n > 0 ? "pointer" : "default",
                        background: n > 0 ? `rgba(255,107,53,${heat})` : "#fff",
                        border: isToday ? `2px solid ${VIOLET}` : n > 0 ? "1px solid rgba(255,107,53,0.35)" : "1px solid rgba(0,0,0,0.08)",
                        boxShadow: n > 0 ? "0 2px 5px rgba(255,107,53,0.12)" : "none",
                        display: "flex", flexDirection: "column", alignItems: "center",
                        justifyContent: "center", gap: 3, fontFamily: "inherit", padding: 2 }}>
                      <span style={{ fontSize: 15, fontWeight: n > 0 || isToday ? 700 : 400,
                        color: isToday ? VIOLET : n > 0 ? NAVY : "#aaa" }}>{i + 1}</span>
                      {n > 0 && (
                        <>
                          <span style={{ display: "flex", gap: 2 }}>
                            {cats.map(c => (
                              <span key={c} style={{ width: 6, height: 6, borderRadius: "50%", background: CAT_COLOR[c] }} />
                            ))}
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: NAVY }}>{n}</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Légende */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12 }}>
          {allowed.map(c => (
            <span key={c} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#aaa" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: CAT_COLOR[c] }} />
              {CAT_LABEL[c]}
            </span>
          ))}
        </div>
      </div>

      {openDay && (
        <DayModal date={openDay} events={byDay.get(keyOf(openDay)) ?? []}
          initialFilter={filter} cats={allowed} onClose={() => setOpenDay(null)} />
      )}
    </main>
  );
}

const navBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.14)", border: "none", color: "#fff", width: 38, height: 38,
  borderRadius: "50%", cursor: "pointer", fontSize: 22, lineHeight: 1,
};

// ─── 4. FENÊTRE DU JOUR ──────────────────────────────────────────────────────
function DayModal({ date, events, initialFilter, cats, onClose }: {
  date: Date; events: CalEvent[]; initialFilter: "all" | Cat; cats: Cat[]; onClose: () => void;
}) {
  const [cat, setCat] = useState<"all" | Cat>(initialFilter);
  const [q, setQ] = useState("");

  const facs = events.filter(e => e.type === "facture_creee");
  const ventes = facs.filter(e => !e.cancelled).reduce((s, e) => s + (e.amount ?? 0), 0);
  const annul = events.filter(e => e.type === "facture_annulee").length;
  const comm = events.filter(e => e.cat === "ms" && e.type === "vente").reduce((s, e) => s + (e.amount ?? 0), 0);
  const retraits = events.filter(e => e.type === "retrait").reduce((s, e) => s + Math.abs(e.amount ?? 0), 0);
  const cmds = events.filter(e => e.type === "commande_recue");
  const cmdTotal = cmds.filter(e => !e.cancelled).reduce((s, e) => s + (e.amount ?? 0), 0);
  const depots = events.filter(e => e.type === "depot").reduce((s, e) => s + (e.amount ?? 0), 0);

  const needle = q.toLowerCase().trim();
  const list = events.filter(e => {
    if (cat !== "all" && e.cat !== cat) return false;
    if (!needle) return true;
    return e.title.toLowerCase().includes(needle) || e.subtitle.toLowerCase().includes(needle)
      || e.lines.some(l => l.toLowerCase().includes(needle));
  });

  const stats = [
    ...(cats.includes("facture") ? [
      { l: "Factures", v: String(facs.length), c: "#2979FF", i: "🧾" },
      { l: "Ventes", v: money(ventes), c: "#00C853", i: "💵" },
      { l: "Annulées", v: String(annul), c: "#EF5350", i: "❌" },
    ] : []),
    ...(cats.includes("commande") ? [
      { l: "Commandes", v: String(cmds.length), c: "#6C63FF", i: "🛍️" },
      { l: "Cmd. ($)", v: money(cmdTotal), c: "#6C63FF", i: "💰" },
    ] : []),
    ...(cats.includes("ms") ? [{ l: "Commissions", v: money(comm), c: "#FFB300", i: "🏪" }] : []),
    ...(cats.some(c => c === "vendeur" || c === "fournisseur" || c === "ms") ? [
      { l: "Retraits", v: money(retraits), c: "#FF9100", i: "⬆️" },
      { l: "Dépôts", v: money(depots), c: VIOLET, i: "⬇️" },
    ] : []),
  ];

  const label = `${WD_LONG[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()].toLowerCase()} ${date.getFullYear()}`;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300,
      display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#F4F5FA", color: NAVY, borderRadius: "26px 26px 0 0", width: "100%",
          maxWidth: 720, maxHeight: "92vh", overflowY: "auto", padding: "12px 16px 30px" }}>
        <div style={{ width: 44, height: 5, background: "#ccc", borderRadius: 3, margin: "0 auto 12px" }} />

        <div style={{ background: `linear-gradient(135deg, ${NAVY}, ${VIOLET})`, borderRadius: 20,
          padding: 16, color: "#fff", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 28 }}>📅</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{label}</div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
              {events.length} activité{events.length > 1 ? "s" : ""}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.18)", border: "none",
            color: "#fff", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 12 }}>
          {stats.map(s => (
            <div key={s.l} style={{ background: "#fff", borderRadius: 16, padding: "10px 6px", textAlign: "center",
              border: `1px solid ${s.c}4d`, boxShadow: `0 2px 6px ${s.c}1a` }}>
              <div style={{ fontSize: 16 }}>{s.i}</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: s.c }}>{s.v}</div>
              <div style={{ fontSize: 10, color: "#888" }}>{s.l}</div>
            </div>
          ))}
        </div>

        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Rechercher (client, produit, vendeur, N° facture...)"
          style={{ width: "100%", boxSizing: "border-box", margin: "14px 0 10px", padding: "11px 14px",
            borderRadius: 14, border: "none", outline: "none", fontSize: 13, fontFamily: "inherit" }} />

        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 12 }}>
          {(["all", ...cats] as ("all" | Cat)[]).map(id => {
            const c = id === "all" ? VIOLET : CAT_COLOR[id];
            const n = id === "all" ? events.length : events.filter(e => e.cat === id).length;
            const sel = cat === id;
            return (
              <button key={id} onClick={() => setCat(id)}
                style={{ padding: "7px 13px", borderRadius: 20, cursor: "pointer", whiteSpace: "nowrap",
                  border: `1px solid ${c}66`, background: sel ? c : "#fff", color: sel ? "#fff" : NAVY,
                  fontWeight: 700, fontSize: 12, fontFamily: "inherit" }}>
                {id === "all" ? "Tout" : CAT_LABEL[id]} ({n})
              </button>
            );
          })}
        </div>

        {list.length === 0 ? (
          <p style={{ textAlign: "center", color: "#999", padding: "40px 0" }}>Aucun résultat</p>
        ) : CATS.filter(c => list.some(e => e.cat === c)).map(c => {
          const items = list.filter(e => e.cat === c);
          return (
            <div key={c} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 8px" }}>
                <span style={{ width: 28, height: 28, borderRadius: "50%", background: `${CAT_COLOR[c]}26`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{CAT_ICON[c]}</span>
                <span style={{ color: CAT_COLOR[c], fontWeight: 700, fontSize: 12, letterSpacing: 1 }}>
                  {CAT_LABEL[c].toUpperCase()}
                </span>
                <span style={{ background: `${CAT_COLOR[c]}26`, color: CAT_COLOR[c], borderRadius: 10,
                  padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{items.length}</span>
                <div style={{ flex: 1, height: 1, background: `${CAT_COLOR[c]}40` }} />
              </div>

              {items.map((e, i) => {
                const col = evColor(e);
                const amt = e.amountText ?? (e.amount ? money(e.amount) : null);
                const sign = !e.amountText && (e.amount ?? 0) > 0 ? "+" : "";
                return (
                  <div key={i} style={{ background: "#fff", borderRadius: 16, padding: 12, marginBottom: 8,
                    border: `1px solid ${col}40` }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <span style={{ width: 36, height: 36, borderRadius: "50%", background: `${col}21`,
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                        {TYPE_ICON[e.type] ?? "🧾"}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13,
                          textDecoration: e.cancelled ? "line-through" : "none" }}>{e.title}</div>
                        <div style={{ color: "#888", fontSize: 11, marginTop: 2 }}>
                          🕐 {hhmm(e.ts)}
                          {e.cancelled && (
                            <span style={{ marginLeft: 8, background: "rgba(239,83,80,0.12)", color: "#EF5350",
                              fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 6 }}>ANNULÉE</span>
                          )}
                        </div>
                      </div>
                      {amt && <span style={{ fontWeight: 700, fontSize: 14, color: col }}>{sign}{amt}</span>}
                    </div>
                    {e.lines.length > 0 && (
                      <div style={{ background: "#F4F5FA", borderRadius: 10, padding: 8, marginTop: 8 }}>
                        {e.lines.map((l, j) => (
                          <div key={j} style={{ fontSize: 11.5, color: "#666", marginBottom: 3 }}>{l}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}