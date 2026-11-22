// Settings メニュー（SettingsMenu.vue）の遷移先。コマンドパレットから直接開くために使う。
export const SETTINGS_VIEW_ENTRIES = [
  { view: "TerminalConfig", label: "Terminal", icon: "mdi-format-font-size-increase" },
  { view: "EditorConfig", label: "Editor", icon: "mdi-application-edit-outline" },
  { view: "DisplayConfig", label: "Display", icon: "mdi-monitor-eye" },
  { view: "CircleKeypadConfig", label: "Circle Keypad", icon: "mdi-gesture-tap" },
  { view: "NotificationConfig", label: "Notifications", icon: "mdi-bell-outline" },
  { view: "PreviewConfig", label: "Preview Server", icon: "mdi-server" },
  { view: "AuthConfig", label: "Auth", icon: "mdi-shield-lock-outline" },
  { view: "ServerProcesses", label: "Server Processes", icon: "mdi-server" },
  { view: "ServerInfo", label: "System Info", icon: "mdi-information-outline" },
] as const;
