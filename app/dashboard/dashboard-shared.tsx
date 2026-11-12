"use client";
import { createContext, useContext } from "react";
import { Globe } from "lucide-react";
import {
  ShoppingCart, BarChart2, Settings,
  Badge, Truck, HardHat, StickyNote, Info, Calculator, CalendarDays, Bike, ClipboardList,
} from "lucide-react";
import { db } from "../../lib/firebase";
import { getDocs, collection, query } from "firebase/firestore";

// ══════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════
export interface UserSession {
  uid: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  localId: string;
  permissions: Record<string, boolean>;
}

export interface MenuItem {
  key: string;
  label: string;
  icon: (size: number) => React.ReactNode;
  color: string;
  href: string;
  permKey?: string;
  adminOnly?: boolean;
  permDefault?: boolean;
  permKeys?: string[];
}

// ══════════════════════════════════════════════════════════════════════════
// MENU ITEMS
// ══════════════════════════════════════════════════════════════════════════
export const MENU_ITEMS: MenuItem[] = [
  { key: "rapports",      label: "Rapports",           icon: (s) => <BarChart2 size={s} />,     color: "#F44336", href: "/dashboard/rapports",      permKey: "rapportVoir" },
  { key: "parametres",    label: "Paramètres",         icon: (s) => <Settings size={s} />,      color: "#9E9E9E", href: "/dashboard/parametres",    permKey: "parametreVoir" },
  { key: "vendeurs",      label: "Vendeurs",           icon: (s) => <Badge size={s} />,         color: "#3F51B5", href: "/dashboard/vendeurs",      permKey: "vendeurVoir" },
  { key: "fournisseurs",  label: "Fournisseurs",       icon: (s) => <Truck size={s} />,         color: "#795548", href: "/dashboard/fournisseurs",  permKey: "fournisseurVoir" },
  { key: "workers",       label: "Employés",           icon: (s) => <HardHat size={s} />,       color: "#8D6E63", href: "/dashboard/workers",       permKey: "workersVoir" },
  { key: "notes",         label: "Notes",              icon: (s) => <StickyNote size={s} />,    color: "#FFC107", href: "/dashboard/notes",         permKey: "noteVoir" },
  { key: "site-settings", label: "Paramètres du site", icon: (s) => <Globe size={s} />,         color: "#e63946", href: "/dashboard/site-settings", adminOnly: true },
  { key: "commandes",     label: "Commandes",          icon: (s) => <ShoppingCart size={s} />,  color: "#FF5722", href: "/dashboard/commandes",     adminOnly: true },
  { key: "information",   label: "Informations",       icon: (s) => <Info size={s} />,          color: "#1565C0", href: "/dashboard/information",   permKey: "informationVoir", permDefault: true },
  { key: "calculatrice",  label: "Calculatrice",       icon: (s) => <Calculator size={s} />,    color: "#FF6B35", href: "/dashboard/calculatrice",  permKey: "calculatriceVoir" },
  { key: "calendrier",    label: "Calendrier",         icon: (s) => <CalendarDays size={s} />,  color: "#4A3AA7", href: "/dashboard/calendrier",    permKey: "calendrierVoir" },
  { key: "livraison",     label: "Livraison",          icon: (s) => <Bike size={s} />,          color: "#00D4AA", href: "/dashboard/livraison",     permKey: "livreurVoir" },
  { key: "rapportage",    label: "Rapportage",         icon: (s) => <ClipboardList size={s} />, color: "#7C5CFF", href: "/dashboard/rapportage",    permKeys: ["controlVoir", "rapportageVoir"] },
];

// Palette
export const C = {
  bg: "#FDF5EE", dark: "#1a1a2e", primary: "#FF9800", text: "#1a1a2e", grey: "#888",
  green: "#2EAD6B", red: "#E5484D", orange: "#FF9800", blue: "#2F80ED", purple: "#7C5CFF", teal: "#009688",
};

// ══════════════════════════════════════════════════════════════════════════
// FIRESTORE HELPERS
// ══════════════════════════════════════════════════════════════════════════
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch(() => { clearTimeout(t); resolve(fallback); });
  });
}

export async function readCol(path: string[], ms = 9000, constraints: any[] = []): Promise<any[]> {
  return withTimeout(
    (async () => {
      const ref = (collection as any)(db, ...path);
      const snap = await getDocs(constraints.length ? (query as any)(ref, ...constraints) : ref);
      return snap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
    })(),
    ms,
    [] as any[],
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CONTEXT (layout → pages)
// ══════════════════════════════════════════════════════════════════════════
export interface DashboardCtx {
  user: UserSession | null;
  visibleItems: MenuItem[];
  locals: { id: string; name: string }[];
  localId: string;
  setLocalId: (id: string) => void;
  online: boolean;
}

export const DashboardContext = createContext<DashboardCtx>({
  user: null,
  visibleItems: [],
  locals: [],
  localId: "",
  setLocalId: () => {},
  online: true,
});

export const useDash = () => useContext(DashboardContext);