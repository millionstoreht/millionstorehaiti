"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db, auth } from "../../../lib/firebase";
import {
  collection, doc, getDocs, setDoc, deleteDoc, onSnapshot, runTransaction, query, where,
} from "firebase/firestore";
import {
  EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, type User,
} from "firebase/auth";

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface UserSession {
  username: string; displayName: string;
  isAdmin: boolean; localId: string;
  permissions: Record<string, boolean>;
}
type Raw = Record<string, unknown>;
type W = Raw & { id: string };
type Res = { ok: boolean; message?: string };
interface LocalItem { id: string; name: string }

// ─── COULEURS (même palette que l'application) ───────────────────────────────
const P = {
  bg: "#0B0E1A", card: "#141A2E", accent: "#7C5CFF", gold: "#FFC857",
  red: "#FF5470", green: "#2EE59D", blue: "#4D8DFF",
};

// ─── OUTILS ──────────────────────────────────────────────────────────────────
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const str = (v: unknown) => (v ?? "").toString();
const num = (v: unknown) => { const n = Number(v ?? 0); return isFinite(n) ? n : 0; };
const money = (v: number) => `$${v.toFixed(2)}`;
const bal = (w: Raw) => num(w.balance);
const sal = (w: Raw) => num(w.salary);

function nomOf(w: Raw): string {
  const f = str(w.fullName).trim();
  if (f) return f;
  return `${str(w.firstName)} ${str(w.lastName)}`.trim();
}

/** Lit une date ISO ; une date seule (AAAA-MM-JJ) est lue en heure locale. */
function parseDate(raw: unknown): Date | null {
  const s = str(raw).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
const p2 = (n: number) => String(n).padStart(2, "0");
function fmtDate(raw: unknown): string {
  const d = parseDate(raw);
  return d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` : "-";
}
function fmtDateTime(raw: unknown): string {
  const d = parseDate(raw);
  return d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}  ${p2(d.getHours())}:${p2(d.getMinutes())}` : "";
}
/** AAAA-MM-JJ pour un champ <input type="date">. */
function toInputDate(raw: unknown): string {
  const d = parseDate(raw);
  return d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : "";
}
const toIso = (inputDate: string) => (inputDate ? `${inputDate}T00:00:00.000` : "");

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

const cleanNote = (raw: string) => raw.replace(/\s+/g, " ").trim().slice(0, 200);

// ─── CALCUL DES SALAIRES (identique à l'application) ─────────────────────────
function addMonths(d: Date, m: number): Date {
  const y = d.getFullYear() + Math.floor((d.getMonth() + m) / 12);
  const mo = (d.getMonth() + m) % 12;
  const last = new Date(y, mo + 1, 0).getDate();
  return new Date(y, mo, Math.min(d.getDate(), last));
}

/** Nombre de paiements mensuels déjà échus depuis [start] jusqu'à [now]. */
function periodesEcoulees(start: Date, now: Date): number {
  let k = 0;
  while (addMonths(start, k + 1).getTime() <= now.getTime()) {
    k++;
    if (k > 600) break;
  }
  return k;
}

/** Date du prochain paiement (null s'il n'y a pas de date d'embauche). */
function prochainePaie(w: Raw): Date | null {
  const start = parseDate(w.startDate);
  if (!start) return null;
  const done = w.paiesVersees != null ? num(w.paiesVersees) : periodesEcoulees(start, new Date());
  return addMonths(start, done + 1);
}

// ─── VÉRIFICATION DU MOT DE PASSE ────────────────────────────────────────────
function currentAuthUser(): Promise<User | null> {
  return new Promise(resolve => {
    if (auth.currentUser) { resolve(auth.currentUser); return; }
    const off = onAuthStateChanged(auth, u => { off(); resolve(u); });
  });
}

async function verifyPassword(pw: string): Promise<Res> {
  const u = await currentAuthUser();
  if (!u || !u.email) return { ok: false, message: "Session expirée. Reconnectez-vous." };
  try {
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, pw));
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
      return { ok: false, message: "Mot de passe incorrect" };
    }
    if (code === "auth/too-many-requests") {
      return { ok: false, message: "Trop de tentatives. Réessayez dans quelques minutes." };
    }
    return { ok: false, message: "Vérification impossible. Réessayez." };
  }
}

// ─── FIRESTORE ───────────────────────────────────────────────────────────────
const workersCol = () => collection(db, "workers");
const workerDoc = (id: string) => doc(db, "workers", id);

