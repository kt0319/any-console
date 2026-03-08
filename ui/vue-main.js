import { createApp } from "vue";
import { createPinia } from "pinia";
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
