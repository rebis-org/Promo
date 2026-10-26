import { proof } from "./_proof";

export default proof({
  path: "src/common/pipeline/cmd/pipeline/formats_c.go",
  hot: 1,
  page: "6 / 6",
  lines: [
    `const (`,
    `	lineLimit  = 78 // the formatter's packed-list budget`,
    `	tabWidth   = 8`,
    `	initialCol = tabWidth`,
    `)`,
  ],
  claim: [`gen(x) = fmt(gen(x))`, `check  <=>  gen(x) == fmt(gen(x))`],
  grep: `GENERATED from`,
  hits: [
    `src/common/kernel/src/table.c:1:// GENERATED from src/common/pipeline/sources/vocabulary/formats.pkl.`,
    `src/common/kernel/include/vocab.h:1:// GENERATED from src/common/pipeline/sources/vocabulary/stdk.pkl.`,
    `src/common/pipeline/declaration.go:66:        w.Linef("// GENERATED from %s's resolved records.", platform)`,
    `src/common/pipeline/cmd/pipeline/formats_cangjie.go:11:        e.Line("// GENERATED from src/common/pipeline/sources/vocabulary/formats.pkl.")`,
    `src/common/pipeline/cmd/pipeline/formats_cangjie.go:164:        e.Line("// GENERATED from src/common/pipeline/sources/vocabulary/formats.pkl.")`,
  ],
  answer: "36",
  unit: "files",
  sign: "github.com/rebis-org/Transform",
});
