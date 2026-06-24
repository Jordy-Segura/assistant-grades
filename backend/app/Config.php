<?php
// CAPA TRANSVERSAL — Configuración.
// Carga las variables desde backend/.env (sin dependencias externas).
declare(strict_types=1);

final class Config
{
    private static array $vars = [];

    public static function load(string $path): void
    {
        if (!is_file($path)) {
            return;
        }
        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }
            $pos = strpos($line, '=');
            if ($pos === false) {
                continue;
            }
            $key = trim(substr($line, 0, $pos));
            $val = trim(substr($line, $pos + 1));
            // Quita comillas envolventes si las hay.
            if (strlen($val) >= 2 && ($val[0] === '"' || $val[0] === "'")) {
                $val = substr($val, 1, -1);
            }
            self::$vars[$key] = $val;
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        if (array_key_exists($key, self::$vars) && self::$vars[$key] !== '') {
            return self::$vars[$key];
        }
        $env = getenv($key);
        if ($env !== false && $env !== '') {
            return $env;
        }
        return $default;
    }

    public static function has(string $key): bool
    {
        return self::get($key) !== null;
    }
}
