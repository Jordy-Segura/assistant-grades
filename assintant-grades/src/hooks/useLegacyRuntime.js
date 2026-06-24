import { useEffect } from "react";
import { initLegacyRuntime } from "../legacyRuntime";

export default function useLegacyRuntime() {
  useEffect(() => {
    initLegacyRuntime();
  }, []);
}
