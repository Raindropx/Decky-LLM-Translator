export type PluginLanguage = 'system' | 'en' | 'zh-CN';
export type ResolvedPluginLocale = 'en' | 'zh-CN';

export const CHINESE_UI_FONT_FAMILY =
    '"Motiva Sans", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", sans-serif';

type TranslationVariables = Record<string, string | number>;

const CHINESE_LANGUAGE_VALUES = new Set([
    'chinese',
    'simplified chinese',
    'schinese',
    'tchinese',
    'traditional chinese',
    'zh',
    'zh-cn',
    'zh-hans',
    'zh-hans-cn',
    'zh-hant',
    'zh-hant-hk',
    'zh-hant-tw',
    'zh-hk',
    'zh-mo',
    'zh-sg',
    'zh-tw',
]);

function normalizeLanguage(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase().replace(/_/g, '-') : '';
}

function isChineseLanguage(value: unknown): boolean {
    const normalized = normalizeLanguage(value);
    return CHINESE_LANGUAGE_VALUES.has(normalized) || normalized.startsWith('zh-');
}

function firstLanguage(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        const match = value.find((item) => typeof item === 'string' && item.trim());
        return typeof match === 'string' ? match : '';
    }
    return '';
}

export function detectSystemLocale(): ResolvedPluginLocale {
    try {
        const steamWindow = window as typeof window & {
            LocalizationManager?: Record<string, unknown>;
            g_strLanguage?: string;
            g_rgLocalesToUse?: string[];
        };
        const manager = steamWindow.LocalizationManager;
        const steamLanguage = [
            manager?.m_strLanguage,
            manager?.strLanguage,
            manager?.language,
            manager?.m_rgLocalesToUse,
            steamWindow.g_strLanguage,
            steamWindow.g_rgLocalesToUse,
        ].map(firstLanguage).find(Boolean);

        if (steamLanguage) return isChineseLanguage(steamLanguage) ? 'zh-CN' : 'en';
    } catch {
        // Steam globals are not available in browser-based development environments.
    }

    try {
        const browserLanguage = navigator.languages?.[0] || navigator.language;
        if (browserLanguage) return isChineseLanguage(browserLanguage) ? 'zh-CN' : 'en';
    } catch {
        // Navigator can be unavailable in non-browser tests.
    }

    return 'en';
}

export function resolvePluginLocale(preference: PluginLanguage): ResolvedPluginLocale {
    if (preference === 'zh-CN') return 'zh-CN';
    if (preference === 'en') return 'en';
    return detectSystemLocale();
}

export function normalizePluginLanguage(value: unknown): PluginLanguage {
    return value === 'en' || value === 'zh-CN' || value === 'system' ? value : 'system';
}

let currentLocale: ResolvedPluginLocale = detectSystemLocale();

export function setPluginLanguage(preference: PluginLanguage): ResolvedPluginLocale {
    currentLocale = resolvePluginLocale(preference);
    return currentLocale;
}

export function getPluginLocale(): ResolvedPluginLocale {
    return currentLocale;
}

export function getPluginUIFontFamily(locale: ResolvedPluginLocale): string | undefined {
    return locale === 'zh-CN' ? CHINESE_UI_FONT_FAMILY : undefined;
}

