"""Sample-name suggestions describe conditions and time, never statistical pairing."""
import re
from typing import Any


def infer_sample_metadata(name: str) -> dict[str, Any]:
    # In the lab's naming convention, the final .N denotes a biological replicate.
    replicate = re.search(r'\.(\d+)$', name)
    condition = name[:replicate.start()].strip() if replicate else name.strip()
    time = re.search(r'(?i)\b(days?|dpt|d|hours?|hrs?|h)\s*(-?\d+(?:\.\d+)?)\b', condition)
    series = condition
    point = None
    unit = 'day'
    if time:
        point = float(time.group(2))
        unit = 'hour' if time.group(1).lower().startswith('h') else 'day'
        series = (condition[:time.start()] + condition[time.end():]).strip(' _-')
    return {'condition': condition, 'series': series or condition, 'timepoint': point,
            'time_unit': unit, 'replicate': replicate.group(1) if replicate else ''}


def analysis_group(metadata: dict[str, Any]) -> str:
    condition = metadata['condition'].strip()
    if metadata.get('timepoint') is None:
        return condition
    base = re.sub(r'(?i)\b(days?|dpt|d|hours?|hrs?|h)\s*-?\d+(?:\.\d+)?\b', '', condition).strip(' _-·')
    label = 'Hour' if metadata.get('time_unit') == 'hour' else 'Day'
    return f"{base or metadata['series']} · {label} {metadata['timepoint']:g}"
