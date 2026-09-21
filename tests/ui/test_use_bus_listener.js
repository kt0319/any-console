// @ts-check
import { describe, it, expect } from "vitest";
import { effectScope } from "vue";
import { emit } from "../../ui/app-bridge.ts";
import { useBusListener } from "../../ui/composables/useBusListener.ts";

describe("useBusListener", () => {
  it("effect scope の破棄で購読が自動解除される", () => {
    const received = [];
    const scope = effectScope();
    scope.run(() => useBusListener("toast:show", (detail) => received.push(detail)));

    emit("toast:show", { message: "a" });
    scope.stop();
    emit("toast:show", { message: "b" });

    expect(received).toEqual([{ message: "a" }]);
  });

  it("scope 外では解除されず、戻り値の off で手動解除できる", () => {
    const received = [];
    const off = useBusListener("toast:show", (detail) => received.push(detail));

    emit("toast:show", { message: "a" });
    off();
    emit("toast:show", { message: "b" });

    expect(received).toEqual([{ message: "a" }]);
  });
});