const zhCN: Record<string, string> = {
    'Loading...': '加载中…',
    'System language': '跟随系统语言',
    'Chinese': '中文',
    'English': 'English',
    'Plugin Language': '插件语言',
    'Choose the language used by the plugin interface': '选择插件界面使用的语言',
    'Interface': '界面',
    'Failed to update {setting}': '无法更新{setting}',

    'Plugin is enabled': '插件已启用',
    'Plugin is disabled': '插件已禁用',
    'Toggle the functionality on or off': '开启或关闭插件功能',
    'Close Overlay': '关闭翻译层',
    'Download required': '需要下载组件',
    'Translate': '翻译',
    'Test OCR': '测试 OCR',
    'Checking...': '正在检查…',
    'Ready': '就绪',
    'Not ready ({reason})': '未就绪（{reason}）',
    'unreachable': '无法连接',
    'Recognize + Translate:': '识别并翻译：',
    'Text Recognition:': '文字识别：',
    'On-Device': '本机运行',
    'Installed model:': '已安装模型：',
    'Installing...': '正在安装…',
    'Not ready (Model not installed)': '未就绪（模型尚未安装）',
    'Engine:': '引擎：',
    'Not ready (Engine not installed)': '未就绪（引擎尚未安装）',
    'Free, no API key needed': '免费，无需 API 密钥',
    '10 min limit:': '10 分钟限额：',
    'Rate limit exceeded - resets in {minutes} min': '已超过速率限制，{minutes} 分钟后重置',
    'Daily limit:': '每日限额：',
    'Low daily requests remaining': '今日剩余请求次数不多',
    'Translation:': '翻译：',
    'LLM endpoint not configured': '尚未配置 LLM 端点',
    'Model:': '模型：',
    'Annotated vision': '标注图像',
    'Text only': '仅文本',

    'Languages': '语言',
    'Input Language': '输入语言',
    'Source language for OCR; use auto-detect if unsure': 'OCR 要识别的源语言；不确定时请选择自动检测',
    'Output Language': '输出语言',
    'Target language for LLM translation': 'LLM 翻译的目标语言',
    'Custom Languages': '自定义语言',
    'Add output styles and languages that are not in the built-in list': '添加内置列表中没有的输出语言或表达风格',
    'Manage Custom Languages': '管理自定义语言',
    'Select language…': '选择语言…',
    'Auto-detect': '自动检测',
    'Arabic': '阿拉伯语',
    'Bulgarian': '保加利亚语',
    'Chinese (Simplified)': '简体中文',
    'Chinese (Traditional)': '繁体中文',
    'Croatian': '克罗地亚语',
    'Czech': '捷克语',
    'Danish': '丹麦语',
    'Dutch': '荷兰语',
    'Finnish': '芬兰语',
    'French': '法语',
    'German': '德语',
    'Greek': '希腊语',
    'Hindi': '印地语',
    'Hungarian': '匈牙利语',
    'Italian': '意大利语',
    'Japanese': '日语',
    'Korean': '韩语',
    'Norwegian': '挪威语',
    'Polish': '波兰语',
    'Portuguese': '葡萄牙语',
    'Romanian': '罗马尼亚语',
    'Russian': '俄语',
    'Spanish': '西班牙语',
    'Swedish': '瑞典语',
    'Thai': '泰语',
    'Turkish': '土耳其语',
    'Ukrainian': '乌克兰语',
    'Vietnamese': '越南语',
    'Recognition': '文字识别',
    'Text Recognition Method': '文字识别方式',
    'On-Device (Chrome)': '本机运行（Chrome）',
    'On-Device (RapidOCR)': '本机运行（RapidOCR）',
    'Legacy Gemini Vision (Combined)': '旧版 Gemini Vision（识别与翻译合并）',
    'Legacy Gemini Vision': '旧版 Gemini Vision',
    'Legacy Gemini Model': '旧版 Gemini 模型',
    'This mode lets Gemini detect boxes and translate in one request': '此模式让 Gemini 在一次请求中检测文本框并完成翻译',
    'Faster Recognition': '加快识别',
    'Keep Chrome Screen AI loaded between translations': '在两次翻译之间保持 Chrome Screen AI 已加载',
    'Keep RapidOCR loaded between translations': '在两次翻译之间保持 RapidOCR 已加载',
    'OCR Confidence': 'OCR 置信度',
    'Box Detection Threshold': '文本框检测阈值',
    'OCR Test': 'OCR 测试',
    'Unavailable because Legacy Gemini Vision combines recognition and translation': '旧版 Gemini Vision 会合并识别与翻译，因此无法单独测试 OCR',
    'Capture the current game and show recognized text without calling the translation endpoint': '截取当前游戏画面并显示识别结果，不调用翻译端点',
    'OCR model installed': 'OCR 模型已安装',
    'OCR model download required': '需要下载 OCR 模型',
    'Installing… {progress}%': '正在安装… {progress}%',
    'Install': '安装',
    'Delete': '删除',
    'Google Cloud OCR API Key': 'Google Cloud OCR API 密钥',
    'Used only for Google Cloud Vision OCR. The key is write-only after saving.': '仅供 Google Cloud Vision OCR 使用。保存后密钥只写不可读。',
    'Legacy Gemini Vision API Key': '旧版 Gemini Vision API 密钥',
    'Used only by the retained combined OCR + translation mode. The key is write-only after saving.': '仅供保留的 OCR 与翻译合并模式使用。保存后密钥只写不可读。',
    'API Key': 'API 密钥',
    'Cancel': '取消',
    'Save': '保存',
    'Saving…': '正在保存…',
    'Tip: Copy the API key on another device, then send the clipboard to your Steam Deck with': '提示：可在另一台设备上复制 API 密钥，再通过以下工具将剪贴板发送到 Steam Deck：',
    'Only send API keys between devices you trust.': '只在你信任的设备之间传递 API 密钥。',
    'Tip: Copy the API key on another device, then send the clipboard to your Steam Deck with Decky LocalSend (recommended for Gaming Mode) or KDE Connect and paste it here.': '提示：可在另一台设备上复制 API 密钥，再通过 Decky LocalSend（推荐在游戏模式中使用）或 KDE Connect 将剪贴板发送到 Steam Deck，然后粘贴到这里。',
    'Decky Store: search “Decky LocalSend”': 'Decky 商店：搜索“Decky LocalSend”',
    'Custom Output Languages': '自定义输出语言',
    'The alias appears in the output-language list. The definition is sent to the LLM as the target language.': '别名会显示在输出语言列表中；定义则会作为目标语言原样发送给 LLM。',
    'No custom output languages yet.': '还没有自定义输出语言。',
    'Edit {name}': '编辑 {name}',
    'Delete {name}': '删除 {name}',
    'Add Language': '添加语言',
    'Edit Language': '编辑语言',
    'Alias': '别名',
    'Short name shown in the output-language list': '显示在输出语言列表中的简短名称',
    'Definition': '定义',
    'Exact target-language instruction sent to the LLM': '原样发送给 LLM 的目标语言指令',
    'Apply': '应用',
    'Alias and definition are required.': '别名和定义都不能为空。',
    'Alias must be 80 characters or fewer.': '别名不得超过 80 个字符。',
    'Definition must be 2000 characters or fewer.': '定义不得超过 2000 个字符。',
    'This definition is already used by a built-in output language.': '该定义已被内置输出语言使用。',
    'Each custom language needs a unique alias.': '每种自定义语言都需要唯一的别名。',
    'Each custom language needs a unique definition.': '每种自定义语言都需要唯一的定义。',
    'Could not save custom languages.': '无法保存自定义语言。',

    'LLM Translation': 'LLM 翻译',
    'Legacy Gemini Vision currently handles OCR and translation together. Configured LLM endpoints remain available when you switch back to a normal OCR provider.': '旧版 Gemini Vision 当前会一并处理 OCR 与翻译。切回普通 OCR 提供方后，已配置的 LLM 端点仍可使用。',
    'Current LLM Endpoint': '当前 LLM 端点',
    'Annotated screenshot enabled': '已启用标注截图',
    'Text-only context': '仅发送文本上下文',
    'No endpoints configured': '尚未配置端点',
    'API key configured': '已配置 API 密钥',
    'No API key (allowed for local endpoints)': '未配置 API 密钥（本地端点可以不填）',
    'Add endpoint': '添加端点',
    'Copy selected endpoint': '复制所选端点',
    'Configure your first OpenAI-compatible endpoint': '配置第一个 OpenAI 兼容端点',
    'Edit LLM Endpoint': '编辑 LLM 端点',
    'Add LLM Endpoint': '添加 LLM 端点',
    'Name': '名称',
    'Base URL': '基础 URL',
    'Model': '模型',
    'API Key (leave blank to keep current key)': 'API 密钥（留空以保留当前密钥）',
    'Send Annotated Screenshot': '发送标注截图',
    'Draw OCR IDs on a reference image and send it to the model. Otherwise, only plain text is sent to the model.': '在参考图像上绘制 OCR 编号并发送给模型；关闭时仅向模型发送纯文本。',
    'HTTP sends the API key, OCR text and optional screenshot without transport encryption.': 'HTTP 不提供传输加密，API 密钥、OCR 文本及可选截图将以明文传输。',
    'Could not save endpoint': '无法保存端点',
    'Could not copy endpoint': '无法复制端点',
    'The endpoint to copy no longer exists': '要复制的端点已不存在',

    'Control': '控制',
    'Quick Translation Shortcut': '快速翻译快捷键',
    'Select which buttons to hold to start translaton': '选择按住哪些按键来开始翻译',
    'Hold Time to Start': '开始翻译的按住时长',
    'Seconds to hold button(s) to translate': '按住按键多少秒后开始翻译',
    'Hold Time to Dismiss': '关闭翻译层的按住时长',
    'Seconds to hold button(s) to dismiss overlay': '按住按键多少秒后关闭翻译层',
    'Quick toggle with Right Button': '用右侧按键快速切换',
    'If double buttons combination is selected, press right button to toggle overlay visibility': '选择双键组合时，可按右侧按键切换翻译层显示状态',
    'Display': '显示',
    'Passthrough Mode': '透传模式',
    'Keep the game live and show only translated text boxes instead of the captured screenshot': '保持游戏画面实时显示，只叠加翻译文本框而不显示截图',
    'Text Box Opacity': '文本框不透明度',
    'Adjust the translated text box background without fading the text': '调整翻译文本框背景，不影响文字本身的不透明度',
    'Font Scaling': '字体缩放',
    'Increase if translated text is too small. Can be useful for large external monitors': '翻译文字过小时可调高此项，连接大尺寸外接显示器时尤其有用',
    'Text Blocks Grouping': '文本块合并',
    'Normal - Keeps text blocks separated': '普通——保持文本块分离',
    'Increased - Merges text blocks': '增强——合并相邻文本块',
    'Large - Merges distant text blocks': '大——合并距离较远的文本块',
    'Huge - Merges very distant text blocks': '巨大——合并距离很远的文本块',
    'Translated Text Alignment': '译文对齐方式',
    'Choose alignment for translated text labels': '选择翻译文本标签的对齐方式',
    'Left': '左对齐',
    'Right': '右对齐',
    'Center': '居中',
    'Stretch': '两端对齐',
    'Translated Text Font': '译文字体',
    'Translated Text Style': '译文字形',
    'Font weight and style for translated text': '设置译文的字重和样式',
    'Normal': '常规',
    'Bold': '粗体',
    'Italic': '斜体',
    'Bold Italic': '粗斜体',
    'Auto (System Default)': '自动（系统默认）',
    'Local Fonts': '本地字体',
    'Dyslexia-Friendly': '阅读障碍友好字体',
    'Web Fonts': '网络字体',
    '{local} local + {web} web': '{local} 个本地字体 + {web} 个网络字体',
    ' + {count} dyslexia': ' + {count} 个阅读障碍友好字体',
    ' fonts': '字体',
    'Hide Identical Translations': '隐藏相同译文',
    "Don't display if translation is the same as original word/sentence": '译文与原词句相同时不显示',
    'Allow Labels to Expand': '允许标签扩展',
    "Let translated labels grow wider if the text doesn't fit the original box": '译文放不进原文本框时，允许标签向外扩展',
    'Steam Screenshots': 'Steam 截图',
    'Screenshot': '截图',
    'Include Translations in Screenshots': '在截图中包含译文',
    'Composite the currently visible translated text boxes into STEAM+R1 screenshots': '将当前可见的翻译文本框合成到 STEAM+R1 截图中',
    'Keep Original Screenshot': '保留原始截图',
    "Keep Steam's native image and create a numbered translated copy beside it. Steam Media may not index plugin-created copies": '保留 Steam 原始截图，并在旁边创建带编号的翻译副本。Steam 媒体库可能不会索引插件创建的副本',
    'Behavior': '行为',
    'Pause Game While Translating': '翻译时暂停游戏',
    'Ignored while Passthrough Mode is enabled so the game remains live': '启用透传模式时会忽略此项，以保持游戏实时运行',
    'Pauses the active game and allows you to read the text more thoughtfully. The game is resumed when overlay is dismissed.': '暂停当前游戏，方便从容阅读文本。关闭翻译层后游戏会继续运行。',
    "Doesn't work well with game streaming (moonlight, geforce now, remote play, etc)": '不太适合游戏串流（Moonlight、GeForce NOW、远程畅玩等）',
    'Miscellaneous': '其他',
    'Debug Mode': '调试模式',
    'Enable verbose console logging and diagnostics panel': '启用详细控制台日志和诊断面板',
    'Status:': '状态：',
    'Healthy': '正常',
    'Unhealthy': '异常',
    'Disabled': '已禁用',
    'Input mode:': '输入模式：',
    'Input active:': '输入活动：',
    'Yes': '是',
    'No': '否',
    'Buttons pressed:': '已按按键：',
    'None': '无',
    'Plugin State:': '插件状态：',
    'Cooldown': '冷却中',
    'WaitRelease': '等待松开',
    'Overlay': '翻译层',
    'Timings:': '时长：',
    'Hold:': '按住：',
    'Dismiss:': '关闭：',
    'Input system is unhealthy - try toggling the plugin off/on': '输入系统异常，请尝试关闭后重新启用插件',
    'Left Pad + Right Pad': '左触控板 + 右触控板',
    'L3 (Left Stick Click)': 'L3（按下左摇杆）',
    'R3 (Right Stick Click)': 'R3（按下右摇杆）',
    'L3 + R3 (Both Sticks Click)': 'L3 + R3（同时按下双摇杆）',
    'Both Touchpads Touch': '同时触摸双触控板',

    'Hold to Dismiss ({time}s)': '按住以关闭（{time} 秒）',
    'Hold to Translate ({time}s)': '按住以翻译（{time} 秒）',
    'Processing': '处理中',
    'Recognizing and translating': '正在识别并翻译',
    'Recognizing and Translating': '正在识别并翻译',
    'Recognizing': '正在识别文字',
    'Recognizing text': '正在识别文字',
    'Translating text': '正在翻译文字',
    'Testing OCR': '正在测试 OCR',
    'No text detected': '未检测到文字',
    'No text found': '未检测到文字',
    'Capturing': '正在截图',
    'Selected LLM endpoint': '所选 LLM 端点',
    'Screen capture failed': '截图失败',
    'Try pressing the shortcut again': '请再次按下快捷键重试',
    'Try the OCR test again': '请重新进行 OCR 测试',
    'No internet connection': '没有网络连接',
    'Connection timed out': '连接超时',
    'LLM endpoint timed out': 'LLM 端点响应超时',
    'Could not connect to the LLM endpoint': '无法连接到 LLM 端点',
    'LLM endpoint redirects are not allowed': '不允许 LLM 端点重定向',
    'LLM endpoint rejected the API key': 'LLM 端点拒绝了 API 密钥',
    'LLM endpoint rate limit exceeded': '已超过 LLM 端点的速率限制',
    'Select and configure an LLM endpoint': '请选择并配置一个 LLM 端点',
    'Chrome Screen AI engine not downloaded.\nDownload it in plugin settings': '尚未下载 Chrome Screen AI 引擎。\n请在插件设置中下载。',
    'RapidOCR model not downloaded.\nDownload it in plugin settings': '尚未下载 RapidOCR 模型。\n请在插件设置中下载。',
    'OCR test failed': 'OCR 测试失败',
    'OCR-only test unavailable': '无法单独测试 OCR',
    'Legacy Gemini Vision combines recognition and translation in one request.': '旧版 Gemini Vision 会在一次请求中同时完成识别和翻译。',
    'Select an input language before testing OCR.': '测试 OCR 前请先选择输入语言。',
    'Select an LLM endpoint': '请选择一个 LLM 端点',
    'Screenshot kept without translations': '截图已保留，但未写入译文',
    'Steam screenshot file was not found in time': '未能及时找到 Steam 截图文件',
    'The original Steam screenshot was preserved': '原始 Steam 截图已保留',
    'Translated screenshot copy saved': '翻译截图副本已保存',
    'Steam screenshot saved with translations': '已保存包含译文的 Steam 截图',
    'Invalid API key': 'API 密钥无效',
    'Input language is not set': '尚未设置输入语言',
    'Output language is not set': '尚未设置输出语言',
    'Output and Input languages are not set': '尚未设置输入和输出语言',
    'Input and output languages can not be the same': '输入语言和输出语言不能相同',
    'Please select it in the plugin settings': '请在插件设置中选择',
    'Please select them in the plugin settings': '请在插件设置中选择',
    'Select change them in plugin settings': '请在插件设置中修改',
    'Please configure your API key in the Translation settings tab.': '请在“翻译”设置页中配置 API 密钥。',
    'API key required for OCR': 'OCR 需要 API 密钥',
    'Configure the Google Cloud OCR API key before testing.': '测试前请先配置 Google Cloud OCR API 密钥。',
    'Gemini API key required for Legacy Gemini Vision': '旧版 Gemini Vision 需要 Gemini API 密钥',
    'LLM endpoint is not configured': '尚未配置 LLM 端点',
};

export function t(key: string, variables?: TranslationVariables): string {
    let result = currentLocale === 'zh-CN' ? (zhCN[key] ?? key) : key;
    if (variables) {
        for (const [name, value] of Object.entries(variables)) {
            result = result.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        }
    }
    return result;
}
