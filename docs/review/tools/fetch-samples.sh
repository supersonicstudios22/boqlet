#!/usr/bin/env bash
# fetch-samples.sh: download the review's public IFC sample set into docs/review/_samples/
# and check every file's SHA-256. Run from anywhere:
#
#   bash docs/review/tools/fetch-samples.sh            # download what is missing, verify all
#   bash docs/review/tools/fetch-samples.sh --force    # download everything again
#   bash docs/review/tools/fetch-samples.sh --verify   # only verify checksums, no network
#   bash docs/review/tools/fetch-samples.sh --only=S01,S05   # some samples (CI, review B-04)
#
# Every URL is pinned to a git commit, so the bytes never change. Two edge-case files
# (S13, S14) are derived locally from S05 so they need no download; their checksums are
# checked too. Needs bash, curl and sha256sum (Git Bash on Windows has all three).
# The samples are git-ignored (docs/review/.gitignore); their licences are their sources'
# (see docs/review/00-context.md, "Sample files"). They are never committed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(cd "$HERE/.." && pwd)/_samples"
mkdir -p "$OUT"
FORCE=0; VERIFY_ONLY=0; ONLY=""
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    --verify) VERIFY_ONLY=1 ;;
    --only=*) ONLY=",${a#--only=}," ;;        # e.g. --only=S01,S05 (review B-04: CI fetches the small samples)
    *) echo "unknown flag $a" >&2; exit 64 ;;
  esac
done

STF="https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/5030f652e85d3e679b392fcb38bfa3328d6d9f79"
YSC="https://raw.githubusercontent.com/youshengCode/IfcSampleFiles/7e6927982d7e57b29409bb631ef93d6770ef0665"
IOS="https://raw.githubusercontent.com/IfcOpenShell/files/79f40be8b37f0d67c1f8b139e546b399f315878b"
SCH="https://raw.githubusercontent.com/openBIMstandards/Archive-DataSetSchependomlaan/e6971d897b60f04ea28b4e3f2acf80d05f269197"

# id | local file name | url (or "derived:<how>") | sha256
SAMPLES=(
"S01|S01-wall-with-opening-and-window.ifc|$STF/IFC%204.0.2.1%20%28IFC%204%20ADD2%20TC1%29/ISO%20Spec%20-%20ReferenceView_V1.2/wall-with-opening-and-window.ifc|73b0e45d931d5dc13bfee5fdc7bd80f796526445458b2de74c4168d209097832"
"S02|S02-column-straight-rectangle-tessellation.ifc|$STF/IFC%204.0.2.1%20%28IFC%204%20ADD2%20TC1%29/ISO%20Spec%20-%20ReferenceView_V1.2/column-straight-rectangle-tessellation.ifc|58bb9b2cae96edf2c368de95f526650f3f282e4e7fc37c0065c501bdbeed00a1"
"S03|S03-simple-scene-architecture-ifc2x3.ifc|$STF/IFC%202.3.0.1%20%28IFC%202x3%20TC1%29/Simple-Scene/Building-Architecture.ifc|c4db65ba847f6b369a95d6c54fa11f4750cbe6d59f021934e8923d8d578e5885"
"S04|S04-simple-scene-structural-ifc4x3.ifc|$STF/IFC%204.3.2.0%20%28IFC%204.3%20ADD2%29/Simple-Scene/Building-Structural.ifc|db64895488aad4eab082c8292f5632145b0fc864c0642d4fe667404882bacf27"
"S05|S05-duplex-architecture-ifc2x3.ifc|$YSC/Ifc2x3_Duplex_Architecture.ifc|b347a2c8aa8fff6db896a4417a9c50c22ac0ccd7c5cfc22b99b8d29336c606ed"
"S06|S06-duplex-mep-ifc2x3.ifc|$YSC/Ifc2x3_Duplex_MEP.ifc|13976a8e223f177a6d7123679e4b02e750cd90c13f7bb20c593be125d9407119"
"S07|S07-revit-arc-ifc4.ifc|$YSC/Ifc4_Revit_ARC.ifc|c4dd3612f126a0ca5a57f0e75d28f3e5da62751def85a452d849883c2892b518"
"S08|S08-revit-str-ifc4.ifc|$YSC/Ifc4_Revit_STR.ifc|8c16c7ecf76786568c5374e624575cbd3586ec646468dad6f9ea3c9a4e97239f"
"S09|S09-samplehouse-ifc4.ifc|$YSC/Ifc4_SampleHouse.ifc|7606dc4e96b538d6fe7f2fa76655f26186d64d0226f8a10fbc141b9f2cd6cbfe"
"S10|S10-schependomlaan-planning-ifc2x3-65mb.ifc|$SCH/As%20Planned%20models/IFC%20Schependomlaan%20incl%20planningsdata.ifc|57fafa59f03b18c05be211a456e346bdd0445d5c35d66522e598d339e81dfcf4"
"S11|S11-ios-1948-wall-wrong-geometry.ifc|$IOS/1948--wall--wrong-geometry.ifc|776049ebea8c06b0c50f2d2e976a30480a29152c00e3d7da8fc0a34bbf3f33c6"
"S12|S12-ios-478-walls-missing-subtractions.ifc|$IOS/478--walls--missing-subtractions--augmented.ifc|393de14c26b4ab9423941d750c1be60ec5b419da43d3f74f4c237f9cc77e7f85"
"S13|S13-truncated-duplex.ifc|derived:first 1000000 bytes of S05|74dab90474b3ef538e15a8b36ad8af83d0348df2737e4f65bd0cb8c00885e488"
"S14|S14-not-an-ifc.ifc|derived:fixed text, not STEP|de73fa3a7f28c6acce098a084bae104ac4df552f417590ce2e5b8e404f9309e2"
)

checksum_of() { sha256sum "$1" | cut -d' ' -f1; }
fail=0

for row in "${SAMPLES[@]}"; do
  IFS='|' read -r id name url want <<<"$row"
  if [[ -n "$ONLY" && "$ONLY" != *",$id,"* ]]; then continue; fi
  f="$OUT/$name"
  if [[ $VERIFY_ONLY -eq 0 && ( $FORCE -eq 1 || ! -s "$f" ) ]]; then
    case "$url" in
      derived:first*)
        src="$OUT/S05-duplex-architecture-ifc2x3.ifc"
        head -c 1000000 "$src" > "$f" ;;
      derived:fixed*)
        printf 'This is a plain text file with an .ifc extension.\nIt is not ISO-10303-21.\n' > "$f" ;;
      *)
        echo "downloading $id $name"
        curl -fsSL --retry 3 -o "$f.part" "$url"
        mv "$f.part" "$f" ;;
    esac
  fi
  if [[ ! -f "$f" ]]; then echo "MISSING $id $name"; fail=1; continue; fi
  got="$(checksum_of "$f")"
  if [[ "$got" == "$want" ]]; then
    printf 'ok      %s %-48s %10s bytes\n' "$id" "$name" "$(wc -c <"$f" | tr -d ' ')"
  else
    printf 'BAD     %s %s\n        want %s\n        got  %s\n' "$id" "$name" "$want" "$got"; fail=1
  fi
done

if [[ $fail -ne 0 ]]; then echo "fetch-samples: some files are missing or changed" >&2; exit 1; fi
if [[ -n "$ONLY" ]]; then echo "fetch-samples: the requested samples (${ONLY:1:-1}) are present and verified in $OUT"; else echo "fetch-samples: all ${#SAMPLES[@]} samples present and verified in $OUT"; fi
