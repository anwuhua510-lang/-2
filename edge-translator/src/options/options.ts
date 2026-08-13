import './options.css';
import { getSettings, saveSettings } from '../shared/storage';
import { callProvider } from '../background/providers';
import type {
  ExtensionSettings,
  GlossaryEntry,
  ProviderConfig,
  ProviderKind,
} from '../shared/types';

function makeSampleGlossary(): GlossaryEntry[] {
  return [
    { id: newId(), source: 'AI', target: '人工智能', category: '科技' },
    { id: newId(), source: 'machine learning', target: '机器学习', category: '科技' },
    { id: newId(), source: 'large language model', target: '大语言模型', category: '科技' },
    { id: newId(), source: 'prompt', target: '提示词', category: '科技' },
    { id: newId(), source: 'token', target: '词元', category: '科技' },
    { id: newId(), source: 'inference', target: '推理', category: '科技' },
    { id: newId(), source: 'benchmark', target: '基准测试', category: '科技' },
    { id: newId(), source: 'fine-tuning', target: '微调', category: '科技' },
    { id: newId(), source: 'deployment', target: '部署', category: '科技' },
    { id: newId(), source: 'respawn', target: '重生', category: '游戏' },
    { id: newId(), source: 'loadout', target: '配装', category: '游戏' },
    { id: newId(), source: 'boss', target: '首领', category: '游戏' },
    { id: newId(), source: 'quest', target: '任务', category: '游戏' },
    { id: newId(), source: 'grind', target: '刷（重复刷取）', category: '游戏' },
    { id: newId(), source: 'nerf', target: '削弱', category: '游戏' },
    { id: newId(), source: 'buff', target: '增强', category: '游戏' },
    { id: newId(), source: 'protagonist', target: '主角', category: '动漫' },
    { id: newId(), source: 'filler', target: '原创剧情', category: '动漫' },
    { id: newId(), source: 'seiyuu', target: '声优', category: '动漫' },
    { id: newId(), source: 'light novel', target: '轻小说', category: '动漫' },
    { id: newId(), source: 'manga', target: '漫画', category: '动漫' },
  ];
}

let settings: ExtensionSettings;

document.addEventListener('DOMContentLoaded', () => {
  void init();
});

async function init(): Promise<void> {
  settings = await getSettings();
  renderAll();
  bindGlobalControls();
}

function renderAll(): void {
  (document.getElementById('target-language') as HTMLSelectElement).value =
    settings.targetLanguage;
  (document.getElementById('source-language') as HTMLSelectElement).value =
    settings.sourceLanguage;
  (document.getElementById('max-blocks') as HTMLInputElement).value = String(
    settings.maxTextBlocksPerPage,
  );
  (document.getElementById('max-chars') as HTMLInputElement).value = String(
    settings.maxCharsPerRequest,
  );
  (document.getElementById('max-retries') as HTMLInputElement).value = String(
    settings.maxRetries,
  );
  (document.getElementById('auto-retry') as HTMLInputElement).checked =
    settings.autoRetry;
  (document.getElementById('proxy-enabled') as HTMLInputElement).checked =
    settings.proxy.enabled;
  renderProviders();
  renderGlossary();
}

function bindGlobalControls(): void {
  const setNumber = (id: string, apply: (value: number) => void) => {
    document.getElementById(id)?.addEventListener('change', (event) => {
      apply(Number((event.target as HTMLInputElement).value));
    });
  };
  setNumber('max-blocks', (v) => (settings.maxTextBlocksPerPage = v));
  setNumber('max-chars', (v) => (settings.maxCharsPerRequest = v));
  setNumber('max-retries', (v) => (settings.maxRetries = v));

  (document.getElementById('target-language') as HTMLSelectElement).addEventListener(
    'change',
    (event) => {
      settings.targetLanguage = (event.target as HTMLSelectElement)
        .value as ExtensionSettings['targetLanguage'];
    },
  );
  (document.getElementById('source-language') as HTMLSelectElement).addEventListener(
    'change',
    (event) => {
      settings.sourceLanguage = (event.target as HTMLSelectElement)
        .value as ExtensionSettings['sourceLanguage'];
    },
  );
  (document.getElementById('auto-retry') as HTMLInputElement).addEventListener(
    'change',
    (event) => {
      settings.autoRetry = (event.target as HTMLInputElement).checked;
    },
  );
  (document.getElementById('proxy-enabled') as HTMLInputElement).addEventListener(
    'change',
    (event) => {
      settings.proxy.enabled = (event.target as HTMLInputElement).checked;
    },
  );

  document.getElementById('add-gemini')?.addEventListener('click', () => {
    settings.providers.push(newProvider('gemini', 'Gemini', 'gemini-3.6-flash'));
    renderProviders();
  });
  document.getElementById('add-openai')?.addEventListener('click', () => {
    settings.providers.push(
      newProvider('openai-compatible', 'OpenAI 兼容', 'llama-3.3-70b-versatile'),
    );
    renderProviders();
  });

  document.getElementById('add-glossary')?.addEventListener('click', () => {
    settings.glossary.push({ id: newId(), source: '', target: '' });
    renderGlossary();
  });
  document.getElementById('load-sample')?.addEventListener('click', () => {
    settings.glossary = makeSampleGlossary();
    renderGlossary();
  });
  document.getElementById('export-glossary')?.addEventListener('click', exportGlossary);
  document.getElementById('import-glossary')?.addEventListener('click', () => {
    (document.getElementById('glossary-file') as HTMLInputElement).click();
  });
  (document.getElementById('glossary-file') as HTMLInputElement).addEventListener(
    'change',
    importGlossary,
  );

  document.getElementById('save')?.addEventListener('click', save);
}

