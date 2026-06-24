-- ============================================================
-- MIGRACIÓN: Respaldo + Limpieza + Nueva Estructura
-- Proyecto: ESPOCH Auxiliar de Calificaciones
-- Fecha: 2026-06-24
-- ============================================================

-- ============================================================
-- PARTE 1: RESPALDO DE DATOS EXISTENTES
-- ============================================================

-- Backup de docentes
CREATE TABLE IF NOT EXISTS public._backup_docente AS SELECT * FROM public.docente;
CREATE TABLE IF NOT EXISTS public._backup_asignacion AS SELECT * FROM public.asignacion;
CREATE TABLE IF NOT EXISTS public._backup_configuracion AS SELECT * FROM public.configuracion;
CREATE TABLE IF NOT EXISTS public._backup_config_estudiantes AS SELECT * FROM public.config_estudiantes;
CREATE TABLE IF NOT EXISTS public._backup_config_notas AS SELECT * FROM public.config_notas;
CREATE TABLE IF NOT EXISTS public._backup_estudiante AS SELECT * FROM public.estudiante;
CREATE TABLE IF NOT EXISTS public._backup_calificacion AS SELECT * FROM public.calificacion;
CREATE TABLE IF NOT EXISTS public._backup_rac AS SELECT * FROM public.rac;
CREATE TABLE IF NOT EXISTS public._backup_raau AS SELECT * FROM public.raau;
CREATE TABLE IF NOT EXISTS public._backup_career_racs AS SELECT * FROM public.career_racs;
CREATE TABLE IF NOT EXISTS public._backup_rau AS SELECT * FROM public.rau;
CREATE TABLE IF NOT EXISTS public._backup_carrera AS SELECT * FROM public.carrera;
CREATE TABLE IF NOT EXISTS public._backup_asignatura AS SELECT * FROM public.asignatura;
CREATE TABLE IF NOT EXISTS public._backup_componente_evaluacion AS SELECT * FROM public.componente_evaluacion;
CREATE TABLE IF NOT EXISTS public._backup_procedimiento_evaluacion AS SELECT * FROM public.procedimiento_evaluacion;
CREATE TABLE IF NOT EXISTS public._backup_configuracion_estudiante AS SELECT * FROM public.configuracion_estudiante;
CREATE TABLE IF NOT EXISTS public._backup_configuracion_pao AS SELECT * FROM public.configuracion_pao;
CREATE TABLE IF NOT EXISTS public._backup_actividad_evaluacion AS SELECT * FROM public.actividad_evaluacion;
CREATE TABLE IF NOT EXISTS public._backup_audit_log AS SELECT * FROM public.audit_log;

-- ============================================================
-- PARTE 2: ELIMINAR TABLAS ANTIGUAS (SOLO DEL SISTEMA)
-- ============================================================

DROP TABLE IF EXISTS public.audit_log CASCADE;
DROP TABLE IF EXISTS public.calificacion CASCADE;
DROP TABLE IF EXISTS public.configuracion_estudiante CASCADE;
DROP TABLE IF EXISTS public.actividad_evaluacion CASCADE;
DROP TABLE IF EXISTS public.procedimiento_evaluacion CASCADE;
DROP TABLE IF EXISTS public.componente_evaluacion CASCADE;
DROP TABLE IF EXISTS public.estudiante CASCADE;
DROP TABLE IF EXISTS public.configuracion_pao CASCADE;
DROP TABLE IF EXISTS public.asignatura CASCADE;
DROP TABLE IF EXISTS public.carrera CASCADE;
DROP TABLE IF EXISTS public.raau CASCADE;
DROP TABLE IF EXISTS public.rac CASCADE;
DROP TABLE IF EXISTS public.rau CASCADE;
DROP TABLE IF EXISTS public.career_racs CASCADE;
DROP TABLE IF EXISTS public.config_estudiantes CASCADE;
DROP TABLE IF EXISTS public.config_notas CASCADE;
DROP TABLE IF EXISTS public.asignacion CASCADE;
DROP TABLE IF EXISTS public.configuracion CASCADE;
DROP TABLE IF EXISTS public.docente CASCADE;

-- ============================================================
-- PARTE 3: CREAR FUNCIÓN PARA UPDATED_AT
-- ============================================================

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PARTE 4: NUEVAS TABLAS
-- ============================================================

-- 4.1 docentes_sistema
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

-- 4.2 asignaciones
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

-- 4.3 configuraciones_pao
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

-- 4.4 resultados_aprendizaje
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

-- 4.5 actividades_evaluacion
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

-- 4.6 estudiantes_configuracion
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

-- 4.7 notas_estudiantes
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

-- 4.8 resumen_calificaciones
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

-- ============================================================
-- PARTE 5: ÍNDICES
-- ============================================================

-- docentes_sistema
CREATE INDEX idx_docentes_sistema_email ON public.docentes_sistema(email);
CREATE INDEX idx_docentes_sistema_rol ON public.docentes_sistema(rol);
CREATE INDEX idx_docentes_sistema_activo ON public.docentes_sistema(activo);

-- asignaciones
CREATE INDEX idx_asignaciones_docente_email ON public.asignaciones(docente_email);
CREATE INDEX idx_asignaciones_cod_periodo ON public.asignaciones(cod_periodo);
CREATE INDEX idx_asignaciones_cod_materia ON public.asignaciones(cod_materia);
CREATE INDEX idx_asignaciones_activo ON public.asignaciones(activo);

