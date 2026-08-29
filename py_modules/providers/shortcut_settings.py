INPUT_MODES = frozenset(range(10))
DEFAULT_TRANSLATION_INPUT_MODE = 2
PREFERRED_ASK_AI_INPUT_MODES = (3, 1, 8, 0, 7, 5, 4, 9, 6, 2)


def normalize_input_mode(value):
    if isinstance(value, bool) or not isinstance(value, int) or value not in INPUT_MODES:
        raise ValueError("Unsupported shortcut input mode")
    return value


def choose_distinct_ask_ai_input_mode(translation_mode, saved_mode=None):
    translation_mode = normalize_input_mode(translation_mode)
    try:
        saved_mode = normalize_input_mode(saved_mode)
    except ValueError:
        saved_mode = None

    if saved_mode is not None and saved_mode != translation_mode:
        return saved_mode

    return next(
        mode for mode in PREFERRED_ASK_AI_INPUT_MODES
        if mode != translation_mode
    )
