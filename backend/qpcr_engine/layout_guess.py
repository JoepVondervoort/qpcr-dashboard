"""A proposed plate layout for exports that name no samples.

The technical replicates of one sample agree within a few tenths of a cycle, so the replicate block (two wells
side by side, a 2 × 2 square, …) shows in the Ct values. Blocks are numbered so that one number is one sample in
every gene: by position within each gene's band of rows when the genes sit in equal bands, otherwise in plate
order within each gene. A sample's number is its position and never shifts: plates of one run that share numbers
stay matched, and no answer renumbers anything. Positions without any Ct before the first or after the last sample,
and blocks outside the pattern without any Ct, are named NTC. Positions or blocks with only a late Ct (a primer dimer
in an NTC, or a sample with very little template), and positions without any Ct between samples (an NTC, or a failed
sample) are left for the scientist: they stay unnamed, with the question what they are. The suggestion says when it
is unsure; only clear patterns are applied without asking (see sample_numbering.py).
"""
from __future__ import annotations

import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any, Callable, Iterable

from .layout import UNASSIGNED_ASSAY, UNASSIGNED_SAMPLE, placeholder_names, well_order

Record = dict[str, Any]
IsControl = Callable[[Record], bool]
Shape = tuple[int, int]

SAMPLE_PREFIX = "Sample"
NO_TEMPLATE = "NTC"
# Technical replicates agree within a few tenths of a cycle; neighbouring samples usually do not.
REPLICATE_SD = 0.5
# Replicates may hold a stray well, and late Cts scatter; more blocks than this out of line means the shape is wrong.
STRAY_BLOCKS = 0.25
# A larger block must keep its wells nearly as close together as the tightest block shape.
GROWTH_FACTOR, GROWTH_MARGIN = 1.5, 0.1
# Wells this late scatter by chance (few template copies): they say nothing about which wells are replicates. A
# block with nothing earlier may be a control with a primer dimer (often around 34 cycles) or a sample with very
# little template: the scientist decides.
RELIABLE_CT = 32.0
# More numbered blocks than this with fewer wells than the block shape means the shape is probably wrong.
PARTIAL_BLOCKS = 0.1
# The replicate block covers the plate's wells in whole blocks; a shape that leaves clearly more wells in broken
# blocks than another (four-well blocks laid over triplicates) is not the replicate block.
COVERAGE_SLACK = 0.05
# A plate name in front of sample numbers stays short enough for a sample name.
PLATE_PREFIX_MAX = 40
MIN_BLOCKS = 3
# The gene of a band fills most of it; another gene may take a few of its positions.
BAND_FILL = 2 / 3
SILENT = ""
SHAPES: tuple[Shape, ...] = ((1, 2), (2, 1), (1, 3), (3, 1), (2, 2), (1, 4), (4, 1))
SHAPE_LABELS = {(1, 1): "one well", (1, 2): "2 wells side by side", (2, 1): "2 wells stacked", (1, 3): "3 wells side by side",
                (3, 1): "3 wells stacked", (2, 2): "a 2 × 2 square of wells", (1, 4): "4 wells side by side", (4, 1): "4 wells stacked"}


@dataclass(frozen=True)
class Well:
    name: str
    row: int
    col: int
    gene: str
    cts: tuple[tuple[str, float | None], ...]

    @property
    def signal(self) -> bool:
        """A clear Ct: template was there."""
        return any(ct is not None and ct <= RELIABLE_CT for _, ct in self.cts)

    @property
    def measured(self) -> bool:
        """Any Ct at all, however late."""
        return any(ct is not None for _, ct in self.cts)


@dataclass(frozen=True)
class Block:
    row: int
    col: int
    gene: str
    wells: tuple[Well, ...]

    @property
    def signal(self) -> bool:
        return any(well.signal for well in self.wells)

    @property
    def measured(self) -> bool:
        return any(well.measured for well in self.wells)


