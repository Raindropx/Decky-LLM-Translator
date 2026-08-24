import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../src/i18n.ts', import.meta.url);
const rawSource = fs.readFileSync(sourceUrl, 'utf8');
const source = rawSource.replace(
    /^import (\w+) from ['"](\.\/locales\/[^'"]+)['"];$/gm,
    (_match, variable, relativePath) => {
        const localeSource = fs.readFileSync(new URL(`${relativePath}.ts`, sourceUrl), 'utf8');
        const initializer = localeSource.match(/const (?:strings|keys) = ([\s\S]*?) as const;/)?.[1];
        if (!initializer) throw new Error(`Could not inline ${relativePath}`);
        return `const ${variable} = ${initializer};`;
    },
);
const javascript = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.ES2020,
        target: ts.ScriptTarget.ES2020,
    },
}).outputText;
const i18n = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

function objectLiteralEntries(sourceText, variableName, filename) {
    const sourceFile = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true);
    let entries;
    const visit = (node) => {
        const initializer = node.initializer && ts.isAsExpression(node.initializer)
            ? node.initializer.expression
            : node.initializer;
        if (ts.isVariableDeclaration(node)
            && node.name.getText(sourceFile) === variableName
            && initializer
            && ts.isObjectLiteralExpression(initializer)) {
            entries = initializer.properties.map((property) => [
                property.name.text,
                property.initializer.text,
            ]);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    assert.ok(entries, `${variableName} object was not found in ${filename}`);
    return entries;
}

function arrayLiteralValues(sourceText, variableName, filename) {
    const sourceFile = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true);
    let values;
    const visit = (node) => {
        const initializer = node.initializer && ts.isAsExpression(node.initializer)
            ? node.initializer.expression
            : node.initializer;
        if (ts.isVariableDeclaration(node)
            && node.name.getText(sourceFile) === variableName
            && initializer
            && ts.isArrayLiteralExpression(initializer)) {
            values = initializer.elements.map((element) => {
                assert.ok(ts.isStringLiteral(element), `${variableName} contains a non-string entry in ${filename}`);
                return element.text;
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    assert.ok(values, `${variableName} array was not found in ${filename}`);
    return values;
}

function setSteamLanguage(language) {
    globalThis.window = { LocalizationManager: { m_strLanguage: language } };
}

test('Steam simplified and traditional Chinese both resolve to Chinese UI', () => {
    setSteamLanguage('schinese');
    assert.equal(i18n.detectSystemLocale(), 'zh-CN');
    setSteamLanguage('tchinese');
    assert.equal(i18n.detectSystemLocale(), 'zh-CN');
});

test('Steam non-Chinese language falls back to English UI', () => {
    setSteamLanguage('dutch');
    assert.equal(i18n.detectSystemLocale(), 'en');
});

test('Steam interface languages resolve to their matching plugin locale', () => {
    const expected = {
        japanese: 'ja',
        ja: 'ja',
        koreana: 'ko',
        russian: 'ru',
        spanish: 'es',
        latam: 'es',
        'es-419': 'es',
        vietnamese: 'vi',
        malay: 'ms',
        french: 'fr',
        german: 'de',
        polish: 'pl',
        indonesian: 'id',
        italian: 'it',
        thai: 'th',
        finnish: 'fi',
    };
    for (const [steamLanguage, locale] of Object.entries(expected)) {
        setSteamLanguage(steamLanguage);
        assert.equal(i18n.detectSystemLocale(), locale, steamLanguage);
    }
});

test('browser Chinese locale is used when Steam localization globals are unavailable', () => {
    delete globalThis.window;
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { language: 'zh-TW', languages: ['zh-TW'] },
    });
    assert.equal(i18n.detectSystemLocale(), 'zh-CN');
});

test('browser locales can follow languages that Steam cannot select as its interface', () => {
    const expected = {
        'fil-PH': 'fil',
        'ko-KP': 'ko-KP',
        'nan-TW': 'nan',
        tok: 'tok',
        eo: 'eo',
    };
    for (const [browserLanguage, locale] of Object.entries(expected)) {
        delete globalThis.window;
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { language: browserLanguage, languages: [browserLanguage] },
        });
        assert.equal(i18n.detectSystemLocale(), locale, browserLanguage);
    }
});

