import { ref, computed } from "vue";
import { useAuthStore } from "../stores/auth.ts";
import { EP_PUSH_VAPID_KEY, EP_PUSH_SUBSCRIBE } from "../utils/endpoints.ts";

const _supported = typeof PushManager !== "undefined" && "serviceWorker" in navigator;

const permission = ref<"default" | "granted" | "denied">(typeof Notification !== "undefined" ? Notification.permission : "denied");
const subscription = ref<PushSubscription | null>(null);

/** base64url → Uint8Array（VAPID applicationServerKey 変換用） */
function _urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function usePushNotification() {
  const auth = useAuthStore();

  const isSupported = _supported;
  const isGranted = computed(() => permission.value === "granted");
  const isSubscribed = computed(() => !!subscription.value);

  async function _getRegistration() {
    if (!_supported) return null;
    return navigator.serviceWorker.ready;
  }

  async function _loadExistingSubscription() {
    const reg = await _getRegistration();
    if (!reg) return;
    subscription.value = await reg.pushManager.getSubscription();
  }

  async function _fetchVapidKey() {
    const res = await auth.apiFetch(EP_PUSH_VAPID_KEY);
    if (!res?.ok) throw new Error("Failed to fetch VAPID key");
    const data = await res.json();
    return data.publicKey;
  }

  async function subscribe() {
    if (!_supported) return false;
    try {
      const perm = await Notification.requestPermission();
      permission.value = perm;
      if (perm !== "granted") return false;

      const reg = await _getRegistration();
      if (!reg) return false;

      const vapidKey = await _fetchVapidKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(vapidKey),
      });
      subscription.value = sub;

      const subJson = sub.toJSON();
      await auth.apiFetch(EP_PUSH_SUBSCRIBE, {
        method: "POST",
        body: {
          endpoint: subJson.endpoint,
          keys: subJson.keys,
        },
      });
      return true;
    } catch (e) {
      console.error("Push subscribe failed:", e);
      return false;
    }
  }

  async function unsubscribe() {
    if (!subscription.value) return;
    try {
      const endpoint = subscription.value.endpoint;
      await subscription.value.unsubscribe();
      subscription.value = null;
      await auth.apiFetch(EP_PUSH_SUBSCRIBE, {
        method: "DELETE",
        body: { endpoint },
      });
    } catch (e) {
      console.error("Push unsubscribe failed:", e);
    }
  }

  async function init() {
    if (!_supported) return;
    permission.value = Notification.permission;
    await _loadExistingSubscription();
  }

  return { isSupported, isGranted, isSubscribed, permission, subscribe, unsubscribe, init };
}
