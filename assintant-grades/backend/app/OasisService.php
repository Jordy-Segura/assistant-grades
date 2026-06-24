<?php
// CAPA DE APLICACIÓN (Negocio) — Lógica de OASIS.
// Operaciones de alto nivel y resolución (nómina, docentes+cargas, horario).
declare(strict_types=1);

final class OasisService
{
    private Soap $soap;
    /** Caché por petición de matrículas (código real) indexada por "carrera|periodo". */
    private array $matriculaCache = [];

    public function __construct(Soap $soap)
    {
        $this->soap = $soap;
    }

    public function config(): array
    {
        return [
            'base' => rtrim(Config::get('OASIS_BASE', 'http://swoasis.espoch.edu.ec/OASis/OAS_Interop') ?? '', '/'),
            'hasCredentials' => (Config::get('OASIS_USER', '') ?? '') !== '',
        ];
    }

    // ---- Operaciones directas ----
    public function getPeriodoActual(): array
    {
        $r = $this->soap->call('InfoGeneral', 'GetPeriodoActual');
        return [
            'codigo' => $r['Codigo'] ?? '',
            'descripcion' => $r['Descripcion'] ?? '',
            'fechaInicio' => $r['FechaInicio'] ?? '',
            'fechaFin' => $r['FechaFin'] ?? '',
        ];
    }

    public function getFacultades(): array
    {
        $r = $this->soap->call('InfoGeneral', 'GetTodasFacultades');
        return array_map(
            fn($f) => ['codigo' => $f['Codigo'] ?? '', 'nombre' => $f['Nombre'] ?? ''],
            Soap::asList($r['Facultad'] ?? null)
        );
    }

    public function getCarreras(): array
    {
        $r = $this->soap->call('InfoGeneral', 'GetTodasCarreras');
        $out = [];
        foreach (Soap::asList($r['UnidadAcademica'] ?? null) as $c) {
            if (($c['Codigo'] ?? '') === '') {
                continue;
            }
            $out[] = ['codigo' => $c['Codigo'], 'nombre' => $c['Nombre'] ?? '', 'estado' => $c['CodEstado'] ?? ''];
        }
        return $out;
    }

    public function getMalla(string $codCarrera): array
    {
        $r = $this->soap->call('InfoCarrera', 'GetMallaCurricularPensumVigenteSinDescripcion', ['strCodCarrera' => $codCarrera]);
        return array_map(fn($m) => [
            'codMateria' => $m['CodMateria'] ?? '',
            'materia' => trim($m['Materia'] ?? ''),
            'codNivel' => $m['CodNivel'] ?? '',
            'nivel' => $m['Nivel'] ?? '',
        ], Soap::asList($r['Materia_Pensum'] ?? null));
    }

    public function getDictados(string $codCarrera, string $codMateria): array
    {
        $r = $this->soap->call('InfoCarrera', 'GetDictadosMateria', ['CodCarrera' => $codCarrera, 'CodMateria' => $codMateria]);
        return array_map(fn($d) => [
            'codNivel' => $d['CodNivel'] ?? '',
            'nivel' => $d['DescripcionNivel'] ?? '',
            'paralelo' => $d['Paralelo'] ?? '',
            'docente' => [
                'cedula' => $d['Docente']['Cedula'] ?? '',
                'apellidos' => trim($d['Docente']['Apellidos'] ?? ''),
                'nombres' => trim($d['Docente']['Nombres'] ?? ''),
                'email' => $d['Docente']['Email'] ?? '',
            ],
        ], Soap::asList($r['Dictado_Materia'] ?? null));
    }

