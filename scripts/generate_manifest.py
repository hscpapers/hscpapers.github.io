"""
Builds data/manifest.json (subject index) and data/subjects/<slug>.json from:
  - this repo's own file tree (PDFs hosted here)
  - crawls of https://thsc.zaxu.xyz/ (linked, not copied)

Raw inputs live in scripts/raw/ and aren't committed:
  papersdb_tree.json   GitHub API tree: /repos/<owner>/<repo>/git/trees/main?recursive=true
  thsc_*.json          h5ai crawls, shape {"tree": {"_dirs": {...}, "_files": [{name,url,size,modified}]}}

Run from the repo root:  python scripts/generate_manifest.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "scripts", "raw")
DATA = os.path.join(ROOT, "data")

# (file, year key, THSC type folder -> section). Year 11 crawl has one more level (type folders).
THSC_INPUTS = [
    ("thsc_year12_trial.json", "12", {None: "Trials"}),
    ("thsc_Year_12_HY.json", "12", {None: "Half Yearly"}),
    ("thsc_Year_12_CT1.json", "12", {None: "CT1"}),
    ("thsc_Year_12_CT2.json", "12", {None: "CT2"}),
    ("thsc_Year_12_CT3.json", "12", {None: "CT3"}),
    ("thsc_Year_12_CT4.json", "12", {None: "CT4"}),
    ("thsc_Year_11.json", "11", {"Yearly": "Prelims", "HY": "Half Yearly", "PT1": "PT1", "PT2": "PT2", "PT3": "PT3"}),
]

YEARS = [("12", "Year 12"), ("11", "Year 11"), ("all", "All")]
SECTION_ORDER = {
    "12": ["HSC", "Trials", "Trials Paper 1", "Trials Paper 2", "Half Yearly", "CT1", "CT2", "CT3", "CT4"],
    "11": ["Prelims", "Half Yearly", "PT1", "PT2", "PT3"],
}

# THSC subject folder name -> display name (faculty level is ignored; folders are unambiguous)
THSC_SUBJECTS = {
    "2U": "Mathematics Advanced", "2U (Accelerated)": "Mathematics Advanced",
    "3U": "Mathematics Extension 1", "4U": "Mathematics Extension 2", "Standard": "Mathematics Standard",
    "Biology": "Biology", "Chemistry": "Chemistry", "Physics": "Physics",
    "Earth & Environmental Science": "Earth and Environmental Science", "Senior Science": "Senior Science",
    "Business Studies": "Business Studies", "Economics": "Economics", "Legal Studies": "Legal Studies",
    "Modern History": "Modern History", "Ancient History": "Ancient History", "History Extension": "History Extension",
    "SOR 1": "Studies of Religion I", "SOR 2": "Studies of Religion II",
    "Agriculture": "Agriculture", "Engineering Studies": "Engineering Studies",
    "IPT": "Information Processes and Technology", "SDD": "Software Design and Development",
}
THSC_WHOLE_FACULTY = {"CAFS": "Community and Family Studies", "PDHPE": "PDHPE"}

# papersdb internal-task folders -> section names
NATIVE_INTERNALS = {"HY": "Half Yearly", "Preliminary": "Prelims", "Preliminary HY": "Half Yearly"}

YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def paper_year(title):
    m = YEAR_RE.search(title)
    return int(m.group(0)) if m else 0


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


class Store:
    def __init__(self):
        self.subjects = {}  # name -> {"native": bool, "years": {ykey: {section: {"papers": [], "groups": {}}}}}
        self.seen = set()   # (subject, ykey, section, school, year) of hosted papers, for de-duping THSC links
        self.names = set()  # normalised filenames of hosted papers

    def add(self, subject, ykey, section, group, paper, native):
        s = self.subjects.setdefault(subject, {"native": native, "years": {}})
        s["native"] = s["native"] or native
        sec = s["years"].setdefault(ykey, {}).setdefault(section, {"papers": [], "groups": {}})
        if group:
            sec["groups"].setdefault(group, []).append(paper)
        else:
            sec["papers"].append(paper)


def add_native(store):
    with open(os.path.join(RAW, "papersdb_tree.json"), encoding="utf-8") as f:
        tree = json.load(f)["tree"]
    for b in tree:
        if b["type"] != "blob" or not b["path"].lower().endswith(".pdf"):
            continue
        parts = b["path"].split("/")
        subject, inter, fname = parts[0], parts[1:-1], parts[-1]
        paper = {"title": fname[:-4], "url": b["path"].replace(" ", "%20"), "size": b["size"]}
        top = inter[0] if inter else ""
        if top == "HSC":
            ykey, section, group = "12", "HSC", " / ".join(inter[1:]) or None
        elif top == "Trials":
            ykey, section, group = "12", "Trials", " / ".join(inter[1:]) or None
        elif top in ("Y12 Internals", "Y11 Internals") and len(inter) > 1:
            ykey = "12" if top.startswith("Y12") else "11"
            section = NATIVE_INTERNALS.get(inter[1], inter[1])
            group = " / ".join(inter[2:]) or None
        else:
            ykey, section, group = "all", top or "Other", " / ".join(inter[1:]) or None
        store.add(subject, ykey, section, group, paper, True)
        school = (group or "").split(" / ")[-1]
        store.seen.add((subject, ykey, section, norm(school), paper_year(fname)))
        store.names.add(norm(fname[:-4]))


def files_under(node, path=()):
    for f in node.get("_files", []):
        yield path, f
    for name, child in sorted(node.get("_dirs", {}).items()):
        yield from files_under(child, path + (name,))


def thsc_subjects(faculty_root):
    """Yield (subject display name, node, section suffix) for every mapped subject in a faculty-level tree."""
    for fac, fnode in faculty_root.get("_dirs", {}).items():
        if fac in THSC_WHOLE_FACULTY:
            yield THSC_WHOLE_FACULTY[fac], fnode, ""
        elif fac == "English":
            papers = {k: v for k, v in fnode.get("_dirs", {}).items() if k.startswith("Paper")}
            if papers:
                for pname, pnode in papers.items():
                    yield "English", pnode, " " + pname
            else:
                yield "English", fnode, ""
        else:
            for sub, snode in fnode.get("_dirs", {}).items():
                if sub == "History":
                    for hs, hnode in snode.get("_dirs", {}).items():
                        if hs in THSC_SUBJECTS:
                            yield THSC_SUBJECTS[hs], hnode, ""
                elif sub in THSC_SUBJECTS:
                    yield THSC_SUBJECTS[sub], snode, ""


def add_thsc(store):
    added = skipped = 0
    for fname, ykey, types in THSC_INPUTS:
        path = os.path.join(RAW, fname)
        if not os.path.exists(path):
            print("missing", fname)
            continue
        with open(path, encoding="utf-8") as f:
            root = json.load(f)["tree"]
        if None in types:
            roots = [(types[None], root)]
        else:
            roots = [(types[t], n) for t, n in root.get("_dirs", {}).items() if t in types]
        for base_section, troot in roots:
            for subject, snode, suffix in thsc_subjects(troot):
                section = base_section + (suffix if base_section == "Trials" else "")
                for folders, f in files_under(snode):
                    title = f["name"][:-4] if f["name"].lower().endswith(".pdf") else f["name"]
                    school = folders[-1] if folders else ""
                    key = (subject, ykey, section, norm(school), paper_year(title))
                    if norm(title) in store.names or (school and paper_year(title) and key in store.seen):
                        skipped += 1
                        continue
                    paper = {"title": title, "url": f["url"], "size": f.get("size", "")}
                    store.add(subject, ykey, section, " / ".join(folders) or None, paper, False)
                    added += 1
    print(f"THSC: {added} linked, {skipped} skipped as already hosted")


def section_rank(ykey, name):
    order = SECTION_ORDER.get(ykey, [])
    return (order.index(name) if name in order else len(order), name)


def sort_papers(papers):
    return sorted(papers, key=lambda p: (-paper_year(p["title"]), p["title"]))


def build(store):
    os.makedirs(os.path.join(DATA, "subjects"), exist_ok=True)
    index = []
    for name, s in sorted(store.subjects.items()):
        years, schools, count = [], set(), 0
        for ykey, ylabel in YEARS:
            secs = s["years"].get(ykey)
            if not secs:
                continue
            sections = []
            for sname in sorted(secs, key=lambda n: section_rank(ykey, n)):
                sec = secs[sname]
                groups = [{"name": g, "papers": sort_papers(p)} for g, p in sorted(sec["groups"].items())]
                for g in groups:
                    schools.add(g["name"].split(" / ")[-1])
                count += len(sec["papers"]) + sum(len(g["papers"]) for g in groups)
                sections.append({"key": slugify(sname), "name": sname, "papers": sort_papers(sec["papers"]), "groups": groups})
            years.append({"key": ykey, "name": ylabel, "sections": sections})
        slug = slugify(name)
        with open(os.path.join(DATA, "subjects", slug + ".json"), "w", encoding="utf-8") as f:
            json.dump({"name": name, "slug": slug, "native": s["native"], "years": years}, f, separators=(",", ":"))
        index.append({"name": name, "slug": slug, "native": s["native"], "paperCount": count, "schoolCount": len(schools)})
    with open(os.path.join(DATA, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"subjects": index}, f, indent=1)
    print(f"{len(index)} subjects, {sum(i['paperCount'] for i in index)} papers")


def main():
    store = Store()
    add_native(store)
    add_thsc(store)
    build(store)


if __name__ == "__main__":
    main()
