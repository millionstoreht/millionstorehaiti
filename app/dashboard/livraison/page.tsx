"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { db, auth } from "../../../lib/firebase";
import {
  collection, doc, getDoc, getDocs, onSnapshot, runTransaction, setDoc,
} from "firebase/firestore";
import {
  EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, type User,
} from "firebase/auth";

// =============================================================================
// LIVRAISON — livreurs, soldes, dépôts/retraits, relevé de compte, annulation
// Même logique que livraison_screen.dart + FirestoreService (Flutter).
//  • Livreurs : locals/{localId}/livreurs
//  • Frais de livraison : parametres/livraison  (5 $ par défaut)
//  • Permissions : livreurVoir / Ajoute / Modifye / Depot / Retrait / Siprime
// =============================================================================

// ─── 1. TYPES & CONSTANTES ───────────────────────────────────────────────────
interface UserSession {
  uid?: string; username: string; displayName: string; isAdmin: boolean;
  localId: string; permissions: Record<string, boolean>;
}
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Res = { ok: boolean; message?: string };
type TxOut = { erreur?: string; result?: Raw; dejaAnile?: boolean };

const BG = "#080B16", CARD = "#121829", ACCENT = "#00D4AA", GOLD = "#FFC857";
const RED = "#FF5470", GREEN = "#2EE59D", BLUE = "#4D8DFF";
const DEFAULT_FRAIS = 5;
const DEUX_HEURES = 2 * 3600 * 1000;

