-- Supabase/PostgreSQL schema for ESPOCH Auxiliar de Calificaciones.
-- OASIS remains the official academic source. This database stores only
-- application-owned data and minimal OASIS references.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.docentes_sistema (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  cedula TEXT,
  nombres TEXT,
  rol TEXT NOT NULL DEFAULT 'docente',
  activo BOOLEAN DEFAULT true,
  fuente TEXT DEFAULT 'sistema',
  password_hash TEXT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.asignaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  docente_email TEXT NOT NULL,
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
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_asignaciones_docente_materia UNIQUE (docente_email, cod_periodo, cod_carrera, cod_materia, cod_nivel, paralelo)
);

CREATE TABLE IF NOT EXISTS public.configuraciones_pao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email TEXT NOT NULL,
  asignacion_id UUID NULL REFERENCES public.asignaciones(id) ON DELETE SET NULL,
  carrera TEXT,
  asignatura TEXT NOT NULL,
  pao TEXT,
  paralelo TEXT,
  aporte TEXT,
  estado TEXT DEFAULT 'borrador',
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_configuraciones_pao UNIQUE (owner_email, asignatura, pao, paralelo, aporte)
);

CREATE TABLE IF NOT EXISTS public.resultados_aprendizaje (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.configuraciones_pao(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('RAC', 'RAAU')),
  codigo TEXT,
  descripcion TEXT NOT NULL,
  rac_id_relacionado UUID NULL REFERENCES public.resultados_aprendizaje(id) ON DELETE SET NULL,
  orden INTEGER DEFAULT 0,
  activo BOOLEAN DEFAULT true,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_resultado_config_tipo_codigo UNIQUE (config_id, tipo, codigo)
);

CREATE TABLE IF NOT EXISTS public.actividades_evaluacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.configuraciones_pao(id) ON DELETE CASCADE,
  componente TEXT NOT NULL CHECK (componente IN ('ACD', 'APEX', 'AAUT')),
  nombre TEXT NOT NULL,
  descripcion TEXT,
  puntaje_maximo NUMERIC(5,2) NOT NULL CHECK (puntaje_maximo >= 0),
  rac_id UUID NULL REFERENCES public.resultados_aprendizaje(id) ON DELETE SET NULL,
  raau_id UUID NULL REFERENCES public.resultados_aprendizaje(id) ON DELETE SET NULL,
  procedimiento TEXT,
  orden INTEGER DEFAULT 0,
  activo BOOLEAN DEFAULT true,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_actividad_config_nombre UNIQUE (config_id, componente, nombre)
);

CREATE TABLE IF NOT EXISTS public.estudiantes_configuracion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.configuraciones_pao(id) ON DELETE CASCADE,
  cedula TEXT,
  codigo_estudiante TEXT,
  nombres TEXT NOT NULL,
  email TEXT,
  estado TEXT DEFAULT 'activo',
  fuente_oasis BOOLEAN DEFAULT true,
  data_minima JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_estudiante_config_cedula UNIQUE (config_id, cedula)
);

CREATE TABLE IF NOT EXISTS public.notas_estudiantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.configuraciones_pao(id) ON DELETE CASCADE,
  estudiante_id UUID NULL REFERENCES public.estudiantes_configuracion(id) ON DELETE SET NULL,
  estudiante_cedula TEXT,
  actividad_id UUID NOT NULL REFERENCES public.actividades_evaluacion(id) ON DELETE CASCADE,
  nota NUMERIC(5,2),
  observacion TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_nota_config_estudiante_actividad UNIQUE (config_id, estudiante_cedula, actividad_id),
  CONSTRAINT chk_nota_no_negativa CHECK (nota IS NULL OR nota >= 0)
);

CREATE TABLE IF NOT EXISTS public.resumen_calificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.configuraciones_pao(id) ON DELETE CASCADE,
  estudiante_id UUID NULL REFERENCES public.estudiantes_configuracion(id) ON DELETE SET NULL,
  estudiante_cedula TEXT,
  total NUMERIC(5,2),
  promedio NUMERIC(5,2),
  estado TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_resumen_config_estudiante UNIQUE (config_id, estudiante_cedula)
);

CREATE INDEX IF NOT EXISTS idx_docentes_email ON public.docentes_sistema(email);
CREATE INDEX IF NOT EXISTS idx_asignaciones_docente_email ON public.asignaciones(docente_email);
CREATE INDEX IF NOT EXISTS idx_asignaciones_cod_periodo ON public.asignaciones(cod_periodo);
CREATE INDEX IF NOT EXISTS idx_asignaciones_cod_materia ON public.asignaciones(cod_materia);
CREATE INDEX IF NOT EXISTS idx_config_owner_email ON public.configuraciones_pao(owner_email);
CREATE INDEX IF NOT EXISTS idx_config_asignacion_id ON public.configuraciones_pao(asignacion_id);
CREATE INDEX IF NOT EXISTS idx_resultados_config_id ON public.resultados_aprendizaje(config_id);
CREATE INDEX IF NOT EXISTS idx_actividades_config_id ON public.actividades_evaluacion(config_id);
CREATE INDEX IF NOT EXISTS idx_estudiantes_config_id ON public.estudiantes_configuracion(config_id);
CREATE INDEX IF NOT EXISTS idx_estudiantes_cedula ON public.estudiantes_configuracion(cedula);
CREATE INDEX IF NOT EXISTS idx_notas_config_id ON public.notas_estudiantes(config_id);
CREATE INDEX IF NOT EXISTS idx_notas_estudiante_cedula ON public.notas_estudiantes(estudiante_cedula);
CREATE INDEX IF NOT EXISTS idx_notas_actividad_id ON public.notas_estudiantes(actividad_id);
CREATE INDEX IF NOT EXISTS idx_resumen_config_id ON public.resumen_calificaciones(config_id);

