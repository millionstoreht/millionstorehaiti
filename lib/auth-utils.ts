// ══════════════════════════════════════════════════════════════════════════
// auth-utils.ts
// ✅ Firebase Auth (email + mot de passe réel) gère l'authentification et
// la réinitialisation de mot de passe directement — aucun hachage ni
// dérivation personnalisée n'est nécessaire ici. La seule chose partagée
// entre les pages reste la présence (« en ligne » / « hors ligne »).
// ══════════════════════════════════════════════════════════════════════════
import { doc, getDoc, updateDoc } from "firebase/firestore";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { db, auth } from "./firebase";

/** ✅ Change le mot de passe de l'utilisateur connecté. Firebase exige une
 *  ré-authentification récente pour cette opération sensible — on la fait
 *  avec l'ancien mot de passe avant de passer au nouveau. */
export async function changeOwnPassword(
  oldPassword: string,
  newPassword: string
): Promise<{ success: boolean; message?: string }> {
  const user = auth.currentUser;
  if (!user || !user.email) {
    return { success: false, message: "Aucune session active." };
  }
  try {
    const cred = EmailAuthProvider.credential(user.email, oldPassword);
    try {
      await reauthenticateWithCredential(user, cred);
    } catch (e: any) {
      if (e?.code === "auth/wrong-password" || e?.code === "auth/invalid-credential") {
        return { success: false, message: "L'ancien mot de passe est incorrect." };
      }
      return { success: false, message: "Erreur de vérification. Réessayez." };
    }
    await updatePassword(user, newPassword);
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e?.message ?? "Erreur. Veuillez réessayer." };
  }
}

// ══════════════════════════════════════════════════════════════════════════
// PRÉSENCE — « en ligne » / « hors ligne » (même logique que AuthService.dart)
// ══════════════════════════════════════════════════════════════════════════

/** Durée d'inactivité au-delà de laquelle un utilisateur est considéré
 *  "hors ligne". */
export const ONLINE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

/** À appeler régulièrement (par ex. toutes les 45 secondes) pendant qu'un
 *  utilisateur a le Dashboard web ouvert, pour que son statut "en ligne"
 *  reste correct — y compris pour les utilisateurs connectés via Flutter. */
export async function touchPresence(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const ref = doc(db, "users", uid);
    const now = new Date();
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
    // Silence — la présence est une amélioration, pas quelque chose qui
    // doit bloquer l'interface.
  }
}

// ══════════════════════════════════════════════════════════════════════════
// PÈMISYON DEFO POU NOUVO KONT — menm valè ak UserPermissions.defaultPerms() Flutter
// ══════════════════════════════════════════════════════════════════════════
export const DEFAULT_LOCAL_ID = "1773629612385";

export const DEFAULT_PERMISSIONS: Record<string, boolean> = {
  produitVoir: false, produitAjoute: false, produitModifye: false, produitSiprime: false, produitChangePrix: false, produitVoirStockVid: false,
  commandeVoir: false, commandeConfirme: false, commandeLivraison: false, commandeLivre: false, commandeAnile: false, commandeSiprime: false,
  studioVoir: false,
  factureVoir: false, factureCreye: false, factureVoirIstwa: false, factureAnile: false, factureSiprime: false, factureModifye: false,
  clientVoir: false, clientAjoute: false, clientModifye: false, clientSiprime: false,
  rapportVoir: false, rapportEksporte: false, rapportAnile: false, rapportSiprime: false,
  utilisateurVoir: false, utilisateurAjoute: false, utilisateurModifye: false, utilisateurSiprime: false, utilisateurBloke: false, utilisateurDebloke: false,
  localVoir: false, localAjoute: false, localModifye: false, localSiprime: false,
  workersVoir: false, workersAjoute: false, workersModifye: false, workersSiprime: false,
  fournisseurVoir: false, fournisseurAjoute: false, fournisseurModifye: false, fournisseurSiprime: false,
  ficheVoir: false, ficheRapo: false, ficheIstwa: false, ficheAjouteKliyan: false, ficheModifyeKliyan: false, ficheSiprimeKliyan: false,
  ficheAjoutePwodwi: false, ficheModifyePwodwi: false, ficheSiprimePwodwi: false,
  cameraVoir: false, cameraAjoute: false, cameraModifye: false, cameraSiprime: false,
  noteVoir: true, noteAjoute: true, noteModifye: false, noteSiprime: false,
  imprimanteVoir: false, imprimanteAjoute: false, imprimanteModifye: false, imprimanteSiprime: false,
  callingVoir: false, callingAjouteText: false, callingSiprimeText: false, callingModifyeText: false, callingFeApel: false, callingFeVideo: false,
  vendeurVoir: true, vendeurAjoute: false, vendeurModifye: false, vendeurSiprime: false,
  parametreVoir: true, parametreModifye: false, parametreChanje: false, parametreSiprime: false,
  bracVoir: false, bracAjoute: false, bracModifye: false, bracSiprime: false, bracVoirRapport: false, bracVoirIstwa: false,
  techVoir: false, techAjoute: false, techModifye: false, techSiprime: false,
  notepapVoir: true, notepapAjoute: true, notepapSiprime: false,
  printerAcces: false, parametreAcces: false, ficheAcces: false, cameraAcces: false,
};