// ─── 2. UTILITAIRES ──────────────────────────────────────────────────────────
const two = (n: number) => String(n).padStart(2, "0");
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const money = (v: number) => `$${v.toFixed(2)}`;
const balOf = (l: Raw) => num(l.balance);
const histOf = (l: Raw): Raw[] => (Array.isArray(l.historique) ? l.historique : []);
const fmtDate = (raw: unknown) => {
  if (!raw) return "";
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return "";
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}  ${two(d.getHours())}:${two(d.getMinutes())}`;
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/** Même ligne de livraison ? factureId si présent des deux côtés, sinon billNo. */
function memeLiv(e: Raw | undefined, type: string, factureId: string, billNo: string) {
  if (!e || e.type !== type) return false;
  const ef = str(e.factureId);
  if (ef && factureId) return ef === factureId;
  return str(e.billNo) === billNo;
}

function errMsg(e: unknown): string {
  if (e instanceof Error && e.message === "TIMEOUT") {
    return "Réseau trop lent. Vérifiez les données avant de réessayer.";
  }
  const m = e instanceof Error ? e.message : String(e);
  return `Erreur : ${m}`;
}

// ─── 3. AUTHENTIFICATION (vérification du mot de passe) ──────────────────────
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

// ─── 4. FIRESTORE ────────────────────────────────────────────────────────────
const livCol = (lid: string) => collection(db, "locals", lid, "livreurs");
const livDoc = (lid: string, id: string) => doc(db, "locals", lid, "livreurs", id);

async function saveLivreur(lid: string, l: {
  id: string; nom: string; telephone: string; telephone2: string; adresse: string; nif: string;
}): Promise<Res> {
  if (!l.id || !l.nom.trim()) return { ok: false, message: "Le nom complet du livreur est obligatoire." };
  const ref = livDoc(lid, l.id);
  try {
    await withTimeout(runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const profil = {
        id: l.id, nom: l.nom.trim(), telephone: l.telephone.trim(),
        telephone2: l.telephone2.trim(), adresse: l.adresse.trim(), nif: l.nif.trim(),
      };
      if (!snap.exists()) {
        tx.set(ref, { ...profil, balance: 0, historique: [], createdAt: new Date().toISOString() });
      } else {
        tx.set(ref, { ...snap.data(), ...profil });
      }
    }), 12000);
    return { ok: true };
  } catch (e) { return { ok: false, message: errMsg(e) }; }
}

async function deleteLivreur(lid: string, id: string): Promise<Res> {
  const ref = livDoc(lid, id);
  try {
    const r = await withTimeout(runTransaction<TxOut>(db, async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return {};
      const bal = num(snap.data().balance);
      if (Math.abs(bal) > 0.001) {
        return { erreur: `Ce livreur a ${money(bal)} sur son compte. Faites un retrait avant de le supprimer.` };
      }
      tx.delete(ref);
      return {};
    }), 12000);
    if (r.erreur) return { ok: false, message: r.erreur };
    return { ok: true };
  } catch (e) { return { ok: false, message: errMsg(e) }; }
}

async function livreurMouvement(p: {
  lid: string; id: string; montant: number; retrait: boolean; par: string; opId: string; note: string;
}): Promise<Res> {
  if (!(p.montant > 0)) return { ok: false, message: "Le montant doit être supérieur à 0." };
  const ref = livDoc(p.lid, p.id);
  try {
    const r = await withTimeout(runTransaction<TxOut>(db, async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { erreur: "Livreur introuvable." };
      const current: Raw = { ...snap.data() };
      const hist = [...histOf(current)];
      if (p.opId && hist.some(e => str(e.opId) === p.opId)) return { result: current };
      const avant = num(current.balance);
      if (p.retrait && p.montant > avant + 0.001) {
        return { erreur: `Montant supérieur au solde du livreur (${money(avant)}).` };
      }
      const apres = Number((p.retrait ? avant - p.montant : avant + p.montant).toFixed(2));
      const m2 = p.montant.toFixed(2);
      hist.push({
        type: p.retrait ? "retrait" : "depot",
        date: new Date().toISOString(),
        delta: p.retrait ? -p.montant : p.montant,
        soldeAvant: avant, soldeApres: apres,
        description: p.retrait
          ? `Retrait effectué : vous avez retiré ${m2}$, vous avez maintenant ${apres.toFixed(2)}$. Solde actuel : ${apres.toFixed(2)}$`
          : `Dépôt effectué de ${m2}$ : vous aviez ${avant.toFixed(2)}$, vous avez maintenant ${apres.toFixed(2)}$. Solde actuel : ${apres.toFixed(2)}$`,
        par: p.par,
        ...(p.note ? { note: p.note } : {}),
        opId: p.opId,
      });
      current.balance = apres;
      current.historique = hist;
      tx.set(ref, current);
      return { result: current };
    }), 12000);
    if (r.erreur) return { ok: false, message: r.erreur };
    return { ok: true };
  } catch (e) { return { ok: false, message: errMsg(e) }; }
}

/** Annulation d'une livraison : l'argent retourne au compte source (dealer ou
 *  MILLIONSTORE) dans UNE SEULE transaction. Jamais deux fois. */
async function livreurAnnule(p: {
  lid: string; id: string; billNo: string; factureId: string; isAdmin: boolean; par: string; note: string;
}): Promise<Res & { dejaAnile?: boolean }> {
  if (!p.id || !p.billNo) return { ok: false, message: "Livraison invalide." };
  const livRef = livDoc(p.lid, p.id);
  try {
    const r = await withTimeout(runTransaction<TxOut>(db, async tx => {
      const livSnap = await tx.get(livRef);
      if (!livSnap.exists()) return { erreur: "Livreur introuvable." };
      const liv: Raw = { ...livSnap.data() };
      const livHist = [...histOf(liv)];

      let idx = -1;
      for (let i = 0; i < livHist.length; i++) {
        if (memeLiv(livHist[i], "livraison", p.factureId, p.billNo)) { idx = i; break; }
      }
      if (idx === -1) return { erreur: "Cette livraison est introuvable dans l'historique du livreur." };
      const entry: Raw = { ...livHist[idx] };
      const entFact = str(entry.factureId);

      const dejaFait = entry.annule === true ||
        livHist.some(e => memeLiv(e, "annulation_livraison", p.factureId || entFact, p.billNo));
      if (dejaFait) return { result: liv, dejaAnile: true };

      if (!p.isAdmin) {
        const dt = new Date(str(entry.date));
        if (isNaN(dt.getTime()) || Date.now() - dt.getTime() > DEUX_HEURES) {
          return { erreur: "Plus de 2 h : seul un administrateur peut annuler cette livraison." };
        }
      }

      const montant = Math.abs(num(entry.delta));
      if (montant <= 0) return { erreur: "Montant de la livraison invalide." };
      const livAvant = num(liv.balance);
      if (livAvant < montant - 0.001) {
        return {
          erreur: `Le solde du livreur (${money(livAvant)}) est insuffisant pour annuler ${money(montant)}. Il a déjà retiré l'argent.`,
        };
      }

      const srcNom = str(entry.source);
      const sType = str(entry.sourceType);
      const isMS = sType ? sType === "millionstore" : srcNom === "MILLIONSTORE";
      const fKey = (str(entry.sourceKey) || srcNom).toLowerCase();
      if (!isMS && !fKey) return { erreur: "Compte source des fonds introuvable." };

      const srcRef = isMS
        ? doc(db, "locals", p.lid, "millionstore", "compte")
        : doc(db, "locals", p.lid, "fournisseurs_comptes", fKey);
      const srcSnap = await tx.get(srcRef);
      const src: Raw = srcSnap.exists()
        ? { ...srcSnap.data() }
        : (isMS ? { balance: 0, historique: [] } : { id: fKey, nom: srcNom, balance: 0, historique: [] });

      const now = new Date().toISOString();
      const livNom = str(liv.nom);
      const m2 = montant.toFixed(2);

      // Compte livreur : −montant + ligne d'origine marquée annulée
      const livApres = Number((livAvant - montant).toFixed(2));
      entry.annule = true; entry.annuleDate = now; entry.annulePar = p.par;
      livHist[idx] = entry;
      livHist.push({
        type: "annulation_livraison", date: now, delta: -montant,
        soldeAvant: livAvant, soldeApres: livApres,
        description: `Livraison annulée facture #${p.billNo} : ${m2}$ retirés, vous aviez ${livAvant.toFixed(2)}$, vous avez maintenant ${livApres.toFixed(2)}$. Solde actuel : ${livApres.toFixed(2)}$`,
        billNo: p.billNo, source: srcNom, par: p.par, factureId: entFact,
        ...(p.note ? { note: p.note } : {}),
      });
      liv.balance = livApres;
      liv.historique = livHist;

      // Compte source : +montant
      const srcAvant = num(src.balance);
      const srcApres = Number((srcAvant + montant).toFixed(2));
      const srcHist = [...histOf(src), {
        type: "annulation_livraison", date: now, delta: montant,
        soldeAvant: srcAvant, soldeApres: srcApres,
        description: `Livraison annulée facture #${p.billNo} : ${m2}$ retournés par le livreur ${livNom}, vous aviez ${srcAvant.toFixed(2)}$, vous avez maintenant ${srcApres.toFixed(2)}$. Solde actuel : ${srcApres.toFixed(2)}$`,
        billNo: p.billNo, livreurId: p.id, livreurNom: livNom, par: p.par, factureId: entFact,
        ...(p.note ? { note: p.note } : {}),
      }];
      src.balance = srcApres;
      src.historique = srcHist;

      tx.set(srcRef, src);
      tx.set(livRef, liv);
      return { result: liv, dejaAnile: false };
    }), 12000);
    if (r.erreur) return { ok: false, message: r.erreur };
    return { ok: true, dejaAnile: r.dejaAnile === true };
  } catch (e) { return { ok: false, message: errMsg(e) }; }
}

