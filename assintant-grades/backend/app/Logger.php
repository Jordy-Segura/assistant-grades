<?php
// CAPA TRANSVERSAL — Logging.
// Registra eventos a archivo y al log de errores de PHP.
declare(strict_types=1);

final class Logger
{
    private static string $dir = '';

    public static function init(string $dir): void
    {
        self::$dir = $dir;
        if ($dir !== '' && !is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
    }

    public static function log(string $level, string $msg, array $ctx = []): void
    {
        $line = sprintf(
            "[%s] %s %s%s",
            date('c'),
            strtoupper($level),
            $msg,
            $ctx ? ' ' . json_encode($ctx, JSON_UNESCAPED_UNICODE) : ''
        );
        if (self::$dir !== '') {
            @file_put_contents(self::$dir . '/app-' . date('Y-m-d') . '.log', $line . "\n", FILE_APPEND);
        }
        error_log($line);
    }

    public static function info(string $msg, array $ctx = []): void
    {
        self::log('info', $msg, $ctx);
    }

    public static function warning(string $msg, array $ctx = []): void
    {
        self::log('warning', $msg, $ctx);
    }

    public static function error(string $msg, array $ctx = []): void
    {
        self::log('error', $msg, $ctx);
    }
}
