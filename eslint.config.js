import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const networkBan = "Tool code must not use the network: files stay on the visitor's device.";

export default defineConfig(
  { ignores: ["dist/", "dist-e2e/", ".astro/", "node_modules/", "test-results/", "playwright-report/"] },
  tseslint.configs.recommended,
  {
    files: ["src/tools/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": ["error",
        { name: "fetch", message: networkBan },
        { name: "XMLHttpRequest", message: networkBan },
        { name: "WebSocket", message: networkBan },
        { name: "EventSource", message: networkBan },
      ],
      "no-restricted-properties": ["error",
        { object: "navigator", property: "sendBeacon", message: networkBan },
        { object: "window", property: "fetch", message: networkBan },
        { object: "globalThis", property: "fetch", message: networkBan },
      ],
    },
  },
);
