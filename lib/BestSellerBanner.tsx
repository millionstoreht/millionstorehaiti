"use client";
import { useEffect, useState } from "react";
import { db } from "./firebase";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";

// =============================================================================
// MEILLEUR VENDEUR DU MOIS PRÉCÉDENT (même logique que l'app Flutter)
//  • Le 1er octobre  → meilleur vendeur de septembre
//  • Le 1er novembre → meilleur vendeur d'octobre
//  • Calculé UNE fois puis sauvegardé dans locals/<id>/meilleur_vendeur/<AAAA-MM>
//    (le même document est utilisé par l'app Flutter).
//  • Le message reste affiché en permanence, nom en MAJUSCULES.
// =============================================================================

const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet",
  "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

const p2 = (n: number) => String(n).padStart(2, "0");
const monthKey = (y: number, m: number) => `${y}-${p2(m)}`; // m = 1..12

/** "de septembre" / "d'octobre" */
const moisDe = (m: number) => {
  const nom = MOIS[m - 1].toLowerCase();
  return m === 4 || m === 8 || m === 10 ? `d'${nom}` : `de ${nom}`;
};

interface RankItem { nom: string; total: number; n: number; }
interface Best {
  nom: string; total: number; n: number; ranking: RankItem[];
  moisNum: number; annee: number; monthKey: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

type Stored = { none?: boolean; nom?: string; total?: number; n?: number; ranking?: RankItem[] };

function toBest(d: Stored, y: number, m: number): Best | null {
  if (d.none || !d.nom) return null;
  return {
    nom: d.nom, total: Number(d.total ?? 0), n: Number(d.n ?? 0),
    ranking: d.ranking ?? [], moisNum: m, annee: y, monthKey: monthKey(y, m),
  };
}

async function loadForLocal(lid: string): Promise<Best | null> {
  const now = new Date();
  // mois précédent
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const y = prev.getFullYear(), m = prev.getMonth() + 1;
  const key = monthKey(y, m);
  const ck = `best_seller_${lid}_${key}`;

  // 1) cache local
  try {
    const c = localStorage.getItem(ck);
    if (c) return toBest(JSON.parse(c) as Stored, y, m);
  } catch {}

  // 2) résultat déjà calculé (par l'app ou un autre appareil)
  const ref = doc(db, "locals", lid, "meilleur_vendeur", key);
  try {
    const snap = await withTimeout(getDoc(ref), 6000);
    if (snap.exists()) {
      const d = snap.data() as Stored;
      try { localStorage.setItem(ck, JSON.stringify(d)); } catch {}
      return toBest(d, y, m);
    }
  } catch {}

  // 3) calcul depuis les factures du mois précédent
  try {
    const start = `${y}-${p2(m)}-01T00:00:00.000`;
    const next = new Date(y, m, 1); // 1er du mois courant
    const end = `${next.getFullYear()}-${p2(next.getMonth() + 1)}-01T00:00:00.000`;
    const q = query(collection(db, "locals", lid, "factures"),
      where("date", ">=", start), where("date", "<", end));
    const snap = await withTimeout(getDocs(q), 15000);

    const tot = new Map<string, number>();
    const cnt = new Map<string, number>();
    snap.forEach(d => {
      const f = d.data() as Record<string, unknown>;
      if (f.annule === true || f.dansPoubel === true) return;
      const v = String(f.vendeur ?? "").trim();
      if (!v) return;
      tot.set(v, (tot.get(v) ?? 0) + (Number(f.totalUSD) || 0));
      cnt.set(v, (cnt.get(v) ?? 0) + 1);
    });

    let result: Stored & { computedAt: string };
    if (tot.size === 0) {
      result = { none: true, computedAt: new Date().toISOString() };
    } else {
      const ranking: RankItem[] = [...tot.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([nom, total]) => ({ nom, total, n: cnt.get(nom) ?? 0 }));
      result = {
        nom: ranking[0].nom, total: ranking[0].total, n: ranking[0].n,
        ranking: ranking.slice(0, 3), computedAt: new Date().toISOString(),
      };
    }
    try { await withTimeout(setDoc(ref, result), 6000); } catch {}
    try { localStorage.setItem(ck, JSON.stringify(result)); } catch {}
    return toBest(result, y, m);
  } catch {
    return null; // pas de réseau / pas la permission → on réessaiera
  }
}

async function loadBest(localId: string): Promise<Best | null> {
  if (!localId) return null;
  if (localId !== "all") return loadForLocal(localId);
  // admin "tous les locaux" : on garde le meilleur résultat parmi les locaux
  try {
    const snap = await withTimeout(getDocs(collection(db, "locals")), 10000);
    const ids = snap.docs.map(d => d.id).filter(id => id !== "all");
    const all = (await Promise.all(ids.map(loadForLocal))).filter((b): b is Best => !!b);
    if (all.length === 0) return null;
    return all.reduce((a, b) => (b.total > a.total ? b : a));
  } catch { return null; }
}

// ─── COMPOSANT ───────────────────────────────────────────────────────────────
export default function BestSellerBanner({ localId, compact = true }: {
  localId: string; compact?: boolean;
}) {
  const [data, setData] = useState<Best | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    loadBest(localId).then(b => { if (alive) setData(b); });
    return () => { alive = false; };
  }, [localId]);

  if (!data) return null;

  const nom = data.nom.toUpperCase();
  const sentence = `${nom} est le meilleur vendeur du mois ${moisDe(data.moisNum)}`;
  const gradient = "linear-gradient(135deg,#FFB300,#FF6B35)";
  const medals = ["🥇", "🥈", "🥉"];

  if (compact) {
    return (
      <div style={{ background: gradient, borderRadius: 16, padding: "10px 14px", marginBottom: 14,
        display: "flex", alignItems: "center", gap: 10, color: "#fff",
        boxShadow: "0 3px 10px rgba(255,107,53,0.3)", fontFamily: "'Segoe UI',sans-serif" }}>
        <span style={{ fontSize: 26 }}>🏆</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{sentence}</div>
          <div style={{ fontSize: 11.5 }}>
            Félicitations {nom} ! 🎉 &nbsp;•&nbsp; {data.n} vente{data.n > 1 ? "s" : ""}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: gradient, borderRadius: 20, padding: 16, marginBottom: 14, color: "#fff",
      boxShadow: "0 6px 16px rgba(255,107,53,0.35)", fontFamily: "'Segoe UI',sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(255,255,255,0.22)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, flexShrink: 0 }}>🏆</div>
        <div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 10, letterSpacing: 1.2, fontWeight: 700 }}>
            MEILLEUR VENDEUR — {MOIS[data.moisNum - 1].toUpperCase()} {data.annee}
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, margin: "4px 0 2px" }}>{sentence}</div>
          <div style={{ fontSize: 13 }}>Félicitations {nom} ! 🎉</div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 4 }}>
            ${data.total.toFixed(2)} • {data.n} vente{data.n > 1 ? "s" : ""}
          </div>
        </div>
      </div>
      {data.ranking.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {data.ranking.slice(0, 3).map((r, i) => (
            <span key={r.nom} style={{ background: "rgba(255,255,255,0.2)", borderRadius: 12,
              padding: "4px 10px", fontSize: 11, fontWeight: 700 }}>
              {medals[i]} {r.nom.toUpperCase()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}