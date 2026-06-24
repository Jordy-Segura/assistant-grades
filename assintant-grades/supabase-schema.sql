-- Esquema de Supabase para el Asistente de Calificaciones ESPOCH
-- Ejecutar en: Supabase Dashboard > SQL Editor

-- 1. Docentes
CREATE TABLE IF NOT EXISTS docente (
  email TEXT PRIMARY KEY,
  nombre TEXT,
  cedula TEXT,
  rol TEXT DEFAULT 'docente',
  password TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Asignaciones (docente ↔ materia)
CREATE TABLE IF NOT EXISTS asignacion (
  id TEXT PRIMARY KEY,
  docente_email TEXT,
  carrera TEXT,
  asignatura TEXT,
  pao TEXT,
  paralelo TEXT,
  cod_carrera TEXT,
  cod_materia TEXT,
  cod_nivel TEXT,
  cod_periodo TEXT,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Configuraciones (RAC, RAAU, actividades)
CREATE TABLE IF NOT EXISTS configuracion (
  id TEXT PRIMARY KEY,
  owner_email TEXT,
  carrera TEXT,
  asignatura TEXT,
  pao TEXT,
  data JSONB,
  saved_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Estudiantes por configuración
CREATE TABLE IF NOT EXISTS config_estudiantes (
  config_id TEXT PRIMARY KEY REFERENCES configuracion(id) ON DELETE CASCADE,
  data JSONB
);

-- 5. Notas por configuración
CREATE TABLE IF NOT EXISTS config_notas (
  config_id TEXT PRIMARY KEY REFERENCES configuracion(id) ON DELETE CASCADE,
  data JSONB
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_asignacion_docente ON asignacion(docente_email);
CREATE INDEX IF NOT EXISTS idx_config_owner ON configuracion(owner_email);
CREATE INDEX IF NOT EXISTS idx_config_carrera ON configuracion(carrera);

-- Row Level Security
ALTER TABLE docente ENABLE ROW LEVEL SECURITY;
ALTER TABLE asignacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_estudiantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_notas ENABLE ROW LEVEL SECURITY;

-- Políticas: coordinador ve todo, docente ve solo lo suyo
CREATE POLICY "Coordinador: todo" ON docente FOR ALL USING (auth.email() IN (SELECT email FROM docente WHERE rol = 'coordinador'));
CREATE POLICY "Coordinador: todo asignacion" ON asignacion FOR ALL USING (auth.email() IN (SELECT email FROM docente WHERE rol = 'coordinador'));
CREATE POLICY "Coordinador: todo config" ON configuracion FOR ALL USING (auth.email() IN (SELECT email FROM docente WHERE rol = 'coordinador'));
CREATE POLICY "Coordinador: todo estudiantes" ON config_estudiantes FOR ALL USING (true);
CREATE POLICY "Coordinador: todo notas" ON config_notas FOR ALL USING (true);

CREATE POLICY "Docente: ver propio" ON docente FOR SELECT USING (email = auth.email());
CREATE POLICY "Docente: ver asignaciones" ON asignacion FOR SELECT USING (docente_email = auth.email());
CREATE POLICY "Docente: ver configs" ON configuracion FOR ALL USING (owner_email = auth.email());
CREATE POLICY "Docente: ver estudiantes" ON config_estudiantes FOR ALL USING (true);
CREATE POLICY "Docente: ver notas" ON config_notas FOR ALL USING (true);
