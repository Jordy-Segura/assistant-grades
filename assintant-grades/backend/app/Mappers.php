<?php
// CAPA DE DOMINIO — Data Mapper + reglas de correo/código institucional.
// Funciones PURAS (sin I/O) que traducen registros crudos de SOAP a DTO y
// resuelven el correo y el código real del estudiante. Espejo de domain/mappers.mjs.
declare(strict_types=1);

final class Mappers
{
    // Correos institucionales conocidos (override manual para casos puntuales).
    private const CORREOS_CONOCIDOS = [
        '2250044001' => 'dilan.lucero@espoch.edu.ec',
    ];

    public static function soloDigitos($v): string
    {
        return preg_replace('/\D/', '', (string) ($v ?? '')) ?? '';
    }

    // Normaliza: sin tildes, MAYÚSCULAS, solo A-Z 0-9 y espacios.
    public static function norm(?string $text): string
    {
        $map = [
            'Á' => 'A', 'À' => 'A', 'Ä' => 'A', 'Â' => 'A', 'É' => 'E', 'È' => 'E', 'Ë' => 'E', 'Ê' => 'E',
            'Í' => 'I', 'Ì' => 'I', 'Ï' => 'I', 'Î' => 'I', 'Ó' => 'O', 'Ò' => 'O', 'Ö' => 'O', 'Ô' => 'O',
            'Ú' => 'U', 'Ù' => 'U', 'Ü' => 'U', 'Û' => 'U', 'Ñ' => 'N', 'Ç' => 'C',
            'á' => 'a', 'à' => 'a', 'ä' => 'a', 'â' => 'a', 'é' => 'e', 'è' => 'e', 'ë' => 'e', 'ê' => 'e',
            'í' => 'i', 'ì' => 'i', 'ï' => 'i', 'î' => 'i', 'ó' => 'o', 'ò' => 'o', 'ö' => 'o', 'ô' => 'o',
            'ú' => 'u', 'ù' => 'u', 'ü' => 'u', 'û' => 'u', 'ñ' => 'n', 'ç' => 'c',
        ];
        $s = strtoupper(strtr((string) $text, $map));
        $s = preg_replace('/[^A-Z0-9 ]/', ' ', $s);
        $s = preg_replace('/\s+/', ' ', (string) $s);
        return trim((string) $s);
    }

    // OASIS exige la cédula con guion (220023003-1).
    public static function formatearCedula($ced): string
    {
        $d = self::soloDigitos($ced);
        if (strlen($d) === 10) {
            return substr($d, 0, 9) . '-' . substr($d, 9);
        }
        return (string) $ced;
    }

    // Limpia valores basura que OASIS a veces devuelve como correo ("null", "-", ...).
    public static function limpiarEmail($v): string
    {
        $s = trim((string) ($v ?? ''));
        if ($s === '' || strpos($s, '@') === false) {
            return '';
        }
        if (preg_match('/^(null|undefined|-+|n\/?a)$/i', $s)) {
            return '';
        }
        return $s;
    }

    // Correo institucional ESPOCH derivado del nombre: primernombre.primerapellido.
    public static function correoInstitucional(?string $nombres, ?string $apellidos): string
    {
        $primera = static function ($t): string {
            $parts = preg_split('/\s+/', strtolower(self::norm($t)));
            return $parts[0] ?? '';
        };
        $n = $primera($nombres);
        $a = $primera($apellidos);
        if ($n === '' || $a === '') {
            return '';
        }
        return $n . '.' . $a . '@espoch.edu.ec';
    }

    // ¿El correo parece pertenecer a este estudiante? (su parte local contiene algún
    // token del nombre). Descarta el placeholder que OASIS repite para todos.
    private static function correoCoincideConNombre(string $email, ?string $nombres, ?string $apellidos): bool
    {
        $local = strtolower(explode('@', $email)[0]);
        $tokens = array_filter(
            preg_split('/\s+/', strtolower(self::norm(($nombres ?? '') . ' ' . ($apellidos ?? '')))),
            static fn($t) => strlen($t) >= 3
        );
        foreach ($tokens as $t) {
            if (strpos($local, $t) !== false) {
                return true;
            }
        }
        return false;
    }

