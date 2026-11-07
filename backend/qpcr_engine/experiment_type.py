"""What an experiment measures: fold-change expression, or how stable candidate reference genes are.

A stability experiment ("housekeeping genes", "hkg", geNorm) compares the raw Ct of several candidate
reference genes across conditions; it has no target, baseline or fold change. The type is suggested from
names and genes, and only the scientist's answer sets it.
"""
from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from typing import Any

from .layout import UNASSIGNED_ASSAY

EXPRESSION = 'expression'
STABILITY = 'reference_stability'
ANALYSIS_TYPES = (EXPRESSION, STABILITY)

# Mirrors frontend/src/referenceGenes.ts: HGNC symbols and the usual lab spellings of 18S rRNA.
REFERENCE_GENES = frozenset({
    'GAPDH', 'ACTB', 'B2M', 'HPRT1', 'HPRT', 'RPL13A', 'RPL32', 'RPLP0', 'RPS18', 'TBP', 'GUSB', 'PPIA', 'YWHAZ', 'SDHA',
    'UBC', 'HMBS', 'PGK1', 'TFRC', 'EEF1A1', 'C1ORF43', 'CHMP2A', 'EMC7', 'GPI', 'PSMB2', 'PSMB4', 'RAB7A', 'REEP5', 'SNRPD3',
    'VCP', 'VPS29', '18S', '18SR', '18SRRNA', 'RN18S', 'RN18S1'})
_PRIMER_SET = re.compile(r'[\s_-]+(?:V|SET)?\d+$')
# "housekeeping", "housekeepi9ng" (sic), "hkg", "gene stability", "reference genes", geNorm and friends. A bare
# "stability" is left out: mRNA stability (actinomycin D chase) experiments measure expression.
_STABILITY_WORDS = re.compile(r'house\s*keep|(?<![a-z])hkgs?(?![a-z])|genes?[\s_-]*stabilit|ref(?:erence)?[\s_-]*genes?|genorm|normfinder|bestkeeper', re.I)
# A name hint needs a comparison to go with it. Without one, it takes many reference genes and few others: plates
# that normalize three targets to four reference genes (mv01, mv04) are ordinary expression experiments.
MIN_GENES_WITH_NAME = 2
MIN_GENES_WITHOUT_NAME = 4
REFERENCE_SHARE_WITHOUT_NAME = 2

IsControl = Callable[[dict[str, Any]], bool]


def gene_symbol(assay: str) -> str:
    """"GAPDH 1", "GAPDH_2", "18S rRNA" -> "GAPDH", "GAPDH", "18SRRNA": a primer-set number is not part of the gene."""
    return re.sub(r'[\s_-]+', '', _PRIMER_SET.sub('', str(assay).strip().upper()))


def is_reference_gene(assay: str) -> bool:
    return gene_symbol(assay) in REFERENCE_GENES


def measured_assays(records: list[dict[str, Any]], is_control: IsControl) -> list[str]:
    """Assays with a detected Ct outside technical controls, named or not: genes a scientist could compare."""
    return sorted({str(r['assay']) for r in records if r.get('assay') != UNASSIGNED_ASSAY
                   and r.get('ct') is not None and r.get('status', 'detected') == 'detected' and not is_control(r)})


def suggest_analysis_type(texts: Iterable[str], assays: Iterable[str]) -> dict[str, Any] | None:
    """A reference-gene stability question with its reasons, or None when nothing points to one."""
    genes = sorted(set(assays))
    references = [assay for assay in genes if is_reference_gene(assay)]
    hint = next((text for text in texts if text and _STABILITY_WORDS.search(text)), None)
    reasons = []
    if hint and len(references) >= MIN_GENES_WITH_NAME:
        reasons.append(f"“{hint}” mentions reference genes or stability.")
    if len(references) >= MIN_GENES_WITHOUT_NAME and len(references) >= REFERENCE_SHARE_WITHOUT_NAME * (len(genes) - len(references)):
        reasons.append(f"{len(references)} of the {len(genes)} genes are common reference genes ({', '.join(references)}).")
    return {'type': STABILITY, 'reasons': reasons} if reasons else None


def analysis_type_state(metadata: dict[str, Any], texts: Iterable[str], assays: Iterable[str]) -> dict[str, Any]:
    """The chosen type (expression until the scientist answers), the saved gene choice and any open suggestion."""
    chosen = metadata.get('analysis_type') if isinstance(metadata.get('analysis_type'), dict) else {}
    kind = chosen.get('type') if chosen.get('type') in ANALYSIS_TYPES else None
    genes = chosen.get('stability_genes')
    return {'type': kind or EXPRESSION, 'confirmed': kind is not None,
            'stability_genes': [str(gene) for gene in genes] if isinstance(genes, list) else None,
            'suggestion': suggest_analysis_type(texts, assays)}


def experiment_texts(name: str, original_filename: str | None, parsed_summary: dict[str, Any] | None) -> list[str]:
    """Names a scientist or the instrument gave this experiment: labels, uploaded files, runs and instrument files."""
    summary = parsed_summary or {}
    runs = summary.get('runs', [])
    plates = [plate for run in runs for plate in run.get('plates', [])]
    values = [name, original_filename, *summary.get('files', []),
              *(entry.get(key) for entry in [*runs, *plates] for key in ('name', 'instrument_file', 'source_file'))]
    return list(dict.fromkeys(str(value) for value in values if value))
