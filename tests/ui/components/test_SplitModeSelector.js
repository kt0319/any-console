// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SplitModeSelector from "../../../ui/components/SplitModeSelector.vue";

describe("SplitModeSelector", () => {
  it("4つのモードボタンを描画する", () => {
    const wrapper = mount(SplitModeSelector, {
      props: { currentMode: "normal", tabCount: 2 },
    });
    expect(wrapper.findAll("button")).toHaveLength(4);
  });

  it("currentMode と一致するボタンに active クラスが付く", () => {
    const wrapper = mount(SplitModeSelector, {
      props: { currentMode: "vertical", tabCount: 2 },
    });
    const buttons = wrapper.findAll("button");
    // normal=0, vertical=1, horizontal=2, grid=3
    expect(buttons[1].classes()).toContain("active");
    expect(buttons[0].classes()).not.toContain("active");
  });

  it("tabCount < 2 のとき vertical/horizontal が disabled になる", () => {
    const wrapper = mount(SplitModeSelector, {
      props: { currentMode: "normal", tabCount: 1 },
    });
    const buttons = wrapper.findAll("button");
    expect(buttons[0].attributes("disabled")).toBeUndefined(); // normal
    expect(buttons[1].attributes("disabled")).toBeDefined();   // vertical
    expect(buttons[2].attributes("disabled")).toBeDefined();   // horizontal
    expect(buttons[3].attributes("disabled")).toBeDefined();   // grid
  });

  it("tabCount === 2 のとき vertical/horizontal が enabled、grid が disabled", () => {
    const wrapper = mount(SplitModeSelector, {
      props: { currentMode: "normal", tabCount: 2 },
    });
    const buttons = wrapper.findAll("button");
    expect(buttons[1].attributes("disabled")).toBeUndefined(); // vertical
    expect(buttons[2].attributes("disabled")).toBeUndefined(); // horizontal
    expect(buttons[3].attributes("disabled")).toBeDefined();   // grid (minTabs=3)
  });

  it("tabCount >= 3 のとき全モードが enabled", () => {
    const wrapper = mount(SplitModeSelector, {
      props: { currentMode: "normal", tabCount: 3 },
    });
    const buttons = wrapper.findAll("button");
    buttons.forEach((btn) => {
      expect(btn.attributes("disabled")).toBeUndefined();
    });
  });

  it("ボタンクリックで select イベントをモード値とともに emit する", async () => {
    const wrapper = mount(SplitModeSelector, {
      props: { currentMode: "normal", tabCount: 2 },
    });
    const buttons = wrapper.findAll("button");
    await buttons[1].trigger("click"); // vertical
    expect(wrapper.emitted("select")).toBeTruthy();
    expect(wrapper.emitted("select")?.[0]).toEqual(["vertical"]);
  });

  it("normal ボタンクリックで select('normal') を emit する", async () => {
    const wrapper = mount(SplitModeSelector, {
      props: { currentMode: "vertical", tabCount: 2 },
    });
    await wrapper.findAll("button")[0].trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["normal"]);
  });
});
