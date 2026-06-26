// ============================================================================
// CONSTANTES COMPARTIDAS del runtime (sin estado mutable)
// ----------------------------------------------------------------------------
// Valores fijos usados por varias capas: pesos/colores/etiquetas de los
// componentes de evaluación y el usuario coordinador base.
// ============================================================================

export const COMPONENT_WEIGHTS = { ACD: 3.5, APEX: 3.5, AAUT: 3.0 };
export const COMPONENT_COLORS = { ACD: '#3b82f6', APEX: '#22c55e', AAUT: '#f59e0b' };
export const COMPONENT_LABELS = { ACD: 'Aprendizaje en Contacto con el Docente', APEX: 'Aprendizaje Práctico Experimental', AAUT: 'Aprendizaje Autónomo' };
export const COMPONENTS = ['ACD', 'APEX', 'AAUT'];
// Usuario base para asignaciones. Su autenticacion se valida en Neon/OASIS.
export const COORDINADOR = { email: 'ppaguay@espoch.edu.ec', role: 'coordinador', name: 'PAUL PAGUAY', cedula: '' };
export const ROLE_LABEL = { admin: 'Administrador', docente: 'Docente', coordinador: 'Coordinador' };