async function saveFrais(montant: number, par: string): Promise<Res> {
  if (!(montant > 0) || montant > 1000) return { ok: false, message: "Montant invalide." };
  try {
    await withTimeout(setDoc(doc(db, "parametres", "livraison"), {
      montant, updatedAt: new Date().toISOString(), updatedBy: par,
    }), 8000);
    return { ok: true };
  } catch (e) { return { ok: false, message: errMsg(e) }; }
}

// ─── 5. PETITS COMPOSANTS ────────────────────────────────────────────────────
const inputSt: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)",
  color: "#fff", fontSize: 14, outline: "none", fontFamily: "inherit",
};

function Avatar({ nom, size }: { nom: string; size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `linear-gradient(135deg, ${ACCENT}, ${BLUE})`, color: "#fff", fontWeight: 700,
      fontSize: size * 0.4, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {nom ? nom[0].toUpperCase() : "?"}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 300,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: CARD, color: "#fff", borderRadius: 20, padding: 20, width: "100%",
        maxWidth: 440, maxHeight: "92vh", overflowY: "auto", border: "1px solid rgba(255,255,255,0.08)" }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", disabled, error, inputMode, autoFocus, multiline }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean;
  error?: string | null; inputMode?: "decimal" | "tel" | "text"; autoFocus?: boolean; multiline?: boolean;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>{label}</div>
      {multiline ? (
        <textarea value={value} disabled={disabled} rows={2} maxLength={200}
          onChange={e => onChange(e.target.value)} style={{ ...inputSt, resize: "vertical" }} />
      ) : (
        <input value={value} type={type} disabled={disabled} inputMode={inputMode} autoFocus={autoFocus}
          autoComplete="off" onChange={e => onChange(e.target.value)} style={inputSt} />
      )}
      {error && <div style={{ color: RED, fontSize: 11, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

function Btn({ children, onClick, color = ACCENT, fg = "#000", disabled, outline, full }: {
  children: React.ReactNode; onClick?: () => void; color?: string; fg?: string;
  disabled?: boolean; outline?: boolean; full?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: "11px 16px", borderRadius: 12, fontWeight: 700, fontSize: 13, fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, width: full ? "100%" : undefined,
        border: outline ? `1px solid ${color}88` : "none",
        background: outline ? "transparent" : color, color: outline ? color : fg }}>
      {children}
    </button>
  );
}

/** Identité de l'opérateur : nom d'utilisateur + mot de passe (5 essais max). */
function useIdentity(expected: string) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [errUser, setErrUser] = useState<string | null>(null);
  const [errPass, setErrPass] = useState<string | null>(null);
  const attempts = useRef(0);

  const check = async (): Promise<"ok" | "fail" | "blocked"> => {
    const typed = user.trim();
    if (!typed) { setErrUser("Nom d'utilisateur obligatoire"); return "fail"; }
    if (typed.toLowerCase() !== expected.trim().toLowerCase()) {
      setErrUser("Nom d'utilisateur incorrect"); return "fail";
    }
    if (!pass) { setErrPass("Mot de passe obligatoire"); return "fail"; }
    const r = await verifyPassword(pass);
    if (!r.ok) {
      attempts.current += 1;
      if (attempts.current >= 5) return "blocked";
      setErrPass(r.message ?? "Mot de passe incorrect");
      return "fail";
    }
    return "ok";
  };

  const fields = (disabled: boolean) => (
    <>
      <Field label="Votre nom d'utilisateur (obligatoire)" value={user} disabled={disabled} error={errUser}
        onChange={v => { setUser(v); setErrUser(null); }} />
      <Field label="Mot de passe (obligatoire)" type="password" value={pass} disabled={disabled} error={errPass}
        onChange={v => { setPass(v); setErrPass(null); }} />
    </>
  );
  return { check, fields };
}

// ─── 6. FENÊTRES (MODALES) ───────────────────────────────────────────────────
function LivreurFormModal({ lid, existing, onClose, onToast }: {
  lid: string; existing: Raw | null; onClose: () => void; onToast: (m: string, c: string) => void;
}) {
  const isEdit = !!existing;
  const id = useRef(str(existing?.id) || String(Date.now()));
  const [nom, setNom] = useState(str(existing?.nom));
  const [tel, setTel] = useState(str(existing?.telephone));
  const [tel2, setTel2] = useState(str(existing?.telephone2));
  const [adr, setAdr] = useState(str(existing?.adresse));
  const [nif, setNif] = useState(str(existing?.nif));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (nom.trim().length < 2) { setErr("Entrez le nom complet du livreur."); return; }
    setBusy(true); setErr(null);
    const r = await saveLivreur(lid, {
      id: id.current, nom, telephone: tel, telephone2: tel2, adresse: adr, nif,
    });
    if (r.ok) { onToast(isEdit ? "✅ Livreur modifié !" : "✅ Livreur ajouté !", GREEN); onClose(); }
    else { setBusy(false); setErr(r.message ?? "Erreur"); }
  };

  return (
    <Overlay>
      <h2 style={{ margin: "0 0 16px", fontSize: 17 }}>{isEdit ? "Modifier le livreur" : "Nouveau livreur"}</h2>
      <Field label="Nom complet *" value={nom} onChange={setNom} disabled={busy} autoFocus />
      <Field label="Téléphone" value={tel} onChange={setTel} disabled={busy} inputMode="tel" />
      <Field label="Téléphone 2 (optionnel)" value={tel2} onChange={setTel2} disabled={busy} inputMode="tel" />
      <Field label="Adresse" value={adr} onChange={setAdr} disabled={busy} />
      <Field label="NIF / SIN" value={nif} onChange={setNif} disabled={busy} />
      {err && <p style={{ color: RED, fontSize: 12, textAlign: "center" }}>{err}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Btn outline color="#aaa" onClick={onClose} disabled={busy} full>Annuler</Btn>
        <Btn onClick={submit} disabled={busy} full>{busy ? "Enregistrement..." : "Enregistrer"}</Btn>
      </div>
    </Overlay>
  );
}

function MouvementModal({ lid, livreur, retrait, expected, par, onClose, onToast }: {
  lid: string; livreur: Raw; retrait: boolean; expected: string; par: string;
  onClose: () => void; onToast: (m: string, c: string) => void;
}) {
  const [montant, setMontant] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opId = useRef(`${Date.now()}${Math.floor(Math.random() * 1e6)}`);
  const ident = useIdentity(expected);
  const solde = balOf(livreur);
  const color = retrait ? RED : GREEN;

  const submit = async () => {
    if (busy) return;
    const v = parseFloat(montant.trim().replace(",", "."));
    if (!isFinite(v) || v <= 0) { setErr("Entrez un montant valide."); return; }
    const m = Number(v.toFixed(2));
    if (m > 1000000) { setErr("Montant trop élevé."); return; }
    if (retrait && m > solde + 0.001) { setErr("Dépasse le solde du livreur."); return; }
    setBusy(true);
    const c = await ident.check();
    if (c === "blocked") { onToast("Trop de tentatives. Action annulée.", RED); onClose(); return; }
    if (c !== "ok") { setBusy(false); return; }
    const r = await livreurMouvement({
      lid, id: str(livreur.id), montant: m, retrait, par, opId: opId.current,
      note: note.replace(/\s+/g, " ").trim().slice(0, 200),
    });
    if (r.ok) { onToast(`✅ ${retrait ? "Retrait" : "Dépôt"} effectué !`, GREEN); onClose(); }
    else { setBusy(false); setErr(r.message ?? "Erreur"); }
  };

  return (
    <Overlay>
      <h2 style={{ margin: "0 0 6px", fontSize: 17, color }}>{retrait ? "⬆️ Retrait" : "⬇️ Dépôt"}</h2>
      <p style={{ margin: "0 0 4px", color: "rgba(255,255,255,0.7)", fontSize: 13 }}>{str(livreur.nom)}</p>
      <p style={{ margin: "0 0 14px", color: ACCENT, fontWeight: 700, fontSize: 13 }}>Solde actuel : {money(solde)}</p>
      <Field label="Montant ($)" value={montant} onChange={v => { setMontant(v); setErr(null); }}
        disabled={busy} inputMode="decimal" autoFocus error={err} />
      {ident.fields(busy)}
      <Field label="Note (optionnel)" value={note} onChange={setNote} disabled={busy} multiline />
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Btn outline color="#aaa" onClick={onClose} disabled={busy} full>Annuler</Btn>
        <Btn color={color} fg={retrait ? "#fff" : "#000"} onClick={submit} disabled={busy} full>
          {busy ? "..." : retrait ? "Confirmer le retrait" : "Confirmer le dépôt"}
        </Btn>
      </div>
    </Overlay>
  );
}

function FraisModal({ actuel, expected, par, onClose, onSaved, onToast }: {
  actuel: number; expected: string; par: string; onClose: () => void;
  onSaved: (m: number) => void; onToast: (m: string, c: string) => void;
}) {
  const [montant, setMontant] = useState(actuel.toFixed(2));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ident = useIdentity(expected);

  const submit = async () => {
    if (busy) return;
    const v = parseFloat(montant.trim().replace(",", "."));
    if (!isFinite(v) || v <= 0 || v > 1000) { setErr("Entrez un montant valide."); return; }
    const m = Number(v.toFixed(2));
    setBusy(true);
    const c = await ident.check();
    if (c === "blocked") { onToast("Trop de tentatives. Action annulée.", RED); onClose(); return; }
    if (c !== "ok") { setBusy(false); return; }
    const r = await saveFrais(m, par);
    if (r.ok) { onSaved(m); onToast(`✅ Frais de livraison : ${money(m)}`, GREEN); onClose(); }
    else { setBusy(false); setErr(r.message ?? "Erreur"); }
  };

  return (
    <Overlay>
      <h2 style={{ margin: "0 0 6px", fontSize: 17, color: GOLD }}>🏷️ Frais de livraison</h2>
      <p style={{ margin: "0 0 14px", color: "rgba(255,255,255,0.6)", fontSize: 12.5 }}>
        Frais actuel : {money(actuel)}. Les anciennes livraisons ne changent pas.
      </p>
      <Field label="Nouveau montant ($)" value={montant} onChange={v => { setMontant(v); setErr(null); }}
        disabled={busy} inputMode="decimal" autoFocus error={err} />
      {ident.fields(busy)}
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Btn outline color="#aaa" onClick={onClose} disabled={busy} full>Annuler</Btn>
        <Btn color={GOLD} onClick={submit} disabled={busy} full>{busy ? "..." : "Enregistrer"}</Btn>
      </div>
    </Overlay>
  );
}

function AnnulerModal({ lid, livreur, h, expected, isAdmin, peutAnnuler, par, onClose, onToast }: {
  lid: string; livreur: Raw; h: Raw; expected: string; isAdmin: boolean; par: string;
  peutAnnuler: (h: Raw) => boolean; onClose: () => void; onToast: (m: string, c: string) => void;
}) {
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ident = useIdentity(expected);
  const billNo = str(h.billNo);
  const montant = Math.abs(num(h.delta));
  const source = str(h.source);

  const submit = async () => {
    if (busy || !checked) return;
    setBusy(true);
    const c = await ident.check();
    if (c === "blocked") { onToast("Trop de tentatives. Action annulée.", RED); onClose(); return; }
    if (c !== "ok") { setBusy(false); return; }
    if (!peutAnnuler(h)) {
      onToast("❌ Délai de 2 h dépassé : seul un administrateur peut annuler.", RED); onClose(); return;
    }
    const r = await livreurAnnule({
      lid, id: str(livreur.id), billNo, factureId: str(h.factureId), isAdmin, par,
      note: note.replace(/\s+/g, " ").trim().slice(0, 200),
    });
    if (r.ok) {
      onToast(r.dejaAnile ? "ℹ️ Cette livraison était déjà annulée." : `✅ Livraison #${billNo} annulée !`, GREEN);
      onClose();
    } else { setBusy(false); setErr(r.message ?? "Erreur"); }
  };

  return (
    <Overlay>
      <h2 style={{ margin: "0 0 10px", fontSize: 17, color: GOLD }}>↩️ Annuler la livraison ?</h2>
      <p style={{ margin: "0 0 10px", fontWeight: 700 }}>Facture #{billNo}</p>
      <div style={{ background: `${GOLD}14`, border: `1px solid ${GOLD}4d`, borderRadius: 10, padding: 10,
        fontSize: 12.5, color: "rgba(255,255,255,0.75)", marginBottom: 10 }}>
        {money(montant)} seront retirés du compte de {str(livreur.nom)} et retournés{" "}
        {source ? `sur le compte de ${source}` : "sur le compte source"}.
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, marginBottom: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)}
          style={{ marginTop: 2 }} />
        <span>Je confirme que cette livraison n&apos;a pas été effectuée.</span>
      </label>
      {ident.fields(busy)}
      <Field label="Note (optionnel)" value={note} onChange={setNote} disabled={busy} multiline />
      {err && <p style={{ color: RED, fontSize: 12, textAlign: "center" }}>{err}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Btn outline color="#aaa" onClick={onClose} disabled={busy} full>Non</Btn>
        <Btn color={RED} fg="#fff" onClick={submit} disabled={busy || !checked} full>
          {busy ? "..." : "Oui, annuler"}
        </Btn>
      </div>
    </Overlay>
  );
}

