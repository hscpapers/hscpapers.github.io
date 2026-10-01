# hscpapers

NSW HSC past and trial papers, sorted by subject, year and exam.

[hscpapers.github.io](https://hscpapers.github.io/)

## Where the papers live

- PDFs: served from the `files-1` to `files-9` repos (GitHub Pages caps each site at 1 GB). They copy from [UBGHyper/thgilciffart](https://github.com/UBGHyper/thgilciffart), a fork of [papersdb](https://github.com/thgilciffart/thgilciffart), using the split in `scripts/shards.json`.
- Linked papers: [thsc.zaxu.xyz](https://thsc.zaxu.xyz/)

See [NOTICE.md](NOTICE.md).

## Rebuilding the data

`python scripts/generate_manifest.py` (inputs described at the top of the script)

## Credit

- [papersdb](https://papersdb.org/) by thgilciffart and icecreambobcat
- [THSC](https://thsconline.github.io/s/) for most of the school papers
- [zaxu](https://thsc.zaxu.xyz/) for the THSC mirror
