import { createApp } from "vue";
import { createPinia } from "pinia";
import "@mdi/font/css/materialdesignicons.min.css";
import "@xterm/xterm/css/xterm.css";
import "highlight.js/styles/tokyo-night-dark.css";
import App from "./components/App.vue";

const container = document.getElementById("app");
if (container) {
  const app = createApp(App);
  app.use(createPinia());
  app.mount(container);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
