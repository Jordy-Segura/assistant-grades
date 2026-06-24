<?php
// CAPA TRANSVERSAL — Utilidades HTTP (respuestas JSON, CORS, validación de entrada, seguridad).
declare(strict_types=1);

final class Http
{
    private const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB

    public static function cors(): void
    {
        $origin = Config::get('CORS_ORIGIN', '*') ?? '*';
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Methods: GET,POST,PUT,OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
    }

    public static function json($data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    /** Cuerpo JSON de la petición como arreglo asociativo, con límite de tamaño. */
    public static function body(): array
    {
        $raw = file_get_contents('php://input', false, null, 0, self::MAX_BODY_SIZE);
        if ($raw === false || $raw === '') {
            return [];
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }

    public static function query(): array
    {
        return $_GET;
    }

    /** Valida campos obligatorios; corta con 400 si falta alguno. */
    public static function require(array $data, array $keys): void
    {
        foreach ($keys as $k) {
            if (!isset($data[$k]) || (is_string($data[$k]) && trim($data[$k]) === '')) {
                self::json(['error' => "Falta el campo obligatorio: $k"], 400);
            }
        }
    }

    /** Sanitiza strings de un arreglo (elimina whitespace extremo, tags HTML). */
    public static function sanitize(array $data, array $fields): array
    {
        foreach ($fields as $f) {
            if (isset($data[$f]) && is_string($data[$f])) {
                $data[$f] = strip_tags(trim($data[$f]));
            }
        }
        return $data;
    }
}
