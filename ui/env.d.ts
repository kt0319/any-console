/// <reference types="vite/client" />

// .vue モジュールの型シム（SFC の lang="ts" 化までの暫定）。
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
