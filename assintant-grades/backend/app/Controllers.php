<?php
// CAPA DE PRESENTACIÓN — Controladores.
// Orquestan los servicios de aplicación y devuelven datos para la respuesta JSON.
declare(strict_types=1);

final class Controllers
{
    private OasisService $oasis;
    private Database $db;
    private array $warnings;

    public function __construct(OasisService $oasis, Database $db, array $warnings = [])
    {
        $this->oasis = $oasis;
        $this->db = $db;
        $this->warnings = $warnings;
    }

    // ---- OASIS ----
    public function health(array $in = []): array
    {
        $c = $this->oasis->config();
        return [
            'ok' => true,
            'base' => $c['base'],
            'hasCredentials' => $c['hasCredentials'],
            'dbEnabled' => $this->db->enabled(),
            'warnings' => $this->warnings,
        ];
    }

    public function periodoActual(array $in = []): array
    {
        return $this->oasis->getPeriodoActual();
    }

    public function facultades(array $in = []): array
    {
        return $this->oasis->getFacultades();
    }

    public function carreras(array $in = []): array
    {
        return array_values(array_filter($this->oasis->getCarreras(), fn($c) => ($c['estado'] ?? '') === 'ABI'));
    }

    public function nomina(array $in): array
    {
        Http::require($in, ['asignatura']);
        return $this->oasis->resolverNomina($in);
    }

    public function docentesCarrera(array $in): array
    {
        return $this->oasis->getDocentesCarrera($in);
    }

    public function horarioDocente(array $in): array
    {
        Http::require($in, ['cedula']);
        return $this->oasis->getHorarioDocente($in);
    }

    public function materiasDocente(array $in): array
    {
        return $this->oasis->getMateriasDocente($in['codCarrera'] ?? '', $in['cedula'] ?? '', $in['codPeriodo'] ?? '');
    }

    public function alumnosMateria(array $in): array
    {
        return $this->oasis->getAlumnosMateria($in);
    }

    public function notas(array $in): array
    {
        return $this->oasis->getNotas($in['codCarrera'] ?? '', $in['cedula'] ?? '');
    }

    public function login(array $in): array
    {
        Http::require($in, ['login', 'password']);
        return $this->oasis->login($in['login'], $in['password']);
    }

    // ---- Base de datos ----
    public function dbHealth(array $in = []): array
    {
        return $this->db->health();
    }

    public function getStore(array $in)
    {
        if (!$this->db->enabled()) {
            return ['disabled' => true];
        }
        return $this->db->getStore($in['email'] ?? '', $in['role'] ?? '');
    }

    public function putStore(array $in): array
    {
        if (!$this->db->enabled()) {
            return ['disabled' => true];
        }
        return $this->db->putStore($in);
    }

    public function dbLogin(array $in): array
    {
        if (!$this->db->enabled()) {
            return ['disabled' => true];
        }
        Http::require($in, ['login', 'password']);
        $u = $this->db->login($in['login'], $in['password']);
        if (!$u) {
            throw new SoapFaultException('Usuario o contraseña incorrectos.');
        }
        return $u;
    }
}
