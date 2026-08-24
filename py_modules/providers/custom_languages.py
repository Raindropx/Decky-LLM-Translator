MAX_CUSTOM_LANGUAGES = 50
MAX_CUSTOM_LANGUAGE_ALIAS_LENGTH = 80
MAX_CUSTOM_LANGUAGE_DEFINITION_LENGTH = 2000


def normalize_custom_languages(value):
    """Validate and canonicalize custom output-language settings."""
    if not isinstance(value, list):
        raise ValueError("Custom languages must be a list")
    if len(value) > MAX_CUSTOM_LANGUAGES:
        raise ValueError(f"At most {MAX_CUSTOM_LANGUAGES} custom languages are allowed")

    normalized = []
    aliases = set()
    definitions = set()
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("Each custom language must be an object")

        alias = item.get("alias")
        definition = item.get("definition")
        if not isinstance(alias, str) or not isinstance(definition, str):
            raise ValueError("Custom language alias and definition must be strings")

        alias = alias.strip()
        definition = definition.strip()
        if not alias or not definition:
            raise ValueError("Custom language alias and definition are required")
        if len(alias) > MAX_CUSTOM_LANGUAGE_ALIAS_LENGTH:
            raise ValueError(
                f"Custom language alias must be at most {MAX_CUSTOM_LANGUAGE_ALIAS_LENGTH} characters"
            )
        if len(definition) > MAX_CUSTOM_LANGUAGE_DEFINITION_LENGTH:
            raise ValueError(
                "Custom language definition must be at most "
                f"{MAX_CUSTOM_LANGUAGE_DEFINITION_LENGTH} characters"
            )

        alias_key = alias.casefold()
        if alias_key in aliases:
            raise ValueError("Custom language aliases must be unique")
        if definition in definitions:
            raise ValueError("Custom language definitions must be unique")

        aliases.add(alias_key)
        definitions.add(definition)
        normalized.append({"alias": alias, "definition": definition})

    return normalized


def normalize_language_settings(custom_languages, target_language, previous_custom_languages=()):
    normalized_languages = normalize_custom_languages(custom_languages)
    if not isinstance(target_language, str):
        raise ValueError("Target language must be a string")
    normalized_target = target_language.strip()
    if len(normalized_target) > MAX_CUSTOM_LANGUAGE_DEFINITION_LENGTH:
        raise ValueError(
            "Target language must be at most "
            f"{MAX_CUSTOM_LANGUAGE_DEFINITION_LENGTH} characters"
        )

    previous_definitions = {
        item.get("definition")
        for item in previous_custom_languages
        if isinstance(item, dict)
    }
    next_definitions = {item["definition"] for item in normalized_languages}
    if (
        normalized_target
        and normalized_target in previous_definitions
        and normalized_target not in next_definitions
    ):
        raise ValueError("Target language references a removed custom language")

    return normalized_languages, normalized_target
