import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Unused Crypgo template leftovers (already excluded from tsconfig)
      "src/components/Auth/**",
      "src/components/Documentation/**",
      "src/components/SharedComponent/Blog/**",
      "src/utils/markdown.ts",
      "src/utils/markdownToHtml.ts",
      "src/utils/validateEmail.ts",
    ],
  },
];

export default eslintConfig;
