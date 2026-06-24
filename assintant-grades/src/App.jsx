import { useCallback, useEffect, useState } from "react";
import useLegacyRuntime from "./hooks/useLegacyRuntime";
import AuthScreen from "./components/AuthScreen";
import Sidebar from "./components/Sidebar";
import Pages from "./components/Pages";
import "./App.css";

export default function App() {
  useLegacyRuntime();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const toggleSidebar = useCallback((event) => {
    if (event) event.stopPropagation();
    setSidebarOpen((open) => !open);
  }, []);

  useEffect(() => {
    window.__closeSidebar = closeSidebar;
    return () => {
      delete window.__closeSidebar;
    };
  }, [closeSidebar]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeSidebar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSidebar]);

  return (
    <>
      <AuthScreen />
      <div id="app-shell" className={sidebarOpen ? "sidebar-open" : ""} onClick={closeSidebar}>
        <div className="mobile-topbar" onClick={(event) => event.stopPropagation()}>
          <button className="hamburger-btn" onClick={toggleSidebar} aria-label="Abrir menu">
            <span className="hamburger-line"></span>
            <span className="hamburger-line"></span>
            <span className="hamburger-line"></span>
          </button>
          <img src="/escudo_espoch.png" alt="ESPOCH" className="topbar-logo" />
          <span className="topbar-title">ESPOCH - Calificaciones</span>
        </div>
        <Sidebar onNavClick={closeSidebar} />
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
