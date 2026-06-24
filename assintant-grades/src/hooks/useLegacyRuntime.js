import { useEffect } from "react";
import { initLegacyRuntime } from "../legacyRuntime";
import { initState } from "../services/state";
import "../services/ui";

/**
 * Inicializa los módulos de servicio y el runtime legacy al montar la aplicación.
 * Orden: state → ui → legacyRuntime (para que window.* esté disponible).
 */
export default function useLegacyRuntime() {
  useEffect(() => {
    initState();
    initLegacyRuntime();
  }, []);
}
