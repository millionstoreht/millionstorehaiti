"use client";
import { useEffect, useState } from "react";

export default function InstallBanner() {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    // Deteksyon iPhone/iPad/Safari
    const ua = window.navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    setIsIOS(iosDevice);

    // Si app la deja enstale (mode standalone), pa montre bandwòl la
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as any).standalone === true;
    if (isStandalone) return;

    if (iosDevice) {
      // Sou iPhone/iPad — pa gen beforeinstallprompt, montre bandwòl manyèl la
      setShow(true);
      return;
    }

    // Sou Chrome/Android — koute evènman beforeinstallprompt
    if ((window as any).deferredInstallPrompt) setShow(true);

    const onAvailable = () => setShow(true);
    window.addEventListener("ms-install-available", onAvailable);
    return () => window.removeEventListener("ms-install-available", onAvailable);
  }, []);

  const handleInstall = async () => {
    if (isIOS) {
      setShowIOSInstructions(true);
      return;
    }
    const promptEvent = (window as any).deferredInstallPrompt;
    if (!promptEvent) return;
    promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === "accepted" || outcome === "dismissed") {
      (window as any).deferredInstallPrompt = null;
      setShow(false);
    }
  };

  if (!show || dismissed) return null;

  return (
    <>
      <div style={{
        position: "relative", zIndex: 100,
        background: "#1a1a2e", color: "#fff", padding: "10px 16px",
        display: "flex", alignItems: "center", gap: "12px",
        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
      }}>
        <img src="https://i.ibb.co/gLmkySCv/ab785ed1481b.jpg" alt="MillionStore"
          style={{ width: "40px", height: "40px", borderRadius: "10px", objectFit: "contain", background: "#fff" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: "14px" }}>Installer MillionStore</p>
          <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>millionstorehaiti.vercel.app</p>
        </div>
        <button onClick={handleInstall} style={{
          background: "none", border: "none", color: "#4dabf7",
          fontWeight: 700, fontSize: "14px", cursor: "pointer", flexShrink: 0,
        }}>
          Installer
        </button>
        <button onClick={() => setDismissed(true)} style={{
          background: "none", border: "none", color: "rgba(255,255,255,0.5)",
          fontSize: "18px", cursor: "pointer", flexShrink: 0, padding: "0 4px",
        }}>
          ×
        </button>
      </div>

      {/* Modal enstriksyon iPhone/Safari */}
      {showIOSInstructions && (
        <div onClick={() => setShowIOSInstructions(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 6000,
          display: "flex", alignItems: "flex-end", justifyContent: "center",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#fff", borderRadius: "20px 20px 0 0", width: "100%",
            maxWidth: "480px", padding: "24px", textAlign: "center",
          }}>
            <div style={{ width: "40px", height: "4px", background: "#e0e0e0", borderRadius: "2px", margin: "0 auto 20px" }} />
            <p style={{ fontSize: "40px", margin: "0 0 12px" }}>📲</p>
            <h3 style={{ margin: "0 0 16px", fontSize: "18px", fontWeight: 800, color: "#1a1a2e" }}>
              Installer sur iPhone
            </h3>
            <div style={{ textAlign: "left", background: "#f8f9fa", borderRadius: "14px", padding: "16px" }}>
              <p style={{ margin: "0 0 12px", fontSize: "14px", color: "#333", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ background: "#1a1a2e", color: "#fff", borderRadius: "50%", width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", flexShrink: 0 }}>1</span>
                Appuyez sur l'icône <strong>Partager</strong> ⬆️ en bas de Safari
              </p>
              <p style={{ margin: "0 0 12px", fontSize: "14px", color: "#333", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ background: "#1a1a2e", color: "#fff", borderRadius: "50%", width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", flexShrink: 0 }}>2</span>
                Faites défiler et appuyez sur <strong>« Sur l'écran d'accueil »</strong>
              </p>
              <p style={{ margin: 0, fontSize: "14px", color: "#333", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ background: "#1a1a2e", color: "#fff", borderRadius: "50%", width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", flexShrink: 0 }}>3</span>
                Appuyez sur <strong>« Ajouter »</strong>
              </p>
            </div>
            <button onClick={() => { setShowIOSInstructions(false); setDismissed(true); }} style={{
              width: "100%", marginTop: "20px", padding: "14px", background: "#1a1a2e",
              color: "#fff", border: "none", borderRadius: "12px", fontSize: "15px",
              fontWeight: 700, cursor: "pointer",
            }}>
              J'ai compris
            </button>
          </div>
        </div>
      )}
    </>
  );
}