test('manual plugin language overrides system detection', () => {
    setSteamLanguage('english');
    assert.equal(i18n.resolvePluginLocale('zh-CN'), 'zh-CN');
    setSteamLanguage('schinese');
    assert.equal(i18n.resolvePluginLocale('en'), 'en');
    for (const option of i18n.PLUGIN_LANGUAGE_OPTIONS) {
        assert.equal(i18n.resolvePluginLocale(option.data), option.data);
    }
});

test('Chinese UI uses a Simplified Chinese font before generic fallback', () => {
    const family = i18n.getPluginUIFontFamily('zh-CN');
    assert.match(family, /Noto Sans CJK SC/);
    assert.ok(family.indexOf('Noto Sans CJK SC') < family.lastIndexOf('sans-serif'));
    assert.equal(i18n.getPluginUIFontFamily('en'), undefined);
});

test('CJK interface locales select region-correct font stacks', () => {
    assert.match(i18n.getPluginUIFontFamily('ja'), /Noto Sans CJK JP/);
    assert.match(i18n.getPluginUIFontFamily('ko'), /Noto Sans CJK KR/);
    assert.match(i18n.getPluginUIFontFamily('ko-KP'), /Noto Sans CJK KR/);
    assert.match(i18n.getPluginUIFontFamily('nan'), /Noto Sans CJK TC/);
});

test('unknown saved language is normalized to system preference', () => {
    assert.equal(i18n.normalizePluginLanguage('not-supported'), 'system');
    assert.equal(i18n.normalizePluginLanguage('zh-CN'), 'zh-CN');
    assert.equal(i18n.normalizePluginLanguage('tok'), 'tok');
});

test('plugin language options contain every locale once', () => {
    const locales = i18n.PLUGIN_LANGUAGE_OPTIONS.map((option) => option.data);
    assert.equal(locales.length, 20);
    assert.equal(new Set(locales).size, locales.length);
});

