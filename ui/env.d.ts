/// <reference types="vite/client" />

// .vue モジュールの型シム。P6（SFC の lang="ts" 化 + vue-tsc での .vue 検査）までは
// .ts ファイルからの `import X from "./X.vue"` をこの汎用型で解決する。
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
