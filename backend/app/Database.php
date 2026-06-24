<?php
// CAPA DE INFRAESTRUCTURA — Acceso a datos (PostgreSQL/Supabase vía PDO).
// Esquema, repositorio del "store", autenticación y hash de contraseñas.
// Si no hay DATABASE_URL, queda deshabilitada y el frontend usa sessionStorage.
declare(strict_types=1);

final class Database
{
    private ?PDO $pdo = null;
    private bool $enabled = false;

    private const COORDINADOR = [
        'email' => 'ppaguay@espoch.edu.ec',
        'nombre' => 'PAUL PAGUAY',
        'cedula' => '',
        'rol' => 'coordinador',
        'password' => 'paguay2026',
    ];

    public function __construct()
    {
        $url = Config::get('DATABASE_URL', '');
        if ($url !== null && $url !== '') {
            $this->connect($url);
        }
    }

    public function enabled(): bool
    {
        return $this->enabled;
    }

    private function connect(string $url): void
    {
        $p = parse_url($url);
        if ($p === false || empty($p['host'])) {
            Logger::error('DATABASE_URL inválida: no se pudo interpretar.');
            return;
        }
        $host = $p['host'];
        $port = $p['port'] ?? 5432;
        $dbname = isset($p['path']) ? ltrim($p['path'], '/') : 'postgres';
        $user = isset($p['user']) ? urldecode($p['user']) : '';
        $pass = isset($p['pass']) ? urldecode($p['pass']) : '';
        $dsn = "pgsql:host=$host;port=$port;dbname=$dbname;sslmode=require";
        try {
            $this->pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                // Emulación: permite reusar :placeholders y funciona con el
                // pooler de Supabase (pgbouncer en modo transacción).
                PDO::ATTR_EMULATE_PREPARES => true,
            ]);
            $this->enabled = true;
        } catch (Throwable $e) {
            Logger::error('No se pudo conectar a PostgreSQL: ' . $e->getMessage());
            $this->enabled = false;
        }
    }

    // ---- Seguridad: hash de contraseñas (bcrypt nativo de PHP) ----
    public static function hashPassword(string $plain): string
    {
        return password_hash($plain, PASSWORD_DEFAULT);
    }

    public static function verifyPassword(string $plain, ?string $hash): bool
    {
        return $hash !== null && $hash !== '' && password_verify($plain, $hash);
    }

    // ---- Esquema ----
    public function ensureSchema(): void
    {
        if (!$this->pdo) {
            return;
        }
        $this->pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS docente (
                email TEXT PRIMARY KEY,
                nombre TEXT,
                cedula TEXT,
                rol TEXT DEFAULT 'docente',
                password_hash TEXT,
                updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS asignacion (
                id TEXT PRIMARY KEY,
                docente_email TEXT,
                carrera TEXT, asignatura TEXT, pao TEXT, paralelo TEXT,
                data JSONB NOT NULL,
                updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS configuracion (
                id TEXT PRIMARY KEY,
                owner_email TEXT,
                carrera TEXT, asignatura TEXT, pao TEXT,
                data JSONB NOT NULL,
                saved_at TEXT,
                updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS config_estudiantes (
                config_id TEXT PRIMARY KEY,
                data JSONB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS config_notas (
                config_id TEXT PRIMARY KEY,
                data JSONB NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_asignacion_docente ON asignacion(docente_email);
            CREATE INDEX IF NOT EXISTS idx_config_owner ON configuracion(owner_email);
        SQL);

        // Sembrar al coordinador si no existe.
        $stmt = $this->pdo->prepare('SELECT 1 FROM docente WHERE email = :email');
        $stmt->execute([':email' => self::COORDINADOR['email']]);
        if ($stmt->fetchColumn() === false) {
            $ins = $this->pdo->prepare(
                'INSERT INTO docente(email,nombre,cedula,rol,password_hash) VALUES (:email,:nombre,:cedula,:rol,:hash)'
            );
            $ins->execute([
                ':email' => self::COORDINADOR['email'],
                ':nombre' => self::COORDINADOR['nombre'],
                ':cedula' => self::COORDINADOR['cedula'],
                ':rol' => self::COORDINADOR['rol'],
                ':hash' => self::hashPassword(self::COORDINADOR['password']),
            ]);
        }
    }

    public function health(): array
    {
        if (!$this->pdo) {
            return ['enabled' => false];
        }
        $this->pdo->query('SELECT 1');
        return ['enabled' => true];
    }

    // ---- Lectura del store ----
    public function getStore(string $email, string $role): array
    {
        $docentes = $this->pdo->query("SELECT email,nombre,cedula,rol FROM docente ORDER BY nombre")->fetchAll();
        $docentes = array_values(array_filter($docentes, fn($d) => $d['rol'] !== 'coordinador'));

        $asigRows = $this->pdo->query("SELECT data FROM asignacion")->fetchAll();
        $teacherAssignments = array_map(fn($r) => json_decode($r['data'], true), $asigRows);

        if ($role === 'coordinador') {
            $cfgRows = $this->pdo->query("SELECT data FROM configuracion ORDER BY updated_at DESC")->fetchAll();
        } else {
            $stmt = $this->pdo->prepare("SELECT data FROM configuracion WHERE owner_email = :email ORDER BY updated_at DESC");
            $stmt->execute([':email' => $email]);
            $cfgRows = $stmt->fetchAll();
        }
        $savedConfigs = array_map(fn($r) => json_decode($r['data'], true), $cfgRows);

        $ids = array_values(array_filter(array_map(fn($c) => $c['id'] ?? null, $savedConfigs)));
        $studentsByConfig = [];
        $gradesByConfig = [];
        if ($ids) {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $est = $this->pdo->prepare("SELECT config_id,data FROM config_estudiantes WHERE config_id IN ($placeholders)");
            $est->execute($ids);
            foreach ($est->fetchAll() as $r) {
                $studentsByConfig[$r['config_id']] = json_decode($r['data'], true);
            }
            $not = $this->pdo->prepare("SELECT config_id,data FROM config_notas WHERE config_id IN ($placeholders)");
            $not->execute($ids);
            foreach ($not->fetchAll() as $r) {
                $gradesByConfig[$r['config_id']] = json_decode($r['data'], true);
            }
        }

        return [
            'docentes' => $docentes,
            'teacherAssignments' => $teacherAssignments,
            'savedConfigs' => $savedConfigs,
            'studentsByConfig' => (object) $studentsByConfig,
            'gradesByConfig' => (object) $gradesByConfig,
        ];
    }

    // ---- Escritura del store (por alcance del propietario) ----
    public function putStore(array $payload): array
    {
        $email = $payload['email'] ?? '';
        $role = $payload['role'] ?? '';
        $this->pdo->beginTransaction();
        try {
            if ($role === 'coordinador' && isset($payload['docentes']) && is_array($payload['docentes'])) {
                foreach ($payload['docentes'] as $d) {
                    $de = strtolower($d['email'] ?? '');
                    if ($de === '') {
                        continue;
                    }
                    $nombre = $d['nombre'] ?? $d['name'] ?? '';
                    $cedula = $d['cedula'] ?? '';
                    $rol = $d['rol'] ?? $d['role'] ?? 'docente';
                    if (!empty($d['password'])) {
                        $stmt = $this->pdo->prepare(
                            'INSERT INTO docente(email,nombre,cedula,rol,password_hash) VALUES (:e,:n,:c,:r,:h)
                             ON CONFLICT (email) DO UPDATE SET nombre=:n,cedula=:c,rol=:r,password_hash=:h,updated_at=now()'
                        );
                        $stmt->execute([':e' => $de, ':n' => $nombre, ':c' => $cedula, ':r' => $rol, ':h' => self::hashPassword($d['password'])]);
                    } else {
                        $stmt = $this->pdo->prepare(
                            'INSERT INTO docente(email,nombre,cedula,rol,password_hash) VALUES (:e,:n,:c,:r,NULL)
                             ON CONFLICT (email) DO UPDATE SET nombre=:n,cedula=:c,rol=:r,updated_at=now()'
                        );
                        $stmt->execute([':e' => $de, ':n' => $nombre, ':c' => $cedula, ':r' => $rol]);
                    }
                }
            }

            if ($role === 'coordinador' && isset($payload['teacherAssignments']) && is_array($payload['teacherAssignments'])) {
                $this->pdo->exec('DELETE FROM asignacion');
                $stmt = $this->pdo->prepare(
                    'INSERT INTO asignacion(id,docente_email,carrera,asignatura,pao,paralelo,data)
                     VALUES (:id,:de,:ca,:asg,:pao,:par,:data::jsonb)
                     ON CONFLICT (id) DO UPDATE SET docente_email=:de,carrera=:ca,asignatura=:asg,pao=:pao,paralelo=:par,data=:data::jsonb,updated_at=now()'
                );
                foreach ($payload['teacherAssignments'] as $a) {
                    if (empty($a['id'])) {
                        continue;
                    }
                    $stmt->execute([
                        ':id' => $a['id'], ':de' => $a['docenteEmail'] ?? '', ':ca' => $a['carrera'] ?? '',
                        ':asg' => $a['asignatura'] ?? '', ':pao' => (string) ($a['pao'] ?? ''),
                        ':par' => (string) ($a['paralelo'] ?? ''), ':data' => json_encode($a, JSON_UNESCAPED_UNICODE),
                    ]);
                }
            }

            if (isset($payload['savedConfigs']) && is_array($payload['savedConfigs'])) {
                $keepIds = array_values(array_filter(array_map(fn($c) => $c['id'] ?? null, $payload['savedConfigs'])));
                if ($keepIds) {
                    $ph = implode(',', array_fill(0, count($keepIds), '?'));
                    $del = $this->pdo->prepare("DELETE FROM configuracion WHERE owner_email = ? AND id NOT IN ($ph)");
                    $del->execute(array_merge([$email], $keepIds));
                } else {
                    $del = $this->pdo->prepare('DELETE FROM configuracion WHERE owner_email = ?');
                    $del->execute([$email]);
                }
                $stmt = $this->pdo->prepare(
                    'INSERT INTO configuracion(id,owner_email,carrera,asignatura,pao,data,saved_at)
                     VALUES (:id,:owner,:ca,:asg,:pao,:data::jsonb,:saved)
                     ON CONFLICT (id) DO UPDATE SET owner_email=:owner,carrera=:ca,asignatura=:asg,pao=:pao,data=:data::jsonb,saved_at=:saved,updated_at=now()'
                );
                foreach ($payload['savedConfigs'] as $c) {
                    if (empty($c['id'])) {
                        continue;
                    }
                    $cc = $c['courseConfig'] ?? [];
                    $stmt->execute([
                        ':id' => $c['id'], ':owner' => $c['ownerEmail'] ?? $email,
                        ':ca' => $cc['carrera'] ?? '', ':asg' => $cc['asignatura'] ?? '', ':pao' => (string) ($cc['pao'] ?? ''),
                        ':data' => json_encode($c, JSON_UNESCAPED_UNICODE), ':saved' => $c['savedAt'] ?? '',
                    ]);
                }
            }

            $this->upsertJsonMap('config_estudiantes', $payload['studentsByConfig'] ?? null);
            $this->upsertJsonMap('config_notas', $payload['gradesByConfig'] ?? null);

            $this->pdo->commit();
            return ['ok' => true];
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    private function upsertJsonMap(string $table, $map): void
    {
        if (!is_array($map)) {
            return;
        }
        $stmt = $this->pdo->prepare(
            "INSERT INTO $table(config_id,data) VALUES (:id,:data::jsonb)
             ON CONFLICT (config_id) DO UPDATE SET data=:data::jsonb"
        );
        foreach ($map as $configId => $arr) {
            $stmt->execute([':id' => $configId, ':data' => json_encode($arr ?? [], JSON_UNESCAPED_UNICODE)]);
        }
    }

    // ---- Login verificado contra la BD ----
    public function login(string $email, string $password): ?array
    {
        $stmt = $this->pdo->prepare('SELECT email,nombre,cedula,rol,password_hash FROM docente WHERE email = :email');
        $stmt->execute([':email' => strtolower($email)]);
        $u = $stmt->fetch();
        if (!$u || !self::verifyPassword($password, $u['password_hash'])) {
            return null;
        }
        return ['email' => $u['email'], 'name' => $u['nombre'], 'cedula' => $u['cedula'] ?? '', 'role' => $u['rol'], 'source' => 'db'];
    }
}
