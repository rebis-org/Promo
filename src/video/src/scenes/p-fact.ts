import { proof } from "./_proof";

export default proof({
  path: "src/common/pipeline/sources/vocabulary/formats.pkl",
  hot: 3,
  page: "1 / 6",
  lines: [
    `formats: Listing<vocab.FormatEntry> = new {`,
    `  new {`,
    `    wireName = "zip"`,
    `    extraAliases { "xpi"; "cbz"; "jar"; "apk"; "aar"; "ear"; "war"; "ipa" }`,
    `    password = true`,
    `    mime = "application/zip"`,
    `    kernel = "zip"`,
    `  }`,
  ],
  claim: [
    `for p in ports:  p = project(table, p)`,
    `for p in ports:  p != copy(q)`,
  ],
  grep: `"xpi"`,
  hits: [
    `src/common/pipeline/sources/vocabulary/formats.pkl:6:    extraAliases { "xpi"; "cbz"; "jar"; "apk"; "aar"; "ear"; "war"; "ipa" }`,
  ],
  answer: "1",
  unit: "fact",
});
