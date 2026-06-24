-- Neon/PostgreSQL schema for ESPOCH Auxiliar de Calificaciones.
-- App-owned data only. OASIS remains the official academic source.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.app_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.app_docentes_sistema (
  email TEXT PRIMARY KEY,
  cedula TEXT,
  nombres TEXT,
  rol TEXT NOT NULL DEFAULT 'docente',
  activo BOOLEAN NOT NULL DEFAULT true,
  fuente TEXT NOT NULL DEFAULT 'sistema',
  password_hash TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_user_sessions (
  email TEXT PRIMARY KEY REFERENCES public.app_docentes_sistema(email) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_asignaciones (
  id TEXT PRIMARY KEY,
  docente_email TEXT NOT NULL,
  carrera TEXT,
  asignatura TEXT NOT NULL,
  pao TEXT,
  paralelo TEXT,
  cod_carrera TEXT,
  cod_materia TEXT,
  cod_nivel TEXT,
  cod_periodo TEXT,
  fuente_oasis BOOLEAN NOT NULL DEFAULT true,
  activo BOOLEAN NOT NULL DEFAULT true,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_configuraciones_pao (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  asignacion_id TEXT NULL REFERENCES public.app_asignaciones(id) ON DELETE SET NULL,
  carrera TEXT,
  asignatura TEXT NOT NULL,
  pao TEXT,
  paralelo TEXT,
  aporte TEXT,
  cod_carrera TEXT,
  cod_materia TEXT,
  cod_nivel TEXT,
  cod_periodo TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador',
  activo BOOLEAN NOT NULL DEFAULT true,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  saved_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_resultados_aprendizaje (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL REFERENCES public.app_configuraciones_pao(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('RAC', 'RAAU')),
  legacy_id TEXT,
  codigo TEXT,
  descripcion TEXT NOT NULL DEFAULT '',
  rac_id_relacionado TEXT NULL REFERENCES public.app_resultados_aprendizaje(id) ON DELETE SET NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT true,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_app_resultado_config_tipo_legacy UNIQUE (config_id, tipo, legacy_id)
);

CREATE TABLE IF NOT EXISTS public.app_actividades_evaluacion (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL REFERENCES public.app_configuraciones_pao(id) ON DELETE CASCADE,
  legacy_id TEXT NOT NULL,
  componente TEXT NOT NULL CHECK (componente IN ('ACD', 'APEX', 'AAUT')),
  nombre TEXT NOT NULL,
  puntaje_maximo NUMERIC(5,2) NOT NULL CHECK (puntaje_maximo >= 0),
  rac_legacy_id TEXT,
  raau_legacy_id TEXT,
  procedimiento TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT true,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_app_actividad_config_legacy UNIQUE (config_id, legacy_id)
);

CREATE TABLE IF NOT EXISTS public.app_estudiantes_configuracion (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL REFERENCES public.app_configuraciones_pao(id) ON DELETE CASCADE,
  student_legacy_id TEXT NOT NULL,
  cedula TEXT,
  codigo_estudiante TEXT,
  apellidos TEXT,
  nombres TEXT NOT NULL DEFAULT '',
  email TEXT,
  estado TEXT NOT NULL DEFAULT 'activo',
  fuente_oasis BOOLEAN NOT NULL DEFAULT true,
  activo BOOLEAN NOT NULL DEFAULT true,
  orden INTEGER NOT NULL DEFAULT 0,
  data_minima JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_app_estudiante_config_legacy UNIQUE (config_id, student_legacy_id)
);

CREATE TABLE IF NOT EXISTS public.app_notas_estudiantes (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL REFERENCES public.app_configuraciones_pao(id) ON DELETE CASCADE,
  estudiante_id TEXT NULL REFERENCES public.app_estudiantes_configuracion(id) ON DELETE SET NULL,
  student_legacy_id TEXT NOT NULL,
  activity_legacy_id TEXT NOT NULL,
  nota NUMERIC(5,2),
  observacion TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_app_nota_config_est_act UNIQUE (config_id, student_legacy_id, activity_legacy_id),
  CONSTRAINT chk_app_nota_no_negativa CHECK (nota IS NULL OR nota >= 0)
);

CREATE TABLE IF NOT EXISTS public.app_resumen_calificaciones (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL REFERENCES public.app_configuraciones_pao(id) ON DELETE CASCADE,
  estudiante_id TEXT NULL REFERENCES public.app_estudiantes_configuracion(id) ON DELETE SET NULL,
  student_legacy_id TEXT NOT NULL,
  estudiante_cedula TEXT,
  total NUMERIC(5,2),
  promedio NUMERIC(5,2),
  estado TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_app_resumen_config_estudiante UNIQUE (config_id, student_legacy_id)
);

CREATE TABLE IF NOT EXISTS public.app_vectores_catalogo (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('RAC', 'RAAU', 'PROCEDIMIENTO')),
  carrera TEXT,
  asignatura TEXT,
  componente TEXT,
  legacy_id TEXT,
  codigo TEXT,
  descripcion TEXT NOT NULL DEFAULT '',
  rac_legacy_id TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_docentes_rol ON public.app_docentes_sistema(rol);
CREATE INDEX IF NOT EXISTS idx_app_user_sessions_expires ON public.app_user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_app_asignaciones_docente ON public.app_asignaciones(docente_email);
CREATE INDEX IF NOT EXISTS idx_app_asignaciones_periodo ON public.app_asignaciones(cod_periodo);
CREATE INDEX IF NOT EXISTS idx_app_config_owner ON public.app_configuraciones_pao(owner_email);
CREATE INDEX IF NOT EXISTS idx_app_config_oasis ON public.app_configuraciones_pao(cod_periodo, cod_carrera, cod_materia, paralelo);
CREATE INDEX IF NOT EXISTS idx_app_resultados_config ON public.app_resultados_aprendizaje(config_id);
CREATE INDEX IF NOT EXISTS idx_app_actividades_config ON public.app_actividades_evaluacion(config_id);
CREATE INDEX IF NOT EXISTS idx_app_estudiantes_config ON public.app_estudiantes_configuracion(config_id);
CREATE INDEX IF NOT EXISTS idx_app_estudiantes_cedula ON public.app_estudiantes_configuracion(cedula);
CREATE INDEX IF NOT EXISTS idx_app_notas_config ON public.app_notas_estudiantes(config_id);
CREATE INDEX IF NOT EXISTS idx_app_notas_estudiante ON public.app_notas_estudiantes(student_legacy_id);
CREATE INDEX IF NOT EXISTS idx_app_resumen_config ON public.app_resumen_calificaciones(config_id);
CREATE INDEX IF NOT EXISTS idx_app_vectores_tipo ON public.app_vectores_catalogo(tipo);
CREATE INDEX IF NOT EXISTS idx_app_vectores_asignatura ON public.app_vectores_catalogo(asignatura);
CREATE INDEX IF NOT EXISTS idx_app_vectores_rac ON public.app_vectores_catalogo(rac_legacy_id);

DROP TRIGGER IF EXISTS trg_app_docentes_updated_at ON public.app_docentes_sistema;
CREATE TRIGGER trg_app_docentes_updated_at BEFORE UPDATE ON public.app_docentes_sistema
FOR EACH ROW EXECUTE FUNCTION public.app_set_updated_at();

DROP TRIGGER IF EXISTS trg_app_user_sessions_updated_at ON public.app_user_sessions;
CREATE TRIGGER trg_app_user_sessions_updated_at BEFORE UPDATE ON public.app_user_sessions
FOR EACH ROW EXECUTE FUNCTION public.app_set_updated_at();

DROP TRIGGER IF EXISTS trg_app_asignaciones_updated_at ON public.app_asignaciones;
CREATE TRIGGER trg_app_asignaciones_updated_at BEFORE UPDATE ON public.app_asignaciones
FOR EACH ROW EXECUTE FUNCTION public.app_set_updated_at();

DROP TRIGGER IF EXISTS trg_app_config_updated_at ON public.app_configuraciones_pao;
CREATE TRIGGER trg_app_config_updated_at BEFORE UPDATE ON public.app_configuraciones_pao
FOR EACH ROW EXECUTE FUNCTION public.app_set_updated_at();

DROP TRIGGER IF EXISTS trg_app_resultados_updated_at ON public.app_resultados_aprendizaje;
CREATE TRIGGER trg_app_resultados_updated_at BEFORE UPDATE ON public.app_resultados_aprendizaje
FOR EACH ROW EXECUTE FUNCTION public.app_set_updated_at();

DROP TRIGGER IF EXISTS trg_app_actividades_updated_at ON public.app_actividades_evaluacion;
CREATE TRIGGER trg_app_actividades_updated_at BEFORE UPDATE ON public.app_actividades_evaluacion
FOR EACH ROW EXECUTE FUNCTION public.app_set_updated_at();

DROP TRIGGER IF EXISTS trg_app_estudiantes_updated_at ON public.app_estudiantes_configuracion;
CREATE TRIGGER trg_app_estudiantes_updated_at BEFORE UPDATE ON public.app_estudiantes_configuracion
FOR EACH ROW EXECUTE FUNCTION public.app_set_updated_at();

DROP TRIGGER IF EXISTS trg_app_notas_updated_at ON public.app_notas_estudiantes;
CREATE TRIGGER trg_app_notas_updated_at BEFORE UPDATE ON public.app_notas_estudiantes
FOR EACH ROW EXECUTE FUNCTION public.app_set_updated_at();

DROP TRIGGER IF EXISTS trg_app_vectores_updated_at ON public.app_vectores_catalogo;
CREATE TRIGGER trg_app_vectores_updated_at BEFORE UPDATE ON public.app_vectores_catalogo
FOR EACH ROW EXECUTE FUNCTION public.app_set_updated_at();
