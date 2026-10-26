import { rowPage } from "./_rows";

export default rowPage({
  path: "src/common/pipeline/sources/vocabulary/formats.pkl",
  page: "2 / 6",
  claim: [
    `spell : table * lang -> source`,
    `for p in ports:  spell(p) == table`,
  ],
  size: 16,
  labelW: 112,
  rows: [
    {
      label: "pkl",
      text: `    extraAliases { "xpi"; "cbz"; "jar"; "apk"; "aar"; "ear"; "war"; "ipa" }`,
    },
    {
      label: "kt",
      text: `    Zip("zip", "zip", true, listOf("zip", "xpi", "cbz", "jar", "apk", "aar", "ear", "war", "ipa")),`,
    },
    {
      label: "swift",
      text: `            Metadata(preferredExtension: "zip", isContainer: true, aliases: ["zip", "xpi", "cbz", "jar", "apk", "aar", "ear", "war", "ipa"])`,
    },
    {
      label: "cj",
      text: `            case Zip => ["zip", "xpi", "cbz", "jar", "apk", "aar", "ear", "war", "ipa"]`,
    },
    {
      label: "cs",
      text: `        new(Format.Zip, "zip", "zip", true, ["zip", "xpi", "cbz", "jar", "apk", "aar", "ear", "war", "ipa"], true, "application/zip"),`,
    },
    {
      label: "c",
      text: `static const char *const aliases_zip[] = { "zip", "xpi", "cbz", "jar", "apk",`,
      more: [`${" ".repeat(43)}"aar", "ear", "war", "ipa", NULL };`],
    },
  ],
  grep: `"xpi"`,
  hits: [
    `src/common/kernel/src/table.c:6:static const char *const aliases_zip[] = { "zip", "xpi", "cbz", "jar", "apk",`,
    `src/common/pipeline/sources/vocabulary/formats.pkl:6:    extraAliases { "xpi"; "cbz"; "jar"; "apk"; "aar"; "ear"; "war"; "ipa" }`,
    `src/platforms/android/modules/kernel/domain/src/main/kotlin/dev/rebis/transform/kernel/domain/Format.kt:15:    Zip("zip", "zip", true, listOf("zip", "xpi", "cbz", "jar", "apk", "aar", "ear", "war", "ipa")),`,
    `src/platforms/hm/modules/kernel/domain/src/main/cangjie/format.cj:131:            case Zip => ["zip", "xpi", "cbz", "jar", "apk", "aar", "ear", "war", "ipa"]`,
    `src/platforms/darwin/Sources/Common/Backend/Domain/Format.swift:75:            Metadata(preferredExtension: "zip", isContainer: true, aliases: ["zip", "xpi", "cbz", "jar", "apk", "aar", "ear", "war", "ipa"])`,
  ],
  answer: "6",
  unit: "files",
});
