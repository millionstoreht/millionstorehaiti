"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import {
  collection, doc, getDoc, getDocs, setDoc, onSnapshot, runTransaction, serverTimestamp,
} from "firebase/firestore";

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface UserSession {
  username: string; displayName: string;
  isAdmin: boolean; localId: string;
  permissions: Record<string, boolean>;
}
interface Product {
  id: string; marque?: string; modele?: string; description?: string;
  nomDealer?: string; prixDealer?: number; stock?: number; isDeleted?: boolean;
}
interface Hist {
  type: string; date: string; delta: number;
  description?: string; soldeAvant?: number; soldeApres?: number;
  billNo?: string; productId?: string; marque?: string; modele?: string;
  categorie?: string; qty?: number; produitDescription?: string;
  clientNom?: string; vendeurNom?: string; cashier?: string;
  parAdmin?: string; opId?: string; venteDate?: string;
}
interface Compte { id: string; nom: string; balance: number; historique: Hist[]; }

// ─── COLORS ──────────────────────────────────────────────────────────────────
const C = {
  dark: "#0A0C14", card: "#141828", accent: "#FF6B35",
  green: "#00E676", red: "#FF5252", gold: "#FFD740", blue: "#448AFF",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

const fmtDateHeure = (raw?: string) => {
  if (!raw) return "";
  const dt = new Date(raw);
  if (isNaN(dt.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}  ${p(dt.getHours())}:${p(dt.getMinutes())}`;
};

/** Disponib (15j+) ak an atant. Retrait/Dépôt konte touswit.
 *  Annilasyon konte depi dat vant orijinal la (venteDate). */
function calcDisponibleEtAtente(c: { historique?: Hist[] }) {
  const now = Date.now();
  let disponible = 0, enAttente = 0;
  for (const e of c.historique ?? []) {
    const type = e.type ?? "";
    const delta = Number(e.delta ?? 0);
    if (type === "retrait" || type === "depot") { disponible += delta; continue; }
    const ref = type === "annulation" ? (e.venteDate ?? e.date) : e.date;
    const dt = ref ? new Date(ref).getTime() : NaN;
    if (isNaN(dt) || (now - dt) / 86400000 >= 15) disponible += delta;
    else enAttente += delta;
  }
  return { disponible: r2(disponible), enAttente: r2(enAttente) };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function FournisseursPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [locals, setLocals] = useState<{ id: string; name: string }[]>([]);
  const [lid, setLid] = useState<string>("");
  const [comptes, setComptes] = useState<Compte[]>([]);
  const [ms, setMs] = useState<Compte>({ id: "ms", nom: "MILLIONSTORE", balance: 0, historique: [] });
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [detailKey, setDetailKey] = useState<string | null>(null); // key founisè, oswa "__ms__"
  const [showComm, setShowComm] = useState(false);
  const [mvt, setMvt] = useState<{ retrait: boolean } | null>(null);
  const [snack, setSnack] = useState<{ msg: string; color: string } | null>(null);

  const showSnack = (msg: string, color: string) => {
    setSnack({ msg, color });
    setTimeout(() => setSnack(null), 2800);
  };

  async function guard<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (busyRef.current) return undefined;
    busyRef.current = true; setBusy(true);
    try { return await action(); }
    finally { busyRef.current = false; setBusy(false); }
  }

  // ─── AUTH ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const s = JSON.parse(raw) as UserSession;
      if (!s.isAdmin && !s.permissions?.fournisseurVoir) { router.push("/dashboard"); return; }
      setUser(s);
      if (s.localId && s.localId !== "all") {
        setLid(s.localId);
      } else {
        // Admin "all": chwazi yon lokal
        withTimeout(getDocs(collection(db, "locals")), 10000).then(snap => {
          const list = snap.docs.filter(d => d.id !== "all")
            .map(d => ({ id: d.id, name: (d.data().name as string) ?? d.id }));
          setLocals(list);
          if (list.length > 0) setLid(list[0].id); else setLoading(false);
        }).catch(() => { setLoading(false); });
      }
    } catch { router.push("/login"); }
  }, [router]);

  // Admin ak yon sèl lokal fiks (pa "all"): ranpli lis la tou pou chips yo
  useEffect(() => {
    if (!user?.isAdmin || locals.length > 0) return;
    withTimeout(getDocs(collection(db, "locals")), 10000).then(snap => {
      setLocals(snap.docs.filter(d => d.id !== "all")
        .map(d => ({ id: d.id, name: (d.data().name as string) ?? d.id })));
    }).catch(() => {});
  }, [user, locals.length]);

  // ─── LIVE DATA ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !lid) return;
    setLoading(true);
    const un1 = onSnapshot(collection(db, "locals", lid, "fournisseurs_comptes"), snap => {
      const list: Compte[] = [];
      snap.forEach(d => {
        const x = d.data();
        list.push({
          id: d.id, nom: (x.nom as string) ?? d.id,
          balance: Number(x.balance ?? 0),
          historique: (x.historique as Hist[]) ?? [],
        });
      });
      setComptes(list);
      setLoading(false);
    }, () => { setLoading(false); showSnack("Connexion perdue avec le serveur.", "#e65100"); });

    const un2 = onSnapshot(doc(db, "locals", lid, "millionstore", "compte"), snap => {
      const x = snap.data();
      setMs({
        id: "ms", nom: "MILLIONSTORE",
        balance: Number(x?.balance ?? 0),
        historique: (x?.historique as Hist[]) ?? [],
      });
    }, () => {});

    const un3 = onSnapshot(collection(db, "locals", lid, "products"), snap => {
      const list: Product[] = [];
      snap.forEach(d => list.push({ ...(d.data() as Product), id: d.id }));
      setProducts(list);
    }, () => {});

    return () => { un1(); un2(); un3(); };
  }, [user, lid]);

  // ─── COMPTES + FOUNISÈ KI GEN PWODWI ASIYEN (menm si pa gen vant) ─────────
  const allComptes = useMemo(() => {
    const byKey = new Map<string, Compte>();
    for (const c of comptes) byKey.set((c.id ?? "").toLowerCase(), c);
    for (const p of products) {
      const nom = (p.nomDealer ?? "").trim();
      if (!nom) continue;
      const k = nom.toLowerCase();
      if (!byKey.has(k)) byKey.set(k, { id: k, nom, balance: 0, historique: [] });
    }
    return [...byKey.values()].sort((a, b) => a.nom.toLowerCase().localeCompare(b.nom.toLowerCase()));
  }, [comptes, products]);

  const produitsAsiyen = (nom: string) => {
    const k = nom.toLowerCase();
    return products.filter(p => (p.nomDealer ?? "").trim().toLowerCase() === k && p.isDeleted !== true);
  };

  // ─── OPERASYON: RETRAIT / DÉPÔT FOUNISÈ ──────────────────────────────────
  const fournisseurMouvement = async (nom: string, montantBrut: number, retrait: boolean, opId: string) => {
    const m = r2(montantBrut);
    const key = nom.toLowerCase();
    const ref = doc(db, "locals", lid, "fournisseurs_comptes", key);
    return guard(async () => {
      try {
        await withTimeout(runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (retrait && !snap.exists()) throw new Error("Kont founisè a pa jwenn.");
          const current = (snap.data() ?? { id: key, nom, balance: 0, historique: [] }) as Record<string, unknown>;
          const hist = [...((current.historique as Hist[]) ?? [])];
          if (hist.some(e => e.opId === opId)) return; // deja fèt
          if (retrait) {
            const disp = calcDisponibleEtAtente({ historique: hist }).disponible;
            if (m > disp + 0.001) {
              throw new Error(`Montan sa depase sa ki disponib ($${disp.toFixed(2)}). Tann 15 jou pou rès la.`);
            }
          }
          const avant = Number(current.balance ?? 0);
          const apres = r2(avant + (retrait ? -m : m));
          const delta = retrait ? -m : m;
          hist.push({
            type: retrait ? "retrait" : "depot",
            date: new Date().toISOString(), delta,
            soldeAvant: avant, soldeApres: apres,
            description: retrait
              ? `Retrait effectué vous avez retiré ${m.toFixed(2)}$ vous avez maintenant ${apres.toFixed(2)}$. Solde actuel est ${apres.toFixed(2)}$`
              : `Dépôt effectué de ${m.toFixed(2)}$ vous aviez ${avant.toFixed(2)}$ vous avez maintenant ${apres.toFixed(2)}$. Solde actuel est ${apres.toFixed(2)}$`,
            parAdmin: user?.username ?? "admin", opId,
          });
          tx.set(ref, { ...current, nom, balance: apres, historique: hist });
        }), 12000);
        showSnack(`✅ ${retrait ? "Retrait" : "Dépôt"} de $${m.toFixed(2)} fèt!`, C.green);
        setMvt(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erè";
        showSnack(msg === "TIMEOUT" ? "Rezo twò dousman. Verifye balans lan anvan w reeseye." : "❌ " + msg, C.red);
      }
    });
  };

  // ─── OPERASYON: RETRAIT MILLIONSTORE (tout balans, san 15 jou) ───────────
  const msRetrait = async (montantBrut: number, opId: string) => {
    const m = r2(montantBrut);
    const ref = doc(db, "locals", lid, "millionstore", "compte");
    return guard(async () => {
      try {
        await withTimeout(runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          const current = (snap.exists() ? snap.data() : { balance: 0, historique: [] }) as Record<string, unknown>;
          const hist = [...((current.historique as Hist[]) ?? [])];
          if (hist.some(e => e.opId === opId)) return;
          const avant = Number(current.balance ?? 0);
          if (m > avant + 0.001) throw new Error(`Montan sa depase balans MILLIONSTORE ($${avant.toFixed(2)}).`);
          const apres = r2(avant - m);
          hist.push({
            type: "retrait", date: new Date().toISOString(), delta: -m,
            soldeAvant: avant, soldeApres: apres,
            description: `Retrait effectué vous avez retiré ${m.toFixed(2)}$ vous avez maintenant ${apres.toFixed(2)}$. Solde actuel est ${apres.toFixed(2)}$`,
            parAdmin: user?.username ?? "admin", opId,
          });
          tx.set(ref, { ...current, balance: apres, historique: hist });
        }), 12000);
        showSnack(`✅ Retrait de $${m.toFixed(2)} fèt!`, C.green);
        setMvt(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erè";
        showSnack(msg === "TIMEOUT" ? "Rezo twò dousman. Verifye balans lan anvan w reeseye." : "❌ " + msg, C.red);
      }
    });
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────
  if (loading || !user) return (
    <main style={{ minHeight: "100vh", background: C.dark, display: "flex",
      alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 48, height: 48, border: "4px solid #333",
          borderTop: `4px solid ${C.accent}`, borderRadius: "50%",
          animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
        <p style={{ color: "#888" }}>Chajman...</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </main>
  );

  const myKey = user.username.toLowerCase();
  const isMsDetail = detailKey === "__ms__";
  const detailCompte: Compte | null = !detailKey
    ? null
    : isMsDetail ? ms
    : allComptes.find(c => c.id.toLowerCase() === detailKey)
      ?? { id: detailKey, nom: detailKey, balance: 0, historique: [] };

  // Non-admin: li wè sèlman pwòp kont li
  if (!user.isAdmin) {
    const mine = allComptes.find(c => c.id.toLowerCase() === myKey)
      ?? { id: myKey, nom: user.username, balance: 0, historique: [] };
    return (
      <>
        <CompteDetail compte={mine} isMs={false} isAdmin={false}
          produits={produitsAsiyen(mine.nom)} busy={busy}
          onBack={() => router.push("/dashboard")}
          onRetrait={() => {}} onDepot={() => {}} />
        {snack && <Snack {...snack} />}
      </>
    );
  }

  const totalBalance = allComptes.reduce((s, c) => s + c.balance, 0);
  const totalDisp = allComptes.reduce((s, c) => s + calcDisponibleEtAtente(c).disponible, 0);

  return (
    <main style={{ minHeight: "100vh", background: C.dark,
      fontFamily: "'Segoe UI',sans-serif", color: "#fff" }}>

      {/* HEADER */}
      <div style={{ background: C.card, padding: "14px 20px", position: "sticky",
        top: 0, zIndex: 100, display: "flex", alignItems: "center",
        justifyContent: "space-between", borderBottom: "1px solid #ffffff0a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push("/dashboard")}
            style={{ background: "#ffffff18", border: "none", color: "#aaa",
              padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13 }}>
            ← Retounen
          </button>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Fournisseurs</h1>
        </div>
        <button onClick={() => setShowComm(true)} title="Komisyon MILLIONSTORE"
          style={{ background: `${C.accent}22`, border: `1px solid ${C.accent}66`,
            color: C.accent, padding: "8px 14px", borderRadius: 10,
            cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
          % Komisyon
        </button>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: 16 }}>

        {/* Chwa lokal */}
        {locals.length > 1 && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 14 }}>
            {locals.map(l => (
              <button key={l.id} onClick={() => { setLid(l.id); setDetailKey(null); }}
                style={{ padding: "6px 14px", borderRadius: 20, cursor: "pointer",
                  border: "none", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
                  background: lid === l.id ? C.accent : `${C.accent}18`,
                  color: lid === l.id ? "#fff" : C.accent }}>
                {l.name}
              </button>
            ))}
          </div>
        )}

        {/* Rezime */}
        <div style={{ background: C.card, borderRadius: 16, padding: 16, marginBottom: 14,
          display: "flex", justifyContent: "space-around",
          border: "1px solid #ffffff0f" }}>
          {[
            { v: `${allComptes.length}`, l: "Founisè", c: "#ffffffb3" },
            { v: `$${totalBalance.toFixed(0)}`, l: "Total Solde", c: totalBalance >= 0 ? "#fff" : C.red },
            { v: `$${totalDisp.toFixed(0)}`, l: "Disponib", c: C.green },
          ].map(s => (
            <div key={s.l} style={{ textAlign: "center" }}>
              <p style={{ margin: 0, color: s.c, fontWeight: 700, fontSize: 16 }}>{s.v}</p>
              <p style={{ margin: "2px 0 0", color: "#666", fontSize: 10 }}>{s.l}</p>
            </div>
          ))}
        </div>

        {/* MILLIONSTORE */}
        <div onClick={() => setDetailKey("__ms__")}
          style={{ background: `linear-gradient(90deg, ${C.gold}2e, ${C.gold}0d)`,
            border: `1px solid ${C.gold}59`, borderRadius: 16, padding: 16,
            marginBottom: 14, cursor: "pointer", display: "flex",
            alignItems: "center", gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: `${C.gold}2e`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🏪</div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>MILLIONSTORE</p>
            <p style={{ margin: 0, color: "#666", fontSize: 11 }}>Kont taks / komisyon</p>
          </div>
          <span style={{ color: C.gold, fontWeight: 700, fontSize: 18 }}>${ms.balance.toFixed(2)}</span>
          <span style={{ color: "#444" }}>›</span>
        </div>

        <p style={{ color: "#666", fontWeight: 700, fontSize: 12, letterSpacing: 1.2, margin: "0 0 10px" }}>
          FOUNISÈ
        </p>

        {allComptes.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 56, opacity: 0.15 }}>🤝</div>
            <p style={{ color: "#666" }}>Pa gen kont founisè toujou</p>
            <p style={{ color: "#444", fontSize: 12 }}>
              Ajoute yon &quot;Nom Dealer&quot; sou yon pwodwi pou l parèt isit la
            </p>
          </div>
        ) : allComptes.map(c => {
          const disp = calcDisponibleEtAtente(c).disponible;
          const nbProd = produitsAsiyen(c.nom).length;
          return (
            <div key={c.id} onClick={() => setDetailKey(c.id.toLowerCase())}
              style={{ background: C.card, borderRadius: 14, padding: 14, marginBottom: 10,
                cursor: "pointer", border: "1px solid #ffffff0d",
                display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar nom={c.nom} size={42} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{c.nom}</p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <span style={{ color: disp >= 0 ? C.green : C.red, fontSize: 11 }}>
                    Disponib: ${disp.toFixed(2)}
                  </span>
                  {nbProd > 0 && (
                    <span style={{ background: `${C.blue}26`, color: C.blue, fontSize: 10,
                      padding: "1px 6px", borderRadius: 6 }}>{nbProd} pwodwi</span>
                  )}
                </div>
              </div>
              <span style={{ color: c.balance >= 0 ? "#fff" : C.red, fontWeight: 700, fontSize: 15 }}>
                ${c.balance.toFixed(2)}
              </span>
              <span style={{ color: "#444" }}>›</span>
            </div>
          );
        })}
      </div>

      {/* DETAY KONT */}
      {detailCompte && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: C.dark, overflowY: "auto" }}>
          <CompteDetail compte={detailCompte} isMs={isMsDetail} isAdmin
            produits={isMsDetail ? [] : produitsAsiyen(detailCompte.nom)} busy={busy}
            onBack={() => setDetailKey(null)}
            onRetrait={() => setMvt({ retrait: true })}
            onDepot={() => setMvt({ retrait: false })} />
        </div>
      )}

      {/* MODAL RETRAIT / DÉPÔT */}
      {mvt && detailCompte && (
        <MouvementModal retrait={mvt.retrait} isMs={isMsDetail}
          compte={detailCompte} busy={busy}
          onClose={() => setMvt(null)}
          onConfirm={(m, opId) => isMsDetail
            ? msRetrait(m, opId)
            : fournisseurMouvement(detailCompte.nom, m, mvt.retrait, opId)} />
      )}

      {/* KOMISYON */}
      {showComm && lid && (
        <KomisyonModal lid={lid} onClose={() => setShowComm(false)} notify={showSnack} />
      )}

      {snack && <Snack {...snack} />}
    </main>
  );
}

// ─── DETAY YON KONT ──────────────────────────────────────────────────────────
function CompteDetail({ compte, isMs, isAdmin, produits, busy, onBack, onRetrait, onDepot }: {
  compte: Compte; isMs: boolean; isAdmin: boolean; produits: Product[]; busy: boolean;
  onBack: () => void; onRetrait: () => void; onDepot: () => void;
}) {
  const [showProd, setShowProd] = useState(false);
  const calc = calcDisponibleEtAtente(compte);
  const disp = isMs ? compte.balance : calc.disponible;
  const atn = isMs ? 0 : calc.enAttente;
  const hist = [...compte.historique].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return (
    <div style={{ minHeight: "100vh", background: C.dark, color: "#fff",
      fontFamily: "'Segoe UI',sans-serif" }}>
      <div style={{ background: C.card, padding: "14px 20px", display: "flex",
        alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 10 }}>
        <button onClick={onBack}
          style={{ background: "#ffffff18", border: "none", color: "#aaa",
            padding: "8px 14px", borderRadius: 10, cursor: "pointer" }}>←</button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{isMs ? "MILLIONSTORE" : compte.nom}</h2>
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ background: C.card, padding: 20, textAlign: "center" }}>
          <p style={{ margin: 0, color: "#666", fontSize: 11, letterSpacing: 1.2 }}>SOLDE ACTUEL</p>
          <p style={{ margin: "6px 0 14px", fontWeight: 700, fontSize: 34,
            color: compte.balance >= 0 ? "#fff" : C.red }}>${compte.balance.toFixed(2)}</p>
          <div style={{ display: "flex", gap: 10 }}>
            <StatBox label="Disponible" value={disp} color={C.green} />
            {!isMs && <StatBox label="En attente (15j)" value={atn} color={C.gold} />}
          </div>

          {isAdmin ? (
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={onRetrait} disabled={busy}
                style={{ flex: 1, padding: 12, border: "none", borderRadius: 12,
                  background: busy ? "#555" : C.red, color: "#fff", fontWeight: 700,
                  cursor: "pointer" }}>↑ Retrait</button>
              {!isMs && (
                <button onClick={onDepot} disabled={busy}
                  style={{ flex: 1, padding: 12, border: "none", borderRadius: 12,
                    background: busy ? "#555" : C.green, color: "#000", fontWeight: 700,
                    cursor: "pointer" }}>↓ Dépôt</button>
              )}
            </div>
          ) : (
            <p style={{ margin: "14px auto 0", color: "#666", fontSize: 11,
              background: "#ffffff0d", display: "inline-block", padding: "8px 12px", borderRadius: 10 }}>
              ℹ️ Kontakte yon admin pou retrait/dépôt
            </p>
          )}
        </div>

        {!isMs && (
          <div style={{ background: C.card, borderTop: "1px solid #ffffff1f" }}>
            <div onClick={() => setShowProd(s => !s)}
              style={{ padding: "12px 16px", display: "flex", alignItems: "center",
                gap: 8, cursor: "pointer" }}>
              <span style={{ color: C.blue }}>📦</span>
              <span style={{ fontWeight: 700, fontSize: 13 }}>Produits assignés ({produits.length})</span>
              <span style={{ flex: 1 }} />
              <span style={{ color: "#666" }}>{showProd ? "▲" : "▼"}</span>
            </div>
            {showProd && produits.map(p => {
              const stock = Number(p.stock ?? 0);
              const vendu = stock <= 0;
              const col = vendu ? C.green : C.blue;
              return (
                <div key={p.id} style={{ margin: "0 16px 10px", padding: 10, borderRadius: 10,
                  background: "#ffffff08", border: `1px solid ${col}33` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ background: `${col}26`, color: col, fontSize: 9, fontWeight: 700,
                      padding: "2px 6px", borderRadius: 5 }}>{vendu ? "Vendu" : "En stock"}</span>
                    <span style={{ background: "rgba(255,165,0,0.12)", color: "orange", fontSize: 9,
                      fontWeight: 700, padding: "2px 6px", borderRadius: 5 }}>ID: {p.id}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: "#888", fontSize: 12, fontWeight: 700 }}>
                      ${Number(p.prixDealer ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <p style={{ margin: "6px 0 0", fontWeight: 700, fontSize: 12 }}>{p.marque} {p.modele}</p>
                  {p.description && <p style={{ margin: "3px 0 0", color: "#666", fontSize: 11 }}>{p.description}</p>}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ padding: "14px 16px 8px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>🧾 Relevé du compte</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: "#444", fontSize: 11 }}>{hist.length} mouvman</span>
        </div>

        <div style={{ padding: "0 14px 30px" }}>
          {hist.length === 0 ? (
            <p style={{ textAlign: "center", color: "#666", padding: "50px 0" }}>Pa gen mouvman toujou</p>
          ) : hist.map((h, i) => <HistCard key={`${h.date}${i}`} e={h} />)}
        </div>
      </div>
    </div>
  );
}

function HistCard({ e }: { e: Hist }) {
  const delta = Number(e.delta ?? 0);
  const meta: Record<string, { icon: string; color: string }> = {
    vente: { icon: "🛒", color: C.green },
    annulation: { icon: "🚫", color: C.red },
    retrait: { icon: "↑", color: C.red },
    depot: { icon: "↓", color: C.green },
  };
  const { icon, color } = meta[e.type] ?? { icon: "🧾", color: "#888" };
  const hasDetails = e.type === "vente" || e.type === "annulation";
  const rows: string[] = [];
  if (e.marque || e.modele) rows.push(`📱 ${`${e.marque ?? ""} ${e.modele ?? ""}`.trim()}`);
  if (e.productId) rows.push(`🏷 ID: ${e.productId}`);
  if (e.produitDescription) rows.push(`📝 ${e.produitDescription}`);
  if (e.clientNom) rows.push(`👤 Client: ${e.clientNom}`);
  if (e.vendeurNom) rows.push(`🧑‍💼 Vendeur: ${e.vendeurNom}`);
  if (e.cashier) rows.push(`💳 Caissier: ${e.cashier}`);

  return (
    <div style={{ background: C.card, borderRadius: 14, padding: 12, marginBottom: 10,
      border: `1px solid ${color}26` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: `${color}1f`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color, fontSize: 15, flexShrink: 0 }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.3 }}>{e.description || e.type}</p>
          <p style={{ margin: "4px 0 0", color: "#555", fontSize: 10 }}>
            🕐 {fmtDateHeure(e.date)}{e.billNo ? `   #${e.billNo}` : ""}
          </p>
        </div>
        <span style={{ color: delta >= 0 ? C.green : C.red, fontWeight: 700, fontSize: 13 }}>
          {delta >= 0 ? "+" : "-"}${Math.abs(delta).toFixed(2)}
        </span>
      </div>
      {hasDetails && rows.length > 0 && (
        <div style={{ marginTop: 8, padding: 8, background: "#ffffff08", borderRadius: 8 }}>
          {rows.map((r, i) => (
            <p key={i} style={{ margin: "0 0 3px", color: "#999", fontSize: 11 }}>{r}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MODAL RETRAIT / DÉPÔT ───────────────────────────────────────────────────
function MouvementModal({ retrait, isMs, compte, busy, onClose, onConfirm }: {
  retrait: boolean; isMs: boolean; compte: Compte; busy: boolean;
  onClose: () => void; onConfirm: (m: number, opId: string) => void;
}) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // menm opId si w reeseye nan menm modal la
  const [opId] = useState(() => `${Date.now()}${Math.floor(Math.random() * 1e6)}`);
  const disp = isMs ? compte.balance : calcDisponibleEtAtente(compte).disponible;
  const color = retrait ? C.red : C.green;

  const submit = () => {
    if (busy) return;
    const m = parseFloat(val.replace(",", "."));
    if (isNaN(m) || m <= 0) { setErr("Antre yon montan valab."); return; }
    if (m > 1000000) { setErr("Montan twò wo."); return; }
    if (retrait && m > disp + 0.001) { setErr("Depase montan disponib la."); return; }
    onConfirm(r2(m), opId);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={busy ? undefined : onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: C.card, borderRadius: 18, padding: 22, width: "100%", maxWidth: 400 }}>
        <h3 style={{ margin: "0 0 14px", color }}>{retrait ? "↑ Retrait" : "↓ Dépôt"}</h3>
        {retrait && (
          <>
            <p style={{ margin: 0, color: C.green, fontWeight: 700, fontSize: 13 }}>
              Disponib pou retrait: ${disp.toFixed(2)}
            </p>
            <p style={{ margin: "4px 0 14px", color: "#666", fontSize: 11 }}>
              {isMs ? "Ou ka retire tout balans lan." : "Sèlman lajan ki gen 15 jou oswa plis ka retire."}
            </p>
          </>
        )}
        <input type="number" step="0.01" autoFocus value={val} disabled={busy}
          onChange={e => { setVal(e.target.value); setErr(null); }}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          placeholder="Montan ($)"
          style={{ width: "100%", padding: "12px 14px", background: "#ffffff14", border: "none",
            borderRadius: 12, color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
        {err && <p style={{ color: C.red, fontSize: 12, margin: "6px 0 0" }}>{err}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={onClose} disabled={busy}
            style={{ flex: 1, padding: 12, background: "#ffffff0a", border: "none",
              borderRadius: 12, cursor: "pointer", color: "#888" }}>Anile</button>
          <button onClick={submit} disabled={busy}
            style={{ flex: 1, padding: 12, background: busy ? "#555" : color, border: "none",
              borderRadius: 12, cursor: "pointer", fontWeight: 700,
              color: retrait ? "#fff" : "#000" }}>
            {busy ? "..." : retrait ? "Konfime Retrait" : "Konfime Dépôt"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── KOMISYON MILLIONSTORE (pa kategori) ─────────────────────────────────────
function KomisyonModal({ lid, onClose, notify }: {
  lid: string; onClose: () => void; notify: (m: string, c: string) => void;
}) {
  const [ctrls, setCtrls] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newVal, setNewVal] = useState("");

  useEffect(() => {
    let alive = true;
    withTimeout(getDoc(doc(db, "config", `commissions_${lid}`)), 8000).then(snap => {
      if (!alive) return;
      const out: Record<string, string> = {};
      Object.entries(snap.data() ?? {}).forEach(([k, v]) => {
        if (k !== "updatedAt" && typeof v === "number") out[k] = v.toFixed(2);
      });
      setCtrls(out); setLoaded(true);
    }).catch(() => { if (alive) { setLoaded(true); notify("Impossible de charger les komisyon.", C.red); } });
    return () => { alive = false; };
  }, [lid, notify]);

  const saveAll = async (data: Record<string, string>): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      const out: Record<string, unknown> = { updatedAt: serverTimestamp() };
      Object.entries(data).forEach(([k, s]) => {
        const v = parseFloat(s.replace(",", "."));
        if (!isNaN(v) && v >= 0) out[k] = r2(v);
      });
      await withTimeout(setDoc(doc(db, "config", `commissions_${lid}`), out, { merge: true }), 8000);
      notify("✅ Komisyon sove!", C.green);
      return true;
    } catch {
      notify("❌ Pa sove. Rezo a move, reeseye.", C.red);
      return false;
    } finally { setSaving(false); }
  };

  const addCat = async () => {
    const nom = newName.trim();
    const v = parseFloat(newVal.replace(",", "."));
    if (!nom || isNaN(v) || v < 0) { notify("Antre yon non ak yon montan valab.", "#e65100"); return; }
    const next = { ...ctrls, [nom]: r2(v).toFixed(2) };
    setCtrls(next); setNewName(""); setNewVal("");
    await saveAll(next);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300,
      display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: C.card, borderRadius: "20px 20px 0 0", width: "100%",
          maxWidth: 500, padding: "20px 20px 32px", maxHeight: "90vh", overflowY: "auto" }}>
        <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 15, color: C.accent }}>
          % Komisyon MILLIONSTORE pa Kategori
        </p>
        <p style={{ margin: "0 0 16px", color: "#666", fontSize: 11 }}>
          Montan sa a soti sou kont founisè a, ale nan kont MILLIONSTORE
        </p>
        {!loaded ? <p style={{ color: "#666" }}>Chajman...</p> : (
          <>
            {Object.keys(ctrls).length === 0 && (
              <p style={{ color: "#666", fontSize: 12 }}>Pa gen kategori toujou — ajoute youn anba a</p>
            )}
            {Object.entries(ctrls).map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <span style={{ flex: 1, fontSize: 14 }}>{k}</span>
                <span style={{ color: C.accent }}>$</span>
                <input type="text" inputMode="decimal" value={v} disabled={saving}
                  onChange={e => setCtrls(p => ({ ...p, [k]: e.target.value }))}
                  style={{ width: 100, padding: "9px 12px", background: "#ffffff14", border: "none",
                    borderRadius: 10, color: "#fff", fontSize: 14, outline: "none", textAlign: "center" }} />
              </div>
            ))}
            <div style={{ height: 1, background: "#ffffff1f", margin: "16px 0" }} />
            <p style={{ margin: "0 0 10px", color: "#ffffffb3", fontWeight: 700, fontSize: 12 }}>
              ➕ Ajoute yon nouvo kategori
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Non kategori"
                style={{ flex: 2, padding: "10px 12px", background: "#ffffff14", border: "none",
                  borderRadius: 10, color: "#fff", fontSize: 13, outline: "none", minWidth: 0 }} />
              <input value={newVal} onChange={e => setNewVal(e.target.value)} placeholder="$"
                type="text" inputMode="decimal"
                style={{ width: 80, padding: "10px 12px", background: "#ffffff14", border: "none",
                  borderRadius: 10, color: "#fff", fontSize: 13, outline: "none" }} />
              <button onClick={addCat} disabled={saving}
                style={{ background: `${C.green}33`, border: "none", color: C.green, width: 40,
                  borderRadius: 10, cursor: "pointer", fontSize: 20 }}>+</button>
            </div>
            <button disabled={saving}
              onClick={async () => { if (await saveAll(ctrls)) onClose(); }}
              style={{ width: "100%", marginTop: 18, padding: 13, border: "none", borderRadius: 12,
                background: saving ? "#555" : C.accent, color: "#fff", fontWeight: 700,
                cursor: "pointer", fontSize: 14 }}>
              {saving ? "Ap sove..." : "💾 Sove Komisyon yo"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── ZOUTI ───────────────────────────────────────────────────────────────────
function Avatar({ nom, size }: { nom: string; size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `${C.accent}1f`, border: `1px solid ${C.accent}4d`,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: C.accent, fontWeight: 700, fontSize: size * 0.37 }}>
      {nom?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, background: `${color}14`, border: `1px solid ${color}33`,
      borderRadius: 10, padding: "10px" }}>
      <p style={{ margin: 0, color, fontWeight: 700, fontSize: 15 }}>${value.toFixed(2)}</p>
      <p style={{ margin: "2px 0 0", color: "#666", fontSize: 10 }}>{label}</p>
    </div>
  );
}

function Snack({ msg, color }: { msg: string; color: string }) {
  return (
    <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      background: color, color: "#fff", padding: "12px 24px", borderRadius: 12,
      fontWeight: 600, fontSize: 14, zIndex: 999, maxWidth: "90vw", textAlign: "center",
      boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
      {msg}
    </div>
  );
}