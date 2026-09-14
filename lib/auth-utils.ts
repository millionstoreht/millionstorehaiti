// ══════════════════════════════════════════════════════════════════════════
// auth-utils.ts
// Fonksyon hachaj pataje pou tout paj (login, register, reset).
// ⚠️ IMPÒTAN: menm eskèm egzat ak Flutter AuthService (sha256(valè + sèl)),
// pou yon kont kreye sou web la ka konekte sou Flutter, e vis vèsa.
// ══════════════════════════════════════════════════════════════════════════
import { doc, getDoc, updateDoc } from "firebase/firestore";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { db, auth } from "./firebase";

/** ⚠️ Sèl legacy — sèvi SÈLMAN pou verifye ansyen kont. Pa janm itilize l
 *  pou kreye oswa chanje yon modpas nouvo. */
export const LEGACY_SALT = "_millionstore_2024_sel";

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Jenere yon sèl inik, kriptografikman solid, pou chak itilizatè. */
export function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Hache yon modpas ak yon sèl OBLIGATWA. */
export async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256Hex(password + salt);
}

/** Verifye yon modpas kont valè ki estoke a — sipòte sèl pwòp itilizatè a,
 *  ansyen sèl global la (konpatibilite), ak ansyen tèks klè. */
export async function verifyPassword(
  plain: string,
  stored: string,
  salt?: string
): Promise<boolean> {
  if (stored.length === 64) {
    if (salt && (await hashPassword(plain, salt)) === stored) return true;
    return (await hashPassword(plain, LEGACY_SALT)) === stored;
  }
  return plain === stored;
}

/** Tcheke si yon modpas estoke bezwen rehachaj (migrasyon sekirite). */
export function passwordNeedsRehash(stored: string, salt?: string): boolean {
  if (stored.length !== 64) return true; // tèks klè
  if (!salt) return true; // ansyen sèl global
  return false;
}

/** Hache yon repons kesyon sekirite (normalize: retire espas, miniskil)
 *  ak sèl itilizatè a. */
export async function hashSecurityAnswer(answer: string, salt: string): Promise<string> {
  const normalized = answer.trim().toLowerCase();
  return sha256Hex(normalized + salt);
}

/** Verifye yon repons kesyon sekirite — sipòte repons hache (ak sèl) ak
 *  ansyen repons tèks klè. */
export async function verifySecurityAnswer(
  plain: string,
  stored: string,
  salt?: string
): Promise<boolean> {
  const normalized = plain.trim().toLowerCase();
  if (stored.length === 64 && salt) {
    if ((await hashSecurityAnswer(plain, salt)) === stored) return true;
  }
  return stored === normalized;
}

/** Si repons kesyon sekirite yo toujou tèks klè, retounen yon vèsyon hache
 *  ak nouvo sèl la. Retounen null si pa gen chanjman pou fè. */
export async function upgradeSecurityQuestionsIfNeeded(
  salt: string,
  questions: Record<string, unknown> | undefined | null
): Promise<Record<string, string> | null> {
  if (!questions || !salt) return null;
  let changed = false;
  const updated: Record<string, string> = {};
  for (const key of ["rep1", "rep2", "rep3"] as const) {
    const val = (questions[key] ?? "").toString();
    if (val && val.length !== 64) {
      updated[key] = await hashSecurityAnswer(val, salt);
      changed = true;
    } else {
      updated[key] = val;
    }
  }
  return changed ? updated : null;
}

/** Rele fonksyon sa a chak fwa yon login (Firestore) reyisi. Li kreye/
 *  konekte an silans yon kont Firebase Auth pou itilizatè a
 *  ({username}@millionstore.com) — pa modpas reyèl la ki sèvi kòm modpas
 *  Auth, men yon valè derive ki depann sèlman sou modpas la (pa sou sèl
 *  Firestore aktyèl la), pou l rete estab pandan migrasyon an.
 *  ⚠️ Menm lojik egzat ak AuthService.provisionFirebaseIdentity nan Flutter. */
export async function provisionFirebaseIdentity(
  username: string,
  password: string
): Promise<void> {
  const email = `${username}@millionstore.com`;
  const derivedPassword = (await hashPassword(password, LEGACY_SALT)).substring(0, 20);
  try {
    await signInWithEmailAndPassword(auth, email, derivedPassword);
  } catch (e: any) {
    if (e?.code === "auth/user-not-found" || e?.code === "auth/invalid-credential") {
      try {
        await createUserWithEmailAndPassword(auth, email, derivedPassword);
      } catch {
        // Silans — pwovizyon se yon etap tranzisyon, pa yon bagay ki dwe
        // bloke login aktyèl la.
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// PREZANS — "sou liy" / "pa sou liy" (menm lojik ak AuthService.dart)
// ══════════════════════════════════════════════════════════════════════════

/** Konbyen tan san aktivite anvan nou konsidere yon itilizatè "pa sou liy".
 *  ⚠️ Dwe rete menm valè ak `AuthService.onlineThreshold` nan Flutter la. */
export const ONLINE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minit

/** Rele fonksyon sa a regilyèman (pa egzanp chak 45 segonn) pandan
 *  itilizatè a gen Dashboard web la louvri, pou estati "sou liy" la rete
 *  kòrèk pou moun k ap itilize sit la (pa sèlman Flutter la). */
export async function touchPresence(username: string): Promise<void> {
  if (!username) return;
  try {
    const ref  = doc(db, "users", username);
    const now  = new Date();
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : null;
    const lastSeenStr = data?.lastSeen as string | undefined;
    const lastSeen = lastSeenStr ? new Date(lastSeenStr) : null;
    const wasOffline = !lastSeen || now.getTime() - lastSeen.getTime() > ONLINE_THRESHOLD_MS;

    const update: Record<string, string> = { lastSeen: now.toISOString() };
    if (wasOffline) {
      update.onlineSince = now.toISOString();
    }
    await updateDoc(ref, update);
  } catch {
    // Silans — prezans se yon amelyorasyon, pa yon bagay ki dwe kraze UI a
  }
}