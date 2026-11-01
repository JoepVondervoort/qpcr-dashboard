"""Sample-name suggestions describe conditions and time, never statistical pairing."""
import re
from typing import Any, NamedTuple

_NUMBER = r'(-?\d+(?:\.\d+)?)'
_FLAGS = re.I | re.ASCII
# A word unit, then a number: "day 0", "Day21", "_day0", "dpt3". A letter or digit right before
# the unit makes it part of another word, so it never starts a time point.
_WORD_FIRST = re.compile(rf'(?<![a-z0-9])(days?|dpt|hours?|hrs?)\s*{_NUMBER}(?![a-z0-9])', _FLAGS)
# A number, then a unit: "72h", "48 hpt", "7 days". A bare "d" is left out: "3D" is usually a culture format.
_NUMBER_FIRST = re.compile(r'(?<![a-z0-9.])(\d+(?:\.\d+)?)\s*(hours?|hrs?|hpt|h|days?|dpt)(?![a-z0-9])', _FLAGS)
# "d7" is common for day 7, but a single letter is a guess. A single "h" before a number is never
# read as hours: H1, H9 and NCI-H1299 are cell lines.
_LETTER_FIRST = re.compile(rf'(?<![a-z0-9])(d)\s*{_NUMBER}(?![a-z0-9])', _FLAGS)
# In the lab's naming convention, the final .N denotes a biological replicate.
_REPLICATE = re.compile(r'\.(\d+)$', re.ASCII)
# "day 21.2 RS": a label after the replicate number of a time point belongs to the condition.
_REPLICATE_THEN_LABEL = re.compile(r'^(.*?(?<![a-z0-9])(?:days?|dpt|d|hours?|hrs?)\s*\d+)\.(\d+)\s+([^\s.][^.]*)$', _FLAGS)
_SEPARATORS = ' _-'


class TimeToken(NamedTuple):
    value: float
    unit: str
    start: int
    end: int
    guessed: bool


def find_time(text: str) -> TimeToken | None:
    """Word units first ("day"), then number-first forms ("72h"), then a single "d"."""
    for pattern, number_first in ((_WORD_FIRST, False), (_NUMBER_FIRST, True), (_LETTER_FIRST, False)):
        match = pattern.search(text)
        if match:
            break
    else:
        return None
    value, unit = (match.group(1), match.group(2)) if number_first else (match.group(2), match.group(1))
    # Underscores glued to the token ("_day0", "day28_resplit") are a lab habit, not a standard spelling.
    glued = (match.start() > 0 and text[match.start() - 1] == '_') or (match.end() < len(text) and text[match.end()] == '_')
    guessed = pattern is _LETTER_FIRST or (glued and not number_first)
    return TimeToken(float(value), 'hour' if unit.lower().startswith('h') else 'day', match.start(), match.end(), guessed)


def without_time(text: str, token: TimeToken) -> str:
    """Remove the time token and join what remains with the separator that surrounded it."""
    left, right = text[:token.start], text[token.end:]
    left_core, right_core = left.rstrip(_SEPARATORS), right.lstrip(_SEPARATORS)
    gap = left[len(left_core):] or right[:len(right) - len(right_core)]
    separator = gap.strip(' ')[:1] or ' '
    return f"{left_core}{separator}{right_core}" if left_core and right_core else left_core or right_core


def infer_sample_metadata(name: str) -> dict[str, Any]:
    text = name.strip()
    checks: list[str] = []
    replicate = _REPLICATE.search(text)
    labelled = None if replicate else _REPLICATE_THEN_LABEL.match(text)
    if replicate:
        condition, replicate_label = text[:replicate.start()].strip(), replicate.group(1)
    elif labelled:
        label = labelled.group(3).strip()
        condition, replicate_label = f"{labelled.group(1)} {label}", labelled.group(2)
        checks.append(f"“{label}” after the replicate number was read as part of the condition")
    else:
        condition, replicate_label = text, ''
    time = find_time(condition)
    series = condition
    if time:
        series = without_time(condition, time) or condition
        if time.guessed:
            checks.append(f"the time point was read from “{condition[time.start:time.end]}”")
    result: dict[str, Any] = {'condition': condition, 'series': series, 'timepoint': time.value if time else None,
                              'time_unit': time.unit if time else 'day', 'replicate': replicate_label}
    if checks:
        summary = '; '.join(checks)
        result['name_check'] = f"{summary[0].upper()}{summary[1:]}. Check this suggestion."
    return result


def analysis_group(metadata: dict[str, Any]) -> str:
    condition = metadata['condition'].strip()
    if metadata.get('timepoint') is None:
        return condition
    time = find_time(condition)
    base = (without_time(condition, time) if time else condition).strip(' _-·')
    label = 'Hour' if metadata.get('time_unit') == 'hour' else 'Day'
    return f"{base or metadata['series']} · {label} {metadata['timepoint']:g}"
