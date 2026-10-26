import { proof } from "./_proof";

export default proof({
  path: "src/common/pipeline/sources/vocabulary/formats.pkl",
  hot: 1,
  page: "5 / 6",
  lines: [
    `matrices: Listing<vocab.MatrixRow> = new {`,
    `  for (platform in List("darwin", "android", "hm", "windows")) {`,
    `    for (format in formats) {`,
    `      row(platform, format)`,
    `    }`,
    `  }`,
    `}`,
  ],
  claim: [
    `4 platforms * 25 formats = 100 rows`,
    `for row in matrix:  row == row(platform, format)`,
    `if not declared(p, w):  w is not offered`,
  ],
  grep: `row\\(platform, format)`,
  hits: [
    `src/common/pipeline/sources/vocabulary/formats.pkl:276:      row(platform, format)`,
  ],
  answer: "1",
  unit: "call",
});
