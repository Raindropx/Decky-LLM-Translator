#!/usr/bin/env python3
"""
Persistent subprocess worker for CTranslate2 + NLLB-200 translation.

Communicates via stdin/stdout JSON-lines protocol.
Commands:
    {"cmd": "load", "model_dir": "/path/to/model"}
    {"cmd": "translate", "texts": ["Hello", "World"], "src_langs": ["eng_Latn", "eng_Latn"], "tgt_lang": "fra_Latn"}
        (src_lang is also accepted as a single default for all items)
    {"cmd": "lid", "texts": ["..."], "candidates": [["de", "en"]]}
    {"cmd": "unload"}
    {"cmd": "shutdown"}

Responses:
    {"ok": true, "translations": ["..."], "fallbacks": [false, ...]}
    {"ok": false, "error": "message"}

Self-terminates after 10 minutes of inactivity.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import language_detection

IDLE_TIMEOUT = 600  # 10 minutes

# Skip the idle timeout when parent sets CT2_PERSISTENT=1
PERSISTENT = os.environ.get("CT2_PERSISTENT") == "1"

_DASH_PREFIXES = ("-", "–", "—", "‐", "−", "‑")

_LID_MIN_PROB = 0.9

_lid_identifier = None
_lid_unavailable = False


def _get_lid():
    global _lid_identifier, _lid_unavailable
    if _lid_identifier is not None or _lid_unavailable:
        return _lid_identifier
    try:
        from py3langid.langid import LanguageIdentifier, MODEL_FILE
        _lid_identifier = LanguageIdentifier.from_pickled_model(
            MODEL_FILE, norm_probs=True
        )
    except Exception:
        _lid_unavailable = True
    return _lid_identifier


def lid_texts(texts, candidates):
    """Classify each text within its candidate lid codes; None when unsure."""
    identifier = _get_lid()
    if identifier is None:
        return {"ok": True, "langs": [None] * len(texts), "available": False}
    langs = []
    for text, cands in zip(texts, candidates):
        code = None
        try:
            identifier.set_languages(sorted(set(cands)))
            lang, prob = identifier.classify(text)
            if prob >= _LID_MIN_PROB:
                code = lang
        except Exception:
            code = None
        langs.append(code)
    return {"ok": True, "langs": langs, "available": True}


def _has_oscillatory_repetition(tokens):
    if len(tokens) < 9:
        return False
    # Mask digits so "X: 4 ... X: 21 ..." patterns still count as repeats
    masked = ["0" if any(c.isdigit() for c in t) else t for t in tokens]
    trigrams = [tuple(masked[i:i + 3]) for i in range(len(masked) - 2)]
    return len(set(trigrams)) / len(trigrams) < 0.5


def _norm_for_copy(s):
    return " ".join(s.split()).casefold()


def _is_dash_hallucination(src, out):
    return out.lstrip().startswith(_DASH_PREFIXES) and not src.lstrip().startswith(_DASH_PREFIXES)


def _is_source_copy_with_tail(src, out):
    if sum(1 for c in src if c.isalpha()) < 5:
        return False
    ns = _norm_for_copy(src)
    no = _norm_for_copy(out)
    return len(no) >= len(ns) + 3 and no.startswith(ns)


def _output_script_mismatch(src, out, tgt_lang):
    expected = language_detection.flores_families(tgt_lang)
    if not expected:
        return False
    out_letters = sum(1 for c in out if c.isalpha())
    if out_letters < 4:
        return False
    fams = language_detection.letter_families(out)
    in_target = sum(n for f, n in fams.items() if f in expected)
    if in_target / out_letters >= 0.5:
        return False
    src_letters = sum(1 for c in src if c.isalpha())
    if src_letters:
        src_fams = language_detection.letter_families(src)
        if sum(n for f, n in src_fams.items() if f in expected) / src_letters >= 0.5:
            return False
    return True

# Redirect stderr to avoid blocking on pipe buffer
try:
    devnull = open(os.devnull, 'w')
    sys.stderr = devnull
except Exception:
    pass


def main():
    translator = None
    tokenizer = None
    last_activity = time.monotonic()
    loaded_model_dir = None

    # Import heavy libraries
    try:
        import ctranslate2
        import sentencepiece as spm
    except ImportError as e:
        resp = {"ok": False, "error": f"Import failed: {e}"}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()
        sys.exit(1)

    def send(obj):
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()

    def load_model(model_dir):
        nonlocal translator, tokenizer, loaded_model_dir

        unload_model()

        model_bin = os.path.join(model_dir, "model.bin")
        sp_model = os.path.join(model_dir, "sentencepiece.bpe.model")

        if not os.path.exists(model_bin):
            return {"ok": False, "error": f"model.bin not found in {model_dir}"}
        if not os.path.exists(sp_model):
            return {"ok": False, "error": f"sentencepiece.bpe.model not found in {model_dir}"}

        try:
            translator = ctranslate2.Translator(
                model_dir,
                device="cpu",
                inter_threads=1,
                intra_threads=4,
                compute_type="int8",
            )
            tokenizer = spm.SentencePieceProcessor(sp_model)
            loaded_model_dir = model_dir

            # Warmup
            try:
                translator.translate_batch(
                    [
                        ["eng_Latn", "▁hello", "</s>"],
                        ["eng_Latn", "▁this", "▁is", "▁a", "▁warmup", "▁batch", "</s>"],
                    ],
                    target_prefix=[["eng_Latn"]] * 2,
                    beam_size=1,
                    max_decoding_length=12,
                )
            except Exception:
                pass

            return {"ok": True}
        except Exception as e:
            unload_model()
            return {"ok": False, "error": f"Failed to load model: {e}"}

    def unload_model():
        nonlocal translator, tokenizer, loaded_model_dir
        translator = None
        tokenizer = None
        loaded_model_dir = None

    def translate_texts(texts, src_langs, tgt_lang):
        if translator is None or tokenizer is None:
            return {"ok": False, "error": "No model loaded"}

        try:
            # NLLB tokenization: [src_lang] + sp_tokens + [</s>], source tag per item
            tokenized = []
            for t, src in zip(texts, src_langs):
                sp_tokens = tokenizer.encode(t, out_type=str)
                tokenized.append([src] + sp_tokens + ["</s>"])

            # Adapt decoding strategy based on input length.
            # Short texts (labels, single words) are out-of-distribution for
            # NLLB and hallucinate with beam search, so use greedy decoding
            # with aggressive length penalty to stay close to the source.
            max_input_tokens = max(len(t) - 2 for t in tokenized)  # minus lang + </s>

            if max_input_tokens <= 4:
                beam = 1
                length_pen = 0.2
                no_repeat = 3
                rep_pen = 1.2  # short path only
                # EN->JA/KO/ZH/DE can expand >1.5x on 2-4 token inputs
                max_output = max(int(max_input_tokens * 2) + 2, 5)
            else:
                # 1.3B distilled is stable at beam=1, so skip beam search
                beam = 1
                no_repeat = 4
                rep_pen = 1.0
                length_pen = 1.0
                # 32+3n leaves room for high-expansion pairs (ja->en etc.);
                # the guards below own the runaway cases.
                max_output = 32 + 3 * max_input_tokens

            max_output = min(max_output, 256)

            results = translator.translate_batch(
                tokenized,
                target_prefix=[[tgt_lang]] * len(texts),
                beam_size=beam,
                max_decoding_length=max_output,
                max_input_length=512,
                repetition_penalty=rep_pen,
                length_penalty=length_pen,
                no_repeat_ngram_size=no_repeat,
                disable_unk=True,
                replace_unknowns=True,
                return_scores=True,
            )

            # Detokenize and validate each translation
            translations = []
            token_counts = []
            confidences = []
            fallbacks = []
            for i, result in enumerate(results):
                src_text = texts[i]
                input_token_count = len(tokenized[i]) - 2  # minus lang token and </s>
                # NLLB occasionally returns no hypothesis on weird input.
                # Fall back to the source instead of crashing or emitting ""
                if not result.hypotheses or not result.hypotheses[0]:
                    translations.append(src_text)
                    token_counts.append({"input": input_token_count, "output": 0})
                    confidences.append(0.0)
                    fallbacks.append(True)
                    continue
                tokens = result.hypotheses[0]
                score = result.scores[0] if result.scores else 0.0
                if tokens and tokens[0] == tgt_lang:
                    tokens = tokens[1:]
                # Only the target-lang prefix came out - nothing to translate.
                # Return source instead of an empty string.
                if not tokens:
                    translations.append(src_text)
                    token_counts.append({"input": input_token_count, "output": 0})
                    confidences.append(round(score, 3))
                    fallbacks.append(True)
                    continue
                token_counts.append({"input": input_token_count, "output": len(tokens)})
                # Per-token log-prob normalizes across output lengths
                per_token = score / max(len(tokens), 1)
                confidences.append(round(per_token, 3))
                text = tokenizer.decode(tokens)

                # Hallucination guard
                fallback = False
                if _is_dash_hallucination(src_text, text):
                    if input_token_count > 8:
                        text = text.lstrip().lstrip("".join(_DASH_PREFIXES)).lstrip()
                        if not text:
                            fallback = True
                    else:
                        fallback = True
                if not fallback and _is_source_copy_with_tail(src_text, text):
                    fallback = True
                elif input_token_count <= 4:
                    if per_token < -0.8 or len(tokens) > input_token_count * 2 + 2:
                        fallback = True
                else:
                    if per_token < -1.0 and len(tokens) > input_token_count * 2:
                        fallback = True
                if not fallback and _has_oscillatory_repetition(tokens):
                    fallback = True
                if not fallback and _output_script_mismatch(src_text, text, tgt_lang):
                    fallback = True

                if fallback:
                    text = src_text

                fallbacks.append(fallback)
                translations.append(text)

            return {
                "ok": True,
                "translations": translations,
                "token_counts": token_counts,
                "confidences": confidences,
                "fallbacks": fallbacks,
            }
        except Exception as e:
            return {"ok": False, "error": f"Translation failed: {e}"}

    # Main loop with idle timeout
    import select

    while True:
        # fix for leaking RAM
        if os.getppid() == 1:
            break
        if not PERSISTENT and time.monotonic() - last_activity > IDLE_TIMEOUT:
            break

        try:
            ready, _, _ = select.select([sys.stdin], [], [], 30.0)
        except (ValueError, OSError):
            break

        if not ready:
            continue

        line = sys.stdin.readline()
        if not line:
            break

        last_activity = time.monotonic()
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            send({"ok": False, "error": "Invalid JSON"})
            continue

        command = cmd.get("cmd")

        if command == "load":
            model_dir = cmd.get("model_dir", "")
            result = load_model(model_dir)
            send(result)

        elif command == "translate":
            texts = cmd.get("texts", [])
            src_langs = cmd.get("src_langs")
            src_lang = cmd.get("src_lang", "")
            tgt_lang = cmd.get("tgt_lang", "")
            if src_langs is None and src_lang:
                src_langs = [src_lang] * len(texts)
            if not texts:
                send({"ok": True, "translations": []})
            elif not src_langs or not tgt_lang:
                send({"ok": False, "error": "src_langs and tgt_lang required"})
            elif len(src_langs) != len(texts):
                send({"ok": False, "error": "src_langs length mismatch"})
            else:
                result = translate_texts(texts, src_langs, tgt_lang)
                send(result)

        elif command == "lid":
            texts = cmd.get("texts", [])
            candidates = cmd.get("candidates", [])
            if len(candidates) != len(texts):
                send({"ok": False, "error": "candidates length mismatch"})
            else:
                send(lid_texts(texts, candidates))

        elif command == "unload":
            unload_model()
            send({"ok": True})

        elif command == "shutdown":
            send({"ok": True})
            break

        else:
            send({"ok": False, "error": f"Unknown command: {command}"})


if __name__ == "__main__":
    main()
