import { proof } from "./_proof";

export default proof({
  path: "src/representation/leaf/zstd/onprem.zig",
  hot: -1,
  page: "2 / 6",
  lines: [
    `const std = @import("std");`,
    `const build_options = @import("options");`,
    ``,
    `const kernels = @import("../../../common/kernels.zig");`,
    `const binary = @import("../../../common/primitive/binary.zig");`,
    `const checksum = @import("../../../common/primitive/checksum.zig");`,
    `const huffman = @import("../../../common/primitive/huffman.zig");`,
    `const tee = @import("../../../common/primitive/tee.zig");`,
  ],
  claim: [
    `imports(f) subset { std, options, common }   for f in representation`,
    `kernel not in imports(representation)`,
  ],
  grep: `\\.\\./\\.\\./\\.\\./(kernel|compose)`,
  hits: [],
  answer: "0",
  unit: "upward imports",
});
