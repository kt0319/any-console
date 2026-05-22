import { createApp } from "vue";
import { createPinia } from "pinia";
import "@mdi/font/css/materialdesignicons.min.css";
import "@xterm/xterm/css/xterm.css";
import "highlight.js/styles/tokyo-night-dark.css";
import "./styles/a11y.css";
import App from "./components/App.vue";
import { useAuthStore } from "./stores/auth.js";
import { installErrorReporter } from "./utils/error-reporter.js";

const container = document.getElementById("app");
if (container) {
  const app = createApp(App);
  app.use(createPinia());
  const auth = useAuthStore();
  installErrorReporter(app, auth.apiFetch.bind(auth));
  app.mount(container);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