    // Resuelve el correo priorizando el dato REAL verdadero:
    //   1) override conocido, 2) correo real de OASIS SOLO si pertenece al estudiante,
    //   3) correo institucional derivado.
    public static function resolverCorreo($rawEmail, $cedula, ?string $nombres, ?string $apellidos): string
    {
        $digits = self::soloDigitos($cedula);
        if (isset(self::CORREOS_CONOCIDOS[$digits])) {
            return self::CORREOS_CONOCIDOS[$digits];
        }
        $real = self::limpiarEmail($rawEmail);
        if ($real !== '' && self::correoCoincideConNombre($real, $nombres, $apellidos)) {
            return $real;
        }
        return self::correoInstitucional($nombres, $apellidos);
    }

    // Código REAL del estudiante, nunca la cédula (cuando un servicio sí lo trae).
    public static function pickCodigo(array $obj, $cedula): string
    {
        $ced = self::soloDigitos($cedula);
        foreach (['Codigo', 'CodEstudiante', 'CodigoEstudiante', 'Matricula', 'NumMatricula', 'CodMatricula'] as $k) {
            if (isset($obj[$k]) && !is_array($obj[$k])) {
                $s = trim((string) $obj[$k]);
                if ($s !== '' && self::soloDigitos($s) !== $ced) {
                    return $s;
                }
            }
        }
        return '';
    }

    // ---- Mappers crudo -> DTO ----
    public static function mapAlumno(array $e): array
    {
        return [
            'codigo' => '', // se completa con mergeCodigos() usando la matrícula
            'cedula' => $e['Cedula'] ?? '',
            'nombres' => trim($e['Nombres'] ?? ''),
            'apellidos' => trim($e['Apellidos'] ?? ''),
            'email' => self::resolverCorreo($e['Email'] ?? '', $e['Cedula'] ?? '', $e['Nombres'] ?? '', $e['Apellidos'] ?? ''),
        ];
    }

    public static function mapMatricula(array $m): array
    {
        return [
            'cedula' => $m['Cedula'] ?? '',
            'codigo' => trim($m['Codigo'] ?? ''),
            'nombres' => trim($m['Nombres'] ?? ''),
            'apellidos' => trim($m['Apellidos'] ?? ''),
            'codNivel' => $m['CodNivel'] ?? '',
            'codEstado' => $m['CodEstado'] ?? '',
        ];
    }

    public static function mapEstudiante(array $r, $cedula): array
    {
        $apellidos = trim($r['Apellidos'] ?? '');
        $nombres = trim($r['Nombres'] ?? '');
        return [
            'cedula' => $r['Cedula'] ?? $cedula,
            'codigo' => self::pickCodigo($r, $r['Cedula'] ?? $cedula),
            'apellidos' => $apellidos,
            'nombres' => $nombres,
            'email' => self::resolverCorreo($r['Email'] ?? '', $r['Cedula'] ?? $cedula, $nombres, $apellidos),
            'telefono' => $r['Telefono'] ?? '',
            'direccion' => $r['Direccion'] ?? '',
            'sexo' => $r['Sexo'] ?? '',
            'fechaNacimiento' => $r['FechaNacimiento'] ?? ($r['FechaNac'] ?? ''),
        ];
    }

    public static function mapMateriaEstudiante(array $m): array
    {
        return [
            'codMateria' => $m['Codigo'] ?? '',
            'materia' => trim($m['Nombre'] ?? ''),
            'codNivel' => $m['CodNivel'] ?? '',
            'nivel' => $m['Nivel'] ?? '',
            'paralelo' => $m['Paralelo'] ?? '',
            'nota' => (float) ($m['Nota'] ?? ($m['Acumulado'] ?? 0)),
        ];
    }

    // Completa el código real de cada alumno cruzando por cédula con la matrícula.
    public static function mergeCodigos(array $alumnos, array $matriculas): array
    {
        $porCedula = [];
        foreach ($matriculas as $m) {
            $ced = self::soloDigitos($m['cedula'] ?? '');
            if ($ced !== '' && ($m['codigo'] ?? '') !== '') {
                $porCedula[$ced] = $m['codigo'];
            }
        }
        return array_map(static function ($a) use ($porCedula) {
            $ced = self::soloDigitos($a['cedula'] ?? '');
            $a['codigo'] = $porCedula[$ced] ?? ($a['codigo'] ?? '');
            return $a;
        }, $alumnos);
    }
}
