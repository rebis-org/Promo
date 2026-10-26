import { proof } from "./_proof";

export default proof({
  path: "src/common/pipeline/sources/vocabulary/formats.pkl",
  hot: 1,
  page: "3 / 6",
  lines: [
    `compounds: Listing<vocab.CompoundSuffix> = new {`,
    `  new { suffix = ".tar.gz"; format = "tgz"; detect = true }`,
    `  new { suffix = ".tar.bz2"; format = "tbz2"; detect = true }`,
    `  new { suffix = ".tar.xz"; format = "txz"; detect = true }`,
    `  new { suffix = ".tar.zst"; format = "tzst"; detect = true }`,
    `  new { suffix = ".tar.bz"; format = "tbz2"; detect = false }`,
    `}`,
  ],
  claim: [`match(n) = longest s in declared such that n ends s`],
  grep: `suffix = "\\.tar`,
  hits: [
    `src/common/pipeline/sources/vocabulary/formats.pkl:131:  new { suffix = ".tar.gz"; format = "tgz"; detect = true }`,
    `src/common/pipeline/sources/vocabulary/formats.pkl:132:  new { suffix = ".tar.bz2"; format = "tbz2"; detect = true }`,
    `src/common/pipeline/sources/vocabulary/formats.pkl:133:  new { suffix = ".tar.xz"; format = "txz"; detect = true }`,
    `src/common/pipeline/sources/vocabulary/formats.pkl:134:  new { suffix = ".tar.zst"; format = "tzst"; detect = true }`,
    `src/common/pipeline/sources/vocabulary/formats.pkl:135:  new { suffix = ".tar.bz"; format = "tbz2"; detect = false }`,
  ],
  answer: "5",
  unit: "compounds",
});