/** DÉPÔT ou RETRAIT sur le compte d'un employé (opId = protection contre le double envoi). */
async function workerMouvement(p: {
  workerId: string; montant: number; retrait: boolean; parUser: string; opId: string; note: string;
}): Promise<Res> {
  if (p.montant <= 0) return { ok: false, message: "Le montant doit être supérieur à 0." };
  const ref = workerDoc(p.workerId);
  try {
    let erreur: string | null = null;
    await withTimeout(runTransaction(db, async (tx) => {
      erreur = null;
      const snap = await tx.get(ref);
      if (!snap.exists()) { erreur = "Employé introuvable."; return; }
      const current = { ...(snap.data() as Raw) };
      const hist = [...((current.historique as Raw[]) ?? [])];
      if (hist.some(e => str(e.opId) === p.opId)) return;
      const avant = num(current.balance);
      if (p.retrait && p.montant > avant + 0.001) {
        erreur = `Montant supérieur au solde ($${avant.toFixed(2)}).`;
        return;
      }
      const apres = r2(p.retrait ? avant - p.montant : avant + p.montant);
      hist.push({
        type: p.retrait ? "retrait" : "depot",
        date: new Date().toISOString(),
        delta: p.retrait ? -p.montant : p.montant,
        soldeAvant: avant, soldeApres: apres,
        description: p.retrait
          ? `Retrait de ${p.montant.toFixed(2)}$ : vous aviez ${avant.toFixed(2)}$, il vous reste ${apres.toFixed(2)}$.`
          : `Dépôt de ${p.montant.toFixed(2)}$ : vous aviez ${avant.toFixed(2)}$, vous avez maintenant ${apres.toFixed(2)}$.`,
        par: p.parUser,
        ...(p.note ? { note: p.note } : {}),
        opId: p.opId,
      });
      current.balance = apres;
      current.historique = hist;
      tx.set(ref, current);
    }), 12000);
    if (erreur) return { ok: false, message: erreur };
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && e.message === "TIMEOUT") {
      return { ok: false, message: "Réseau trop lent. Vérifiez le relevé avant de réessayer." };
    }
    return { ok: false, message: `Erreur : ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Paie UN mois : MILLIONSTORE (−salaire) → compte employé (+salaire), en UNE transaction. */
async function payerPeriode(workerId: string, lid: string, periode: number):
  Promise<{ statut: "paye" | "deja" | "echwe"; message?: string; montant: number }> {
  const wRef = workerDoc(workerId);
  const msRef = doc(db, "locals", lid, "millionstore", "compte");
  const opId = `paie_${workerId}_${periode}`;
  try {
    let statut: "paye" | "deja" | "echwe" = "echwe";
    let message: string | undefined;
    let montant = 0;
    await withTimeout(runTransaction(db, async (tx) => {
      statut = "echwe"; message = undefined; montant = 0;
      const wSnap = await tx.get(wRef);
      const msSnap = await tx.get(msRef);
      if (!wSnap.exists()) { message = "Employé introuvable."; return; }

      const w = { ...(wSnap.data() as Raw) };
      const done = num(w.paiesVersees);
      if (done >= periode) { statut = "deja"; return; }
      if (done !== periode - 1) { message = "Ordre de paie invalide."; return; }

      const salaire = num(w.salary);
      if (salaire <= 0) { message = "Salaire non défini."; return; }

      const ms: Raw = msSnap.exists() ? { ...(msSnap.data() as Raw) } : { balance: 0, historique: [] };
      const msAvant = num(ms.balance);
      if (msAvant < salaire - 0.001) {
        message = `Solde MILLIONSTORE insuffisant ($${msAvant.toFixed(2)}).`;
        return;
      }

      const start = parseDate(w.startDate);
      const dateDue = start ? addMonths(start, periode) : new Date();
      const now = new Date().toISOString();
      const nom = (str(w.fullName) || `${str(w.firstName)} ${str(w.lastName)}`).trim();
      const s2 = salaire.toFixed(2);
      const label = `${p2(dateDue.getMonth() + 1)}/${dateDue.getFullYear()}`;

      // MILLIONSTORE : −salaire
      const msApres = r2(msAvant - salaire);
      const msHist = [...((ms.historique as Raw[]) ?? []), {
        type: "salaire", date: now, delta: -salaire,
        soldeAvant: msAvant, soldeApres: msApres,
        description: `Salaire ${label} payé à ${nom} : ${s2}$. Vous aviez ${msAvant.toFixed(2)}$, il vous reste ${msApres.toFixed(2)}$.`,
        workerId, workerNom: nom, opId, parAdmin: "Système",
      }];
      ms.balance = msApres;
      ms.historique = msHist;

      // Employé : +salaire
      const avant = num(w.balance);
      const apres = r2(avant + salaire);
      const hist = [...((w.historique as Raw[]) ?? []), {
        type: "salaire", date: now, delta: salaire,
        soldeAvant: avant, soldeApres: apres,
        description: `Salaire ${label} reçu : ${s2}$. Vous aviez ${avant.toFixed(2)}$, vous avez maintenant ${apres.toFixed(2)}$.`,
        periode: label, source: "MILLIONSTORE", opId, par: "Système",
      }];
      w.balance = apres;
      w.historique = hist;
      w.paiesVersees = periode;
      w.dernierePaie = now;

      tx.set(msRef, ms);
      tx.set(wRef, w);
      statut = "paye";
      montant = salaire;
    }), 12000);
    return { statut, message, montant };
  } catch (e) {
    return { statut: "echwe", message: `Erreur : ${e instanceof Error ? e.message : String(e)}`, montant: 0 };
  }
}

/** Appelé quand l'admin ouvre la page : paie tous les salaires échus (jamais deux fois). */
async function payerSalaires(defaultLid: string): Promise<{ payes: number; total: number; alertes: string[] }> {
  let payes = 0, total = 0;
  const alertes: string[] = [];
  try {
    const snap = await withTimeout(getDocs(workersCol()), 10000);
    for (const d of snap.docs) {
      const w = d.data() as Raw;
      if (w.isActive === false) continue;
      const salaire = num(w.salary);
      const start = parseDate(w.startDate);
      if (salaire <= 0 || !start) continue;

      const ecoules = periodesEcoulees(start, new Date());

      // Ancien employé : initialise le compteur SANS payer rétroactivement
      if (w.paiesVersees == null) {
        await setDoc(workerDoc(d.id), {
          paiesVersees: ecoules,
          balance: num(w.balance),
          historique: w.historique ?? [],
        }, { merge: true });
        continue;
      }

      const done = num(w.paiesVersees);
      const lid = str(w.localId) || defaultLid;
      if (!lid) continue;
      const nom = str(w.fullName);

      for (let p = done + 1; p <= ecoules; p++) {
        const r = await payerPeriode(d.id, lid, p);
        if (r.statut === "paye") { payes++; total += r.montant; }
        else if (r.statut === "deja") continue;
        else { alertes.push(`${nom} : ${r.message ?? "paiement impossible"}`); break; }
      }
    }
  } catch { /* connexion perdue : on réessaiera à la prochaine ouverture */ }
  return { payes, total, alertes };
}

/** Crée / modifie le profil sans jamais toucher au solde ni à l'historique. */
async function workerSave(id: string | null, data: Raw): Promise<Res> {
  try {
    if (id == null) {
      const start = parseDate(data.startDate);
      const ref = doc(workersCol());
      await withTimeout(setDoc(ref, {
        ...data,
        balance: 0,
        historique: [],
        paiesVersees: start ? periodesEcoulees(start, new Date()) : 0,
        createdAt: new Date().toISOString(),
      }), 10000);
      return { ok: true };
    }
    await withTimeout(setDoc(workerDoc(id), data, { merge: true }), 10000);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `Erreur : ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ─── FORMULAIRE : valeurs autorisées ─────────────────────────────────────────
const GENRES = ["Homme", "Femme"];
const CONTRATS = ["CDI", "Temps partiel", "Saisonnier", "Stagiaire"];
const ANCIENS: Record<string, string> = {
  Gason: "Homme", Fi: "Femme",
  Fiks: "CDI", Paryè: "Temps partiel", Sezonye: "Saisonnier", Estajyè: "Stagiaire",
};
function norm(v: unknown, valides: string[]): string {
  const s = str(v);
  const m = ANCIENS[s] ?? s;
  return valides.includes(m) ? m : valides[0];
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.06)",
  border: "none", borderRadius: 14, color: "#fff", fontSize: 14, outline: "none",
  boxSizing: "border-box", fontFamily: "inherit",
};
const gradient = "linear-gradient(135deg,#7C5CFF,#3D7BFF)";

// ─── PAGE PRINCIPALE ─────────────────────────────────────────────────────────
export default function WorkersPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [workers, setWorkers] = useState<W[]>([]);
  const [locals, setLocals] = useState<LocalItem[]>([]);
  const [alertes, setAlertes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState<{ existing: W | null } | null>(null);
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);

  const isAdmin = !!user?.isAdmin;
  const actor = ((user?.username ?? "").trim() || (user?.displayName ?? "").trim());
  const defaultLid = user && user.localId && user.localId !== "all" ? user.localId : "";

  const showToast = (msg: string, color: string) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3200);
  };

  // Session : admin, ou utilisateur avec la permission « workersVoir »
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const s = JSON.parse(raw) as UserSession;
      if (!s.isAdmin && !s.permissions?.workersVoir) { router.push("/dashboard"); return; }
      setUser(s);
    } catch { router.push("/login"); }
  }, [router]);

  async function load() {
    if (!user) return;
    setLoading(true); setFailed(false);
    try {
      if (user.isAdmin) {
        const r = await payerSalaires(defaultLid);
        setAlertes(r.alertes);
        if (r.payes > 0) showToast(`💰 ${r.payes} salaire(s) versé(s) : ${money(r.total)}`, P.green);
        try {
          const ls = await withTimeout(getDocs(collection(db, "locals")), 10000);
          setLocals(ls.docs.filter(d => d.id !== "all")
            .map(d => ({ id: d.id, name: str((d.data() as Raw).name) || d.id })));
        } catch { /* la liste des locaux est facultative */ }
      }
      const snap = user.isAdmin
        ? await withTimeout(getDocs(workersCol()), 10000)
        : await withTimeout(getDocs(query(workersCol(), where("linkedUsername", "==", actor.toLowerCase()))), 10000);
      const list = snap.docs.map(d => ({ ...(d.data() as Raw), id: d.id }) as W);
      list.sort((a, b) => nomOf(a).toLowerCase().localeCompare(nomOf(b).toLowerCase()));
      setWorkers(list);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) load(); }, [user]);

  if (!user) return null;

  const detail = detailId ? workers.find(w => w.id === detailId) ?? null : null;

  // Employé simple : il voit directement son propre compte
  const soloWorker = !isAdmin && !loading && workers.length > 0 ? workers[0] : null;

  const actifs = workers.filter(w => w.isActive !== false);
  const totalSoldes = workers.reduce((s, w) => s + bal(w), 0);
  const masse = actifs.reduce((s, w) => s + sal(w), 0);
  const needle = q.trim().toLowerCase();
  const list = workers.filter(w =>
    !needle || `${nomOf(w)} ${str(w.position)} ${str(w.phone)}`.toLowerCase().includes(needle));

  const toastEl = toast && (
    <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      background: toast.color, color: toast.color === P.green ? "#000" : "#fff",
      padding: "12px 22px", borderRadius: 12, fontWeight: 600, fontSize: 14, zIndex: 999,
      maxWidth: "90vw", textAlign: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
      {toast.msg}
    </div>
  );

  const formEl = form && (
    <WorkerForm existing={form.existing} locals={locals} defaultLid={defaultLid}
      onClose={() => setForm(null)}
      onSaved={() => { setForm(null); showToast(form.existing ? "✅ Employé modifié !" : "✅ Employé enregistré !", P.green); load(); }} />
  );

  // ── Employé simple avec compte lié ──
  if (soloWorker) {
    return (
      <>
        <WorkerDetail worker={soloWorker} isAdmin={false} actor={actor}
          onBack={() => router.push("/dashboard")}
          onEdit={() => {}} onDeleted={() => {}} notify={showToast} />
        {toastEl}
      </>
    );
  }

  // ── Détail (admin) ──
  if (detail) {
    return (
      <>
        <WorkerDetail worker={detail} isAdmin={isAdmin} actor={actor}
          onBack={() => setDetailId(null)}
          onEdit={() => setForm({ existing: detail })}
          onDeleted={() => { setDetailId(null); showToast("✅ Employé supprimé.", P.green); load(); }}
          notify={showToast} />
        {formEl}
        {toastEl}
      </>
    );
  }

  // ── Liste ──
  return (
    <main style={{ minHeight: "100vh", background: P.bg, color: "#fff",
      fontFamily: "'Segoe UI',sans-serif" }}>
      <div style={{ background: P.card, padding: "14px 20px", position: "sticky", top: 0, zIndex: 100,
        display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.push("/dashboard")}
          style={{ background: "#ffffff18", border: "none", color: "#aaa", padding: "8px 14px",
            borderRadius: 10, cursor: "pointer", fontSize: 13 }}>← Retour</button>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, flex: 1 }}>
          {isAdmin ? `Employés (${workers.length})` : "Mon compte employé"}
        </h1>
        <button onClick={() => load()} disabled={loading} title="Actualiser"
          style={{ background: "#ffffff18", border: "none", color: "#fff", width: 38, height: 38,
            borderRadius: 10, cursor: loading ? "default" : "pointer", fontSize: 16 }}>⟳</button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 80 }}>
          <div style={{ width: 44, height: 44, border: "4px solid #333", borderTop: `4px solid ${P.accent}`,
            borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 14px" }} />
          <p style={{ color: "#888" }}>Chargement...</p>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : !isAdmin ? (
        <p style={{ textAlign: "center", color: "#ffffff8a", padding: 40, whiteSpace: "pre-line" }}>
          {failed
            ? "Impossible de charger. Vérifiez la connexion."
            : "Aucun compte employé n'est lié à votre utilisateur.\nDemandez à un administrateur de faire le lien."}
        </p>
      ) : (
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "16px 14px 100px" }}>
          {failed && (
            <p style={{ color: P.gold, fontSize: 12, margin: "0 0 12px" }}>
              Connexion impossible. Actualisez pour réessayer.
            </p>
          )}

          {alertes.length > 0 && (
            <div style={{ background: `${P.red}1a`, border: `1px solid ${P.red}66`,
              borderRadius: 14, padding: 12, marginBottom: 12 }}>
              <p style={{ margin: "0 0 6px", color: P.red, fontWeight: 700, fontSize: 13 }}>
                ⚠️ Salaires en attente
              </p>
              {alertes.map((a, i) => (
                <p key={i} style={{ margin: "2px 0 0", color: "#ffffffb3", fontSize: 12 }}>• {a}</p>
              ))}
            </div>
          )}

          <div style={{ background: gradient, borderRadius: 22, padding: 18, marginBottom: 14,
            boxShadow: `0 8px 18px ${P.accent}4d` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.18)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🪪</div>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 16, letterSpacing: 1.5 }}>ÉQUIPE</p>
            </div>
            <p style={{ margin: "16px 0 4px", color: "#ffffffb3", fontSize: 10, letterSpacing: 1.2 }}>
              TOTAL DES SOLDES EMPLOYÉS
            </p>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 32 }}>{money(totalSoldes)}</p>
            <div style={{ display: "flex", marginTop: 14 }}>
              {[
                { v: `${actifs.length}`, l: "Employés actifs" },
                { v: money(masse), l: "Salaires / mois" },
              ].map((s, i) => (
                <div key={s.l} style={{ flex: 1, textAlign: "center",
                  borderLeft: i ? "1px solid rgba(255,255,255,0.24)" : "none" }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>{s.v}</p>
                  <p style={{ margin: "2px 0 0", color: "#ffffff99", fontSize: 10 }}>{s.l}</p>
                </div>
              ))}
            </div>
          </div>

          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍  Rechercher un employé..."
            style={{ ...fieldStyle, background: P.card, marginBottom: 14 }} />

          {list.length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 0" }}>
              <div style={{ fontSize: 56, opacity: 0.15 }}>🪪</div>
              <p style={{ color: "#ffffff61" }}>{needle ? "Aucun résultat" : "Aucun employé pour le moment"}</p>
            </div>
          ) : list.map(w => {
            const nom = nomOf(w);
            const actif = w.isActive !== false;
            const prochain = prochainePaie(w);
            const poste = str(w.position);
            return (
              <div key={w.id} onClick={() => setDetailId(w.id)}
                style={{ background: P.card, borderRadius: 18, padding: 14, marginBottom: 10,
                  cursor: "pointer", border: "1px solid #ffffff0f",
                  display: "flex", alignItems: "center", gap: 12 }}>
                <Avatar nom={nom} size={48} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 15, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nom}</p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                    <Chip t={actif ? "Actif" : "Inactif"} c={actif ? P.green : "#9E9E9E"} />
                    {poste && <Chip t={poste} c={P.accent} />}
                    {sal(w) > 0 && <Chip t={`${money(sal(w))}/mois`} c={P.gold} />}
                  </div>
                  {prochain && actif && sal(w) > 0 && (
                    <p style={{ margin: "6px 0 0", color: "#ffffff61", fontSize: 11 }}>
                      Prochain salaire : {fmtDate(prochain.toISOString())}
                    </p>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 16,
                    color: bal(w) >= 0 ? P.green : P.red }}>{money(bal(w))}</p>
                  <p style={{ margin: 0, color: "#ffffff4d", fontSize: 10 }}>solde</p>
                </div>
                <span style={{ color: "#ffffff3d" }}>›</span>
              </div>
            );
          })}

          <button onClick={() => setForm({ existing: null })}
            style={{ position: "fixed", right: 20, bottom: 24, background: P.accent, color: "#fff",
              border: "none", borderRadius: 28, padding: "14px 22px", fontWeight: 700, fontSize: 14,
              cursor: "pointer", boxShadow: `0 6px 18px ${P.accent}66` }}>
            + Ajouter
          </button>
        </div>
      )}
      {formEl}
      {toastEl}
    </main>
  );
}

