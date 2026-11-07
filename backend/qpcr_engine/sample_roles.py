"""Conservative defaults for technical-control labels; users may override roles."""
import re
import unicodedata

# No-template, water and mastermix-only wells. Names are compared after punctuation becomes spaces.
# A bare "mm" is a mastermix well; "MM 1" may be a numbered sample (a myeloma line, mouse), so it is not.
_NO_TEMPLATE = re.compile(
    r'(?:(?:technical control|control)\s+)?'
    r'(?:(?:h\s*2\s*[o0]|water|ntc|no\s*template(?:\s+control)?|nuclease\s*free\s+water|master\s*mix|mmix)'
    r'(?:\s+(?:control|blank))?(?:\s+(?:rep(?:licate)?\s*)?\d+)?|mm(?:\s+(?:control|blank))?)')
# No-reverse-transcription controls. The minus sign carries the meaning, so these are matched before
# punctuation is removed: "-RT" is a control, a bare "RT" is not.
_NO_RT = re.compile(r'(?:-\s*rt|rt\s*-|minus\s*rt|no\s*-?\s*rt|nrt)(?:\s*(?:control|ctrl))?(?:[\s_.]+\d+)?')


def is_technical_control(sample: str) -> bool:
    text = unicodedata.normalize('NFKC', str(sample)).casefold().strip()
    if _NO_RT.fullmatch(text):
        return True
    return bool(_NO_TEMPLATE.fullmatch(re.sub(r'[^a-z0-9]+', ' ', text).strip()))
