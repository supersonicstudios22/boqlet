"""
user_regex.py - the one place that runs regular expressions a firm writes (review A-35, DEC-65).

Dictionary `regex` entries, extractors and `matches` selectors come from presets anyone with edit rights
can write, and a run shares its engine with every other org. Python's `re` backtracks, holds the GIL while it
does, and `(.|.)*X` on a 40-character name takes minutes. These patterns therefore run on RE2
(`google-re2`), which matches in time linear in the text and refuses what it cannot do that way
(look-arounds, back-references).

RE2 syntax, as documented in packages/types/src/dictionary.ts: named groups may be written `(?<name>...)`
(as in JavaScript) or `(?P<name>...)`; `\\b`, `\\w` and `\\d` are ASCII, so a word in another script is
written with `\\pL` (any letter). The resolver also tries the accent-folded name, so Latin-script names
("beton", "ploča", "Hormigón") match as before.
"""
from __future__ import annotations

import functools
import re

import re2

MAX_LENGTH = 500

_NAMED = re.compile(r"\(\?<(?![=!])")           # (?<name>  ->  (?P<name>   (not the look-behinds (?<= (?<!)
# `\b` written right next to a letter outside ASCII never sees a word boundary in RE2 (that letter is not a
# word character there), so the pattern cannot do what it says: `\bбетон` never matches at a word's start.
_LETTER = r"(?![\x00-\x7f])[^\W\d_]"            # a letter outside ASCII
_ASCII_BOUNDARY = re.compile(rf"(?<!\\)(?:\\\\)*\\[bB](?={_LETTER})|(?<={_LETTER})\\[bB]")


class PatternError(ValueError):
    """A pattern RE2 refuses, or one over MAX_LENGTH. A ValueError, so a job or rpc that meets one is the
    caller's error (422 / `engine_input`), never an outage."""


def translate(pattern: str) -> str:
    return _NAMED.sub("(?P<", pattern)


def problem(pattern: str) -> str | None:
    """Why `pattern` cannot be used, in words for the person who wrote it; None when it can."""
    if not isinstance(pattern, str):
        return "the pattern must be text"
    if len(pattern) > MAX_LENGTH:
        return f"the pattern is {len(pattern):,} characters long; the limit is {MAX_LENGTH}"
    if _ASCII_BOUNDARY.search(pattern):
        return ("\\b next to a letter outside A-Z never matches (RE2 word boundaries are ASCII); "
                "write (?:^|\\PL) before and (?:\\PL|$) after the word instead")
    try:
        _compiled(pattern, True)
    except re2.error as err:
        return f"RE2 does not accept it ({_reason(err)}); look-arounds and back-references are not supported"
    return None


def compile(pattern: str, ignore_case: bool = True):
    """The compiled pattern (cached). Raises PatternError for a pattern `problem` refuses."""
    reason = _checked(pattern)
    if reason:
        raise PatternError(f"The regex '{pattern[:80]}' cannot be used: {reason}")
    return _compiled(pattern, ignore_case)


def search(pattern: str, text: str, ignore_case: bool = True):
    return compile(pattern, ignore_case).search(text)


@functools.lru_cache(maxsize=4096)
def _checked(pattern: str) -> str | None:
    return problem(pattern)


@functools.lru_cache(maxsize=4096)
def _compiled(pattern: str, ignore_case: bool):
    options = re2.Options()
    options.case_sensitive = not ignore_case
    options.log_errors = False
    return re2.compile(translate(pattern), options)


def _reason(err: Exception) -> str:
    text = err.args[0] if err.args else err
    return text.decode("utf-8", "replace") if isinstance(text, bytes) else str(text)
