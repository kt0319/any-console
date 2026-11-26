// 非同期フェッチの状態を判別可能 union で表す（boolean の組み合わせだと loaded かつ error 等の不正状態を表現できてしまう）。

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

// idle / loading の間だけ true。error は含めない（失敗時に Run ボタン等が永久に disabled のままになるため）
export function isAsyncPending<T>(state: AsyncState<T>): boolean {
  return state.status === "idle" || state.status === "loading";
}

export function asyncValueOr<T>(state: AsyncState<T>, fallback: T): T {
  return state.status === "ready" ? state.value : fallback;
}
