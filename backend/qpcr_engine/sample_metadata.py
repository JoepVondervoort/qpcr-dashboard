"""Sample-name suggestions describe conditions and time, never statistical pairing."""
import re
from collections.abc import Iterable
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
# "LNP4_50_1", "Apt 44 1-2", "IMR90 2": a short trailing number may count replicates, or be a dose or a sample
# number. It is only ever asked about (see suffix_replicates), never applied without the scientist's answer.
_SUFFIX = re.compile(r'^(.*\S)([_\- ])(\d{1,2})$', re.ASCII)
MAX_SUFFIX_REPLICATES = 6
# A stem ending in a time, sequence or date word numbers time points, plates or runs, not replicates:
# "Week 2", "30 min 1", "T 3", "Plate 2", "Exp 2024-11-05".
_SEQUENCE_STEM = re.compile(r'(?:(?<![a-z0-9])(?:weeks?|wks?|w|mins?|minutes?|secs?|hours?|hrs?|h|days?|d|t|tp|time\s*points?|'
                            r'passages?|p|plates?|runs?|batch(?:es)?|lots?|exp(?:eriment)?s?|rounds?|cycles?)|\d{4}[-_]\d{1,2})$', re.I | re.ASCII)


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


def suffix_replicates(names: Iterable[str]) -> dict[str, tuple[str, str, str]]:
    """Names whose trailing number may be a replicate number: name -> (stem, separator, number).

    A name qualifies only with siblings that share its stem and whose numbers form a short consecutive run,
    such as "_1, _2" or "_3, _4". Doses ("_50, _100"), sample numbers 1-12 and time points ("day 2") do not.
    """
    groups: dict[str, dict[str, tuple[str, str]]] = {}
    for name in {str(value).strip() for value in names}:
        match = _SUFFIX.match(name)
        if not match or _REPLICATE.search(name) or _REPLICATE_THEN_LABEL.match(name):
            continue
        time = find_time(name)
        stem, separator, number = match.groups()
        if (time and time.end == len(name)) or _SEQUENCE_STEM.search(stem):
            continue
        groups[stem] = {**groups.get(stem, {}), name: (separator, number)}
    found: dict[str, tuple[str, str, str]] = {}
    for stem, members in groups.items():
        numbers = sorted(int(number) for _, number in members.values())
        consecutive = len(set(numbers)) == len(numbers) and numbers[-1] - numbers[0] + 1 == len(numbers)
        if 2 <= len(numbers) <= MAX_SUFFIX_REPLICATES and consecutive:
            found.update({name: (stem, separator, number) for name, (separator, number) in members.items()})
    return found


def analysis_group(metadata: dict[str, Any]) -> str:
    condition = metadata['condition'].strip()
    if metadata.get('timepoint') is None:
        return condition
    time = find_time(condition)
    base = (without_time(condition, time) if time else condition).strip(' _-·')
    label = 'Hour' if metadata.get('time_unit') == 'hour' else 'Day'
    return f"{base or metadata['series']} · {label} {metadata['timepoint']:g}"
