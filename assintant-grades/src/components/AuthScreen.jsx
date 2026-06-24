const callGlobal = (name, ...args) => {
  if (typeof window !== "undefined" && typeof window[name] === "function") return window[name](...args);
};

export default function AuthScreen() {
  return (
    <div id="auth-screen">
      <div className="auth-centered">
        <div className="auth-card">
          <img src="/escudo_espoch.png" alt="ESPOCH" className="auth-shield" />
          <div style={{fontSize:"1.1rem",fontWeight:700,color:"var(--gray-800)",marginBottom:"2px"}}>Iniciar Sesión</div>
          <div style={{fontSize:".8rem",color:"var(--gray-500)",marginBottom:"18px"}}>Ingrese sus credenciales institucionales</div>
          <div className="form-group"><label className="form-label">Correo Institucional</label><input id="auth-email" className="form-input" placeholder="correo@espoch.edu.ec" /></div>
          <div className="form-group"><label className="form-label">Contraseña</label><input id="auth-pass" type="password" className="form-input" placeholder="••••••••" /></div>
          <button className="btn btn-primary auth-main-btn" onClick={() => callGlobal("doLogin")}>Ingresar</button>
          <div className="auth-demo-box">
            <div className="demo-note">Ingrese con sus credenciales institucionales o con la contraseña asignada por coordinación.</div>
          </div>
          <div id="auth-msg" className="auth-msg"></div>
          <div className="auth-footer">Escuela Superior Politécnica de Chimborazo · Sede Orellana</div>
        </div>
      </div>
    </div>
  );
}