    public function getAlumnosMateria(array $p): array
    {
        $r = $this->soap->call('InfoCarrera', 'GetAlumnosMateria', [
            'strCodCarrera' => $p['codCarrera'] ?? '',
            'strCodNivel' => $p['codNivel'] ?? '',
            'strCodParalelo' => $p['codParalelo'] ?? '',
            'strCodPeriodo' => $p['codPeriodo'] ?? '',
            'strCodMateria' => $p['codMateria'] ?? '',
        ]);
        $alumnos = array_map([Mappers::class, 'mapAlumno'], Soap::asList($r['Estudiante'] ?? null));
        // GetAlumnosMateria NO trae el código real: se completa cruzando por cédula
        // con la matrícula de la carrera (GetTodasMatriculaEstudiantes).
        $matriculas = $this->getTodasMatricula((string) ($p['codCarrera'] ?? ''), (string) ($p['codPeriodo'] ?? ''));
        return Mappers::mergeCodigos($alumnos, $matriculas);
    }

    // Matrícula de TODA la carrera en un período: incluye el CÓDIGO real del estudiante.
    // Cacheada por carrera+período dentro de la misma petición.
    public function getTodasMatricula(string $codCarrera, string $codPeriodo): array
    {
        if ($codCarrera === '' || $codPeriodo === '') {
            return [];
        }
        $key = $codCarrera . '|' . $codPeriodo;
        if (isset($this->matriculaCache[$key])) {
            return $this->matriculaCache[$key];
        }
        try {
            $r = $this->soap->call('InfoCarrera', 'GetTodasMatriculaEstudiantes', [
                'strCodCarrera' => $codCarrera,
                'strCodPeriodo' => $codPeriodo,
            ]);
            $data = array_map([Mappers::class, 'mapMatricula'], Soap::asList($r['TodasMatriculaEstudiantes'] ?? null));
        } catch (Throwable $e) {
            $data = [];
        }
        $this->matriculaCache[$key] = $data;
        return $data;
    }

    public function getDatosEstudiante(string $cedula): ?array
    {
        $r = $this->soap->call('InfoCarrera', 'GetDatosCompletosEstudiante', [
            'strCedula' => Mappers::formatearCedula($cedula),
        ]);
        if (!is_array($r) || $r === []) {
            return null;
        }
        return Mappers::mapEstudiante($r, $cedula);
    }

    public function getMateriasEstudiante(string $codCarrera, string $cedula, string $codPeriodo): array
    {
        $r = $this->soap->call('InfoCarrera', 'GetMateriasEstudiante', [
            'CodCarrera' => $codCarrera,
            'Cedula' => Mappers::formatearCedula($cedula),
            'CodPeriodo' => $codPeriodo,
        ]);
        return array_map([Mappers::class, 'mapMateriaEstudiante'], Soap::asList($r['Materia'] ?? null));
    }

    // Datos completos + materias actuales + horario, con el código real del estudiante.
    public function getEstudianteFull(string $cedula): array
    {
        $estudiante = null;
        try {
            $estudiante = $this->getDatosEstudiante($cedula);
        } catch (Throwable $e) {
            $estudiante = null;
        }
        $periodo = $this->getPeriodoActual();
        $codPeriodo = $periodo['codigo'] ?? '';
        if ($codPeriodo === '' || !$estudiante) {
            return ['estudiante' => $estudiante, 'materias' => [], 'horario' => []];
        }

        // Prioriza Sede Orellana al buscar la carrera del estudiante.
        $carreras = array_filter($this->getCarreras(), fn($c) => ($c['estado'] ?? '') === 'ABI');
        $orellana = array_values(array_filter($carreras, fn($c) => stripos($c['nombre'] ?? '', 'ORELLANA') !== false));
        $otras = array_values(array_filter($carreras, fn($c) => stripos($c['nombre'] ?? '', 'ORELLANA') === false));
        $priorizadas = array_slice(array_merge($orellana, $otras), 0, 30);

        $carreraEst = null;
        $materias = [];
        foreach ($priorizadas as $c) {
            try {
                $ms = $this->getMateriasEstudiante($c['codigo'], $cedula, $codPeriodo);
            } catch (Throwable $e) {
                $ms = [];
            }
            if (count($ms) > 0) {
                $carreraEst = $c;
                $materias = $ms;
                break;
            }
        }

        // Completa el código real del estudiante desde la matrícula de su carrera.
        if ($carreraEst && ($estudiante['codigo'] ?? '') === '') {
            $ced = Mappers::soloDigitos($cedula);
            foreach ($this->getTodasMatricula($carreraEst['codigo'], $codPeriodo) as $m) {
                if (Mappers::soloDigitos($m['cedula'] ?? '') === $ced && ($m['codigo'] ?? '') !== '') {
                    $estudiante['codigo'] = $m['codigo'];
                    break;
                }
            }
        }

        $horario = [];
        foreach ($materias as $m) {
            try {
                $dictados = $this->getDictados($carreraEst['codigo'], $m['codMateria']);
            } catch (Throwable $e) {
                $dictados = [];
            }
            $horario[] = ['codMateria' => $m['codMateria'], 'materia' => $m['materia'], 'dictados' => $dictados];
        }

        return ['estudiante' => $estudiante, 'periodo' => $periodo, 'carrera' => $carreraEst, 'materias' => $materias, 'horario' => $horario];
    }

