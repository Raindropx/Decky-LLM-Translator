import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.ES2020,
        target: ts.ScriptTarget.ES2020,
    },
}).outputText;
const i18n = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

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
    setSteamLanguage('german');
    assert.equal(i18n.detectSystemLocale(), 'en');
});

test('browser Chinese locale is used when Steam localization globals are unavailable', () => {
    delete globalThis.window;
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { language: 'zh-TW', languages: ['zh-TW'] },
    });
    assert.equal(i18n.detectSystemLocale(), 'zh-CN');
});

test('manual plugin language overrides system detection', () => {
    setSteamLanguage('english');
    assert.equal(i18n.resolvePluginLocale('zh-CN'), 'zh-CN');
    setSteamLanguage('schinese');
    assert.equal(i18n.resolvePluginLocale('en'), 'en');
});

test('Chinese UI uses a Simplified Chinese font before generic fallback', () => {
    const family = i18n.getPluginUIFontFamily('zh-CN');
    assert.match(family, /Noto Sans CJK SC/);
    assert.ok(family.indexOf('Noto Sans CJK SC') < family.lastIndexOf('sans-serif'));
    assert.equal(i18n.getPluginUIFontFamily('en'), undefined);
});

test('unknown saved language is normalized to system preference', () => {
    assert.equal(i18n.normalizePluginLanguage('not-supported'), 'system');
    assert.equal(i18n.normalizePluginLanguage('zh-CN'), 'zh-CN');
});

test('translations fall back to the English source key', () => {
    i18n.setPluginLanguage('zh-CN');
    assert.equal(i18n.t('Plugin Language'), '插件语言');
    assert.equal(i18n.t('Unknown source text'), 'Unknown source text');
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
