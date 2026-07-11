import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: ["storage/**", ".generated/**", ".next/**", "public/**/*.ipynb", "notebooks/**"]
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off"
    },
    rules: {
      "@next/next/no-img-element": "off",
      // The legacy application predates these rules. Keep its lint runnable and
      // enforce the stricter profile below on the new orchestration boundary.
      complexity: "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "off",
      "react/no-unescaped-entities": "off"
    }
  },
  {
    files: [
      "services/orchestrator/**/*.{ts,tsx}",
      "services/tools/**/*.{ts,tsx}",
      "services/skills/**/*.{ts,tsx}",
      "app/api/orchestrator/**/*.{ts,tsx}",
      "components/supercomputer/**/*.{ts,tsx}",
      "app/(dashboard)/supercomputer/**/*.{ts,tsx}"
    ],
    rules: {
      complexity: ["error", 10],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/ban-ts-comment": "error"
    }
  }
];

export default eslintConfig;