    public function getMateriasDocente(string $codCarrera, string $cedula, string $codPeriodo): array
    {
        $r = $this->soap->call('InfoCarrera', 'GetMateriasDocente', [
            'CodCarrera' => $codCarrera, 'Cedula' => Mappers::formatearCedula($cedula), 'CodPeriodo' => $codPeriodo,
        ]);
        return array_map(fn($m) => ['codigo' => $m['Codigo'] ?? '', 'nombre' => $m['Nombre'] ?? ''], Soap::asList($r['Materia'] ?? null));
    }

    public function getNotas(string $codCarrera, string $cedula): array
    {
        $r = $this->soap->call('InfoCarrera', 'GetUltimasNotasEstudianteCarrera', [
            'strCodCarrera' => $codCarrera, 'strCedula' => Mappers::formatearCedula($cedula),
        ]);
        return array_map(fn($n) => [
            'codMateria' => $n['CodMateria'] ?? '',
            'materia' => $n['Materia'] ?? '',
            'nota' => (float) ($n['Acumulado'] ?? $n['Principal'] ?? 0),
        ], Soap::asList($r['Notas'] ?? null));
    }

    public function getUsuarioFacultad(string $login, string $password): array
    {
        $r = $this->soap->call('Seguridad', 'GetUsuarioFacultad', ['login' => $login, 'password' => $password]);
        return [
            'cedula' => $r['Cedula'] ?? '',
            'apellidos' => $r['Apellidos'] ?? '',
            'nombres' => $r['Nombres'] ?? '',
            'email' => $r['Email'] ?? '',
        ];
    }

    public function login(string $usuario, string $password): array
    {
        try {
            $r = $this->soap->call('Seguridad', 'AutenticarUsuarioCarrera', ['login' => $usuario, 'password' => $password]);
        } catch (SoapFaultException $e) {
            if (stripos($e->getMessage(), 'referencia a objeto') !== false) {
                throw new SoapFaultException('Usuario o contraseña incorrectos.');
            }
            throw $e;
        }
        $roles = array_map(fn($x) => [
            'codigoCarrera' => $x['CodigoCarrera'] ?? '',
            'nombreRol' => $x['NombreRol'] ?? '',
        ], Soap::asList($r['RolCarrera'] ?? null));
        $perfil = ['cedula' => '', 'apellidos' => '', 'nombres' => '', 'email' => ''];
        try {
            $perfil = $this->getUsuarioFacultad($usuario, $password);
        } catch (Throwable $e) {
            // El perfil es opcional.
        }
        return ['roles' => $roles, 'perfil' => $perfil];
    }