function SupprimerModal({ lid, livreur, onClose, onDeleted, onToast }: {
  lid: string; livreur: Raw; onClose: () => void; onDeleted: () => void;
  onToast: (m: string, c: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const r = await deleteLivreur(lid, str(livreur.id));
    if (r.ok) { onToast("✅ Livreur supprimé !", GREEN); onDeleted(); }
    else { onToast(`❌ ${r.message ?? "Erreur"}`, RED); setBusy(false); onClose(); }
  };
  return (
    <Overlay>
      <h2 style={{ margin: "0 0 10px", fontSize: 17, color: RED }}>🗑️ Supprimer le livreur ?</h2>
      <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 13.5, lineHeight: 1.5 }}>
        {str(livreur.nom)} sera supprimé définitivement. Le solde doit être à 0 $.
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <Btn outline color="#aaa" onClick={onClose} disabled={busy} full>Non</Btn>
        <Btn color={RED} fg="#fff" onClick={go} disabled={busy} full>{busy ? "..." : "Oui, supprimer"}</Btn>
      </div>
    </Overlay>
  );
}

// ─── 7. PAGE ─────────────────────────────────────────────────────────────────
export default function LivraisonPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [locals, setLocals] = useState<{ id: string; name: string }[]>([]);
  const [lid, setLid] = useState("");
  const [livreurs, setLivreurs] = useState<Raw[]>([]);
  const [loading, setLoading] = useState(true);
  const [frais, setFrais] = useState(DEFAULT_FRAIS);
  const [q, setQ] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formFor, setFormFor] = useState<{ existing: Raw | null } | null>(null);
  const [mouv, setMouv] = useState<{ retrait: boolean } | null>(null);
  const [fraisOpen, setFraisOpen] = useState(false);
  const [annuler, setAnnuler] = useState<Raw | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const [, setTick] = useState(0);

  const showToast = (msg: string, color: string) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3000);
  };

  const perms = user?.permissions ?? {};
  const isAdmin = !!user?.isAdmin;
  const canView = !!user && (isAdmin || perms.livreurVoir === true);
  const canAdd = isAdmin || perms.livreurAjoute === true;
  const canEdit = isAdmin || perms.livreurModifye === true;
  const canDepot = isAdmin || perms.livreurDepot === true;
  const canRetrait = isAdmin || perms.livreurRetrait === true;
  const canDelete = isAdmin || perms.livreurSiprime === true;
  const actor = user ? (str(user.username) || str(user.displayName)) : "";
  const par = user ? (str(user.displayName) || actor) : "";

  // ─── AUTH + LOCAUX ─────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const s = JSON.parse(raw) as UserSession;
      setUser(s);
      if (s.localId && s.localId !== "all") { setLid(s.localId); return; }
      withTimeout(getDocs(collection(db, "locals")), 10000).then(snap => {
        const list = snap.docs.filter(d => d.id !== "all")
          .map(d => ({ id: d.id, name: (d.data().name as string) ?? d.id }));
        setLocals(list);
        if (list.length > 0) setLid(list[0].id); else setLoading(false);
      }).catch(() => setLoading(false));
    } catch { router.push("/login"); }
  }, [router]);

  // Rafraîchit le décompte des 2 h toutes les 30 s
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // ─── DONNÉES EN DIRECT ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !lid || !canView) { if (user && !canView) setLoading(false); return; }
    setLoading(true); setDetailId(null);
    const unsub = onSnapshot(livCol(lid), snap => {
      const list = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Raw);
      list.sort((a, b) => str(a.nom).toLowerCase().localeCompare(str(b.nom).toLowerCase()));
      setLivreurs(list);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [user, lid, canView]);

  useEffect(() => {
    if (!user || !canView) return;
    getDoc(doc(db, "parametres", "livraison")).then(s => {
      const m = Number(s.data()?.montant);
      if (isFinite(m) && m >= 0 && s.exists()) setFrais(m);
    }).catch(() => {});
  }, [user, canView]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return livreurs;
    return livreurs.filter(l =>
      `${l.nom} ${l.telephone} ${l.telephone2} ${l.adresse} ${l.nif}`.toLowerCase().includes(needle));
  }, [livreurs, q]);

  const detail = detailId ? livreurs.find(l => str(l.id) === detailId) ?? null : null;

  if (!user) return null;

  const peutAnnuler = (h: Raw) => {
    if (h.type !== "livraison" || h.annule === true) return false;
    if (isAdmin) return true;
    if (perms.livreurRetrait !== true) return false;
    const d = new Date(str(h.date));
    return !isNaN(d.getTime()) && Date.now() - d.getTime() <= DEUX_HEURES;
  };

  const shell = (children: React.ReactNode) => (
    <main style={{ minHeight: "100vh", background: BG, fontFamily: "'Segoe UI',sans-serif", color: "#fff" }}>
      <div style={{ borderBottom: "1px solid #1e1e2e", padding: "14px 20px", display: "flex",
        alignItems: "center", gap: 12, position: "sticky", top: 0, background: CARD, zIndex: 50 }}>
        <button onClick={() => (detail ? setDetailId(null) : router.push("/dashboard"))} title="Retour"
          style={{ background: "#1A1D2E", border: "none", color: "#aaa", width: 36, height: 36,
            borderRadius: 10, cursor: "pointer", fontSize: 16 }}>←</button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, flex: 1 }}>
          {detail ? str(detail.nom) : "Livraison"}
        </h1>
        {!detail && isAdmin && (
          <button onClick={() => setFraisOpen(true)} title={`Frais de livraison (${money(frais)})`}
            style={{ background: `${GOLD}22`, border: `1px solid ${GOLD}66`, color: GOLD, borderRadius: 10,
              padding: "7px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
            🏷️ Frais : {money(frais)}
          </button>
        )}
        {detail && canEdit && (
          <button onClick={() => setFormFor({ existing: detail })} title="Modifier"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>✏️</button>
        )}
        {detail && canDelete && (
          <button onClick={() => setDelOpen(true)} title="Supprimer"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>🗑️</button>
        )}
      </div>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "16px 14px 100px" }}>{children}</div>

      {formFor && lid && (
        <LivreurFormModal lid={lid} existing={formFor.existing} onClose={() => setFormFor(null)} onToast={showToast} />
      )}
      {mouv && detail && (
        <MouvementModal lid={lid} livreur={detail} retrait={mouv.retrait} expected={actor} par={par}
          onClose={() => setMouv(null)} onToast={showToast} />
      )}
      {fraisOpen && (
        <FraisModal actuel={frais} expected={actor} par={par} onClose={() => setFraisOpen(false)}
          onSaved={setFrais} onToast={showToast} />
      )}
      {annuler && detail && (
        <AnnulerModal lid={lid} livreur={detail} h={annuler} expected={actor} isAdmin={isAdmin} par={par}
          peutAnnuler={peutAnnuler} onClose={() => setAnnuler(null)} onToast={showToast} />
      )}
      {delOpen && detail && (
        <SupprimerModal lid={lid} livreur={detail} onClose={() => setDelOpen(false)}
          onDeleted={() => { setDelOpen(false); setDetailId(null); }} onToast={showToast} />
      )}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: toast.color, color: toast.color === GREEN ? "#000" : "#fff", padding: "10px 20px",
          borderRadius: 12, fontWeight: 700, zIndex: 999, fontSize: 13, maxWidth: "90vw", textAlign: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}>{toast.msg}</div>
      )}
    </main>
  );

  if (!canView) {
    return shell(
      <p style={{ textAlign: "center", color: "rgba(255,255,255,0.55)", padding: "60px 0" }}>
        🔒 Vous n&apos;avez pas accès à cette page.
      </p>
    );
  }

  // ─── VUE DÉTAIL D'UN LIVREUR ───────────────────────────────────────────
  if (detail) {
    const nom = str(detail.nom);
    const bal = balOf(detail);
    const hist = [...histOf(detail)].sort((a, b) => str(b.date).localeCompare(str(a.date)));
    const livs = hist.filter(h => h.type === "livraison" && h.annule !== true);
    const totalLiv = livs.reduce((s, h) => s + num(h.delta), 0);

    const infoRow = (icon: string, label: string, value: string) => (
      <div style={{ display: "flex", gap: 8, padding: "5px 0", fontSize: 13 }}>
        <span>{icon}</span>
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{label} :</span>
        <span style={{ fontWeight: 600, color: value ? "#fff" : "rgba(255,255,255,0.25)" }}>
          {value || "Non renseigné"}
        </span>
      </div>
    );
    const statBox = (v: string, l: string, icon: string, c: string) => (
      <div style={{ flex: 1, background: `${c}14`, border: `1px solid ${c}33`, borderRadius: 14,
        padding: "12px 10px", textAlign: "center" }}>
        <div>{icon}</div>
        <div style={{ color: c, fontWeight: 700, fontSize: 15 }}>{v}</div>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>{l}</div>
      </div>
    );

    return shell(
      <>
        <div style={{ background: `linear-gradient(135deg, #00BFA5, #0277BD)`, borderRadius: 22,
          padding: 18, textAlign: "center", boxShadow: `0 8px 18px ${ACCENT}40` }}>
          <div style={{ display: "flex", justifyContent: "center" }}><Avatar nom={nom} size={60} /></div>
          <div style={{ fontWeight: 700, fontSize: 17, marginTop: 8 }}>{nom}</div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 10, letterSpacing: 1.2, marginTop: 12 }}>
            SOLDE ACTUEL
          </div>
          <div style={{ fontWeight: 700, fontSize: 34 }}>{money(bal)}</div>
          {(canDepot || canRetrait) && (
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              {canRetrait && <Btn color={RED} fg="#fff" full onClick={() => setMouv({ retrait: true })}>⬆️ Retrait</Btn>}
              {canDepot && <Btn color={GREEN} full onClick={() => setMouv({ retrait: false })}>⬇️ Dépôt</Btn>}
            </div>
          )}
        </div>

        <div style={{ background: CARD, borderRadius: 18, padding: 14, marginTop: 14,
          border: "1px solid rgba(255,255,255,0.06)" }}>
          {infoRow("👤", "Nom complet", nom)}
          {infoRow("📱", "Téléphone", str(detail.telephone))}
          {infoRow("📞", "Téléphone 2", str(detail.telephone2))}
          {infoRow("📍", "Adresse", str(detail.adresse))}
          {infoRow("🪪", "NIF / SIN", str(detail.nif))}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          {statBox(String(livs.length), "Livraisons", "🚚", BLUE)}
          {statBox(money(totalLiv), "Total des livraisons", "💰", GOLD)}
        </div>

        <div style={{ display: "flex", alignItems: "center", margin: "20px 0 10px" }}>
          <b style={{ fontSize: 13, flex: 1 }}>🧾 Relevé du compte</b>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>{hist.length} mouvement(s)</span>
        </div>

        {hist.length === 0 && (
          <p style={{ textAlign: "center", color: "rgba(255,255,255,0.35)", padding: "40px 0" }}>Aucun mouvement</p>
        )}
        {hist.map((h, i) => {
          const type = str(h.type);
          const delta = num(h.delta);
          const annule = h.annule === true;
          const [icon, color] =
            type === "livraison" ? ["🛵", annule ? "rgba(255,255,255,0.38)" : ACCENT]
            : type === "annulation_livraison" ? ["↩️", GOLD]
            : type === "depot" ? ["⬇️", GREEN]
            : type === "retrait" ? ["⬆️", RED]
            : ["🧾", "rgba(255,255,255,0.54)"];
          const details = [
            str(h.source) && `Source : ${str(h.source)}`,
            str(h.clientNom) && `Client : ${str(h.clientNom)}`,
            str(h.vendeurNom) && `Vendeur : ${str(h.vendeurNom)}`,
            str(h.cashier) && `Caissier : ${str(h.cashier)}`,
            str(h.par) && `Par : ${str(h.par)}`,
            str(h.note) && `Note : ${str(h.note)}`,
          ].filter(Boolean) as string[];
          const peut = peutAnnuler(h);
          let delai: string | null = null;
          if (type === "livraison" && !annule && !isAdmin && perms.livreurRetrait === true) {
            const dt = new Date(str(h.date));
            if (!isNaN(dt.getTime())) {
              const reste = DEUX_HEURES - (Date.now() - dt.getTime());
              delai = reste < 0 ? "Plus de 2 h : seul un administrateur peut annuler"
                : `Annulation possible encore ${Math.floor(reste / 60000)} min`;
            }
          }
          return (
            <div key={`${str(h.opId)}${str(h.date)}${i}`} style={{ background: CARD, borderRadius: 14, padding: 12,
              marginBottom: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {annule && (
                    <span style={{ background: `${RED}26`, color: RED, fontSize: 9, fontWeight: 700,
                      padding: "2px 6px", borderRadius: 5 }}>ANNULÉ</span>
                  )}
                  <div style={{ fontSize: 12.5, lineHeight: 1.3, color: annule ? "rgba(255,255,255,0.38)" : "#fff" }}>
                    {str(h.description) || type}
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10, marginTop: 4 }}>
                    🕐 {fmtDate(h.date)}{str(h.billNo) && `  •  #${str(h.billNo)}`}
                  </div>
                </div>
                <b style={{ fontSize: 13, whiteSpace: "nowrap",
                  color: annule ? "rgba(255,255,255,0.3)" : delta >= 0 ? GREEN : RED,
                  textDecoration: annule ? "line-through" : "none" }}>
                  {delta >= 0 ? "+" : ""}{money(delta)}
                </b>
              </div>
              {details.length > 0 && (
                <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: 8, marginTop: 8,
                  color: "rgba(255,255,255,0.55)", fontSize: 11 }}>{details.join("  •  ")}</div>
              )}
              {peut && (
                <div style={{ marginTop: 10 }}>
                  <Btn outline color={RED} full onClick={() => setAnnuler(h)}>↩️ Annuler cette livraison</Btn>
                </div>
              )}
              {delai && <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 11, marginTop: 8 }}>{delai}</div>}
            </div>
          );
        })}
      </>
    );
  }

  // ─── VUE LISTE ─────────────────────────────────────────────────────────
  const totalBal = livreurs.reduce((s, l) => s + balOf(l), 0);
  const nbLiv = livreurs.reduce((s, l) =>
    s + histOf(l).filter(h => h.type === "livraison" && h.annule !== true).length, 0);

  return shell(
    <>
      {isAdmin && locals.length > 1 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 14 }}>
          {locals.map(l => (
            <button key={l.id} onClick={() => setLid(l.id)}
              style={{ padding: "6px 14px", borderRadius: 20, cursor: "pointer", border: "none", fontSize: 12,
                fontWeight: 700, whiteSpace: "nowrap", background: lid === l.id ? ACCENT : `${ACCENT}22`,
                color: lid === l.id ? "#000" : ACCENT }}>{l.name}</button>
          ))}
        </div>
      )}

      <div style={{ background: "linear-gradient(135deg, #00BFA5, #0277BD)", borderRadius: 22, padding: 18,
        marginBottom: 14, boxShadow: `0 8px 18px ${ACCENT}40` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.18)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🛵</span>
          <b style={{ letterSpacing: 1.5, fontSize: 16 }}>LIVRAISON</b>
        </div>
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 10, letterSpacing: 1.2 }}>SOLDE TOTAL DES LIVREURS</div>
          <div style={{ fontWeight: 700, fontSize: 32, marginTop: 4 }}>{money(totalBal)}</div>
        </div>
        <div style={{ display: "flex", marginTop: 14, textAlign: "center" }}>
          <div style={{ flex: 1 }}><b style={{ fontSize: 16 }}>{livreurs.length}</b>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 10 }}>Livreurs</div></div>
          <div style={{ width: 1, background: "rgba(255,255,255,0.25)" }} />
          <div style={{ flex: 1 }}><b style={{ fontSize: 16 }}>{nbLiv}</b>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 10 }}>Livraisons</div></div>
        </div>
      </div>

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un livreur..."
        style={{ ...inputSt, background: CARD, marginBottom: 14, padding: "13px 16px" }} />

      {loading ? (
        <p style={{ textAlign: "center", color: "rgba(255,255,255,0.4)", padding: 40 }}>Chargement...</p>
      ) : list.length === 0 ? (
        <div style={{ textAlign: "center", padding: "50px 0", color: "rgba(255,255,255,0.38)" }}>
          <div style={{ fontSize: 56, opacity: 0.4 }}>🛵</div>
          {q ? "Aucun résultat" : "Aucun livreur pour le moment"}
        </div>
      ) : list.map(l => {
        const nom = str(l.nom);
        const bal = balOf(l);
        const infos = [["📱", l.telephone], ["📞", l.telephone2], ["📍", l.adresse], ["🪪", l.nif]]
          .filter(([, v]) => str(v));
        return (
          <div key={str(l.id)} onClick={() => setDetailId(str(l.id))}
            style={{ background: CARD, borderRadius: 18, padding: 14, marginBottom: 10, cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar nom={nom} size={48} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap" }}>{nom}</div>
              {infos.map(([ic, v], i) => (
                <div key={i} style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 3,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ic} {str(v)}</div>
              ))}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: bal >= 0 ? GREEN : RED, fontWeight: 700, fontSize: 16 }}>{money(bal)}</div>
              <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>solde</div>
            </div>
            <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 20 }}>›</span>
          </div>
        );
      })}

      {canAdd && (
        <button onClick={() => setFormFor({ existing: null })}
          style={{ position: "fixed", bottom: 24, right: 24, background: ACCENT, color: "#000", border: "none",
            borderRadius: 28, padding: "14px 22px", fontWeight: 700, fontSize: 14, cursor: "pointer",
            boxShadow: `0 6px 18px ${ACCENT}66`, zIndex: 60 }}>
          ➕ Ajouter
        </button>
      )}
    </>
  );
}