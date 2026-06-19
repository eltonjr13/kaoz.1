import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off"
    },
    rules: {
      "@next/next/no-img-element": "off",
      complexity: ["error", 10]
    }
  }
];

export default eslintConfig;
