"""Conservative defaults for technical-control labels; users may override roles."""
import re
import unicodedata


def is_technical_control(sample: str) -> bool:
    text = unicodedata.normalize('NFKC', str(sample)).casefold()
    text = re.sub(r'[^a-z0-9]+', ' ', text).strip()
    return bool(re.fullmatch(
        r'(?:(?:technical control|control)\s+)?'
        r'(?:h\s*2\s*[o0]|water|ntc|no\s*template(?:\s+control)?|nuclease\s*free\s+water)'
        r'(?:\s+(?:control|blank))?(?:\s+(?:rep(?:licate)?\s*)?\d+)?', text))