    public function getHorarioDocente(array $in): array
    {
        $cod = $in['codCarrera'] ?? '';
        if ($cod === '' || $cod === null) {
            $c = $this->resolverCarrera($in['carrera'] ?? '', $in['facultad'] ?? '');
            if (!$c) {
                throw new SoapFaultException('No se encontró la carrera "' . ($in['carrera'] ?? '') . '" en OASIS.');
            }
            $cod = $c['codigo'];
        }
        $periodo = ($in['codPeriodo'] ?? '') ?: $this->getPeriodoActual()['codigo'];
        $r = $this->soap->call('InfoCarrera', 'GetHorariosDocente', [
            'strCodCarrera' => $cod, 'strCedula' => Mappers::formatearCedula($in['cedula'] ?? ''), 'strCodPeriodo' => $periodo,
        ]);
        $clases = array_map(fn($h) => [
            'codMateria' => $h['CodMateria'] ?? '',
            'materia' => trim($h['Materia'] ?? ''),
            'codDia' => $h['CodDia'] ?? '',
            'dia' => trim($h['Dia'] ?? ''),
            'inicio' => $h['Inicio'] ?? '',
            'fin' => $h['Fin'] ?? '',
        ], Soap::asList($r['HorarioClase'] ?? null));
        return ['codCarrera' => $cod, 'codPeriodo' => $periodo, 'clases' => $clases];
    }

    // ---- Resolución (nombres -> códigos) ----  ·  norm() vive en Mappers (dominio).
    public function resolverCarrera(?string $nombre, ?string $facultad): ?array
    {
        $carreras = array_filter($this->getCarreras(), fn($c) => ($c['estado'] ?? '') === 'ABI');
        $target = Mappers::norm($nombre);
        if ($target === '') {
            return null;
        }
        $wantOrellana = strpos(Mappers::norm($facultad), 'ORELLANA') !== false;
        $baseName = fn($n) => trim((string) preg_replace('/ SEDE.*$| MORONA.*$/', '', Mappers::norm($n)));
        $matches = [];
        foreach ($carreras as $c) {
            $cn = $baseName($c['nombre']);
            if ($cn !== '' && ($cn === $target || strpos($cn, $target) !== false || strpos($target, $cn) !== false)) {
                $matches[] = $c;
            }
        }
        if (!$matches) {
            return null;
        }
        if ($wantOrellana) {
            foreach ($matches as $c) {
                if (strpos(Mappers::norm($c['nombre']), 'ORELLANA') !== false) {
                    return $c;
                }
            }
        }
        foreach ($matches as $c) {
            if (!preg_match('/SEDE|MORONA|\(/', $c['nombre'])) {
                return $c;
            }
        }
        return $matches[0];
    }