def _position(name: str) -> tuple[int, int] | None:
    row, col, _ = well_order(name)
    return (row - ord("A"), col - 1) if row < 999 else None


def _plate_wells(records: list[Record], candidates: set[str]) -> list[Well]:
    by_well: dict[str, list[Record]] = defaultdict(list)
    for r in records:
        by_well[r["well"]].append(r)
    wells = []
    for name, found in by_well.items():
        position = _position(name)
        if position is None or not all(r["sample"] in candidates and r.get("assay") != UNASSIGNED_ASSAY for r in found):
            continue
        cts = tuple(sorted((str(r["assay"]), r.get("ct") if r.get("status", "detected") == "detected" else None) for r in found))
        wells.append(Well(name, *position, " + ".join(assay for assay, _ in cts), cts))
    return sorted(wells, key=lambda w: (w.row, w.col))


def _blocks(wells: Iterable[Well], shape: Shape, offset: Shape = (0, 0)) -> list[Block]:
    tiles: dict[tuple[int, int, str], list[Well]] = defaultdict(list)
    for w in wells:
        tiles[((w.row - offset[0]) // shape[0], (w.col - offset[1]) // shape[1], w.gene)].append(w)
    return sorted((Block(row, col, gene, tuple(found)) for (row, col, gene), found in tiles.items()), key=lambda b: (b.row, b.col, b.gene))


def _block_spreads(blocks: list[Block], size: int) -> list[float]:
    """The Ct SD of every full block whose wells all have a reliable Ct, per gene of a multiplex well."""
    spreads = []
    for block in blocks:
        if len(block.wells) != size:
            continue
        for index in range(len(block.wells[0].cts)):
            values = [w.cts[index][1] for w in block.wells]
            if all(value is not None and value <= RELIABLE_CT for value in values):
                spreads.append(statistics.stdev(values))
    return spreads


Score = tuple[float, float, Shape, float]


def _coverage(blocks: list[Block], size: int) -> float:
    """The share of wells with a clear signal that sit in whole blocks."""
    heard = [len([w for w in b.wells if w.signal]) for b in blocks]
    whole = [count for count, b in zip(heard, blocks) if len(b.wells) == size]
    return sum(whole) / sum(heard) if sum(heard) else 0.0


def _spread(wells: list[Well], shape: Shape) -> Score | None:
    """Median block SD, the share of out-of-line blocks, the alignment and the whole-block coverage, at the best alignment."""
    scores = []
    for offset in ((dr, dc) for dr in range(shape[0]) for dc in range(shape[1])):
        blocks = _blocks(wells, shape, offset)
        spreads = _block_spreads(blocks, shape[0] * shape[1])
        if len(spreads) >= MIN_BLOCKS:
            stray = sum(s > REPLICATE_SD for s in spreads) / len(spreads)
            scores.append((statistics.median(spreads), stray, offset, _coverage(blocks, shape[0] * shape[1])))
    return min(scores) if scores else None


def _fits(score: Score | None, limit: float) -> bool:
    return score is not None and score[0] <= limit and score[1] <= STRAY_BLOCKS


def _size(shape: Shape) -> int:
    return shape[0] * shape[1]


def replicate_shape(wells: list[Well]) -> tuple[Shape, Shape, list[str]]:
    """The replicate block, its alignment and any doubt about it.

    Every shape is scored on its own. The largest shape whose blocks agree nearly as well as the tightest one, and
    that leaves no more wells in broken blocks, wins: triplicates side by side agree as well as pairs within them,
    while blocks that mix two samples do not, and four-well blocks laid over triplicates break at the row ends.
    """
    scores = {shape: _spread(wells, shape) for shape in SHAPES}
    fitting = [shape for shape in SHAPES if _fits(scores[shape], REPLICATE_SD)]
    if not fitting:
        return (1, 1), (0, 0), ["Neighbouring wells do not agree like technical replicates, so each well is taken as its own sample."]
    tightest = min(scores[shape][0] for shape in fitting)
    limit = min(REPLICATE_SD, max(tightest * GROWTH_FACTOR, tightest + GROWTH_MARGIN))
    close = [shape for shape in fitting if scores[shape][0] <= limit]
    covered = max(scores[shape][3] for shape in close)
    close = [shape for shape in close if scores[shape][3] >= covered - COVERAGE_SLACK]
    # Of equally large blocks that fit, a square (2 × 2) is the more common way to pipette replicates than a line.
    shape = max(close, key=lambda s: (_size(s), -abs(s[0] - s[1]), -scores[s][0]))
    doubts = []
    if any(_size(other) == _size(shape) and other != shape for other in close):
        doubts.append("Wells agree side by side as well as stacked, so which wells are replicates is a guess.")
    if any(_fits(_spread(wells, bigger), limit) for bigger in ((shape[0] * 2, shape[1]), (shape[0], shape[1] * 2))):
        doubts.append("Neighbouring samples are as similar as replicate wells, so how many wells one sample has is a guess.")
    return shape, scores[shape][2], doubts


def _row_genes(blocks: list[Block], size: int) -> dict[int, str]:
    """The gene with most blocks in each block row; a tie continues the gene of the row above.

    A row belongs to no gene, so it never joins a band, when most of its blocks have no Ct or fewer wells than a
    replicate block (a stray half row), or when no gene has half of it (a row of controls, one block per gene). A gene
    expressed so little that every Ct is late still has its band.
    """
    genes: dict[int, str] = {}
    for row in sorted({b.row for b in blocks}):
        members = [b for b in blocks if b.row == row]
        counts = Counter(b.gene for b in members)
        top = max(counts.values())
        if sum(not b.measured or len(b.wells) < size for b in members) * 2 > len(members) or top * 2 < len(members):
            genes[row] = SILENT
            continue
        tied = sorted(gene for gene, count in counts.items() if count == top)
        genes[row] = genes[row - 1] if genes.get(row - 1) in tied else tied[0]
    return genes


def _bands(blocks: list[Block], size: int) -> list[tuple[str, tuple[int, ...]]]:
    """Consecutive block rows of one gene."""
    bands: list[tuple[str, tuple[int, ...]]] = []
    for row, gene in _row_genes(blocks, size).items():
        joins = bool(bands) and bands[-1][0] == gene and bands[-1][1][-1] == row - 1
        bands = [*bands[:-1], (gene, (*bands[-1][1], row))] if joins else [*bands, (gene, (row,))]
    return bands


def _band_numbers(blocks: list[Block], size: int) -> dict[Block, int] | None:
    """Same position in every gene's band, same sample; None unless the genes sit in equal, separate bands."""
    bands = _bands(blocks, size)
    heights = Counter(len(rows) for gene, rows in bands if gene != SILENT).most_common(1)
    if not heights:
        return None
    height = heights[0][0]
    main = [(gene, rows) for gene, rows in bands if len(rows) == height and gene != SILENT]
    width = max(b.col for b in blocks) + 1
    band_of = {row: (gene, rows[0]) for gene, rows in main for row in rows}
    inside = [b for b in blocks if b.row in band_of]
    own = [gene for gene, _ in main]
    if len(main) < 2 or len(set(own)) != len(own):
        return None
    for gene, rows in main:
        members = [b for b in inside if b.row in rows]
        if sum(b.gene == gene for b in members) < BAND_FILL * height * width:
            return None
        # A gene with a band of its own that also fills positions of another band wraps across rows.
        if any(b.gene in own and b.gene != gene for b in members):
            return None
    position = {b: (b.row - band_of[b.row][1], b.col) for b in inside}
    number = {spot: index + 1 for index, spot in enumerate(sorted(set(position.values())))}
    return {b: number[position[b]] for b in inside}


def _runs(order: list[Block], gene: str) -> list[list[Block]]:
    """Stretches of a gene's blocks with no other gene's block between them, in plate order."""
    indices = [index for index, block in enumerate(order) if block.gene == gene]
    starts = [i for i, index in enumerate(indices) if i == 0 or indices[i - 1] != index - 1]
    return [[order[index] for index in indices[start:end]] for start, end in zip(starts, [*starts[1:], len(indices)])]


def _gene_numbers(blocks: list[Block]) -> tuple[dict[Block, int], list[str]]:
    """The n-th block of each gene's longest stretch in plate order is sample n."""
    order = sorted(blocks, key=lambda b: (b.row, b.col, b.gene))
    numbers: dict[Block, int] = {}
    counts: dict[str, int] = {}
    for gene in sorted({b.gene for b in blocks}):
        run = max(_runs(order, gene), key=len)
        if len(run) > 1 or any(b.signal for b in run):
            counts[gene] = len(run)
            numbers.update({block: index + 1 for index, block in enumerate(run)})
    doubts = []
    if len(set(counts.values())) > 1:
        listed = ", ".join(f"{gene}: {count}" for gene, count in sorted(counts.items()))
        doubts.append(f"Genes have different numbers of samples ({listed}), so a number may not be the same sample in every gene.")
    return numbers, doubts


def _wells_text(wells: list[str]) -> str:
    return f"{len(wells)} well{'s' if len(wells) != 1 else ''}"


def _ct_text(blocks: Iterable[Block]) -> str:
    cts: dict[str, list[float]] = defaultdict(list)
    for w in (w for b in blocks for w in b.wells):
        for assay, ct in w.cts:
            if ct is not None:
                cts[assay].append(ct)
    return "; ".join(f"{assay} Ct {', '.join(f'{ct:.1f}' for ct in sorted(values))}" for assay, values in sorted(cts.items()))


def _by_number(numbers: dict[Block, int]) -> dict[int, list[Block]]:
    found: dict[int, list[Block]] = defaultdict(list)
    for block, number in numbers.items():
        found[number].append(block)
    return dict(found)


def _classify(numbers: dict[Block, int]) -> tuple[set[int], set[int], set[int]]:
    """Sample numbers with a clear Ct, control positions, and positions the scientist decides.

    Positions without any Ct are controls only before the first or after the last sample: between samples, an empty
    position may as well be a failed sample.
    """
    groups = _by_number(numbers)
    heard = {n for n, found in groups.items() if any(b.signal for b in found)}
    silent = {n for n, found in groups.items() if not any(b.measured for b in found)}
    ends = {n for n in silent if not heard or n < min(heard) or n > max(heard)}
    return heard, ends, set(groups) - heard - ends


def _held_groups(numbers: dict[Block, int], held: set[int], outside: list[Block]) -> list[dict[str, Any]]:
    """Wells for the scientist to decide, per held sample number (all genes there) or per late block outside the pattern."""
    groups = _by_number(numbers)
    found = [(f"{SAMPLE_PREFIX} {n}", groups[n]) for n in sorted(held)] + [(None, [b]) for b in outside if b.measured and not b.signal]
    return [{"sample": sample, "wells": sorted((w.name for b in blocks for w in b.wells), key=well_order),
             "reason": "late" if any(b.measured for b in blocks) else "none", "cts": _ct_text(blocks) or "no Ct"}
            for sample, blocks in found]


def _summary(samples: int, shape: Shape, numbering: str, guests: list[str], controls: list[str], unfitted: list[Block],
             placeholder: str | None, late: list[dict[str, Any]]) -> str:
    sentences = [f"Every well is named “{placeholder}” in the export."] if placeholder else []
    if numbering == "band":
        sentences.append(f"{samples} samples, each in {SHAPE_LABELS[shape]}, numbered left to right through each gene's rows: "
                         "the same number is the same sample in every gene.")
        if guests:
            sentences.append(f"{', '.join(guests)} sit{'s' if len(guests) == 1 else ''} in another gene's rows and {'is' if len(guests) == 1 else 'are'} numbered by position too.")
    else:
        sentences.append(f"{samples} samples, each in {SHAPE_LABELS[shape]}, numbered in plate order within each gene: "
                         "the first block of every gene is sample 1.")
    if controls:
        sentences.append(f"{_wells_text(controls)} without any Ct, before or after the samples or outside the pattern, are named {NO_TEMPLATE}.")
    if unfitted:
        wells = [w.name for b in unfitted for w in b.wells]
        genes = ", ".join(sorted({b.gene for b in unfitted}))
        sentences.append(f"{_wells_text(wells)} ({genes}) do not fit the pattern and keep no name.")
    if late:
        wells = [well for group in late for well in group["wells"]]
        sentences.append(f"{_wells_text(wells)} with only a late Ct (above {RELIABLE_CT:g}), or without any Ct between samples, stay unnamed "
                         "until you say whether they are no-template controls or samples.")
    return " ".join(sentences)


def _suggest(run_id: str, plate: str | None, wells: list[Well], placeholder: str | None) -> dict[str, Any]:
    shape, offset, doubts = replicate_shape(wells)
    blocks = _blocks(wells, shape, offset)
    banded = _band_numbers(blocks, shape[0] * shape[1])
    numbers, numbering_doubts = (banded, []) if banded else _gene_numbers(blocks)
    numbering = "band" if banded else "gene"
    heard, ends, held = _classify(numbers)
    outside = [b for b in blocks if b not in numbers]
    controls = [b for b in outside if not b.measured] + [b for b, n in numbers.items() if n in ends]
    unfitted = [b for b in outside if b.signal]
    late = _held_groups(numbers, held, outside)
    row_genes = _row_genes(blocks, shape[0] * shape[1])
    guests = sorted({b.gene for b, n in numbers.items() if b.gene != row_genes[b.row] and n in heard}) if banded else []
    assignments = {**{w.name: NO_TEMPLATE for b in controls for w in b.wells},
                   **{w.name: f"{SAMPLE_PREFIX} {n}" for b, n in numbers.items() if n in heard for w in b.wells}}
    control_wells = sorted((w.name for b in controls for w in b.wells), key=well_order)
    samples = len(heard)
    partial = [b for b, n in numbers.items() if n in heard and len(b.wells) < _size(shape)]
    shape_doubts = [f"{len(partial)} of the {len(numbers)} sample blocks have fewer wells than {SHAPE_LABELS[shape]}, "
                    "so the replicate block may be wrong."] if len(partial) > PARTIAL_BLOCKS * len(numbers) else []
    all_doubts = [*doubts, *shape_doubts, *numbering_doubts]
    return {"run_id": run_id, "plate": plate, "kind": "placeholder" if placeholder else "unnamed",
            "wells": dict(sorted(assignments.items(), key=lambda item: well_order(item[0]))),
            "samples": samples, "positions": len(set(numbers.values())), "shape": list(shape), "numbering": numbering, "late": late,
            "controls": control_wells, "unfitted": sorted((w.name for b in unfitted for w in b.wells), key=well_order),
            "summary": _summary(samples, shape, numbering, guests, control_wells, unfitted, placeholder, late),
            "doubts": all_doubts, "confident": not all_doubts}


def _candidates(records: list[Record], is_control: IsControl, confirmed: set[str]) -> tuple[set[str], str | None] | None:
    """Names to number on one plate: no names at all, or one placeholder name; None when samples are named.

    A placeholder the scientist confirmed as technical replicates of one sample is a name, not a placeholder.
    """
    biological = {r["sample"] for r in records if r.get("assay") != UNASSIGNED_ASSAY and not is_control(r)}
    if biological == {UNASSIGNED_SAMPLE}:
        return {UNASSIGNED_SAMPLE}, None
    placeholders = placeholder_names(records, is_control) - confirmed
    named = biological - {UNASSIGNED_SAMPLE}
    if len(named) == 1 and named <= placeholders:
        return biological, next(iter(named))
    return None


def _plate_labels(suggestions: list[dict[str, Any]]) -> dict[tuple[str, str | None], str]:
    """Short plate names to put before sample numbers; numbered plates when shortening makes two names alike."""
    runs: dict[str, list[str | None]] = defaultdict(list)
    for s in suggestions:
        runs[s["run_id"]].append(s["plate"])
    labels = {}
    for run, plates in runs.items():
        short = [str(plate)[:PLATE_PREFIX_MAX].strip() for plate in plates]
        distinct = len(set(short)) == len(short) and all(short)
        labels.update({(run, plate): short[i] if distinct else f"Plate {i + 1}" for i, plate in enumerate(plates)})
    return labels


def _across_plates(suggestions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Plates of one run that measure the same gene hold different samples: their numbers carry the plate name.

    Plates of one run with different genes share numbers, as the same samples in the same layout; that is a guess
    when the plates hold different numbers of samples.
    """
    plates: dict[tuple[str, str], set[str | None]] = defaultdict(set)
    counts: dict[str, dict[str | None, int]] = defaultdict(dict)
    for s in suggestions:
        counts[s["run_id"]][s["plate"]] = s["positions"]
        for well in s["wells"]:
            for assay in s["_assays"][well]:
                plates[(s["run_id"], assay)].add(s["plate"])
    shared = {run for (run, _), found in plates.items() if len(found) > 1}
    labels = _plate_labels(suggestions)

    def finished(s: dict[str, Any]) -> dict[str, Any]:
        base = {key: value for key, value in s.items() if key != "_assays"}
        if s["run_id"] in shared and s["plate"]:
            label = labels[(s["run_id"], s["plate"])]
            late = [{**group, "sample": group["sample"] and f"{label} {group['sample']}"} for group in s["late"]]
            return {**base, "late": late, "wells": {well: name if name == NO_TEMPLATE else f"{label} {name}" for well, name in s["wells"].items()}}
        if len(set(counts[s["run_id"]].values())) > 1:
            listed = ", ".join(f"{plate}: {count}" for plate, count in sorted(counts[s["run_id"]].items(), key=lambda item: str(item[0])))
            doubt = f"The plates of this run hold different numbers of sample positions ({listed}), so a number may not be the same sample on every plate."
            return {**base, "doubts": [*s["doubts"], doubt], "confident": False}
        return base
    return [finished(s) for s in suggestions]


def suggest_layouts(records: list[Record], is_control: IsControl, confirmations: Iterable[dict[str, Any]] = ()) -> list[dict[str, Any]]:
    """One proposal per plate whose wells carry no sample names (or one placeholder name)."""
    plates: dict[tuple[str, str | None], list[Record]] = defaultdict(list)
    for r in records:
        plates[(str(r.get("run_id", "")), r.get("plate"))].append(r)
    confirmed = {(c.get("run_id"), c.get("plate"), c.get("sample")) for c in confirmations if isinstance(c, dict)}
    suggestions = []
    for (run_id, plate), found in sorted(plates.items(), key=lambda item: (item[0][0], item[0][1] or "")):
        candidates = _candidates(found, is_control, {sample for run, on, sample in confirmed if (run, on) == (run_id, plate)})
        if candidates is None:
            continue
        wells = _plate_wells([r for r in found if not is_control(r)], candidates[0])
        if wells:
            suggestion = _suggest(run_id, plate, wells, candidates[1])
            suggestions.append({**suggestion, "_assays": {w.name: [assay for assay, _ in w.cts] for w in wells}})
    return _across_plates(suggestions)
