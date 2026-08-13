/**
 * 页内翻译进度条（M3）。
 * 所有样式带 eat- 前缀，避免污染目标页面。
 */
import type { TranslationError } from '../shared/types';

const BAR_ID = 'eat-translation-bar';

function injectStyle(): void {
  if (document.getElementById('eat-style')) return;
  const style = document.createElement('style');
  style.id = 'eat-style';
  style.textContent = `
    #eat-translation-bar {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      border-radius: 8px;
      background: #1f2937;
      color: #f9fafb;
      font: 13px/1.4 system-ui, "Microsoft YaHei", sans-serif;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      max-width: 90vw;
      opacity: 1;
      transition: opacity 0.4s ease;
    }
    #eat-translation-bar.eat-fade-out {
      opacity: 0;
    }
    #eat-translation-bar.eat-error {
      background: #7f1d1d;
    }
    #eat-translation-bar.eat-done {
      background: #14532d;
    }
    .eat-bar-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .eat-bar-progress {
      min-width: 90px;
      height: 6px;
      border-radius: 3px;
      background: #4b5563;
      overflow: hidden;
    }
    .eat-bar-progress > div {
      height: 100%;
      width: 0%;
      background: #60a5fa;
      transition: width 0.2s ease;
    }
    .eat-bar-btn {
      border: 1px solid rgba(255, 255, 255, 0.4);
      background: transparent;
      color: inherit;
      border-radius: 6px;
      padding: 3px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .eat-bar-btn:hover {
      background: rgba(255, 255, 255, 0.12);
    }
  `;
  document.documentElement.appendChild(style);
}

export class TranslationBar {
  private readonly bar: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private readonly progress: HTMLDivElement;

  constructor() {
    injectStyle();
    this.bar = document.createElement('div');
    this.bar.id = BAR_ID;

    this.text = document.createElement('span');
    this.text.className = 'eat-bar-text';

    const progressWrap = document.createElement('div');
    progressWrap.className = 'eat-bar-progress';
    this.progress = document.createElement('div');
    progressWrap.appendChild(this.progress);

    this.bar.appendChild(this.text);
    this.bar.appendChild(progressWrap);
    document.documentElement.appendChild(this.bar);
  }

  update(done: number, total: number, providerName: string): void {
    this.text.textContent = `翻译中 ${done}/${total} · ${providerName}`;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    this.progress.style.width = `${percent}%`;
  }

  complete(truncated: boolean): void {
    this.bar.classList.add('eat-done');
    this.progress.style.width = '100%';
    this.text.textContent = truncated
      ? '翻译完成（部分内容超过上限未翻译）'
      : '翻译完成';
  }

  /** 淡出后自动移除 */
  fadeOut(): void {
    this.bar.classList.add('eat-fade-out');
    setTimeout(() => this.bar.remove(), 400);
  }

  fail(error: TranslationError): void {
    this.bar.classList.add('eat-error');
    this.text.textContent = `翻译失败：${error.message}`;
  }

  addButton(label: string, onClick: () => void): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'eat-bar-btn';
    button.textContent = label;
    button.addEventListener('click', onClick);
    this.bar.appendChild(button);
  }

  remove(): void {
    this.bar.remove();
  }
}
