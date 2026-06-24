<?php
// CAPA DE INFRAESTRUCTURA — Cliente SOAP de OASIS.
// Construye el envelope, llama por cURL (incluida fan-out en paralelo) y
// convierte la respuesta XML a arreglos PHP. Las credenciales de servicio se
// quedan aquí (servidor), nunca en el navegador.
declare(strict_types=1);

/** Falla de negocio del servicio (HTTP 400), distinta de un fallo de red (502). */
final class SoapFaultException extends RuntimeException
{
}

final class Soap
{
    public const NS = 'http://academico.espoch.edu.ec/';

    private string $base;
    private string $user;
    private string $pass;
    private int $timeout;

    public function __construct()
    {
        $this->base = rtrim(Config::get('OASIS_BASE', 'http://swoasis.espoch.edu.ec/OASis/OAS_Interop'), '/');
        $this->user = Config::get('OASIS_USER', '') ?? '';
        $this->pass = Config::get('OASIS_PASS', '') ?? '';
        $this->timeout = (int) (Config::get('OASIS_TIMEOUT', '25') ?? '25');
    }

    private function escape($value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    private function buildInner(string $op, array $params): string
    {
        $inner = '<' . $op . ' xmlns="' . self::NS . '">';
        foreach ($params as $key => $value) {
            $inner .= '<' . $key . '>' . $this->escape($value) . '</' . $key . '>';
        }
        return $inner . '</' . $op . '>';
    }

    private function envelope(string $inner): string
    {
        return '<?xml version="1.0" encoding="utf-8"?>'
            . '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
            . ' xmlns:xsd="http://www.w3.org/2001/XMLSchema"'
            . ' xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
            . '<soap:Header><credentials xmlns="' . self::NS . '">'
            . '<username>' . $this->escape($this->user) . '</username>'
            . '<password>' . $this->escape($this->pass) . '</password>'
            . '</credentials></soap:Header>'
            . '<soap:Body>' . $inner . '</soap:Body></soap:Envelope>';
    }

    private function curlHandle(string $service, string $op, string $body)
    {
        $ch = curl_init($this->base . '/' . $service . '.asmx');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_HTTPHEADER => [
                'Content-Type: text/xml; charset=utf-8',
                'SOAPAction: "' . self::NS . $op . '"',
            ],
        ]);
        return $ch;
    }

    private function extractResult(string $resp, string $op): array
    {
        $parsed = self::parseXml($resp);
        $body = $parsed['Body'] ?? [];
        if (isset($body['Fault'])) {
            $msg = $body['Fault']['faultstring'] ?? 'Error en el servicio OASIS';
            $parts = explode('--->', (string) $msg);
            throw new SoapFaultException(trim(end($parts)));
        }
        return $body[$op . 'Response'][$op . 'Result'] ?? [];
    }

    /** Llama una operación y devuelve el contenido de <OpResult> como arreglo. */
    public function call(string $service, string $op, array $params = []): array
    {
        $ch = $this->curlHandle($service, $op, $this->envelope($this->buildInner($op, $params)));
        $resp = curl_exec($ch);
        if ($resp === false) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new RuntimeException('No se pudo contactar OASIS: ' . $err);
        }
        curl_close($ch);
        return $this->extractResult($resp, $op);
    }

    /**
     * Llama la misma operación con varios juegos de parámetros EN PARALELO
     * (con concurrencia limitada). Devuelve los resultados en el mismo orden.
     */
    public function callMany(string $service, string $op, array $paramSets, int $concurrency = 8): array
    {
        $results = [];
        foreach (array_chunk($paramSets, $concurrency, true) as $chunk) {
            $mh = curl_multi_init();
            $handles = [];
            foreach ($chunk as $i => $params) {
                $ch = $this->curlHandle($service, $op, $this->envelope($this->buildInner($op, $params)));
                curl_multi_add_handle($mh, $ch);
                $handles[$i] = $ch;
            }
            $running = null;
            do {
                curl_multi_exec($mh, $running);
                if ($running > 0) {
                    curl_multi_select($mh, 1.0);
                }
            } while ($running > 0);
            foreach ($handles as $i => $ch) {
                $resp = curl_multi_getcontent($ch);
                curl_multi_remove_handle($mh, $ch);
                curl_close($ch);
                try {
                    $results[$i] = is_string($resp) && $resp !== '' ? $this->extractResult($resp, $op) : [];
                } catch (Throwable $e) {
                    $results[$i] = [];
                }
            }
            curl_multi_close($mh);
        }
        return $results;
    }

    // ---- Parser XML -> arreglo (quita prefijos de namespace, repeticiones -> listas) ----
    public static function parseXml(string $xml): array
    {
        $clean = preg_replace('/(<\/?)[A-Za-z0-9_]+:/', '$1', $xml);
        $clean = preg_replace('/\s+xmlns(:[A-Za-z0-9_]+)?="[^"]*"/', '', (string) $clean);
        $prev = libxml_use_internal_errors(true);
        $sx = simplexml_load_string((string) $clean);
        libxml_use_internal_errors($prev);
        if ($sx === false) {
            return [];
        }
        return self::nodeToArray($sx);
    }

    private static function nodeToArray(SimpleXMLElement $node): array
    {
        $out = [];
        foreach ($node->children() as $name => $child) {
            $value = $child->count() > 0 ? self::nodeToArray($child) : trim((string) $child);
            if (array_key_exists($name, $out)) {
                if (!is_array($out[$name]) || !array_key_exists(0, $out[$name])) {
                    $out[$name] = [$out[$name]];
                }
                $out[$name][] = $value;
            } else {
                $out[$name] = $value;
            }
        }
        return $out;
    }

    /** Normaliza a lista un nodo que puede venir ausente, único o repetido. */
    public static function asList($value): array
    {
        if ($value === null || $value === '') {
            return [];
        }
        if (is_array($value)) {
            if ($value === []) {
                return [];
            }
            return array_keys($value) === range(0, count($value) - 1) ? $value : [$value];
        }
        return [$value];
    }
}
