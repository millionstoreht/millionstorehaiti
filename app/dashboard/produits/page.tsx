"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../../lib/firebase";
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, getDocs,
} from "firebase/firestore";

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface UserSession {
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  permissions: Record<string, boolean>;
}

interface Product {
  id: string;
  marque: string;
  modele: string;
  category: string;
  description: string;
  stock: number;
  prixAchat: number;
  prixVente: number;
  serialImei: string;
  imagePaths: string[];
  imagePath: string;
  fournisseurId: string;
  localId: string;
  isDeleted: boolean;
  nomDealer: string;
  prixDealer: number;
}

interface Fournisseur {
  id: string;
  nom: string;
}

// ─── COLORS ──────────────────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  Phone:      "#6C63FF",
  Ordinateur: "#00B894",
  Desktop:    "#0984E3",
  Accessoire: "#F79F1F",
  Tablette:   "#E17055",
  "Lòt":      "#636E72",
};
const catColor = (cat: string) => CAT_COLORS[cat] ?? "#636E72";

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function ProduitsPage() {
  const router = useRouter();
  const [user, setUser]           = useState<UserSession | null>(null);
  const [products, setProducts]   = useState<Product[]>([]);
  const [trashed, setTrashed]     = useState<Product[]>([]);
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showTrash, setShowTrash] = useState(false);
  const [search, setSearch]       = useState("");
  const [taux, setTaux]           = useState(1);
  const [localId, setLocalId]     = useState("all");
  const [snack, setSnack]         = useState<{msg:string;color:string}|null>(null);

  // Modals
  const [formProduct, setFormProduct]   = useState<Product | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [permDeleteTarget, setPermDeleteTarget] = useState<Product | null>(null);
  const [previewImgs, setPreviewImgs]   = useState<{imgs:string[];idx:number}|null>(null);

  // ─── AUTH ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem("ms_web_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const s = JSON.parse(raw) as UserSession;
      if (!s.isAdmin && !s.permissions?.produitVoir) {
        router.push("/dashboard"); return;
      }
      setUser(s);
      setLocalId(s.localId === "all" ? "all" : s.localId);
    } catch { router.push("/login"); }
  }, [router]);

  // ─── LOAD PRODUCTS ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const unsubList: (() => void)[] = [];

    const loadAll = async () => {
      // Taux
      try {
        const { getDoc, doc: fDoc } = await import("firebase/firestore");
        const tSnap = await getDoc(fDoc(db, "parametres", "taux"));
        if (tSnap.exists()) setTaux(Number(tSnap.data()?.taux ?? 1));
      } catch {}

      if (user.isAdmin) {
        // Admin: chèche nan tout lokal yo
        const localsSnap = await getDocs(collection(db, "locals"));
        const localIds: string[] = [];
        localsSnap.forEach(d => { if (d.id !== "all") localIds.push(d.id); });

        // Si pa gen lokal, eseye "all" dirèkteman
        const idsToWatch = localIds.length > 0 ? localIds : ["all"];

        const allActive: Record<string, Product> = {};
        const allTrashed: Record<string, Product> = {};

        const flush = () => {
          setProducts(Object.values(allActive));
          setTrashed(Object.values(allTrashed));
          setLoading(false);
        };

        idsToWatch.forEach(lid => {
          const unsub = onSnapshot(
            collection(db, "locals", lid, "products"),
            snap => {
              snap.forEach(d => {
                const p = { ...d.data(), id: d.id, _lid: lid } as Product & { _lid: string };
                const key = `${lid}_${d.id}`;
                if (p.isDeleted) {
                  allTrashed[key] = p;
                  delete allActive[key];
                } else {
                  allActive[key] = p;
                  delete allTrashed[key];
                }
              });
              // Retire pwodwi ki efase nan Firestore (doc siprime)
              const existingKeys = new Set(snap.docs.map(d => `${lid}_${d.id}`));
              Object.keys(allActive).forEach(k => {
                if (k.startsWith(`${lid}_`) && !existingKeys.has(k)) delete allActive[k];
              });
              Object.keys(allTrashed).forEach(k => {
                if (k.startsWith(`${lid}_`) && !existingKeys.has(k)) delete allTrashed[k];
              });
              flush();
            },
            () => { setLoading(false); }
          );
          unsubList.push(unsub);
        });

        // Fournisseurs pou premye lokal
        if (idsToWatch[0]) {
          getDocs(collection(db, "locals", idsToWatch[0], "fournisseurs")).then(snap => {
            const list: Fournisseur[] = [];
            snap.forEach(d => list.push({ id: d.id, nom: d.data().nom ?? "" }));
            setFournisseurs(list);
          });
        }

      } else {
        // Non-admin: sèlman lokal pa li, pa wè stock 0
        const lid = localId;
        const unsub = onSnapshot(
          collection(db, "locals", lid, "products"),
          snap => {
            const active: Product[] = [];
            const trash: Product[]  = [];
            snap.forEach(d => {
              const p = { ...d.data(), id: d.id } as Product;
              if (p.isDeleted) trash.push(p);
              else if (Number(p.stock ?? 0) > 0) active.push(p); // ← filtre stock 0
            });
            setProducts(active);
            setTrashed(trash);
            setLoading(false);
          },
          () => setLoading(false)
        );
        unsubList.push(unsub);

        getDocs(collection(db, "locals", lid, "fournisseurs")).then(snap => {
          const list: Fournisseur[] = [];
          snap.forEach(d => list.push({ id: d.id, nom: d.data().nom ?? "" }));
          setFournisseurs(list);
        });
      }
    };

    loadAll();
    return () => unsubList.forEach(u => u());
  }, [user, localId]);

  // ─── SNACK ───────────────────────────────────────────────────────────────
  const showSnack = (msg: string, color: string) => {
    setSnack({ msg, color });
    setTimeout(() => setSnack(null), 2500);
  };

  // ─── FILTER ──────────────────────────────────────────────────────────────
  const src = showTrash ? trashed : products;
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return src;
    return src.filter(p =>
      (p.marque      ?? "").toLowerCase().includes(q) ||
      (p.modele      ?? "").toLowerCase().includes(q) ||
      (p.id          ?? "").toLowerCase().includes(q) ||
      (p.category    ?? "").toLowerCase().includes(q) ||
      (p.serialImei  ?? "").toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q)
    );
  }, [src, search]);

  // By category
  const byCategory = useMemo(() => {
    const map: Record<string, Product[]> = {};
    for (const p of filtered) {
      const cat = p.category || "Lòt";
      if (!map[cat]) map[cat] = [];
      map[cat].push(p);
    }
    return map;
  }, [filtered]);

  // ─── SAVE ────────────────────────────────────────────────────────────────
  const saveProduct = async (p: Product) => {
    await setDoc(doc(db, "locals", localId, "products", p.id), p);
  };

  // ─── DELETE (soft) ────────────────────────────────────────────────────────
  const softDelete = async (p: Product) => {
    await saveProduct({ ...p, isDeleted: true });
    setDeleteTarget(null);
    showSnack("🗑 Voye nan poubelle!", "#ff4444");
  };

  // ─── DELETE PERMANENT ────────────────────────────────────────────────────
  const permDelete = async (p: Product) => {
    await deleteDoc(doc(db, "locals", localId, "products", p.id));
    setPermDeleteTarget(null);
    showSnack("🗑 Pwodwi efase definitivamente!", "#ff4444");
  };

  // ─── RESTORE ─────────────────────────────────────────────────────────────
  const restore = async (p: Product) => {
    await saveProduct({ ...p, isDeleted: false, stock: p.stock || 1 });
    showSnack("✅ Pwodwi restore!", "#00C853");
  };

  if (loading || !user) return (
    <main style={{ minHeight:"100vh", background:"#f8f9fa", display:"flex",
      alignItems:"center", justifyContent:"center", fontFamily:"'Segoe UI',sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:48, height:48, border:"4px solid #eee",
          borderTop:"4px solid orange", borderRadius:"50%",
          animation:"spin 1s linear infinite", margin:"0 auto 16px" }}/>
        <p style={{ color:"#888" }}>Chajman...</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </main>
  );

  return (
    <main style={{ minHeight:"100vh", background:"#f8f9fa",
      fontFamily:"'Segoe UI',sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{ background:"linear-gradient(135deg,#FF6B35,#FF8C42)",
        padding:"16px 20px", position:"sticky", top:0, zIndex:100,
        boxShadow:"0 2px 12px rgba(255,107,53,0.3)" }}>
        <div style={{ display:"flex", alignItems:"center",
          justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <button onClick={() => router.push("/dashboard")}
              style={{ background:"rgba(255,255,255,0.2)", border:"none",
                color:"#fff", padding:"8px 14px", borderRadius:10,
                cursor:"pointer", fontSize:13 }}>
              ← Retounen
            </button>
            <div>
              <p style={{ margin:0, color:"rgba(255,255,255,0.8)", fontSize:12 }}>
                {showTrash ? "Poubelle" : "Pwodwi"}
              </p>
              <p style={{ margin:0, color:"#fff", fontSize:22, fontWeight:700 }}>
                {showTrash ? trashed.length : products.length} total
              </p>
            </div>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            {taux > 1 && (
              <span style={{ background:"rgba(255,255,255,0.2)", color:"#fff",
                padding:"4px 10px", borderRadius:20, fontSize:11, fontWeight:700 }}>
                1$ = {taux} HTG
              </span>
            )}
            {user.isAdmin && (
              <button onClick={() => { setShowTrash(p => !p); setSearch(""); }}
                style={{ background:"rgba(255,255,255,0.2)", border:"none",
                  color:"#fff", padding:"8px 12px", borderRadius:10,
                  cursor:"pointer", fontSize:13 }}>
                {showTrash ? "📦 Pwodwi" : "🗑 Poubelle"}
              </button>
            )}
            {user.isAdmin && !showTrash && (
              <button onClick={() => setFormProduct("new")}
                style={{ background:"rgba(255,255,255,0.95)", border:"none",
                  color:"#FF6B35", padding:"8px 16px", borderRadius:10,
                  cursor:"pointer", fontSize:13, fontWeight:700 }}>
                + Ajoute
              </button>
            )}
          </div>
        </div>
        {/* Search */}
        <input
          type="search" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Chèche ID, Mak, Modèl, S/N..."
          style={{ width:"100%", padding:"10px 16px",
            background:"rgba(255,255,255,0.2)", border:"none",
            borderRadius:12, color:"#fff", fontSize:14,
            outline:"none", boxSizing:"border-box" as const,
            fontFamily:"inherit" }}
        />
      </div>

      {/* ── CONTENT ── */}
      <div style={{ maxWidth:900, margin:"0 auto", padding:"16px" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign:"center", marginTop:80 }}>
            <div style={{ width:80, height:80, borderRadius:"50%",
              background:"rgba(255,165,0,0.1)", display:"flex",
              alignItems:"center", justifyContent:"center",
              margin:"0 auto 16px", fontSize:36 }}>
              {showTrash ? "🗑" : "📦"}
            </div>
            <p style={{ color:"#888", fontSize:15 }}>
              {showTrash ? "Poubelle vid" : "Pa gen pwodwi toujou"}
            </p>
          </div>
        ) : (
          Object.entries(byCategory).map(([cat, items]) => {
            const color = catColor(cat);
            return (
              <div key={cat} style={{ marginBottom:24 }}>
                {/* Category header */}
                <div style={{ display:"flex", alignItems:"center",
                  gap:8, marginBottom:12 }}>
                  <div style={{ width:4, height:18, background:color,
                    borderRadius:2 }}/>
                  <span style={{ color, fontWeight:700, fontSize:12,
                    letterSpacing:1.5 }}>
                    {cat.toUpperCase()}
                  </span>
                  <span style={{ background:`${color}18`, color,
                    padding:"2px 10px", borderRadius:10,
                    fontSize:11, fontWeight:700 }}>
                    {items.length}
                  </span>
                </div>
                {/* Products */}
                {items.map(p => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    isAdmin={user.isAdmin}
                    showTrash={showTrash}
                    taux={taux}
                    onEdit={() => setFormProduct(p)}
                    onDelete={() => setDeleteTarget(p)}
                    onRestore={() => restore(p)}
                    onPermDelete={() => setPermDeleteTarget(p)}
                    onPreview={(imgs, idx) => setPreviewImgs({ imgs, idx })}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* ── FAB ── */}
      {user.isAdmin && !showTrash && (
        <button onClick={() => setFormProduct("new")}
          style={{ position:"fixed", bottom:24, right:24,
            width:56, height:56, borderRadius:"50%",
            background:"#FF6B35", border:"none", color:"#fff",
            fontSize:28, cursor:"pointer", boxShadow:"0 4px 20px rgba(255,107,53,0.4)",
            display:"flex", alignItems:"center", justifyContent:"center",
            zIndex:50 }}>
          +
        </button>
      )}

      {/* ── MODALS ── */}
      {formProduct !== null && (
        <ProductForm
          product={formProduct === "new" ? null : formProduct}
          fournisseurs={fournisseurs}
          localId={localId}
          isAdmin={user.isAdmin}
          onClose={() => setFormProduct(null)}
          onSave={async p => {
            await saveProduct(p);
            setFormProduct(null);
            showSnack(formProduct === "new" ? "✅ Pwodwi ajoute!" : "✅ Chanjman sove!", "#00C853");
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Voye nan Poubelle?"
          message={`${deleteTarget.marque} ${deleteTarget.modele}`}
          confirmLabel="Wi" confirmColor="#ff4444"
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => softDelete(deleteTarget)}
        />
      )}

      {permDeleteTarget && (
        <ConfirmModal
          title="Siprime Definitif?"
          message={`⚠️ ${permDeleteTarget.marque} ${permDeleteTarget.modele} — Aksyon sa pa ka defèt!`}
          confirmLabel="Wi, Efase Pou Toujou" confirmColor="#ff4444"
          onClose={() => setPermDeleteTarget(null)}
          onConfirm={() => permDelete(permDeleteTarget)}
        />
      )}

      {previewImgs && (
        <ImagePreview
          imgs={previewImgs.imgs}
          initialIndex={previewImgs.idx}
          onClose={() => setPreviewImgs(null)}
        />
      )}

      {snack && (
        <div style={{ position:"fixed", bottom:24, left:"50%",
          transform:"translateX(-50%)", background:snack.color,
          color:"#fff", padding:"12px 24px", borderRadius:12,
          fontWeight:600, fontSize:14, zIndex:999,
          boxShadow:"0 4px 20px rgba(0,0,0,0.3)", whiteSpace:"nowrap" }}>
          {snack.msg}
        </div>
      )}
    </main>
  );
}

// ─── PRODUCT CARD ─────────────────────────────────────────────────────────────
function ProductCard({ product: p, isAdmin, showTrash, taux, onEdit, onDelete, onRestore, onPermDelete, onPreview }: {
  product: Product; isAdmin: boolean; showTrash: boolean; taux: number;
  onEdit: () => void; onDelete: () => void;
  onRestore: () => void; onPermDelete: () => void;
  onPreview: (imgs: string[], idx: number) => void;
}) {
  const pa      = Number(p.prixAchat ?? 0);
  const pv      = Number(p.prixVente ?? 0);
  const benefis = pv - pa;
  const stock   = Number(p.stock ?? 0);
  const color   = catColor(p.category || "Lòt");
  const imgs    = p.imagePaths?.length ? p.imagePaths : p.imagePath ? [p.imagePath] : [];

  return (
    <div style={{ background:"#fff", borderRadius:18, padding:14,
      marginBottom:12, boxShadow:"0 2px 8px rgba(0,0,0,0.06)",
      border:"1px solid #f0f0f0" }}>
      {/* Row 1: ID + actions */}
      <div style={{ display:"flex", justifyContent:"space-between",
        alignItems:"center", marginBottom:10 }}>
        <span style={{ background:`${color}18`, color, fontSize:11,
          fontWeight:700, padding:"4px 10px", borderRadius:8 }}>
          ID: {p.id}
        </span>
        <div style={{ display:"flex", gap:8 }}>
          {!showTrash && isAdmin && (
            <>
              <button onClick={onEdit}
                style={iconBtn("#2196F3")}>✏️</button>
              <button onClick={onDelete}
                style={iconBtn("#ff4444")}>🗑</button>
            </>
          )}
          {showTrash && (
            <>
              <button onClick={onRestore}
                style={iconBtn("#00C853")}>♻️</button>
              <button onClick={onPermDelete}
                style={iconBtn("#ff4444")}>❌</button>
            </>
          )}
        </div>
      </div>

      {/* Row 2: Image + info */}
      <div style={{ display:"flex", gap:14, marginBottom:12 }}>
        {/* Image */}
        <div style={{ position:"relative", flexShrink:0, cursor: imgs.length ? "pointer" : "default" }}
          onClick={() => imgs.length && onPreview(imgs, 0)}>
          {imgs.length ? (
            <img src={imgs[0]} alt=""
              style={{ width:90, height:90, borderRadius:14, objectFit:"cover" }}
              onError={e => { (e.target as HTMLImageElement).style.display="none"; }}
            />
          ) : (
            <div style={{ width:90, height:90, borderRadius:14,
              background:`${color}18`, display:"flex",
              alignItems:"center", justifyContent:"center",
              fontSize:32 }}>📦</div>
          )}
          {imgs.length > 1 && (
            <div style={{ position:"absolute", bottom:4, left:4,
              background:"rgba(0,0,0,0.6)", borderRadius:8,
              padding:"2px 6px", display:"flex", gap:3,
              alignItems:"center" }}>
              <span style={{ color:"#fff", fontSize:10 }}>📷 {imgs.length}</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div style={{ flex:1 }}>
          <p style={{ margin:"0 0 4px", fontWeight:700, fontSize:15,
            color:"#1a1a2e" }}>
            {p.marque} {p.modele}
          </p>
          {p.category && (
            <div style={{ display:"flex", alignItems:"center",
              gap:6, marginBottom:4 }}>
              <div style={{ width:8, height:8, borderRadius:"50%",
                background:color }}/>
              <span style={{ color, fontSize:11, fontWeight:600 }}>
                {p.category}
              </span>
            </div>
          )}
          {p.description && (
            <p style={{ margin:"0 0 4px", color:"#888", fontSize:11,
              overflow:"hidden", display:"-webkit-box",
              WebkitLineClamp:2, WebkitBoxOrient:"vertical" as const }}>
              {p.description}
            </p>
          )}
          {p.serialImei && (
            <p style={{ margin:"0 0 3px", color:"#FF9800", fontSize:10,
              fontWeight:500 }}>
              S/N: {p.serialImei}
            </p>
          )}
          {isAdmin && p.nomDealer && (
            <p style={{ margin:0, color:"#795548", fontSize:10,
              fontWeight:600 }}>
              🤝 {p.nomDealer}{p.prixDealer ? ` — $${Number(p.prixDealer).toFixed(2)}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* Row 3: Stats */}
      <div style={{ display:"flex", gap:8, alignItems:"center",
        flexWrap:"wrap" }}>
        <span style={{
          background: stock <= 0 ? "#ff000018" : stock <= 2 ? "rgba(255,165,0,0.1)" : "#00C85318",
          color: stock <= 0 ? "#ff4444" : stock <= 2 ? "orange" : "#00C853",
          border: `1px solid ${stock <= 0 ? "#ff000044" : stock <= 2 ? "rgba(255,165,0,0.4)" : "#00C85344"}`,
          padding:"4px 10px", borderRadius:10,
          fontSize:11, fontWeight:700 }}>
          {stock <= 0 ? "❌ Stock vid" : stock <= 2 ? `⚠️ Stock: ${stock}` : `✅ Stock: ${stock}`}
        </span>
        <div style={{ flex:1, textAlign:"right" }}>
          <p style={{ margin:0, fontSize:11, color:"#888" }}>
            Achat: <span style={{ color:"#333" }}>${pa.toFixed(2)}</span>
          </p>
          <p style={{ margin:0, fontSize:13, fontWeight:700, color:"#FF9800" }}>
            Vente: ${pv.toFixed(2)}
          </p>
        </div>
        <div style={{ background: benefis >= 0 ? "#00C85318" : "#ff000018",
          border:`1px solid ${benefis >= 0 ? "#00C85344" : "#ff000044"}`,
          borderRadius:10, padding:"6px 10px", textAlign:"center" }}>
          <p style={{ margin:0, fontWeight:700, fontSize:13,
            color: benefis >= 0 ? "#00C853" : "#ff4444" }}>
            {benefis >= 0 ? "+" : ""}${benefis.toFixed(0)}
          </p>
          <p style={{ margin:0, color:"#aaa", fontSize:9 }}>benefis</p>
        </div>
      </div>

      {taux > 1 && (
        <p style={{ margin:"6px 0 0", color:"#2196F3", fontSize:11,
          fontWeight:500 }}>
          ≈ HTG {(pv * taux).toFixed(0)}
        </p>
      )}
    </div>
  );
}

// ─── PRODUCT FORM ─────────────────────────────────────────────────────────────
function ProductForm({ product, fournisseurs, localId, isAdmin, onClose, onSave }: {
  product: Product | null;
  fournisseurs: Fournisseur[];
  localId: string;
  isAdmin: boolean;
  onClose: () => void;
  onSave: (p: Product) => void;
}) {
  const p = product;
  const [id, setId]             = useState(p?.id ?? "");
  const [marque, setMarque]     = useState(p?.marque ?? "");
  const [modele, setModele]     = useState(p?.modele ?? "");
  const [category, setCategory] = useState(p?.category ?? "");
  const [desc, setDesc]         = useState(p?.description ?? "");
  const [stock, setStock]       = useState(String(p?.stock ?? 1));
  const [pa, setPa]             = useState(String(p?.prixAchat ?? 0));
  const [pv, setPv]             = useState(String(p?.prixVente ?? 0));
  const [sn, setSn]             = useState(p?.serialImei ?? "");
  const [dealer, setDealer]     = useState(p?.nomDealer ?? "");
  const [pDealer, setPDealer]   = useState(String(p?.prixDealer ?? ""));
  const [fourId, setFourId]     = useState(p?.fournisseurId ?? "");
  const [imgPaths, setImgPaths] = useState<string[]>(
    p?.imagePaths?.length ? p.imagePaths : p?.imagePath ? [p.imagePath] : []
  );

  const handleSave = () => {
    if (!marque.trim()) return;
    const finalId = id.trim() || Date.now().toString();
    onSave({
      id: finalId,
      marque: marque.trim(),
      modele: modele.trim(),
      category: category.trim(),
      description: desc.trim(),
      stock: parseInt(stock) || 1,
      prixAchat: parseFloat(pa) || 0,
      prixVente: parseFloat(pv) || 0,
      serialImei: sn.trim(),
      imagePaths: imgPaths,
      imagePath: imgPaths[0] ?? "",
      fournisseurId: fourId,
      localId,
      isDeleted: false,
      nomDealer: dealer.trim(),
      prixDealer: parseFloat(pDealer) || 0,
    });
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
      zIndex:200, display:"flex", alignItems:"flex-end",
      justifyContent:"center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:"#fff", borderRadius:"24px 24px 0 0",
          width:"100%", maxWidth:700, maxHeight:"90vh",
          overflow:"auto", padding:"20px 20px 40px",
          boxSizing:"border-box" as const }}>
        {/* Handle */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:12 }}>
          <div style={{ width:40, height:4, background:"#ddd", borderRadius:2 }}/>
        </div>
        <h2 style={{ margin:"0 0 20px", fontSize:18, fontWeight:700, color:"#1a1a2e" }}>
          {p ? "Modifye Pwodwi" : "Ajoute Pwodwi"}
        </h2>

        {/* Image URLs */}
        <div style={{ marginBottom:16 }}>
          <p style={{ margin:"0 0 8px", color:"orange", fontWeight:700, fontSize:13 }}>
            📷 Foto ({imgPaths.length}/5)
          </p>
          <div style={{ display:"flex", gap:8, overflowX:"auto",
            paddingBottom:8 }}>
            {imgPaths.map((img, i) => (
              <div key={i} style={{ position:"relative", flexShrink:0 }}>
                <img src={img} alt=""
                  style={{ width:80, height:80, borderRadius:12,
                    objectFit:"cover",
                    border: i===0 ? "2px solid orange" : "none" }}/>
                <button onClick={() => setImgPaths(p => p.filter((_,j) => j!==i))}
                  style={{ position:"absolute", top:-6, right:-6,
                    width:20, height:20, borderRadius:"50%",
                    background:"#ff4444", border:"none", color:"#fff",
                    cursor:"pointer", fontSize:12, display:"flex",
                    alignItems:"center", justifyContent:"center" }}>
                  ×
                </button>
              </div>
            ))}
            {imgPaths.length < 5 && (
              <div style={{ width:80, height:80, borderRadius:12,
                border:"2px dashed #FFB74D", background:"#FFF8F0",
                display:"flex", flexDirection:"column" as const,
                alignItems:"center", justifyContent:"center",
                cursor:"pointer", flexShrink:0 }}
                onClick={() => {
                  const url = prompt("Kole URL foto a:");
                  if (url?.trim()) setImgPaths(p => [...p, url.trim()]);
                }}>
                <span style={{ fontSize:24 }}>📷</span>
                <span style={{ color:"orange", fontSize:10 }}>+ Foto</span>
              </div>
            )}
          </div>
        </div>

        {/* Fields */}
        {[
          { label:"ID / Nimewo", val:id, set:setId },
          { label:"Mak *", val:marque, set:setMarque },
          { label:"Modèl *", val:modele, set:setModele },
          { label:"Kategori", val:category, set:setCategory },
        ].map(f => (
          <input key={f.label} value={f.val}
            onChange={e => f.set(e.target.value)}
            placeholder={f.label}
            style={{ ...fldStyle, marginBottom:10 }}/>
        ))}

        <textarea value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="Deskripsyon" rows={2}
          style={{ ...fldStyle, marginBottom:10, resize:"vertical" as const }}/>

        <div style={{ display:"flex", gap:10, marginBottom:10 }}>
          {[
            { label:"Stock", val:stock, set:setStock },
            { label:"Prix Achat $", val:pa, set:setPa },
            { label:"Prix Vente $", val:pv, set:setPv },
          ].map(f => (
            <input key={f.label} value={f.val} type="number"
              onChange={e => f.set(e.target.value)}
              placeholder={f.label}
              style={{ ...fldStyle, flex:1 }}/>
          ))}
        </div>

        <input value={sn} onChange={e => setSn(e.target.value)}
          placeholder="S/N ou IMEI"
          style={{ ...fldStyle, marginBottom:10 }}/>

        {isAdmin && (
          <div style={{ background:"rgba(121,85,72,0.05)",
            border:"1px solid rgba(121,85,72,0.2)",
            borderRadius:12, padding:12, marginBottom:10 }}>
            <p style={{ margin:"0 0 10px", color:"#795548",
              fontWeight:700, fontSize:12 }}>🤝 Enfòmasyon Dealer</p>
            <input value={dealer} onChange={e => setDealer(e.target.value)}
              placeholder="Non Dealer"
              style={{ ...fldStyle, marginBottom:8 }}/>
            <input value={pDealer} onChange={e => setPDealer(e.target.value)}
              placeholder="Prix Dealer $" type="number"
              style={{ ...fldStyle }}/>
          </div>
        )}

        {fournisseurs.length > 0 && (
          <select value={fourId} onChange={e => setFourId(e.target.value)}
            style={{ ...fldStyle, marginBottom:10 }}>
            <option value="">— Sans fournisseur —</option>
            {fournisseurs.map(f => (
              <option key={f.id} value={f.id}>{f.nom}</option>
            ))}
          </select>
        )}

        <div style={{ display:"flex", gap:10, marginTop:8 }}>
          <button onClick={onClose}
            style={{ flex:1, padding:14, background:"#f5f5f5",
              border:"none", borderRadius:12, cursor:"pointer",
              fontSize:14, color:"#888" }}>
            Anile
          </button>
          <button onClick={handleSave}
            style={{ flex:2, padding:14, background:"#FF6B35",
              border:"none", borderRadius:12, cursor:"pointer",
              fontSize:14, fontWeight:700, color:"#fff" }}>
            {p ? "✅ Sove Chanjman" : "✅ Ajoute Pwodwi"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── IMAGE PREVIEW ────────────────────────────────────────────────────────────
function ImagePreview({ imgs, initialIndex, onClose }: {
  imgs: string[]; initialIndex: number; onClose: () => void;
}) {
  const [cur, setCur] = useState(initialIndex);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)",
      zIndex:300, display:"flex", flexDirection:"column" as const,
      alignItems:"center", justifyContent:"center" }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ maxWidth:600, width:"100%", padding:20 }}>
        <img src={imgs[cur]} alt=""
          style={{ width:"100%", maxHeight:"60vh", objectFit:"contain",
            borderRadius:16 }}/>
        {imgs.length > 1 && (
          <>
            <div style={{ display:"flex", justifyContent:"center",
              gap:6, marginTop:12 }}>
              {imgs.map((_, i) => (
                <div key={i} onClick={() => setCur(i)}
                  style={{ width: i===cur ? 20 : 8, height:8,
                    borderRadius:4, cursor:"pointer",
                    background: i===cur ? "orange" : "rgba(255,255,255,0.3)",
                    transition:"width 0.2s" }}/>
              ))}
            </div>
            <div style={{ display:"flex", gap:8, marginTop:12,
              justifyContent:"center", overflowX:"auto" }}>
              {imgs.map((img, i) => (
                <img key={i} src={img} alt=""
                  onClick={() => setCur(i)}
                  style={{ width:56, height:56, borderRadius:10,
                    objectFit:"cover", cursor:"pointer",
                    border: i===cur ? "2px solid orange" : "2px solid transparent" }}/>
              ))}
            </div>
          </>
        )}
        <button onClick={onClose}
          style={{ width:"100%", marginTop:16, padding:12,
            background:"rgba(255,255,255,0.1)", border:"none",
            color:"#fff", borderRadius:12, cursor:"pointer", fontSize:14 }}>
          Fèmen
        </button>
      </div>
    </div>
  );
}

// ─── CONFIRM MODAL ────────────────────────────────────────────────────────────
function ConfirmModal({ title, message, confirmLabel, confirmColor, onClose, onConfirm }: {
  title: string; message: string;
  confirmLabel: string; confirmColor: string;
  onClose: () => void; onConfirm: () => void;
}) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
      zIndex:200, display:"flex", alignItems:"center",
      justifyContent:"center", padding:20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:"#fff", borderRadius:20, padding:24,
          maxWidth:400, width:"100%" }}>
        <h3 style={{ margin:"0 0 12px", fontSize:17, fontWeight:700 }}>{title}</h3>
        <p style={{ margin:"0 0 20px", color:"#666", fontSize:14 }}>{message}</p>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onClose}
            style={{ flex:1, padding:12, background:"#f5f5f5",
              border:"none", borderRadius:12, cursor:"pointer" }}>
            Anile
          </button>
          <button onClick={onConfirm}
            style={{ flex:1, padding:12, background:confirmColor,
              border:"none", borderRadius:12, cursor:"pointer",
              color:"#fff", fontWeight:700 }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const fldStyle: React.CSSProperties = {
  width:"100%", padding:"12px 14px",
  background:"#f8f9fa", border:"1.5px solid #eee",
  borderRadius:12, color:"#1a1a2e", fontSize:14,
  outline:"none", fontFamily:"'Segoe UI',sans-serif",
  boxSizing:"border-box" as const,
};

const iconBtn = (color: string): React.CSSProperties => ({
  background:`${color}18`, border:`1px solid ${color}44`,
  color, width:32, height:32, borderRadius:8,
  cursor:"pointer", fontSize:14, display:"flex",
  alignItems:"center", justifyContent:"center",
});
