import { proof } from "./_proof";

export default proof({
  path: "build.zig.zon",
  hot: 0,
  page: "5 / 6",
  lines: [
    `    .dependencies = .{`,
    `        .translate_c = .{`,
    `            .path = "pkg/translate-c",`,
    `        },`,
    `        .aro = .{`,
    `            .path = "pkg/arocc",`,
    `        },`,
    `    },`,
  ],
  claim: [
    `dependents(libstd) = { translate_c, aro }`,
    `vendor not in dependents(libstd)`,
  ],
  grep: `\\.path = `,
  hits: [
    `build.zig.zon:8:            .path = "pkg/translate-c",`,
    `build.zig.zon:11:            .path = "pkg/arocc",`,
  ],
  answer: "2",
  unit: "dependencies",
});
