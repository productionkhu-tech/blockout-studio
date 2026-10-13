"""앱에 넣는 글꼴 만들기 — Pretendard(OTF, github.com/orioncactus/pretendard)에서 자주 쓰는 한글 2,350자(KS X 1001)·영문·기호만 남긴 woff2.
OFL 의 '예약 글꼴 이름' 때문에 줄인 판은 안쪽 이름을 'BlockoutSans' 로 바꾼다(원본은 그대로 Pretendard). 결과: app/fonts/BlockoutSans-<굵기>.woff2
사용: python tools/make_fonts.py "<Pretendard-Medium.otf 등이 있는 폴더>"
"""
import os
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

if len(sys.argv) < 2:
    sys.exit('사용: python tools/make_fonts.py "<Pretendard OTF 폴더>"')
SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "fonts")
WEIGHTS = {500: "Medium", 600: "SemiBold"}                                      # 본문 500 · 제목·강조 600 (400 은 500, 700 은 600 으로 대신 — 앱을 가볍게)


def charset():
    cps = set(range(0x20, 0x7F)) | set(range(0xA0, 0x100))                       # 영문·라틴-1
    cps |= set(range(0x3131, 0x318F))                                              # 한글 자모
    for cp in range(0xAC00, 0xD7A4):                                               # KS X 1001 완성형 2,350자
        try:
            chr(cp).encode("euc-kr")
            cps.add(cp)
        except UnicodeEncodeError:
            pass
    cps |= {ord(c) for c in "·—–‘’“”…•→←↑↓↺↻×÷°±≤≥≈「」『』《》〈〉※★☆✓✔①②③④⑤⑥⑦⑧⑨⑩₩€¹²³"}
    return sorted(cps)


def main():
    os.makedirs(OUT, exist_ok=True)
    cps = charset()
    for w, name in WEIGHTS.items():
        src = os.path.join(SRC, f"Pretendard-{name}.otf")
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["ccmp", "locl", "mark", "mkmk", "tnum"]               # 커닝 표(GPOS)가 절반 — UI 글자엔 티가 안 남
        opts.hinting = False
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        font = subset.load_font(src, opts)
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=cps)
        sub.subset(font)
        for rec in font["name"].names:                                             # 예약 글꼴 이름 대신 새 이름
            try:
                s = rec.toUnicode()
            except Exception:
                continue
            if "Pretendard" in s:
                rec.string = s.replace("Pretendard", "BlockoutSans")
        out = os.path.join(OUT, f"BlockoutSans-{w}.woff2")
        subset.save_font(font, out, opts)
        print(out, f"{os.path.getsize(out) / 1024:.0f} KB")
    assert all(os.path.getsize(os.path.join(OUT, f"BlockoutSans-{w}.woff2")) > 50_000 for w in WEIGHTS), "글꼴이 너무 작음 — 원본 경로 확인"
    names = {r.toUnicode() for r in TTFont(os.path.join(OUT, "BlockoutSans-500.woff2"))["name"].names if r.nameID in (1, 4, 6)}
    assert not any("Pretendard" in n for n in names), names                         # 자가 점검: 예약 이름이 남지 않음
    print("names:", sorted(names))


if __name__ == "__main__":
    main()