test('backend accepts every plugin interface language', () => {
    const mainSource = fs.readFileSync(new URL('../main.py', import.meta.url), 'utf8');
    const validationSet = mainSource.match(/key == "plugin_language" and value not in \{([\s\S]*?)\}:/)?.[1];
    assert.ok(validationSet, 'plugin_language validation set was not found in main.py');
    const backendLocales = [...validationSet.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
    const frontendLocales = ['system', ...i18n.PLUGIN_LANGUAGE_OPTIONS.map((option) => option.data)].sort();
    assert.deepEqual(backendLocales, frontendLocales);
});

test('untranslated interface strings fall back to the English source key in every locale', () => {
    const futureEnglishSetting = 'Future untranslated setting';
    for (const option of i18n.PLUGIN_LANGUAGE_OPTIONS) {
        i18n.setPluginLanguage(option.data);
        assert.equal(i18n.t(futureEnglishSetting), futureEnglishSetting, option.data);
    }
    i18n.setPluginLanguage('zh-CN');
    assert.equal(i18n.t('Plugin Language'), '插件语言');
});

test('inserting a new source string does not shift existing positional translations', async () => {
    const futureEnglishSetting = 'Future untranslated setting';
    const sourceWithNewSetting = source.replace(
        'const zhCN: Record<string, string> = {',
        `const zhCN: Record<string, string> = {\n    '${futureEnglishSetting}': '未来设置',`,
    );
    const javascriptWithNewSetting = ts.transpileModule(sourceWithNewSetting, {
        compilerOptions: {
            module: ts.ModuleKind.ES2020,
            target: ts.ScriptTarget.ES2020,
        },
    }).outputText;
    const moduleWithNewSetting = await import(
        `data:text/javascript;base64,${Buffer.from(javascriptWithNewSetting).toString('base64')}`
    );

    moduleWithNewSetting.setPluginLanguage('ja');
    assert.equal(moduleWithNewSetting.t('Loading...'), '読み込み中...');
    assert.equal(moduleWithNewSetting.t(futureEnglishSetting), futureEnglishSetting);
});

test('every interface locale translates core controls and preserves placeholders', () => {
    const coreKeys = ['System language', 'Plugin Language', 'Translate', 'Save'];
    const placeholderKeys = [
        'Failed to update {setting}',
        'Not ready ({reason})',
        'Rate limit exceeded - resets in {minutes} min',
        'Installing… {progress}%',
        'Edit {name}',
        'Delete {name}',
        '{local} local + {web} web',
        ' + {count} dyslexia',
        'Hold to Dismiss ({time}s)',
        'Hold to Translate ({time}s)',
    ];
    const placeholders = (value) => [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
    const untranslatedCore = [];
    const placeholderMismatches = [];

    for (const option of i18n.PLUGIN_LANGUAGE_OPTIONS) {
        if (option.data === 'en') continue;
        i18n.setPluginLanguage(option.data);
        for (const key of coreKeys) {
            if (i18n.t(key) === key) untranslatedCore.push(`${option.data}: ${key}`);
        }
        for (const key of placeholderKeys) {
            if (JSON.stringify(placeholders(i18n.t(key))) !== JSON.stringify(placeholders(key))) {
                placeholderMismatches.push(`${option.data}: ${key} -> ${i18n.t(key)}`);
            }
        }
    }
    assert.deepEqual(untranslatedCore, []);
    assert.deepEqual(placeholderMismatches, []);
});

test('toki pona has a reviewed entry for every interface string', () => {
    const tokUrl = new URL('../src/locales/tok.ts', import.meta.url);
    const tokSource = fs.readFileSync(tokUrl, 'utf8');
    const sourceEntries = objectLiteralEntries(rawSource, 'zhCN', 'src/i18n.ts');
    const tokEntries = objectLiteralEntries(tokSource, 'strings', 'src/locales/tok.ts');
    const sourceKeys = sourceEntries.map(([key]) => key).sort();
    const tokKeys = tokEntries.map(([key]) => key).sort();
    assert.deepEqual(tokKeys, sourceKeys);

    const placeholders = (value) => [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
    const sourceByKey = new Map(sourceEntries);
    const placeholderMismatches = tokEntries
        .filter(([key, value]) => JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(sourceByKey.get(key))))
        .map(([key, value]) => `${key} -> ${value}`);
    assert.deepEqual(placeholderMismatches, []);
    assert.deepEqual(tokEntries.filter(([, value]) => !value.trim()), []);
});

test('Taiwanese Hokkien translates every interface string without Simplified Chinese placeholders', () => {
    const keysSource = fs.readFileSync(new URL('../src/locales/keys.ts', import.meta.url), 'utf8');
    const nanSource = fs.readFileSync(new URL('../src/locales/nan.ts', import.meta.url), 'utf8');
    const keys = arrayLiteralValues(keysSource, 'keys', 'src/locales/keys.ts');
    const translations = arrayLiteralValues(nanSource, 'strings', 'src/locales/nan.ts');
    assert.equal(translations.length, keys.length);
    assert.deepEqual(translations.filter((value) => !value.trim()), []);

    const placeholders = (value) => [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
    const placeholderMismatches = translations
        .map((value, index) => [keys[index], value])
        .filter(([key, value]) => JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(key)));
    assert.deepEqual(placeholderMismatches, []);

    const simplifiedChineseOnly = /[载随统语译识择为关显键设线网复录图调状态开经没进远还请连时体义兰读储传]/u;
    assert.deepEqual(translations.filter((value) => simplifiedChineseOnly.test(value)), []);

    const table = new Map(keys.map((key, index) => [key, translations[index]]));
    assert.equal(table.get('Text Recognition Method'), '文字辨識方式');
    assert.equal(table.get('Seconds to hold button(s) to translate'), '鈕仔愛揤牢幾秒才翻譯');
});

test('literal UI translation calls have Chinese entries', () => {
    const sourceRoot = new URL('../src/', import.meta.url);
    const files = [];
    const collect = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const path = new URL(entry.name, directory.href.endsWith('/') ? directory : new URL(`${directory.href}/`));
            if (entry.isDirectory()) collect(path);
            else if (/\.(ts|tsx)$/.test(entry.name) && entry.name !== 'i18n.ts') files.push(path);
        }
    };
    collect(sourceRoot);

    i18n.setPluginLanguage('zh-CN');
    const intentionallyUnchanged = new Set(['English']);
    const missing = new Set();
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        for (const match of text.matchAll(/\bt\(\s*(['"])(.*?)\1/g)) {
            const key = match[2];
            if (!intentionallyUnchanged.has(key) && i18n.t(key) === key) missing.add(key);
        }
    }
    assert.deepEqual([...missing].sort(), []);
});
