// Web Worker para detección de anomalías en calificaciones
// Se ejecuta en un hilo separado para no bloquear la UI

// Estadísticas básicas
function media(arr) {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function desviacionEstandar(arr, med) {
  if (arr.length < 2) return 0;
  const m = med ?? media(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

// Detectar valores atípicos (outliers) usando IQR
function detectarOutliers(valores) {
  if (valores.length < 4) return [];
  const sorted = [...valores].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const min = q1 - 1.5 * iqr;
  const max = q3 + 1.5 * iqr;
  return valores.map((v, i) => (v < min || v > max) ? i : -1).filter(i => i >= 0);
}

self.onmessage = function (e) {
  const { type, data } = e.data;

  if (type === "analizar") {
    const { students, grades, activities } = data;
    const anomalias = [];

    if (!students || !grades || !activities || students.length === 0) return;

    // 1. CAÍDAS DE RENDIMIENTO: detectar estudiantes con nota 0 en actividades recientes
    const estudiantesConCero = new Map();
    grades.forEach(g => {
      if (g.score === 0 || g.score === null) {
        estudiantesConCero.set(g.studentId, (estudiantesConCero.get(g.studentId) || 0) + 1);
      }
    });

    estudiantesConCero.forEach((count, sid) => {
      if (count >= 2) {
        const s = students.find(st => st.id === sid);
        if (s) {
          anomalias.push({
            tipo: "caida",
            severidad: count >= 4 ? "alta" : "media",
            mensaje: `${s.apellidos} ${s.nombres} tiene ${count} actividad(es) sin calificar`,
            estudianteId: sid,
            nombreEstudiante: `${s.apellidos} ${s.nombres}`
          });
        }
      }
    });

    // 2. PROMEDIO BAJO POR ESTUDIANTE
    const promedios = students.map(s => {
      const notas = activities.map(a => {
        const g = grades.find(gr => gr.studentId === s.id && gr.activityId === a.id);
        return g && g.score != null ? g.score : null;
      }).filter(n => n !== null);
      const prom = notas.length > 0 ? notas.reduce((a, b) => a + b, 0) / notas.length : 0;
      return { studentId: s.id, promedio: prom, count: notas.length };
    });

    promedios.forEach(p => {
      if (p.count >= 2 && p.promedio < 5) {
        const s = students.find(st => st.id === p.studentId);
        if (s) {
          anomalias.push({
            tipo: "rendimiento_bajo",
            severidad: "alta",
            mensaje: `${s.apellidos} ${s.nombres} tiene promedio de ${p.promedio.toFixed(2)} (mínimo esperado: 7.0)`,
            estudianteId: p.studentId,
            nombreEstudiante: `${s.apellidos} ${s.nombres}`
          });
        }
      }
    });

    const promediosCalificados = promedios.filter(p => p.count >= 2);
    const outlierIndices = detectarOutliers(promediosCalificados.map(p => p.promedio));
    outlierIndices.forEach(index => {
      const p = promediosCalificados[index];
      const s = students.find(st => st.id === p.studentId);
      if (s && p.promedio < 7) {
        anomalias.push({
          tipo: "promedio_atipico",
          severidad: "media",
          mensaje: `${s.apellidos} ${s.nombres} tiene un promedio atípico de ${p.promedio.toFixed(2)} frente al grupo`,
          estudianteId: p.studentId,
          nombreEstudiante: `${s.apellidos} ${s.nombres}`
        });
      }
    });

    // 3. DETECTAR POSIBLES INCONSISTENCIAS (notas > puntaje máximo)
    const inconsistencias = [];
    grades.forEach(g => {
      const act = activities.find(a => a.id === g.activityId);
      if (act && g.score > act.maxScore) {
        const s = students.find(st => st.id === g.studentId);
        if (s) {
          inconsistencias.push({
            estudiante: `${s.apellidos} ${s.nombres}`,
            actividad: act.name,
            nota: g.score,
            maximo: act.maxScore
          });
        }
      }
    });

    if (inconsistencias.length > 0) {
      anomalias.push({
        tipo: "inconsistencia",
        severidad: "alta",
        mensaje: `${inconsistencias.length} nota(s) superan el puntaje máximo (ej: ${inconsistencias[0].estudiante} - ${inconsistencias[0].actividad}: ${inconsistencias[0].nota} > ${inconsistencias[0].maximo})`,
        detalles: inconsistencias
      });
    }

    // 4. PROMEDIO GENERAL BAJO
    if (promedios.length >= 3) {
      const todosPromedios = promedios.filter(p => p.count > 0).map(p => p.promedio);
      const promGeneral = media(todosPromedios);
      if (promGeneral > 0 && promGeneral < 6) {
        anomalias.push({
          tipo: "promedio_general_bajo",
          severidad: "media",
          mensaje: `El promedio general del curso es ${promGeneral.toFixed(2)} — revisar estrategia pedagógica`,
        });
      }
    }

    // 5. VARIABILIDAD ENTRE ACTIVIDADES DEL MISMO COMPONENTE
    const componentes = {};
    activities.forEach(a => {
      if (!componentes[a.component]) componentes[a.component] = [];
      componentes[a.component].push(a);
    });

    Object.entries(componentes).forEach(([comp, acts]) => {
      if (acts.length >= 2) {
        const promsPorAct = acts.map(act => {
          const vals = students.map(s => {
            const g = grades.find(gr => gr.studentId === s.id && gr.activityId === act.id);
            return g && g.score != null ? g.score : null;
          }).filter(v => v !== null);
          return vals.length > 0 ? media(vals) : 0;
        });
        const desv = desviacionEstandar(promsPorAct);
        if (desv > 1.5) {
          anomalias.push({
            tipo: "variabilidad",
            severidad: "baja",
            mensaje: `Alta variabilidad en componente ${comp}: las actividades no están calibradas uniformemente`,
          });
        }
      }
    });

    self.postMessage({ type: "resultado", anomalias });
  }
};