// ─── PETITS COMPOSANTS ───────────────────────────────────────────────────────
function Avatar({ nom, size }: { nom: string; size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, background: gradient,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontWeight: 700, fontSize: size * 0.4 }}>
      {nom ? nom[0].toUpperCase() : "?"}
    </div>
  );
}

function Chip({ t, c }: { t: string; c: string }) {
  return (
    <span style={{ background: `${c}26`, color: c, fontSize: 10, fontWeight: 700,
      padding: "2px 7px", borderRadius: 8 }}>{t}</span>
  );
}

function Overlay({ children, onClose, align = "center" }: {
  children: React.ReactNode; onClose?: () => void; align?: "center" | "bottom";
}) {
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300,
        display: "flex", alignItems: align === "bottom" ? "flex-end" : "center",
        justifyContent: "center", padding: align === "bottom" ? 0 : 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", display: "flex", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}

// ─── DÉTAIL / COMPTE D'UN EMPLOYÉ ────────────────────────────────────────────
function WorkerDetail({ worker, isAdmin, actor, onBack, onEdit, onDeleted, notify }: {
  worker: W; isAdmin: boolean; actor: string;
  onBack: () => void; onEdit: () => void; onDeleted: () => void;
  notify: (m: string, c: string) => void;
}) {
  const [w, setW] = useState<W>(worker);
  const [mvt, setMvt] = useState<{ retrait: boolean } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);

  // Compte en direct
  useEffect(() => {
    const unsub = onSnapshot(workerDoc(worker.id), snap => {
      if (snap.exists()) setW({ ...(snap.data() as Raw), id: snap.id });
    }, () => {});
    return () => unsub();
  }, [worker.id]);

  const estMoi = !!actor && str(w.linkedUsername).toLowerCase() === actor.toLowerCase();
  const canRetrait = isAdmin || estMoi;
  const canDepot = isAdmin;
  const nom = nomOf(w);
  const solde = bal(w);
  const prochain = prochainePaie(w);
  const hist = [...((w.historique as Raw[]) ?? [])]
    .sort((a, b) => str(b.date).localeCompare(str(a.date)));
  const totalSalaires = hist.filter(h => h.type === "salaire").reduce((s, h) => s + num(h.delta), 0);

  const requestDelete = () => {
    if (busy) return;
    if (Math.abs(solde) > 0.005) {
      notify(`Solde non nul (${money(solde)}). Faites un retrait avant de supprimer.`, P.red);
      return;
    }
    setConfirmDel(true);
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await withTimeout(deleteDoc(workerDoc(w.id)), 10000);
      setConfirmDel(false);
      onDeleted();
    } catch {
      setBusy(false); setConfirmDel(false);
      notify("❌ Suppression impossible. Réessayez.", P.red);
    }
  };

  const ligne = (icon: string, label: string, value: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
      <span style={{ width: 18, textAlign: "center" }}>{icon}</span>
      <span style={{ color: "#ffffff8a", fontSize: 12 }}>{label} :</span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600,
        color: value.trim() ? "#fff" : "#ffffff3d" }}>{value.trim() ? value : "Non renseigné"}</span>
    </div>
  );

  const statBox = (value: string, label: string, color: string) => (
    <div style={{ flex: 1, background: `${color}14`, border: `1px solid ${color}33`,
      borderRadius: 14, padding: "12px 10px", textAlign: "center" }}>
      <p style={{ margin: 0, color, fontWeight: 700, fontSize: 15 }}>{value}</p>
      <p style={{ margin: "2px 0 0", color: "#ffffff61", fontSize: 10 }}>{label}</p>
    </div>
  );

  return (
    <main style={{ minHeight: "100vh", background: P.bg, color: "#fff", fontFamily: "'Segoe UI',sans-serif" }}>
      <div style={{ background: P.card, padding: "14px 20px", position: "sticky", top: 0, zIndex: 100,
        display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack}
          style={{ background: "#ffffff18", border: "none", color: "#aaa", padding: "8px 14px",
            borderRadius: 10, cursor: "pointer" }}>←</button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, flex: 1, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nom}</h2>
        {isAdmin && (
          <>
            <button onClick={onEdit} disabled={busy} title="Modifier"
              style={{ background: `${P.accent}26`, border: "none", color: P.accent, width: 38, height: 38,
                borderRadius: 10, cursor: "pointer", fontSize: 16 }}>✏️</button>
            <button onClick={requestDelete} disabled={busy} title="Supprimer"
              style={{ background: `${P.red}26`, border: "none", color: P.red, width: 38, height: 38,
                borderRadius: 10, cursor: "pointer", fontSize: 16 }}>🗑</button>
          </>
        )}
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: 14 }}>
        <div style={{ background: gradient, borderRadius: 22, padding: 18, textAlign: "center",
          boxShadow: `0 8px 18px ${P.accent}4d` }}>
          <div style={{ display: "flex", justifyContent: "center" }}><Avatar nom={nom} size={60} /></div>
          <p style={{ margin: "10px 0 0", fontWeight: 700, fontSize: 17 }}>{nom}</p>
          {str(w.position) && <p style={{ margin: 0, color: "#ffffffb3", fontSize: 12 }}>{str(w.position)}</p>}
          <p style={{ margin: "12px 0 4px", color: "#ffffffb3", fontSize: 10, letterSpacing: 1.2 }}>SOLDE ACTUEL</p>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 34 }}>{money(solde)}</p>
          {(canRetrait || canDepot) && (
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              {canRetrait && (
                <button onClick={() => setMvt({ retrait: true })} disabled={busy}
                  style={{ flex: 1, padding: 12, border: "none", borderRadius: 12, cursor: "pointer",
                    background: busy ? "#777" : P.red, color: "#fff", fontWeight: 700 }}>↑ Retrait</button>
              )}
              {canDepot && (
                <button onClick={() => setMvt({ retrait: false })} disabled={busy}
                  style={{ flex: 1, padding: 12, border: "none", borderRadius: 12, cursor: "pointer",
                    background: busy ? "#777" : P.green, color: "#000", fontWeight: 700 }}>↓ Dépôt</button>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          {statBox(money(sal(w)), "Salaire mensuel", P.gold)}
          {statBox(!prochain || w.isActive === false || sal(w) <= 0 ? "-" : fmtDate(prochain.toISOString()),
            "Prochain salaire", P.blue)}
        </div>
        <div style={{ display: "flex", marginTop: 10 }}>
          {statBox(money(totalSalaires), "Total des salaires reçus", P.green)}
        </div>

        <div style={{ background: P.card, borderRadius: 18, padding: 14, marginTop: 14,
          border: "1px solid #ffffff0f" }}>
          {ligne("📅", "Date d'embauche", fmtDate(w.startDate))}
          {ligne("📄", "Contrat", str(w.contractType))}
          {ligne("🏢", "Département", str(w.department))}
          {ligne("📱", "Téléphone", str(w.phone))}
          {isAdmin && (
            <>
              {ligne("✉️", "Email", str(w.email))}
              {ligne("📍", "Adresse", str(w.address))}
              {ligne("🪪", "NIF", str(w.nif))}
              {ligne("💳", "CIN", str(w.cin))}
              {ligne("🔗", "Utilisateur lié", str(w.linkedUsername))}
            </>
          )}
          {ligne("✅", "Statut", w.isActive === false ? "Inactif" : "Actif")}
        </div>

        <div style={{ display: "flex", alignItems: "center", margin: "18px 0 10px" }}>
          <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>🧾 Relevé du compte</span>
          <span style={{ color: "#ffffff3d", fontSize: 11 }}>
            {hist.length} mouvement{hist.length > 1 ? "s" : ""}
          </span>
        </div>

        {hist.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 48, opacity: 0.15 }}>🕘</div>
            <p style={{ color: "#ffffff61" }}>Aucun mouvement</p>
          </div>
        ) : hist.map((h, i) => <HistCard key={`${str(h.date)}${i}`} h={h} />)}
        <div style={{ height: 20 }} />
      </div>

      {mvt && (
        <MouvementModal worker={w} retrait={mvt.retrait} actor={actor}
          onClose={() => setMvt(null)}
          onDone={() => { setMvt(null); notify(`✅ ${mvt.retrait ? "Retrait" : "Dépôt"} effectué !`, P.green); }}
          notify={notify} />
      )}

      {confirmDel && (
        <Overlay onClose={busy ? undefined : () => setConfirmDel(false)}>
          <div style={{ background: P.card, borderRadius: 20, padding: 22, maxWidth: 400 }}>
            <h3 style={{ margin: "0 0 10px" }}>Supprimer l&apos;employé ?</h3>
            <p style={{ margin: "0 0 16px", color: "#ffffff99", fontSize: 14 }}>
              {nom} sera supprimé définitivement.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmDel(false)} disabled={busy}
                style={{ flex: 1, padding: 12, background: "#ffffff0a", border: "none", borderRadius: 12,
                  color: "#aaa", cursor: "pointer" }}>Non</button>
              <button onClick={doDelete} disabled={busy}
                style={{ flex: 1, padding: 12, background: busy ? "#777" : P.red, border: "none",
                  borderRadius: 12, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {busy ? "..." : "Oui, supprimer"}
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </main>
  );
}

function HistCard({ h }: { h: Raw }) {
  const type = str(h.type);
  const delta = num(h.delta);
  const meta: Record<string, { icon: string; color: string; titre: string }> = {
    salaire: { icon: "💵", color: P.gold, titre: "Salaire" },
    depot: { icon: "↓", color: P.green, titre: "Dépôt" },
    retrait: { icon: "↑", color: P.red, titre: "Retrait" },
  };
  const { icon, color, titre } = meta[type] ?? { icon: "🧾", color: "#ffffff8a", titre: "Mouvement" };
  const par = str(h.par);
  const note = str(h.note);
  const periode = str(h.periode);
  const apres = h.soldeApres != null ? num(h.soldeApres) : null;

  return (
    <div style={{ background: P.card, borderRadius: 14, padding: 12, marginBottom: 10,
      border: `1px solid ${color}2e` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: `${color}1f`, color,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{icon}</div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{titre}</p>
          <p style={{ margin: "2px 0 0", color: "#ffffff4d", fontSize: 10 }}>{fmtDateTime(h.date)}</p>
        </div>
        <span style={{ color, fontWeight: 700, fontSize: 14 }}>
          {delta >= 0 ? "+" : "-"}{money(Math.abs(delta))}
        </span>
      </div>
      <p style={{ margin: "8px 0 0", color: "#ffffffb3", fontSize: 11, lineHeight: 1.4 }}>{str(h.description)}</p>
      {(par || periode) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {par && <Chip t={`Par : ${par}`} c={P.blue} />}
          {periode && <Chip t={`Période : ${periode}`} c={P.gold} />}
        </div>
      )}
      {note && <p style={{ margin: "6px 0 0", color: "#ffffff8a", fontSize: 11, fontStyle: "italic" }}>📝 {note}</p>}
      {apres != null && (
        <div style={{ textAlign: "right", marginTop: 8 }}>
          <Chip t={`Solde après : ${money(apres)}`} c={color} />
        </div>
      )}
    </div>
  );
}

// ─── DÉPÔT / RETRAIT (nom d'utilisateur + mot de passe + note) ───────────────
function MouvementModal({ worker, retrait, actor, onClose, onDone, notify }: {
  worker: W; retrait: boolean; actor: string;
  onClose: () => void; onDone: () => void; notify: (m: string, c: string) => void;
}) {
  const [montant, setMontant] = useState("");
  const [userVal, setUserVal] = useState("");
  const [pass, setPass] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [errUser, setErrUser] = useState<string | null>(null);
  const [errPass, setErrPass] = useState<string | null>(null);
  const [proc, setProc] = useState(false);
  const [essais, setEssais] = useState(0);
  const [opId] = useState(() => `${Date.now()}${Math.floor(Math.random() * 1e6)}`);
  const color = retrait ? P.red : P.green;
  const solde = bal(worker);

  const submit = async () => {
    if (proc) return;
    const v = parseFloat(montant.trim().replace(",", "."));
    if (isNaN(v) || v <= 0) { setErr("Entrez un montant valide."); return; }
    const m = r2(v);
    if (m > 1000000) { setErr("Montant trop élevé."); return; }
    if (retrait && m > solde + 0.001) { setErr(`Dépasse le solde (${money(solde)}).`); return; }
    const typed = userVal.trim();
    if (!typed) { setErrUser("Nom d'utilisateur obligatoire"); return; }
    if (typed.toLowerCase() !== actor.toLowerCase()) { setErrUser("Nom d'utilisateur incorrect"); return; }
    if (!pass) { setErrPass("Mot de passe obligatoire"); return; }

    setProc(true);
    const check = await verifyPassword(pass);
    if (!check.ok) {
      const n = essais + 1;
      setEssais(n);
      if (n >= 5) { onClose(); notify("Trop de tentatives. Action annulée.", P.red); return; }
      setProc(false);
      setErrPass(check.message ?? "Mot de passe incorrect");
      return;
    }
    const res = await workerMouvement({
      workerId: worker.id, montant: m, retrait, parUser: actor, opId, note: cleanNote(note),
    });
    if (res.ok) onDone();
    else { setProc(false); setErr(res.message ?? "Erreur."); }
  };

  const errP = (m: string | null) => m && <p style={{ color: P.red, fontSize: 12, margin: "6px 0 0" }}>{m}</p>;

  return (
    <Overlay onClose={proc ? undefined : onClose}>
      <div style={{ background: P.card, borderRadius: 20, padding: 22, maxWidth: 400, maxHeight: "92vh",
        overflowY: "auto", width: "100%" }}>
        <h3 style={{ margin: "0 0 10px", color }}>{retrait ? "↑ Retrait" : "↓ Dépôt"}</h3>
        <p style={{ margin: 0, color: "#ffffffb3", fontSize: 13 }}>{nomOf(worker)}</p>
        <p style={{ margin: "4px 0 14px", color: P.accent, fontWeight: 700, fontSize: 13 }}>
          Solde actuel : {money(solde)}
        </p>
        <input type="number" step="0.01" autoFocus value={montant} disabled={proc}
          onChange={e => { setMontant(e.target.value); setErr(null); }}
          placeholder="Montant ($)" style={fieldStyle} />
        {errP(err)}
        <input value={userVal} disabled={proc} autoComplete="off" spellCheck={false}
          onChange={e => { setUserVal(e.target.value); setErrUser(null); }}
          placeholder="Votre nom d'utilisateur (obligatoire)" style={{ ...fieldStyle, marginTop: 10 }} />
        {errP(errUser)}
        <input type="password" value={pass} disabled={proc} autoComplete="new-password"
          onChange={e => { setPass(e.target.value); setErrPass(null); }}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          placeholder="Mot de passe (obligatoire)" style={{ ...fieldStyle, marginTop: 10 }} />
        {errP(errPass)}
        <textarea value={note} disabled={proc} maxLength={200} rows={2}
          onChange={e => setNote(e.target.value)} placeholder="Note (optionnel)"
          style={{ ...fieldStyle, marginTop: 10, resize: "vertical" }} />
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={onClose} disabled={proc}
            style={{ flex: 1, padding: 12, background: "#ffffff0a", border: "none", borderRadius: 12,
              color: "#aaa", cursor: "pointer" }}>Annuler</button>
          <button onClick={submit} disabled={proc}
            style={{ flex: 1, padding: 12, background: proc ? "#777" : color, border: "none",
              borderRadius: 12, fontWeight: 700, cursor: "pointer", color: retrait ? "#fff" : "#000" }}>
            {proc ? "..." : retrait ? "Confirmer le retrait" : "Confirmer le dépôt"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ─── FORMULAIRE EMPLOYÉ (admin) ──────────────────────────────────────────────
function WorkerForm({ existing, locals, defaultLid, onClose, onSaved }: {
  existing: W | null; locals: LocalItem[]; defaultLid: string;
  onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!existing;
  const t = (k: string) => str(existing?.[k]);
  const ids = locals.map(l => l.id);
  const initLocal = t("localId") || defaultLid;

  const [prenom, setPrenom] = useState(t("firstName"));
  const [nom, setNom] = useState(t("lastName"));
  const [genre, setGenre] = useState(norm(existing?.gender, GENRES));
  const [naissance, setNaissance] = useState(toInputDate(existing?.birthDate));
  const [phone, setPhone] = useState(t("phone"));
  const [email, setEmail] = useState(t("email"));
  const [adresse, setAdresse] = useState(t("address"));
  const [poste, setPoste] = useState(t("position"));
  const [depart, setDepart] = useState(t("department"));
  const [contrat, setContrat] = useState(norm(existing?.contractType, CONTRATS));
  const [embauche, setEmbauche] = useState(toInputDate(existing?.startDate));
  const [localId, setLocalId] = useState(ids.includes(initLocal) ? initLocal : "");
  const [actif, setActif] = useState(existing ? existing.isActive !== false : true);
  const [salaire, setSalaire] = useState(num(existing?.salary) > 0 ? String(existing?.salary) : "");
  const [nif, setNif] = useState(t("nif"));
  const [cin, setCin] = useState(t("cin"));
  const [lie, setLie] = useState(t("linkedUsername"));
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const dateVerrouillee = isEdit && existing?.paiesVersees != null;
  const today = toInputDate(new Date().toISOString());

  const titre = (s: string) => (
    <p style={{ margin: "16px 0 12px", color: P.gold, fontWeight: 700, fontSize: 14 }}>{s}</p>
  );
  const champ = (value: string, set: (v: string) => void, placeholder: string, type = "text") => (
    <input type={type} value={value} disabled={saving} placeholder={placeholder}
      onChange={e => set(e.target.value)} style={{ ...fieldStyle, marginBottom: 12 }} />
  );
  const sel = (value: string, set: (v: string) => void, options: string[]) => (
    <select value={value} disabled={saving} onChange={e => set(e.target.value)}
      style={{ ...fieldStyle, marginBottom: 12, background: "#1d2440" }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  const labelDate = (s: string) => (
    <p style={{ margin: "0 0 4px", color: "#ffffff8a", fontSize: 12 }}>{s}</p>
  );
  const hint = (s: string) => (
    <p style={{ margin: "-4px 0 12px", color: "#ffffff61", fontSize: 11 }}>{s}</p>
  );

  const save = async () => {
    if (saving) return;
    if (!prenom.trim() || !nom.trim()) { setErreur("Le prénom et le nom sont obligatoires."); return; }
    const sal = parseFloat(salaire.trim().replace(",", ".")) || 0;
    if (sal < 0 || sal > 100000) { setErreur("Salaire invalide."); return; }
    if (sal > 0 && !embauche) { setErreur("La date d'embauche est obligatoire avec un salaire."); return; }
    setSaving(true); setErreur(null);
    const data: Raw = {
      firstName: prenom.trim(),
      lastName: nom.trim(),
      fullName: `${prenom.trim()} ${nom.trim()}`,
      gender: genre,
      birthDate: toIso(naissance),
      phone: phone.trim(),
      email: email.trim(),
      address: adresse.trim(),
      position: poste.trim(),
      department: depart.trim(),
      contractType: contrat,
      startDate: toIso(embauche),
      localId: localId || "",
      isActive: actif,
      salary: sal,
      salaryType: "Mois",
      nif: nif.trim(),
      cin: cin.trim(),
      linkedUsername: lie.trim().toLowerCase(),
      updatedAt: new Date().toISOString(),
    };
    if (dateVerrouillee) delete data.startDate;
    const res = await workerSave(existing ? existing.id : null, data);
    if (res.ok) onSaved();
    else { setSaving(false); setErreur(res.message ?? "Erreur."); }
  };

  return (
    <Overlay align="bottom" onClose={saving ? undefined : onClose}>
      <div style={{ background: P.card, borderRadius: "24px 24px 0 0", width: "100%", maxWidth: 620,
        maxHeight: "92vh", overflowY: "auto", padding: "18px 20px 30px", color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${P.accent}26`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
            {isEdit ? "✏️" : "➕"}
          </div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, flex: 1 }}>
            {isEdit ? "Modifier l'employé" : "Nouvel employé"}
          </h2>
          <button onClick={onClose} disabled={saving}
            style={{ background: "none", border: "none", color: "#ffffff61", fontSize: 22, cursor: "pointer" }}>✕</button>
        </div>

        {titre("👤 Informations personnelles")}
        {champ(prenom, setPrenom, "Prénom *")}
        {champ(nom, setNom, "Nom *")}
        {sel(genre, setGenre, GENRES)}
        {labelDate("Date de naissance")}
        {champ(naissance, setNaissance, "Date de naissance", "date")}
        {champ(phone, setPhone, "Téléphone", "tel")}
        {champ(email, setEmail, "Email", "email")}
        {champ(adresse, setAdresse, "Adresse")}

        {titre("💼 Travail")}
        {champ(poste, setPoste, "Poste")}
        {champ(depart, setDepart, "Département")}
        {sel(contrat, setContrat, CONTRATS)}
        {labelDate(dateVerrouillee ? "Date d'embauche (verrouillée)" : "Date d'embauche *")}
        <input type="date" value={embauche} max={today} disabled={saving || dateVerrouillee}
          onChange={e => setEmbauche(e.target.value)}
          style={{ ...fieldStyle, marginBottom: 12, opacity: dateVerrouillee ? 0.5 : 1 }} />
        {ids.length > 0 && (
          <select value={localId} disabled={saving} onChange={e => setLocalId(e.target.value)}
            style={{ ...fieldStyle, marginBottom: 12, background: "#1d2440" }}>
            <option value="">Choisir un local</option>
            {locals.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
          background: `${actif ? P.green : "#9E9E9E"}1a`, borderRadius: 14, padding: "12px 14px", marginBottom: 12 }}>
          <input type="checkbox" checked={actif} disabled={saving} onChange={e => setActif(e.target.checked)} />
          <span>
            <span style={{ display: "block", fontWeight: 700, fontSize: 14 }}>
              {actif ? "Employé actif" : "Employé inactif"}
            </span>
            <span style={{ display: "block", color: "#ffffff61", fontSize: 11 }}>
              Un employé inactif ne reçoit plus de salaire.
            </span>
          </span>
        </label>

        {titre("💰 Salaire")}
        {champ(salaire, setSalaire, "Salaire mensuel ($)", "number")}
        {hint("Le salaire est versé chaque mois à la date d'embauche, depuis le compte MILLIONSTORE.")}

        {titre("🔗 Compte utilisateur lié")}
        {champ(lie, setLie, "Nom d'utilisateur de l'employé")}
        {hint("Avec ce lien, l'employé voit son propre compte et peut faire ses retraits.")}

        {titre("📄 Documents")}
        {champ(nif, setNif, "NIF")}
        {champ(cin, setCin, "CIN (carte nationale)")}

        {erreur && <p style={{ color: P.red, fontSize: 12, textAlign: "center", margin: "0 0 10px" }}>{erreur}</p>}
        <button onClick={save} disabled={saving}
          style={{ width: "100%", padding: 14, border: "none", borderRadius: 14, cursor: "pointer",
            background: saving ? "#777" : P.accent, color: "#fff", fontWeight: 700, fontSize: 15 }}>
          {saving ? "Enregistrement..." : "💾 Enregistrer"}
        </button>
      </div>
    </Overlay>
  );
}