DROP TRIGGER IF EXISTS trg_docentes_updated_at ON public.docentes_sistema;
CREATE TRIGGER trg_docentes_updated_at BEFORE UPDATE ON public.docentes_sistema
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_asignaciones_updated_at ON public.asignaciones;
CREATE TRIGGER trg_asignaciones_updated_at BEFORE UPDATE ON public.asignaciones
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_configuraciones_updated_at ON public.configuraciones_pao;
CREATE TRIGGER trg_configuraciones_updated_at BEFORE UPDATE ON public.configuraciones_pao
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_resultados_updated_at ON public.resultados_aprendizaje;
CREATE TRIGGER trg_resultados_updated_at BEFORE UPDATE ON public.resultados_aprendizaje
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_actividades_updated_at ON public.actividades_evaluacion;
CREATE TRIGGER trg_actividades_updated_at BEFORE UPDATE ON public.actividades_evaluacion
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_estudiantes_updated_at ON public.estudiantes_configuracion;
CREATE TRIGGER trg_estudiantes_updated_at BEFORE UPDATE ON public.estudiantes_configuracion
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_notas_updated_at ON public.notas_estudiantes;
CREATE TRIGGER trg_notas_updated_at BEFORE UPDATE ON public.notas_estudiantes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.is_docente_coordinador()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.docentes_sistema d
    WHERE d.email = auth.email()
      AND d.rol IN ('coordinador', 'admin')
      AND d.activo = true
  );
$$;

ALTER TABLE public.docentes_sistema ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuraciones_pao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resultados_aprendizaje ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actividades_evaluacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estudiantes_configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_estudiantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumen_calificaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS docentes_sistema_select ON public.docentes_sistema;
CREATE POLICY docentes_sistema_select ON public.docentes_sistema
FOR SELECT USING (email = auth.email() OR public.is_docente_coordinador());

DROP POLICY IF EXISTS docentes_sistema_manage ON public.docentes_sistema;
CREATE POLICY docentes_sistema_manage ON public.docentes_sistema
FOR ALL USING (public.is_docente_coordinador())
WITH CHECK (public.is_docente_coordinador());

DROP POLICY IF EXISTS asignaciones_owner ON public.asignaciones;
CREATE POLICY asignaciones_owner ON public.asignaciones
FOR ALL USING (docente_email = auth.email() OR public.is_docente_coordinador())
WITH CHECK (docente_email = auth.email() OR public.is_docente_coordinador());

DROP POLICY IF EXISTS configuraciones_owner ON public.configuraciones_pao;
CREATE POLICY configuraciones_owner ON public.configuraciones_pao
FOR ALL USING (owner_email = auth.email() OR public.is_docente_coordinador())
WITH CHECK (owner_email = auth.email() OR public.is_docente_coordinador());

DROP POLICY IF EXISTS resultados_por_config ON public.resultados_aprendizaje;
CREATE POLICY resultados_por_config ON public.resultados_aprendizaje
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.configuraciones_pao c
    WHERE c.id = config_id AND (c.owner_email = auth.email() OR public.is_docente_coordinador())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.configuraciones_pao c
    WHERE c.id = config_id AND (c.owner_email = auth.email() OR public.is_docente_coordinador())
  )
);

DROP POLICY IF EXISTS actividades_por_config ON public.actividades_evaluacion;
CREATE POLICY actividades_por_config ON public.actividades_evaluacion
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.configuraciones_pao c
    WHERE c.id = config_id AND (c.owner_email = auth.email() OR public.is_docente_coordinador())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.configuraciones_pao c
    WHERE c.id = config_id AND (c.owner_email = auth.email() OR public.is_docente_coordinador())
  )
);

DROP POLICY IF EXISTS estudiantes_por_config ON public.estudiantes_configuracion;
CREATE POLICY estudiantes_por_config ON public.estudiantes_configuracion
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.configuraciones_pao c
    WHERE c.id = config_id AND (c.owner_email = auth.email() OR public.is_docente_coordinador())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.configuraciones_pao c
    WHERE c.id = config_id AND (c.owner_email = auth.email() OR public.is_docente_coordinador())
  )
);

DROP POLICY IF EXISTS notas_por_config ON public.notas_estudiantes;
CREATE POLICY notas_por_config ON public.notas_estudiantes
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.configuraciones_pao c
    WHERE c.id = config_id AND (c.owner_email = auth.email() OR public.is_docente_coordinador())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.configuraciones_pao c
    WHERE c.id = config_id AND (c.owner_email = auth.email() OR public.is_docente_coordinador())
  )
);

DROP POLICY IF EXISTS resumen_por_config ON public.resumen_calificaciones;
CREATE POLICY resumen_por_config ON public.resumen_calificaciones
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.configuraciones_pao c
    WHERE c.id = config_id AND (c.owner_email = auth.email() OR public.is_docente_coordinador())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.configuraciones_pao c
    WHERE c.id = config_id AND (c.owner_email = auth.email() OR public.is_docente_coordinador())
  )
);