    public function resolverNomina(array $in): array
    {
        $carrera = !empty($in['codCarrera'])
            ? ['codigo' => $in['codCarrera'], 'nombre' => $in['carrera'] ?? $in['codCarrera']]
            : $this->resolverCarrera($in['carrera'] ?? '', $in['facultad'] ?? '');
        if (!$carrera) {
            throw new SoapFaultException('No se encontró la carrera "' . ($in['carrera'] ?? '') . '" en OASIS.');
        }
        $malla = $this->getMalla($carrera['codigo']);
        $objetivo = Mappers::norm($in['asignatura'] ?? '');
        $materia = null;
        foreach ($malla as $m) {
            if (Mappers::norm($m['materia']) === $objetivo) {
                $materia = $m;
                break;
            }
        }
        if (!$materia) {
            foreach ($malla as $m) {
                $mn = Mappers::norm($m['materia']);
                if ($mn !== '' && (strpos($mn, $objetivo) !== false || strpos($objetivo, $mn) !== false)) {
                    $materia = $m;
                    break;
                }
            }
        }
        if (!$materia) {
            throw new SoapFaultException('La asignatura "' . ($in['asignatura'] ?? '') . '" no está en la malla de ' . $carrera['nombre'] . '.');
        }
        $dictados = $this->getDictados($carrera['codigo'], $materia['codMateria']);
        if (!$dictados) {
            throw new SoapFaultException('"' . $materia['materia'] . '" no tiene paralelos activos este período.');
        }
        $docNorm = Mappers::norm($in['docente'] ?? '');
        $elegido = null;
        if ($docNorm !== '') {
            foreach ($dictados as $d) {
                if (strpos(Mappers::norm($d['docente']['apellidos'] . ' ' . $d['docente']['nombres']), $docNorm) !== false) {
                    $elegido = $d;
                    break;
                }
            }
        }
        if (!$elegido) {
            $elegido = $dictados[0];
        }
        $periodo = $this->getPeriodoActual();
        $estudiantes = $this->getAlumnosMateria([
            'codCarrera' => $carrera['codigo'],
            'codNivel' => $elegido['codNivel'] ?: $materia['codNivel'],
            'codParalelo' => $elegido['paralelo'],
            'codPeriodo' => $periodo['codigo'],
            'codMateria' => $materia['codMateria'],
        ]);
        return [
            'resuelto' => [
                'codCarrera' => $carrera['codigo'],
                'carrera' => $carrera['nombre'],
                'codMateria' => $materia['codMateria'],
                'materia' => $materia['materia'],
                'codNivel' => $elegido['codNivel'] ?: $materia['codNivel'],
                'nivel' => $elegido['nivel'] ?: $materia['nivel'],
                'paralelo' => $elegido['paralelo'],
                'codPeriodo' => $periodo['codigo'],
                'periodo' => $periodo['descripcion'],
                'docente' => $elegido['docente'],
                'paralelosDisponibles' => array_map(fn($d) => $d['paralelo'], $dictados),
            ],
            'estudiantes' => $estudiantes,
        ];
    }

    public function getDocentesCarrera(array $in): array
    {
        $carrera = !empty($in['codCarrera'])
            ? ['codigo' => $in['codCarrera'], 'nombre' => $in['carrera'] ?? $in['codCarrera']]
            : $this->resolverCarrera($in['carrera'] ?? '', $in['facultad'] ?? '');
        if (!$carrera) {
            throw new SoapFaultException('No se encontró la carrera "' . ($in['carrera'] ?? '') . '" en OASIS.');
        }
        $malla = $this->getMalla($carrera['codigo']);
        $paramSets = array_map(fn($m) => ['CodCarrera' => $carrera['codigo'], 'CodMateria' => $m['codMateria']], $malla);
        $resultsRaw = $this->soap->callMany('InfoCarrera', 'GetDictadosMateria', $paramSets, 8);

        $porDocente = [];
        foreach ($malla as $idx => $m) {
            $dictados = Soap::asList($resultsRaw[$idx]['Dictado_Materia'] ?? null);
            foreach ($dictados as $d) {
                $doc = $d['Docente'] ?? [];
                $ced = $doc['Cedula'] ?? '';
                if ($ced === '') {
                    continue;
                }
                if (!isset($porDocente[$ced])) {
                    $porDocente[$ced] = [
                        'cedula' => $ced,
                        'apellidos' => trim($doc['Apellidos'] ?? ''),
                        'nombres' => trim($doc['Nombres'] ?? ''),
                        'email' => $doc['Email'] ?? '',
                        'cargas' => [],
                    ];
                }
                $porDocente[$ced]['cargas'][] = [
                    'codMateria' => $m['codMateria'],
                    'materia' => $m['materia'],
                    'codNivel' => $d['CodNivel'] ?? $m['codNivel'],
                    'nivel' => $d['DescripcionNivel'] ?? $m['nivel'],
                    'paralelo' => $d['Paralelo'] ?? '',
                ];
            }
        }
        $docentes = array_values($porDocente);
        usort($docentes, fn($a, $b) => strcmp($a['apellidos'] . $a['nombres'], $b['apellidos'] . $b['nombres']));
        return ['carrera' => $carrera['nombre'], 'codCarrera' => $carrera['codigo'], 'docentes' => $docentes];
    }
}
