const callGlobal = (name, ...args) => {
  if (typeof window !== "undefined" && typeof window[name] === "function") return window[name](...args);
};

export default function Sidebar({ onNavClick }) {
  const handleNavClick = (event) => {
    event.preventDefault();
    const page = event.currentTarget?.dataset?.page;
    if (page) callGlobal("navigate", page);
    if (onNavClick) onNavClick();
  };

  return (
    <aside id="sidebar" onClick={(event) => event.stopPropagation()}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-row">
          <img src="/escudo_espoch.png" alt="ESPOCH" className="brand-logo-img" />
          <div className="brand-text">
            <div className="title">ESPOCH</div>
            <div className="sub">Auxiliar de Calificaciones</div>
          </div>
        </div>
      </div>

      <div className="sidebar-course">
        <div className="course-label">Asignatura</div>
        <div className="course-name" id="sb-asignatura">—</div>
        <div className="course-tags">
          <span className="tag-pao" id="sb-pao">—</span>
          <span className="tag-aporte" id="sb-aporte">—</span>
        </div>
      </div>

      <div className="sidebar-pao-section" id="sidebar-pao-section">
        <div className="sidebar-pao-header">
          <span>Mis PAOs</span>
          <button className="btn btn-ghost btn-sm" onClick={() => { if (onNavClick) onNavClick(); callGlobal("cfgStartNew"); }} title="Nuevo PAO" style={{padding:"1px 6px",fontSize:"1.1rem",lineHeight:1}}>+</button>
        </div>
        <div id="sidebar-pao-list"></div>
      </div>

      <nav className="sidebar-nav">
        <a className="nav-item active" data-page="dashboard" href="#dashboard" onClick={handleNavClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          Dashboard
        </a>
        <a className="nav-item" data-page="configuracion" href="#configuracion" onClick={handleNavClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          Configuración
        </a>
        <a className="nav-item" data-page="estudiantes" href="#estudiantes" onClick={handleNavClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Estudiantes
        </a>
        <a className="nav-item" data-page="calificaciones" href="#calificaciones" onClick={handleNavClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Calificaciones
        </a>
        <a className="nav-item" data-page="reporte" href="#reporte" onClick={handleNavClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
          Reporte Final
        </a>
        <a className="nav-item" data-page="coordinacion" id="nav-coordinacion" href="#coordinacion" onClick={handleNavClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
          Coordinación
        </a>
        <a className="nav-item" data-page="coord-asignaturas" id="nav-coord-asig" href="#coord-asignaturas" onClick={handleNavClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4v15.5"/><path d="M20 22V4"/><path d="M8 6h8"/></svg>
          Asignaturas
        </a>
        <a className="nav-item" data-page="coord-rac" id="nav-coord-rac" href="#coord-rac" onClick={handleNavClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>
          RAC
        </a>
        <a className="nav-item" data-page="coord-raau" id="nav-coord-raau" href="#coord-raau" onClick={handleNavClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
          RAAU
        </a>
        <a className="nav-item" data-page="coord-docentes" id="nav-coord-docentes" href="#coord-docentes" onClick={handleNavClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6"/><path d="M23 11h-6"/></svg>
          Docentes por Asignatura
        </a>
        <div className="sidebar-nav-divider" id="nav-consulta-divider"></div>
        <div className="sidebar-nav-section" id="nav-consulta-section">Consultas</div>
        <a className="nav-item" data-page="consulta-sede" id="nav-consulta-sede" href="#consulta-sede" onClick={handleNavClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Sede Orellana
        </a>
        <a className="nav-item" data-page="consulta-informacion" id="nav-consulta-info" href="#consulta-informacion" onClick={handleNavClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          Información General
        </a>
        <a className="nav-item" data-page="consulta-estudiante" id="nav-consulta-est" href="#consulta-estudiante" onClick={handleNavClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Datos de Estudiante
        </a>
      </nav>

      <div className="sidebar-footer">
        <div className="footer-avatar">
          <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <div>
          <div className="footer-name" id="sb-docente">—</div>
          <div className="footer-role" id="sb-role">—</div>
        </div>
        <button className="btn btn-ghost btn-sm" style={{marginLeft:"auto"}} onClick={() => { if (onNavClick) onNavClick(); callGlobal("openProfile"); }} title="Mi perfil">Perfil</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { if (onNavClick) onNavClick(); callGlobal("doLogout"); }}>Salir</button>
      </div>
    </aside>
  );
}
