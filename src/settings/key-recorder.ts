/**
 * 快捷键录制组件：点击激活 → 按键捕获 → 显示快捷键字符串。
 *
 * 用法：
 *   const recorder = new KeyRecorder(element, initialValue);
 *   recorder.value; // 当前快捷键字符串，如 "Alt+Cmd+C"
 *
 * 可选第三参 onChange 在录制值变化后调用（Task 8 用于实时冲突检测）。
 */

import { eventToCombo } from "../shared/shortcuts";

export class KeyRecorder {
  private readonly el: HTMLElement;
  private labelEl: HTMLElement;
  private _value: string;
  private recording = false;
  private readonly onChange?: () => void;

  constructor(el: HTMLElement, initialValue: string, onChange?: () => void) {
    this.el = el;
    this._value = initialValue;
    this.onChange = onChange;

    // 确保内部结构
    this.labelEl = el.querySelector(".key-recorder-label") ?? el;

    this.render();
    this.bindEvents();
  }

  get value(): string {
    return this._value;
  }

  set value(v: string) {
    this._value = v;
    this.render();
  }

  private render(): void {
    this.el.dataset.state = this.recording ? "recording" : this._value ? "saved" : "idle";
    this.el.setAttribute("aria-busy", String(this.recording));
    if (!this.el.hasAttribute("aria-invalid")) this.el.setAttribute("aria-invalid", "false");
    if (this.recording) {
      this.el.classList.add("recording");
      this.el.classList.remove("has-value");
      this.labelEl.textContent = "按下快捷键…";
    } else if (this._value) {
      this.el.classList.remove("recording");
      this.el.classList.add("has-value");
      this.labelEl.textContent = this._value;
    } else {
      this.el.classList.remove("recording", "has-value");
      this.labelEl.textContent = "点击录制";
    }
  }

  private bindEvents(): void {
    this.el.addEventListener("click", () => {
      if (!this.recording) this.startRecording();
    });

    this.el.addEventListener("keydown", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        this.stopRecording();
        return;
      }

      if (!this.recording) return;

      const combo = eventToCombo(e);
      if (combo === null) {
        this.labelEl.textContent = "需要修饰键 (Ctrl/Alt/Shift/Cmd)…";
        return;
      }
      this._value = combo;
      this.stopRecording();
      this.onChange?.();
    });

    this.el.addEventListener("focus", () => {
      if (!this.recording) this.startRecording();
    });

    this.el.addEventListener("blur", () => {
      if (this.recording) this.stopRecording();
    });
  }

  private startRecording(): void {
    this.recording = true;
    this.render();
    this.el.focus();
  }

  private stopRecording(): void {
    this.recording = false;
    this.render();
  }
}