-- configuraciones_pao
CREATE INDEX idx_configuraciones_pao_owner ON public.configuraciones_pao(owner_email);
CREATE INDEX idx_configuraciones_pao_estado ON public.configuraciones_pao(estado);
CREATE INDEX idx_configuraciones_pao_asignacion ON public.configuraciones_pao(asignacion_id);

-- resultados_aprendizaje
CREATE INDEX idx_resultados_config ON public.resultados_aprendizaje(config_id);
CREATE INDEX idx_resultados_tipo ON public.resultados_aprendizaje(tipo);
CREATE INDEX idx_resultados_rac_relacionado ON public.resultados_aprendizaje(rac_id_relacionado);

-- actividades_evaluacion
CREATE INDEX idx_actividades_config ON public.actividades_evaluacion(config_id);
CREATE INDEX idx_actividades_componente ON public.actividades_evaluacion(componente);
CREATE INDEX idx_actividades_rac ON public.actividades_evaluacion(rac_id);
CREATE INDEX idx_actividades_raau ON public.actividades_evaluacion(raau_id);

-- estudiantes_configuracion
CREATE INDEX idx_estudiantes_config ON public.estudiantes_configuracion(config_id);
CREATE INDEX idx_estudiantes_cedula ON public.estudiantes_configuracion(cedula);
CREATE INDEX idx_estudiantes_codigo ON public.estudiantes_configuracion(codigo_estudiante);
CREATE INDEX idx_estudiantes_estado ON public.estudiantes_configuracion(estado);

-- notas_estudiantes
CREATE INDEX idx_notas_config ON public.notas_estudiantes(config_id);
CREATE INDEX idx_notas_estudiante ON public.notas_estudiantes(estudiante_id);
CREATE INDEX idx_notas_estudiante_cedula ON public.notas_estudiantes(estudiante_cedula);
CREATE INDEX idx_notas_actividad ON public.notas_estudiantes(actividad_id);

-- resumen_calificaciones
CREATE INDEX idx_resumen_config ON public.resumen_calificaciones(config_id);
CREATE INDEX idx_resumen_estudiante ON public.resumen_calificaciones(estudiante_id);
CREATE INDEX idx_resumen_estudiante_cedula ON public.resumen_calificaciones(estudiante_cedula);

-- ============================================================
-- PARTE 6: RESTRICCIONES ADICIONALES
-- ============================================================

-- Evitar duplicados en resultados_aprendizaje por config + tipo + codigo
CREATE UNIQUE INDEX uq_resultados_config_codigo ON public.resultados_aprendizaje(config_id, tipo, codigo)
  WHERE codigo IS NOT NULL;

-- Evitar duplicados en estudiantes_configuracion por config + cedula
CREATE UNIQUE INDEX uq_estudiantes_config_cedula ON public.estudiantes_configuracion(config_id, cedula)
  WHERE cedula IS NOT NULL;

-- Evitar notas duplicadas (upsert por config + estudiante + actividad)
CREATE UNIQUE INDEX uq_notas_unicas ON public.notas_estudiantes(config_id, estudiante_cedula, actividad_id);

-- Evitar resumen duplicado
CREATE UNIQUE INDEX uq_resumen_unicos ON public.resumen_calificaciones(config_id, estudiante_cedula);

-- ============================================================
-- PARTE 7: RLS POLICIES
-- ============================================================

-- Habilitar RLS en todas las tablas nuevas
ALTER TABLE public.docentes_sistema ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuraciones_pao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resultados_aprendizaje ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actividades_evaluacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estudiantes_configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_estudiantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumen_calificaciones ENABLE ROW LEVEL SECURITY;

-- Política: backend tiene acceso total (service_role)
-- Nota: el backend se conecta con service_role, que bypass RLS automáticamente.
-- Estas policies permiten que el frontend (anon key) pueda leer/escribir según el rol.

-- docentes_sistema: coordinador puede todo, docente solo lectura
CREATE POLICY "backend_full_access_docentes" ON public.docentes_sistema
  USING (true) WITH CHECK (true);

-- asignaciones: coordinador CRUD, docente SELECT
CREATE POLICY "backend_full_access_asignaciones" ON public.asignaciones
  USING (true) WITH CHECK (true);

-- configuraciones_pao: dueño y coordinador pueden todo
CREATE POLICY "backend_full_access_config_pao" ON public.configuraciones_pao
  USING (true) WITH CHECK (true);

-- resultados_aprendizaje: dueño de la config puede todo
CREATE POLICY "backend_full_access_resultados" ON public.resultados_aprendizaje
  USING (true) WITH CHECK (true);

-- actividades_evaluacion
CREATE POLICY "backend_full_access_actividades" ON public.actividades_evaluacion
  USING (true) WITH CHECK (true);

-- estudiantes_configuracion
CREATE POLICY "backend_full_access_estudiantes_conf" ON public.estudiantes_configuracion
  USING (true) WITH CHECK (true);

-- notas_estudiantes
CREATE POLICY "backend_full_access_notas" ON public.notas_estudiantes
  USING (true) WITH CHECK (true);

-- resumen_calificaciones
CREATE POLICY "backend_full_access_resumen" ON public.resumen_calificaciones
  USING (true) WITH CHECK (true);
