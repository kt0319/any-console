import { createApp } from "vue";
import { createPinia } from "pinia";
import "@mdi/font/css/materialdesignicons.min.css";
import "@xterm/xterm/css/xterm.css";
import "highlight.js/styles/tokyo-night-dark.css";
import "./styles/a11y.css";
import "./styles/drag-utils.css";
import "./styles/base.css";
import App from "./components/App.vue";
import { useAuthStore } from "./stores/auth.js";
import { installErrorReporter } from "./utils/error-reporter.js";

async function bootstrap() {
  // xterm.js が文字幅を測る前に Hack Nerd Font をロードしておく。
  // 未ロードのまま Terminal を生成するとフォールバック幅で grid が決まり、
  // カーソル位置が徐々にずれる症状が出る。
  if (document.fonts?.load) {
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load('1em "Hack Nerd Font"'),
          document.fonts.load('bold 1em "Hack Nerd Font"'),
        ]),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch { /* ignore */ }
  }

  const container = document.getElementById("app");
  if (container) {
    const app = createApp(App);
    app.use(createPinia());
    const auth = useAuthStore();
    installErrorReporter(app, auth.apiFetch.bind(auth));
    app.mount(container);
  }
}

bootstrap();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
