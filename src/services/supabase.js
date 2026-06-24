import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Auth ----

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signUp(email, password, userData) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: userData },
  });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

// ---- Docentes ----

export async function getDocentes() {
  const { data, error } = await supabase
    .from("docente")
    .select("*")
    .order("nombre", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function upsertDocente(docente) {
  const { error } = await supabase.from("docente").upsert(docente, {
    onConflict: "email",
  });
  if (error) throw error;
}

export async function deleteDocente(email) {
  const { error } = await supabase.from("docente").delete().eq("email", email);
  if (error) throw error;
}

// ---- Asignaciones (qué docente dicta qué materia) ----

export async function getAsignaciones() {
  const { data, error } = await supabase
    .from("asignacion")
    .select("*")
    .order("carrera", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function upsertAsignacion(asignacion) {
  const { error } = await supabase.from("asignacion").upsert(asignacion, {
    onConflict: "id",
  });
  if (error) throw error;
}

export async function deleteAsignacion(id) {
  const { error } = await supabase.from("asignacion").delete().eq("id", id);
  if (error) throw error;
}

// ---- Configuraciones (RAC, RAAU, actividades) ----

export async function getConfiguraciones(ownerEmail) {
  let query = supabase
    .from("configuracion")
    .select("*")
    .order("updated_at", { ascending: false });
  if (ownerEmail) query = query.eq("owner_email", ownerEmail);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function upsertConfiguracion(config) {
  const { error } = await supabase.from("configuracion").upsert(config, {
    onConflict: "id",
  });
  if (error) throw error;
}

export async function deleteConfiguracion(id) {
  const { error } = await supabase.from("configuracion").delete().eq("id", id);
  if (error) throw error;
}

// ---- Estudiantes por configuración ----

export async function getEstudiantes(configId) {
  const { data, error } = await supabase
    .from("config_estudiantes")
    .select("data")
    .eq("config_id", configId)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data?.data || [];
}

export async function upsertEstudiantes(configId, estudiantes) {
  const { error } = await supabase
    .from("config_estudiantes")
    .upsert({ config_id: configId, data: estudiantes }, { onConflict: "config_id" });
  if (error) throw error;
}

// ---- Notas por configuración ----

export async function getNotas(configId) {
  const { data, error } = await supabase
    .from("config_notas")
    .select("data")
    .eq("config_id", configId)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data?.data || [];
}

export async function upsertNotas(configId, notas) {
  const { error } = await supabase
    .from("config_notas")
    .upsert({ config_id: configId, data: notas }, { onConflict: "config_id" });
  if (error) throw error;
}

// ---- Sync completo (similar al getStore/putStore original) ----

export async function getStore({ email, role }) {
  const docentes = role === "coordinador" ? await getDocentes() : [];
  const asignaciones = role === "coordinador" ? await getAsignaciones() : [];
  const configs = await getConfiguraciones(role === "coordinador" ? undefined : email);
  const ids = configs.map((c) => c.id).filter(Boolean);
  const studentsByConfig = {};
  const gradesByConfig = {};
  for (const id of ids) {
    studentsByConfig[id] = await getEstudiantes(id);
    gradesByConfig[id] = await getNotas(id);
  }
  return { docentes, teacherAssignments: asignaciones, savedConfigs: configs, studentsByConfig, gradesByConfig };
}

export async function putStore(payload) {
  const { email, role, docentes, teacherAssignments, savedConfigs, studentsByConfig, gradesByConfig } = payload;
  if (role === "coordinador" && Array.isArray(docentes)) {
    for (const d of docentes) if (d.email) await upsertDocente(d);
  }
  if (role === "coordinador" && Array.isArray(teacherAssignments)) {
    for (const a of teacherAssignments) if (a.id) await upsertAsignacion(a);
  }
  if (Array.isArray(savedConfigs)) {
    for (const c of savedConfigs) if (c.id) await upsertConfiguracion(c);
  }
  if (studentsByConfig) {
    for (const [configId, arr] of Object.entries(studentsByConfig)) {
      await upsertEstudiantes(configId, arr);
    }
  }
  if (gradesByConfig) {
    for (const [configId, arr] of Object.entries(gradesByConfig)) {
      await upsertNotas(configId, arr);
    }
  }
  return { ok: true };
}
