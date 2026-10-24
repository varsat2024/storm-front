"""Read direct labor hours (install + removal) per repair item from the STORMS-style workbook."""
import openpyxl

SHEET = "Labor time material related"
WIRE_PLACEHOLDER_HOURS = 1.5  # NOT in the workbook: no conductor/span repair hours are provided
DEFAULT_INDIRECT_MULTIPLIER = 4.5  # provided by the challenge team; assumed to include travel + nonproductive time


def _section(rows, title):
    for i, r in enumerate(rows):
        if r and r[0] == title:
            out = []
            for rr in rows[i + 2:]:
                if not rr or rr[0] is None:
                    break
                out.append(rr)
            return out
    raise KeyError(title)


def load(path):
    ws = openpyxl.load_workbook(path, data_only=True)[SHEET]
    rows = [[c for c in r if c is not None] for r in ws.iter_rows(values_only=True)]
    one = lambda t: sum(_section(rows, t)[0][-2:])  # noqa: E731  (install + removal)
    pole = {r[0]: r[-2] + r[-1] for r in _section(rows, "Pole CU Average Hours by Size")}
    xf = {r[0]: r[-2] + r[-1] for r in _section(rows, "Transformer CU Average Hours by Size")}
    items = {
        "pole": {"label": "Poles (40–55 ft)", "hours": pole["Medium"], "source": "workbook: Pole, Medium"},
        "arm": {"label": "Crossarms", "hours": one("Crossarm CU Average Hours"), "source": "workbook: Crossarm"},
        "xf": {"label": "Transformers (25 kVA)", "hours": xf[25], "source": "workbook: Transformer, 25 kVA"},
        "ins": {"label": "Insulator sets (pin + insulator)",
                "hours": one("Pin CU Average Hours") + one("Insulator CU Average Hours"),
                "source": "workbook: Pin + Insulator"},
        "rec": {"label": "Reclosers", "hours": one("Recloser CU Average Hours"), "source": "workbook: Recloser"},
        "wire": {"label": "Wire spans", "hours": WIRE_PLACEHOLDER_HOURS,
                 "source": "PLACEHOLDER: workbook has no conductor repair hours"},
    }
    return {"items": items, "indirect_multiplier": DEFAULT_INDIRECT_MULTIPLIER}
