/**
 * 快捷键录制组件：点击激活 → 按键捕获 → 显示快捷键字符串。
 *
 * 用法：
 *   const recorder = new KeyRecorder(element, initialValue);
 *   recorder.value; // 当前快捷键字符串，如 "Alt+Cmd+C"
 */

/** macOS 上 Meta 键显示为 Cmd，Windows/Linux 显示为 Win。 */
const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

function keyName(key: string): string {
  switch (key) {
    case "Meta": return isMac ? "Cmd" : "Win";
    case "Control": return "Ctrl";
    case "Alt": return "Alt";
    case "Shift": return "Shift";
    case " ": return "Space";
    default:
      // 单字符大写（A-Z），功能键原样（F1, Escape 等）
      if (key.length === 1) return key.toUpperCase();
      return key;
  }
}

export class KeyRecorder {
  private readonly el: HTMLElement;
  private labelEl: HTMLElement;
  private _value: string;
  private recording = false;

  constructor(el: HTMLElement, initialValue: string) {
    this.el = el;
    this._value = initialValue;

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

      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      if (e.metaKey) mods.push(isMac ? "Cmd" : "Win");

      // 修饰键单独按下不算完整快捷键
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;

      // Tauri 要求至少一个修饰键
      if (mods.length === 0) {
        this.labelEl.textContent = "需要修饰键 (Ctrl/Alt/Shift/Cmd)…";
        return;
      }

      mods.push(keyName(e.key));
      this._value = mods.join("+");
      this.stopRecording();
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
