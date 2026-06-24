<?php
// CAPA DE PRESENTACIÓN — Front Controller (punto de entrada).
// Carga configuración, arma las capas y enruta las peticiones HTTP.
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/app/Config.php';
require $root . '/app/Logger.php';
require $root . '/app/Http.php';
require $root . '/app/Soap.php';
require $root . '/app/OasisService.php';
require $root . '/app/Database.php';
require $root . '/app/Controllers.php';

Config::load($root . '/.env');
Logger::init($root . '/' . (Config::get('LOG_DIR', 'logs') ?? 'logs'));

// Validar variables de entorno críticas al arrancar
$warnings = [];
if ((Config::get('OASIS_USER', '') ?? '') === '' || (Config::get('OASIS_PASS', '') ?? '') === '') {
    $warnings[] = 'OASIS_USER/OASIS_PASS vacías — operaciones autenticadas usarán mock data';
}
if ((Config::get('DATABASE_URL', '') ?? '') === '') {
    $warnings[] = 'DATABASE_URL vacía — la app usará localStorage como respaldo';
}
foreach ($warnings as $w) {
    Logger::info('Config: ' . $w);
}

Http::cors();

// Preflight CORS.
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = rtrim(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/', '/');
if ($path === '') {
    $path = '/';
}

// Logger petición entrante (debug)
Logger::info('Request', ['method' => $method, 'path' => $path]);

// Composición de capas (inyección de dependencias simple).
$soap = new Soap();
$oasis = new OasisService($soap);
$db = new Database();
try {
    // Crea el esquema solo una vez (marca con un archivo) para no repetir DDL
    // en cada petición. Borra logs/.schema_ok si cambias de base de datos.
    if ($db->enabled()) {
        $marker = $root . '/' . (Config::get('LOG_DIR', 'logs') ?? 'logs') . '/.schema_ok';
        if (!is_file($marker)) {
            $db->ensureSchema();
            @file_put_contents($marker, date('c'));
            Logger::info('PostgreSQL conectado y esquema listo.');
        }
    }
} catch (Throwable $e) {
    Logger::error('No se pudo inicializar la BD: ' . $e->getMessage());
}
$c = new Controllers($oasis, $db, $warnings);

// Tabla de rutas (Presentación -> Controladores).
$routes = [
    'GET /api/health' => fn($in) => $c->health($in),
    'GET /api/periodo-actual' => fn($in) => $c->periodoActual($in),
    'GET /api/facultades' => fn($in) => $c->facultades($in),
    'GET /api/carreras' => fn($in) => $c->carreras($in),
    'POST /api/nomina' => fn($in) => $c->nomina($in),
    'POST /api/docentes-carrera' => fn($in) => $c->docentesCarrera($in),
    'POST /api/horario-docente' => fn($in) => $c->horarioDocente($in),
    'POST /api/materias-docente' => fn($in) => $c->materiasDocente($in),
    'POST /api/alumnos-materia' => fn($in) => $c->alumnosMateria($in),
    'POST /api/notas' => fn($in) => $c->notas($in),
    'POST /api/login' => fn($in) => $c->login($in),
    'GET /api/db/health' => fn($in) => $c->dbHealth($in),
    'GET /api/store' => fn($in) => $c->getStore($in),
    'PUT /api/store' => fn($in) => $c->putStore($in),
    'POST /api/db-login' => fn($in) => $c->dbLogin($in),
];

$key = $method . ' ' . $path;

if (!isset($routes[$key])) {
    Logger::warning('Ruta no encontrada', ['route' => $key]);
    Http::json(['error' => 'Recurso no encontrado: ' . $key], 404);
}

$input = in_array($method, ['POST', 'PUT'], true) ? Http::body() : Http::query();

// Sanitizar campos comunes de entrada
$input = Http::sanitize($input, ['login', 'email', 'nombre', 'carrera', 'asignatura', 'facultad', 'cedula']);

try {
    $result = $routes[$key]($input);
    Http::json($result, 200);
} catch (SoapFaultException $e) {
    Logger::warning('SoapFault en ' . $key . ': ' . $e->getMessage());
    Http::json(['error' => $e->getMessage()], 400);
} catch (Throwable $e) {
    Logger::error('Error procesando ' . $key . ': ' . $e->getMessage());
    Http::json(['error' => $e->getMessage() ?: 'Error en el servidor'], 502);
}
