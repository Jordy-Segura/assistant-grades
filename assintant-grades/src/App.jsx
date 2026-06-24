import { useState, useCallback, useEffect } from "react";
import useLegacyRuntime from "./hooks/useLegacyRuntime";
import AuthScreen from "./components/AuthScreen";
import Sidebar from "./components/Sidebar";
import Pages from "./components/Pages";
import "./App.css";

export default function App() {
  useLegacyRuntime();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    window.__closeSidebar = closeSidebar;
    return () => { delete window.__closeSidebar; };
  }, [closeSidebar]);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape" && sidebarOpen) closeSidebar();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [sidebarOpen, closeSidebar]);

  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [sidebarOpen]);

  return (
    <>
      <AuthScreen />
      <div id="app-shell" className={sidebarOpen ? "sidebar-open" : ""} onClick={closeSidebar}>
        <div className="mobile-topbar" onClick={(e) => e.stopPropagation()}>
          <button className="hamburger-btn" onClick={(e) => { e.stopPropagation(); toggleSidebar(); }} aria-label="Abrir menú">
            <span className="hamburger-line"></span>
            <span className="hamburger-line"></span>
            <span className="hamburger-line"></span>
          </button>
          <img src="/escudo_espoch.png" alt="ESPOCH" className="topbar-logo" />
          <span className="topbar-title">ESPOCH · Calificaciones</span>
        </div>
        <Sidebar onToggle={toggleSidebar} sidebarOpen={sidebarOpen} onNavClick={closeSidebar} />
        <Pages />
      </div>

      <div id="toast">
        <svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01" fill="none" stroke="white" strokeWidth="2"/></svg>
        <span id="toast-text"></span>
      </div>

      <div className="modal-overlay" id="modal-overlay">
        <div className="modal"><div className="modal-title" id="modal-title"></div><div id="modal-body"></div><div className="modal-actions" id="modal-actions"></div></div>
      </div>

      <div className="modal-overlay" id="success-modal-overlay">
        <div className="modal" style={{textAlign:"center",maxWidth:"420px"}} id="success-modal"><div id="success-modal-content"></div></div>
      </div>

      <canvas id="confetti-canvas" style={{position:"fixed",inset:0,zIndex:9999,pointerEvents:"none",display:"none"}}></canvas>
    </>
  );
}