function newProvider(kind: ProviderKind, name: string, model: string): ProviderConfig {
  return {
    id: newId(),
    name,
    kind,
    model,
    apiKey: '',
    enabled: true,
  };
}

function renderProviders(): void {
  const container = document.getElementById('provider-list');
  if (!container) return;
  container.replaceChildren();

  settings.providers.forEach((provider, index) => {
    const row = document.createElement('div');
    row.className = 'provider-row';

    const head = document.createElement('div');
    head.className = 'row-head';

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = provider.enabled;
    enabled.title = '启用';
    enabled.addEventListener('change', () => {
      provider.enabled = enabled.checked;
    });

    const kindLabel = document.createElement('span');
    kindLabel.className = 'badge';
    kindLabel.textContent = provider.kind === 'gemini' ? 'Gemini' : 'OpenAI';

    const name = document.createElement('input');
    name.className = 'p-name';
    name.placeholder = '名称';
    name.value = provider.name;
    name.addEventListener('input', () => {
      provider.name = name.value;
    });

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const up = actionButton('↑', '上移优先级', () => moveProvider(index, -1));
    const down = actionButton('↓', '下移优先级', () => moveProvider(index, 1));
    const remove = actionButton('删除', '删除该引擎', () => {
      settings.providers.splice(index, 1);
      renderProviders();
    });
    actions.append(up, down, remove);

    head.append(enabled, kindLabel, name, actions);
    row.appendChild(head);

    const body = document.createElement('div');
    body.className = 'row-body';
    const model = textInput('模型，如 gemini-2.5-flash', provider.model, (value) => {
      provider.model = value;
    });
    const key = passwordInput('API key（每个用户填自己的）', provider.apiKey, (value) => {
      provider.apiKey = value;
    });
    const base = textInput('自定义 endpoint（可选）', provider.baseUrl ?? '', (value) => {
      provider.baseUrl = value || undefined;
    });
    body.append(model, key, base);

    const footer = document.createElement('div');
    footer.className = 'provider-footer';
    const status = document.createElement('span');
    status.className = 'test-status';
    const testButton = actionButton('测试连接', '验证 key 与模型是否可用', () => {
      void testProvider(provider, status);
    });
    footer.append(testButton, status);

    row.appendChild(body);
    row.appendChild(footer);
    container.appendChild(row);
  });
}

async function testProvider(
  provider: ProviderConfig,
  status: HTMLSpanElement,
): Promise<void> {
  status.textContent = '测试中…';
  status.className = 'test-status';
  try {
    const result = await callProvider(
      provider,
      [{ id: '0', text: 'Hello, world' }],
      'en',
      'zh-CN',
      [],
    );
    const translated = result.segments[0]?.text ?? '';
    status.textContent = `✓ 连接成功：${translated}`;
    status.className = 'test-status ok';
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);
    status.textContent = `✗ ${message}`;
    status.className = 'test-status err';
  }
}

function renderGlossary(): void {
  const container = document.getElementById('glossary-list');
  if (!container) return;
  container.replaceChildren();

  settings.glossary.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'glossary-row';

    const source = textInput('原文', entry.source, (value) => {
      entry.source = value;
    });
    const target = textInput('译文', entry.target, (value) => {
      entry.target = value;
    });
    const category = textInput('分类（可选）', entry.category ?? '', (value) => {
      entry.category = value || undefined;
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-btn';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      settings.glossary.splice(index, 1);
      renderGlossary();
    });

    row.append(source, target, category, remove);
    container.appendChild(row);
  });
}

function moveProvider(index: number, delta: number): void {
  const target = index + delta;
  if (target < 0 || target >= settings.providers.length) return;
  const [item] = settings.providers.splice(index, 1);
  settings.providers.splice(target, 0, item);
  renderProviders();
}

function textInput(
  placeholder: string,
  value: string,
  onInput: (value: string) => void,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

function passwordInput(
  placeholder: string,
  value: string,
  onInput: (value: string) => void,
): HTMLInputElement {
  const input = textInput(placeholder, value, onInput);
  input.type = 'password';
  return input;
}

function actionButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
}

function exportGlossary(): void {
  const payload = { version: 1, glossary: settings.glossary };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'glossary.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

function importGlossary(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  void (async () => {
    try {
      const parsed = JSON.parse(await file.text()) as {
        glossary?: GlossaryEntry[];
      };
      const list = Array.isArray(parsed)
        ? (parsed as GlossaryEntry[])
        : parsed.glossary;
      if (!Array.isArray(list)) throw new Error('格式不正确');
      settings.glossary = list.map((entry) => ({
        id: newId(),
        source: String(entry.source ?? ''),
        target: String(entry.target ?? ''),
        category: entry.category ? String(entry.category) : undefined,
        note: entry.note ? String(entry.note) : undefined,
      }));
      renderGlossary();
      setStatus('已导入 ' + settings.glossary.length + ' 条词条');
    } catch {
      setStatus('导入失败：文件格式不正确', true);
    }
  })();
}

async function save(): Promise<void> {
  const enabledProviders = settings.providers.filter((provider) => provider.enabled);
  const incomplete = enabledProviders.find(
    (provider) =>
      provider.name.trim() === '' ||
      provider.model.trim() === '' ||
      provider.apiKey.trim() === '',
  );
  if (incomplete) {
    setStatus('请完整填写启用的引擎（名称/模型/API key）', true);
    return;
  }
  await saveSettings(settings);
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings }).catch(() => {});
  setStatus('已保存 ' + new Date().toLocaleTimeString());
}

function setStatus(message: string, isError = false): void {
  const status = document.getElementById('save-status');
  if (!status) return;
  status.textContent = message;
  status.className = isError ? 'error' : '';
}

function newId(): string {
  return crypto.randomUUID();
}
