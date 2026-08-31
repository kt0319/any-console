// 非同期フェッチの「未取得・取得中・成功・失敗」を1つの値で表す。複数の
// boolean（xxxLoaded 等）を組み合わせると「loadedかつerror」のような不正な
// 組み合わせを表現できてしまう問題を避けるため、状態を単一の判別可能union
// にまとめる（DispatchRunView.vue参照）。

export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready", value: T }
  | { status: "error", error: string };

export function asyncIdle<T = never>(): AsyncState<T> {
  return { status: "idle" };
}

export function asyncLoading<T = never>(): AsyncState<T> {
  return { status: "loading" };
}

export function asyncReady<T>(value: T): AsyncState<T> {
  return { status: "ready", value };
}

export function asyncError<T = never>(error: string): AsyncState<T> {
  return { status: "error", error };
}

// 未取得(idle)・取得中(loading)の間だけtrue。取得失敗(error)はブロック対象に
// 含めない（失敗時にRunボタン等が永久にdisabledのまま残る事故を防ぐため。
// errorはloadingと混同せず、単に「まだ検証できない」ではなく「検証済みだが
// 使えるデータが無い」として扱う）。
export function isAsyncPending<T>(state: AsyncState<T>): boolean {
  return state.status === "idle" || state.status === "loading";
}

export function asyncValueOr<T>(state: AsyncState<T>, fallback: T): T {
  return state.status === "ready" ? state.value : fallback;
}
