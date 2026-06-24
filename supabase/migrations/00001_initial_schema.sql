-- ============================================================
-- MIGRACIÓN INICIAL: ESQUEMA COMPLETO
-- Proyecto: ESPOCH Auxiliar de Calificaciones
-- Fecha: 2026-06-24
-- ============================================================
-- Esta migración crea la estructura completa de tablas,
-- índices, restricciones, triggers y políticas RLS.
-- 
-- NOTA: Antes de ejecutar esta migración por primera vez,
-- las tablas antiguas ya fueron respaldadas con prefijo _backup_
-- y eliminadas en una ejecución previa.
-- ============================================================

-- ============================================================
-- FUNCIÓN TRIGGER PARA UPDATED_AT
-- ============================================================
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$func$;

-- ============================================================
-- TABLA: docentes_sistema
-- ============================================================
CREATE TABLE public.docentes_sistema (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  cedula TEXT,
  nombres TEXT,
  rol TEXT NOT NULL DEFAULT 'docente',
  activo BOOLEAN DEFAULT true,
  fuente TEXT DEFAULT 'sistema',
  password_hash TEXT NULL,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_docentes_sistema_updated_at
  BEFORE UPDATE ON public.docentes_sistema
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_docentes_sistema_email ON public.docentes_sistema(email);
CREATE INDEX IF NOT EXISTS idx_docentes_sistema_rol ON public.docentes_sistema(rol);
CREATE INDEX IF NOT EXISTS idx_docentes_sistema_activo ON public.docentes_sistema(activo);

-- ============================================================
-- TABLA: asignaciones
-- ============================================================
CREATE TABLE public.asignaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  docente_email TEXT NOT NULL REFERENCES public.docentes_sistema(email) ON DELETE CASCADE,
  carrera TEXT,
  asignatura TEXT NOT NULL,
  pao TEXT,
  paralelo TEXT,
  cod_carrera TEXT,
  cod_materia TEXT,
  cod_nivel TEXT,
  cod_periodo TEXT,
  fuente_oasis BOOLEAN DEFAULT true,
  activo BOOLEAN DEFAULT true,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_asignaciones_updated_at
  BEFORE UPDATE ON public.asignaciones
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_asignaciones_docente_email ON public.asignaciones(docente_email);
CREATE INDEX IF NOT EXISTS idx_asignaciones_cod_periodo ON public.asignaciones(cod_periodo);
CREATE INDEX IF NOT EXISTS idx_asignaciones_cod_materia ON public.asignaciones(cod_materia);
CREATE INDEX IF NOT EXISTS idx_asignaciones_activo ON public.asignaciones(activo);

-- ============================================================
-- TABLA: configuraciones_pao
-- ============================================================
CREATE TABLE public.configuraciones_pao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email TEXT NOT NULL,
  asignacion_id UUID NULL REFERENCES public.asignaciones(id) ON DELETE SET NULL,
  carrera TEXT,
  asignatura TEXT NOT NULL,
  pao TEXT,
  paralelo TEXT,
  aporte TEXT,
  estado TEXT DEFAULT 'borrador',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_configuraciones_pao_updated_at
  BEFORE UPDATE ON public.configuraciones_pao
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_configuraciones_pao_owner ON public.configuraciones_pao(owner_email);
CREATE INDEX IF NOT EXISTS idx_configuraciones_pao_estado ON public.configuraciones_pao(estado);
CREATE INDEX IF NOT EXISTS idx_configuraciones_pao_asignacion ON public.configuraciones_pao(asignacion_id);

-- ============================================================
-- TABLA: resultados_aprendizaje
-- ============================================================
CREATE TABLE public.resultados_aprendizaje (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.configuraciones_pao(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('RAC', 'RAAU')),
  codigo TEXT,
  descripcion TEXT NOT NULL,
  rac_id_relacionado UUID NULL REFERENCES public.resultados_aprendizaje(id) ON DELETE SET NULL,
  orden INTEGER DEFAULT 0,
  activo BOOLEAN DEFAULT true,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_resultados_aprendizaje_updated_at
  BEFORE UPDATE ON public.resultados_aprendizaje
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_resultados_config ON public.resultados_aprendizaje(config_id);
CREATE INDEX IF NOT EXISTS idx_resultados_tipo ON public.resultados_aprendizaje(tipo);
CREATE INDEX IF NOT EXISTS idx_resultados_rac_relacionado ON public.resultados_aprendizaje(rac_id_relacionado);

-- Evitar duplicados: mismo config + mismo tipo + mismo código
ALTER TABLE public.resultados_aprendizaje
  ADD CONSTRAINT uq_resultados_config_codigo UNIQUE (config_id, tipo, codigo);

-- ============================================================
-- TABLA: actividades_evaluacion
-- ============================================================
CREATE TABLE public.actividades_evaluacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.configuraciones_pao(id) ON DELETE CASCADE,
  componente TEXT NOT NULL CHECK (componente IN ('ACD', 'APEX', 'AAUT')),
  nombre TEXT NOT NULL,
  descripcion TEXT,
  puntaje_maximo NUMERIC(5,2) NOT NULL,
  rac_id UUID NULL REFERENCES public.resultados_aprendizaje(id) ON DELETE SET NULL,
  raau_id UUID NULL REFERENCES public.resultados_aprendizaje(id) ON DELETE SET NULL,
  procedimiento TEXT,
  orden INTEGER DEFAULT 0,
  activo BOOLEAN DEFAULT true,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_actividades_evaluacion_updated_at
  BEFORE UPDATE ON public.actividades_evaluacion
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_actividades_config ON public.actividades_evaluacion(config_id);
CREATE INDEX IF NOT EXISTS idx_actividades_componente ON public.actividades_evaluacion(componente);
CREATE INDEX IF NOT EXISTS idx_actividades_rac ON public.actividades_evaluacion(rac_id);
CREATE INDEX IF NOT EXISTS idx_actividades_raau ON public.actividades_evaluacion(raau_id);

-- ============================================================
-- TABLA: estudiantes_configuracion
-- ============================================================
CREATE TABLE public.estudiantes_configuracion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.configuraciones_pao(id) ON DELETE CASCADE,
  cedula TEXT,
  codigo_estudiante TEXT,
  nombres TEXT NOT NULL,
  email TEXT,
  estado TEXT DEFAULT 'activo',
  fuente_oasis BOOLEAN DEFAULT true,
  data_minima JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_estudiantes_configuracion_updated_at
  BEFORE UPDATE ON public.estudiantes_configuracion
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_estudiantes_config ON public.estudiantes_configuracion(config_id);
CREATE INDEX IF NOT EXISTS idx_estudiantes_cedula ON public.estudiantes_configuracion(cedula);
CREATE INDEX IF NOT EXISTS idx_estudiantes_codigo ON public.estudiantes_configuracion(codigo_estudiante);
CREATE INDEX IF NOT EXISTS idx_estudiantes_estado ON public.estudiantes_configuracion(estado);

-- Evitar duplicados de estudiante por configuración
ALTER TABLE public.estudiantes_configuracion
  ADD CONSTRAINT uq_estudiantes_config_cedula UNIQUE (config_id, cedula);

-- ============================================================
-- TABLA: notas_estudiantes
-- ============================================================
CREATE TABLE public.notas_estudiantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.configuraciones_pao(id) ON DELETE CASCADE,
  estudiante_id UUID NULL REFERENCES public.estudiantes_configuracion(id) ON DELETE CASCADE,
  estudiante_cedula TEXT,
  actividad_id UUID NOT NULL REFERENCES public.actividades_evaluacion(id) ON DELETE CASCADE,
  nota NUMERIC(5,2),
  observacion TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_notas_estudiantes_updated_at
  BEFORE UPDATE ON public.notas_estudiantes
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_notas_config ON public.notas_estudiantes(config_id);
CREATE INDEX IF NOT EXISTS idx_notas_estudiante ON public.notas_estudiantes(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_notas_estudiante_cedula ON public.notas_estudiantes(estudiante_cedula);
CREATE INDEX IF NOT EXISTS idx_notas_actividad ON public.notas_estudiantes(actividad_id);

-- Evitar notas duplicadas: upsert por (config_id, estudiante_cedula, actividad_id)
ALTER TABLE public.notas_estudiantes
  ADD CONSTRAINT uq_notas_unicas UNIQUE (config_id, estudiante_cedula, actividad_id);

-- ============================================================
-- TABLA: resumen_calificaciones
-- ============================================================
CREATE TABLE public.resumen_calificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.configuraciones_pao(id) ON DELETE CASCADE,
  estudiante_id UUID NULL REFERENCES public.estudiantes_configuracion(id) ON DELETE CASCADE,
  estudiante_cedula TEXT,
  total NUMERIC(5,2),
  promedio NUMERIC(5,2),
  estado TEXT,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_resumen_calificaciones_updated_at
  BEFORE UPDATE ON public.resumen_calificaciones
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_resumen_config ON public.resumen_calificaciones(config_id);
CREATE INDEX IF NOT EXISTS idx_resumen_estudiante ON public.resumen_calificaciones(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_resumen_estudiante_cedula ON public.resumen_calificaciones(estudiante_cedula);

-- Evitar duplicados de resumen
ALTER TABLE public.resumen_calificaciones
  ADD CONSTRAINT uq_resumen_unicos UNIQUE (config_id, estudiante_cedula);

-- ============================================================
-- POLÍTICAS RLS
-- ============================================================
-- El backend se conecta con service_role que bypass RLS automáticamente.
-- Estas políticas permiten acceso total al backend.
-- En producción, se pueden refinar por rol (coordinador vs docente).

ALTER TABLE public.docentes_sistema ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuraciones_pao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resultados_aprendizaje ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actividades_evaluacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estudiantes_configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_estudiantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumen_calificaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backend_full_access" ON public.docentes_sistema USING (true) WITH CHECK (true);
CREATE POLICY "backend_full_access" ON public.asignaciones USING (true) WITH CHECK (true);
CREATE POLICY "backend_full_access" ON public.configuraciones_pao USING (true) WITH CHECK (true);
CREATE POLICY "backend_full_access" ON public.resultados_aprendizaje USING (true) WITH CHECK (true);
CREATE POLICY "backend_full_access" ON public.actividades_evaluacion USING (true) WITH CHECK (true);
CREATE POLICY "backend_full_access" ON public.estudiantes_configuracion USING (true) WITH CHECK (true);
CREATE POLICY "backend_full_access" ON public.notas_estudiantes USING (true) WITH CHECK (true);
CREATE POLICY "backend_full_access" ON public.resumen_calificaciones USING (true) WITH CHECK (true);
