import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "react-native": "react-native-web",
      // react-native-svg no carga en Node; los tests usan un sustituto inerte.
      "react-native-svg": fileURLToPath(new URL("./tests/react-native-svg.stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});

